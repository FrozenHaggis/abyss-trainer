import { useCallback, useEffect, useRef, useState } from 'react'
import type { BossDef } from '../engine/types'
import { suggestedSetup } from '../engine/setup'
import type { BarrelRig } from './barrel/BarrelRig'
import { loadModelIndex, type ModelIndex } from './barrel/modelIndex'
import BossSigil from './BossSigil'

/**
 * The boss picker: a tag barrel of the raid's own models instead of eight cards.
 *
 * The cards are still here, and not as a courtesy. `public/models/` is a
 * hundred megabytes of Blizzard's creature art that this repository does not
 * contain and the Pages build does not ship — see `scripts/fetch-boss-models.mjs`
 * — so the grid is what a fresh clone and the deployed site both get, and the
 * barrel is what appears once somebody has run the script. Both paths pick the
 * same boss and hand it to the same `onSelect`, so nothing downstream of here
 * knows or cares which one is on screen.
 *
 * The setup notes and the description are the same either way. They are read
 * off the boss definition by `suggestedSetup`, so they are as true on a card as
 * they are under a model.
 */
export default function BossBarrel({ bosses, selected, onSelect }: {
  bosses: BossDef[]
  selected: BossDef
  onSelect: (boss: BossDef) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rigRef = useRef<BarrelRig | null>(null)

  /**
   * The raid's model index, or false once we know there is none. Null while the
   * one request that decides it is still in flight.
   *
   * Held here rather than re-fetched by the rig because it is also the answer to
   * "barrel or cards", and asking twice would mean the picker and the renderer
   * could disagree about what exists.
   */
  const [models, setModels] = useState<ModelIndex | false | null>(null)
  /** Which bosses have finished loading, so the overlay can stop saying so. */
  const [ready, setReady] = useState<Set<string>>(new Set())

  const index = Math.max(0, bosses.findIndex(b => b.key === selected.key))
  // Read by the rig's constructor, which runs a chunk-load later than this
  // render and must not be handed the index that was current when it started.
  const indexRef = useRef(index)
  indexRef.current = index

  // `onSelect` comes from App and is a fresh closure on every render, but the
  // rig is constructed once and keeps whatever it was handed. Routing the
  // callback through a ref is what stops the barrel calling a stale setter
  // after the first selection — the alternative is rebuilding the whole WebGL
  // scene on every render, which is eight models reloaded per keypress.
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const bossesRef = useRef(bosses)
  bossesRef.current = bosses

  useEffect(() => {
    let live = true
    void loadModelIndex().then(index => {
      if (!live) return
      // Art for SOME bosses is not enough. A barrel with three creatures and
      // five loading shards on it is worse than the grid, and the shards never
      // resolve — so the barrel is all-or-nothing against the raid roster.
      const keys = new Set(index?.bosses.map(b => b.key) ?? [])
      setModels(index !== null && bosses.every(b => keys.has(b.key)) ? index : false)
    })
    return () => { live = false }
  }, [bosses])

  useEffect(() => {
    if (!models || !canvasRef.current) return
    const canvas = canvasRef.current
    let rig: BarrelRig | null = null
    let live = true
    let onResize: (() => void) | null = null

    // Imported here rather than at the top of the file, and it is the reason
    // `loadModelIndex` lives in a module of its own. three.js, the M2 parser
    // and a BLP decoder come to about seven hundred kilobytes; the deployed
    // build has no models and will never execute a line of it, so it must not
    // be in the bundle every visitor downloads before the page paints.
    void import('./barrel/BarrelRig').then(({ BarrelRig }) => {
      // The screen can be left, or the models can turn out to be absent, while
      // the chunk is in flight. Constructing a rig into a dead canvas leaks a
      // WebGL context and an animation loop nothing will ever cancel.
      if (!live) return
      rig = new BarrelRig(canvas, {
        keys: bossesRef.current.map(b => b.key),
        index: models,
        initial: indexRef.current,
        onSelect: i => selectRef.current(bossesRef.current[i]),
        onLoaded: (key, ok) => {
          if (ok) setReady(prev => new Set(prev).add(key))
        },
      })
      rigRef.current = rig

      onResize = () => rig?.resize()
      window.addEventListener('resize', onResize)
    })

    return () => {
      live = false
      if (onResize) window.removeEventListener('resize', onResize)
      rig?.dispose()
      rigRef.current = null
    }
  }, [models])

  // Keep the drum pointing at whatever App thinks is selected. Usually a no-op,
  // because the usual direction of travel is the other way — the barrel decides
  // and tells App. It matters when something else changes the boss.
  useEffect(() => { rigRef.current?.select(index) }, [index])

  const step = useCallback((by: number) => {
    const rig = rigRef.current
    // The rig's angle and the roster index run the same way — slot `i` is at
    // the front when the angle is `i` steps — so one nudge forward is one boss
    // further down the raid, and the rig reports that back through `onSelect`.
    if (rig) { rig.nudge(by); return }
    // No rig means the grid is on screen, and the arrow keys should still work.
    const n = bossesRef.current.length
    selectRef.current(bossesRef.current[((index + by) % n + n) % n])
  }, [index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while somebody is typing into something, even though this screen
      // currently has no inputs — a picker that eats keystrokes is the kind of
      // bug that appears the day a search box is added.
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { step(-1); e.preventDefault() }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { step(1); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  const setup = suggestedSetup(selected)
  const loading = !!models && !ready.has(selected.key)

  return (
    <div className="barrel">
      {models
        ? (
          <div className="barrel-stage">
            <canvas ref={canvasRef} className="barrel-canvas" />
            <button
              className="barrel-arrow left" onClick={() => step(-1)}
              aria-label="Previous boss"
            >‹</button>
            <button
              className="barrel-arrow right" onClick={() => step(1)}
              aria-label="Next boss"
            >›</button>
            {loading && <span className="barrel-loading">summoning {selected.realName}…</span>}
          </div>
        )
        : (
          <div className="cards barrel-fallback">
            {bosses.map(b => (
              <button
                key={b.key}
                className={`card${b.key === selected.key ? ' on' : ''}`}
                onClick={() => onSelect(b)}
              >
                <span className="card-title with-icon">
                  <BossSigil bossKey={b.key} size={30} /> {b.name}
                </span>
                <span className="card-real">teaches {b.realName}</span>
                <span className="card-sub">{b.blurb}</span>
              </button>
            ))}
          </div>
        )}

      {/* One pip per boss, always shown. On the barrel it is the only way to
          tell how far round the drum you are; on the grid it is a second way to
          jump, which costs nothing and keeps the two layouts feeling related. */}
      <div className="barrel-pips" role="tablist" aria-label="Boss">
        {bosses.map((b, i) => (
          <button
            key={b.key}
            role="tab"
            aria-selected={i === index}
            aria-label={b.name}
            className={`pip${i === index ? ' on' : ''}`}
            onClick={() => onSelect(b)}
          />
        ))}
      </div>

      <div className="barrel-plate">
        <div className="barrel-id">
          <h3><BossSigil bossKey={selected.key} size={26} /> {selected.name}</h3>
          <span className="card-real">teaches {selected.realName}</span>
          <p className="barrel-blurb">{selected.blurb}</p>
        </div>

        <div className="barrel-setup">
          <h4>Bring</h4>
          <ul>
            {setup.map(line => (
              <li key={line.need}>
                <strong>{line.need}</strong>
                <span>{line.why}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
