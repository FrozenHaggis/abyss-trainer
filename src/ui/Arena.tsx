import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Ability, AddDef, BossDef, MechanicDef, PhaseDef, Prompt, Role, RunResult, Side,
} from '../engine/types'
import { COOLDOWN_MS, TICK_MS, abilitiesFor, buildResult, createDrill, createWorld, currentTank, step, upcoming } from '../engine/sim'
import type { Input, World } from '../engine/sim'
import { makeCamera, render } from '../engine/render'
import { briefFor, briefForAdd } from '../engine/brief'
import RoleIcon from './RoleIcon'
import { startMusic, stopMusic } from '../engine/audio'
import { initVoice, isTeaching, sayMechanic, sayVerb, setVoiceEnabled, stopVoice, voiceEnabled, voiceSupported } from '../engine/voice'

// The arena. React owns the HUD; the canvas and the simulation live outside
// React entirely (in a ref + rAF loop) so a HUD re-render can never perturb the
// fight. HUD state is sampled from the world a few times a second, not per frame.

const KEY_ABILITY: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3 }

/**
 * How many orbs Helical Toxins puts over a player's head — always four, split
 * 1+3, 2+2 or 3+1 between green and red. The number a PAIR has to reach is read
 * off the `pairUp` rule instead, because that is the number the engine scores.
 */
const ORB_COUNT = 4

/** A health gap this wide is worth shouting about. */
const DELTA_WARN = 0.12

interface HudSample {
  health: number
  raid: number
  bossHp: number
  energy: number
  elapsed: number
  cooldowns: Partial<Record<Ability, number>>
  alive: boolean
  stacks: number
  tanking: boolean
  raidAlive: number
  prompt: Prompt | null
  next: { name: string; inSec: number }[]
  drillReps: number
  drillClean: number
  /** Every entity's health, in the boss file's own order. */
  units: { id: string; name: string; side?: Side; hp: number }[]
  /** Yards between the closest pair of entities. Null when there is only one. */
  separation: number | null
  /** The separation the fight demands, from its own `keepApart` rule. */
  minApart: number
  /** Permanent proximity stacks the player is carrying, one row per aura. */
  marks: { id: string; name: string; side?: Side; stacks: number }[]
  /** Helical Toxins: the player's orbs, and what a partner has to bring. */
  marked: boolean
  green: number
  pairTarget: number
  /** The stage the fight is in, or null on a boss with no stages. */
  phase: PhaseDef | null
}

/**
 * Yards between the closest pair of live entities — the quantity `keepApart` is
 * judged on, computed the same way the simulation computes it. Null on a
 * single-entity fight, where the readout has nothing to say.
 */
function separationOf(w: World): number | null {
  const live = w.bosses.filter(b => !b.def.untargetable && b.alive)
  if (live.length < 2) return null
  let closest = Infinity
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      closest = Math.min(closest, Math.hypot(live[i].pos.x - live[j].pos.x, live[i].pos.y - live[j].pos.y))
    }
  }
  return closest
}

export default function Arena({ boss, role, side, drillId, onEnd, onQuit }: {
  boss: BossDef; role: Role; side?: Side; drillId?: string
  onEnd: (r: RunResult) => void; onQuit: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<World | null>(null)
  const [hud, setHud] = useState<HudSample>({
    health: 1, raid: 1, bossHp: 1, energy: 0, elapsed: 0, cooldowns: {},
    alive: true, stacks: 0, tanking: false, raidAlive: 0,
    prompt: null, next: [], drillReps: 0, drillClean: 0,
    units: [], separation: null, minApart: 0, marks: [],
    marked: false, green: 0, pairTarget: ORB_COUNT, phase: null,
  })
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null)
  // A phase announcement, held for a few seconds and then dropped.
  const [banner, setBanner] = useState<PhaseDef | null>(null)
  const [voiceOn, setVoiceOn] = useState(voiceEnabled())
  const [callout, setCallout] = useState<MechanicDef | null>(null)
  // Set when the thing being briefed is an add, so it gets add guidance.
  const [calloutAdd, setCalloutAdd] = useState<AddDef | null>(null)
  // The loop lives outside React, so the Resume button flips a ref it reads.
  const resumeRef = useRef(false)
  const abilities = abilitiesFor(role)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const world = drillId ? createDrill(boss, role, drillId) : createWorld(boss, role, side)
    worldRef.current = world
    startMusic()
    initVoice()

    // Read off the boss's own data rather than hard-coded per fight: the
    // separation the tanks owe, the count a pair of orbs has to reach, and the
    // proximity auras that stack for the rest of the pull. A boss with none of
    // these samples empty and renders nothing extra.
    const apartDef = boss.mechanics.find(m => m.rule.type === 'keepApart')
    const minApart = apartDef?.rule.type === 'keepApart' ? apartDef.rule.minYards : 0
    const pairDef = boss.mechanics.find(m => m.rule.type === 'pairUp')
    const pairTarget = pairDef?.rule.type === 'pairUp' ? pairDef.rule.target : ORB_COUNT
    const markDefs = boss.mechanics.filter(m => m.proximityStack)

    const input: Input = {
      up: false, down: false, left: false, right: false, pressed: [],
      aim: null, firing: false,
    }
    const held = new Set<string>()

    function onKey(e: KeyboardEvent, down: boolean) {
      const k = e.key.toLowerCase()
      if ('wasd'.includes(k) || k.startsWith('arrow') || k === ' ') e.preventDefault()
      if (down) held.add(k); else held.delete(k)
      if (down && k in KEY_ABILITY) {
        const ab = abilities[KEY_ABILITY[k]]
        if (ab) input.pressed.push(ab)
      }
    }
    const kd = (e: KeyboardEvent) => onKey(e, true)
    const ku = (e: KeyboardEvent) => onKey(e, false)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)

    // Aim with the mouse, hold to fire. Space fires too, straight at the nearest
    // entity, so the fight is playable one-handed from the keyboard.
    const toYards = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: (e.clientX - r.left - cam.cx) / cam.scale, y: (e.clientY - r.top - cam.cy) / cam.scale }
    }
    let mouseDown = false
    const mm = (e: MouseEvent) => { input.aim = toYards(e) }
    const md = (e: MouseEvent) => { input.aim = toYards(e); mouseDown = true }
    const mu = () => { mouseDown = false }
    canvas.addEventListener('mousemove', mm)
    canvas.addEventListener('mousedown', md)
    window.addEventListener('mouseup', mu)

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let cam = makeCamera(1, 1, boss.arenaRadius)
    let cssW = 0, cssH = 0
    function resize() {
      const rect = canvas.getBoundingClientRect()
      cssW = rect.width; cssH = rect.height
      canvas.width = cssW * dpr; canvas.height = cssH * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cam = makeCamera(cssW, cssH, boss.arenaRadius)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let raf = 0
    let last = performance.now()
    let acc = 0
    let hudAcc = 0
    let ended = false
    let paused = false
    let lastFailAt = -1

    function frame(now: number) {
      const realDt = Math.min(250, now - last)
      last = now
      if (resumeRef.current) { resumeRef.current = false; paused = false }
      // A briefing holds the fight completely, until the player presses Resume.
      // Slowing to 16% was not enough — you cannot read three sections of text
      // while still being asked to dodge. `isTeaching()` now only covers the
      // short spoken cue, so it eases off rather than stopping.
      const teaching = isTeaching()
      const scale = paused ? 0 : teaching ? 0.5 : 1
      const dt = realDt * scale
      acc += dt

      // Fixed timestep: the simulation must not vary with frame rate, or a
      // player on a 144Hz monitor would move faster than one on 60Hz.
      while (acc >= TICK_MS) {
        input.up = held.has('w') || held.has('arrowup')
        input.down = held.has('s') || held.has('arrowdown')
        input.left = held.has('a') || held.has('arrowleft')
        input.right = held.has('d') || held.has('arrowright')
        // Space fires at the nearest entity — keyboard-only players get to fight
        // the boss, not the controls.
        input.firing = mouseDown || held.has(' ')
        step(world, input, TICK_MS)
        input.pressed.length = 0
        acc -= TICK_MS

        if (world.announce) {
          // First sight of a mechanic pauses the fight for a briefing. The
          // voice gets the cue only — the description is on the panel, read at
          // whatever pace the player wants.
          const b = world.announceAdd
            ? briefForAdd(world.announceAdd, role)
            : briefFor(world.announce, role)
          setCallout(world.announce)
          setCalloutAdd(world.announceAdd)
          paused = true
          sayMechanic(world.announce.name, b.verb)
        }
        // Bark only once the mechanic is genuinely closing, or it fires on every
        // telegraph and becomes noise.
        if (world.prompt && world.prompt.urgency > 0.45) sayVerb(world.prompt.verb)
        if (world.lastFailure && world.lastFailure.atMs !== lastFailAt) {
          lastFailAt = world.lastFailure.atMs
          setToast({ text: world.lastFailure.failText, id: lastFailAt })
        }

        const over = !world.player.alive || world.killed
          || world.elapsedMs / 1000 >= boss.pullLengthSec
        if (over && !ended) {
          ended = true
          const result = buildResult(world)
          window.setTimeout(() => onEnd(result), 700)
        }
      }

      render(ctx, world, cam, cssW, cssH)

      hudAcc += realDt
      if (hudAcc > 100) {
        hudAcc = 0
        setHud({
          health: world.player.health,
          raid: world.raidHealth,
          bossHp: world.bossHp,
          energy: world.bossEnergy,
          elapsed: world.elapsedMs / 1000,
          cooldowns: { ...world.player.cooldowns },
          alive: world.player.alive,
          // Stacks on whoever holds the entity you would be swapping with —
          // the primary, which is the one the tankSwap mechanic belongs to.
          stacks: currentTank(world).stacks,
          tanking: world.bosses.some(b => b.targetId === 0),
          raidAlive: world.allies.filter(a => a.alive).length,
          prompt: world.prompt,
          next: upcoming(world, 3),
          drillReps: world.drillReps,
          drillClean: world.drillClean,
          units: world.bosses.map(b => ({
            id: b.def.id, name: b.def.name, side: b.def.side, hp: Math.max(0, b.hp),
          })),
          separation: separationOf(world),
          minApart,
          // Floored, because a mark is a whole stack — a fractional one would
          // read as a bug rather than as the aura ticking.
          marks: markDefs.map(m => ({
            id: m.id, name: m.name, side: m.side, stacks: Math.floor(world.player.marks[m.id] ?? 0),
          })),
          marked: world.player.marked,
          green: world.player.green,
          pairTarget,
          // The PhaseDef itself, so its identity is stable while the phase runs
          // and the banner below fires once per stage rather than ten times a
          // second.
          phase: boss.phases?.[world.phaseIndex] ?? null,
        })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      canvas.removeEventListener('mousemove', mm)
      canvas.removeEventListener('mousedown', md)
      window.removeEventListener('mouseup', mu)
      stopMusic()
      stopVoice()
    }
  }, [boss, role, side, drillId, onEnd, abilities])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(t)
  }, [toast])

  // A stage change is the one event that rewrites what everything else on this
  // HUD means, so it gets announced. Keyed on the PhaseDef itself, which the
  // sampler keeps stable for as long as the stage runs.
  useEffect(() => {
    if (!hud.phase) return
    setBanner(hud.phase)
    const t = window.setTimeout(() => setBanner(null), 3600)
    return () => window.clearTimeout(t)
  }, [hud.phase])

  // Esc abandons the pull. Its own effect so changing the handler cannot tear
  // down and restart the simulation.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onQuit() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onQuit])

  // The briefing stays up until dismissed — it is a pause, not a toast.
  const resume = useCallback(() => {
    resumeRef.current = true
    setCallout(null)
    setCalloutAdd(null)
  }, [])

  // Space or Enter resumes, so you never have to reach for the mouse.
  useEffect(() => {
    if (!callout) return
    const k = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); resume() }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [callout, resume])

  const remaining = Math.max(0, boss.pullLengthSec - hud.elapsed)
  // The gap between the healthiest entity and the weakest. On the Sentinels the
  // intermission heals the weaker one up to match, so this is damage you are
  // about to hand back; on a fight with a synchronised kill it is the bar you
  // are about to leave behind. Either way it is the number to close.
  const hps = hud.units.map(u => u.hp)
  const delta = hps.length > 1 ? Math.max(...hps) - Math.min(...hps) : 0
  // Two auras at once means you are standing inside both golems' range, which
  // is the specific mistake this readout exists to catch.
  const bothMarks = hud.marks.filter(m => m.stacks > 0).length > 1
  const needGreen = Math.max(0, hud.pairTarget - hud.green)

  return (
    <div className="arena">
      <canvas ref={canvasRef} className="arena-canvas" />

      {/* Controls, in the arena for the opening seconds. Having to go back to
          the menu to remember what shoots is a bad way to learn a fight. */}
      {hud.elapsed < 9 && (
        <div className="arena-controls" style={{ opacity: Math.min(1, (9 - hud.elapsed) / 2.5) }}>
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</span>
          <span><kbd>Mouse</kbd> aim · <kbd>Hold LMB</kbd> shoot</span>
          <span><kbd>Space</kbd> shoot nearest</span>
          <span><kbd>1</kbd>–<kbd>4</kbd> abilities</span>
        </div>
      )}

      <div className="hud hud-top">
        <div className="boss-block">
          <div className="boss-name">{boss.name}</div>
          <div className="bar bar-boss">
            <div className="bar-track tall">
              <div className="bar-fill boss" style={{ width: `${hud.bossHp * 100}%` }} />
            </div>
            <span className="bar-num">{Math.round(hud.bossHp * 100)}%</span>
          </div>
          <div className="bar bar-boss">
            <span className="bar-label">Energy</span>
            <div className="bar-track"><div className="bar-fill energy" style={{ width: `${hud.energy}%` }} /></div>
          </div>

          {/* Both entities side by side, with the gap between them. The single
              aggregate bar above hides the one thing that decides a two-golem
              pull: which of them you have been feeding damage into. */}
          {hud.units.length > 1 && (
            <div className="golems">
              {hud.units.map(u => (
                // The one you are parked on is marked, because "stay inside 40
                // yards of YOUR golem and outside the other's" is meaningless
                // if the two bars read as interchangeable.
                <div
                  key={u.id}
                  className={`golem${u.side ? ` side-${u.side}` : ''}${u.side && u.side === side ? ' yours' : ''}`}
                >
                  <span className="golem-name">{u.name}</span>
                  <div className="bar-track">
                    <div className="bar-fill golem" style={{ width: `${u.hp * 100}%` }} />
                  </div>
                  <span className="golem-num">{Math.round(u.hp * 100)}%</span>
                </div>
              ))}
              <span className={`golem-delta${delta >= DELTA_WARN ? ' hot' : ''}`}>
                Δ {Math.round(delta * 100)}%
              </span>
            </div>
          )}

          {/* Live separation. The tanks own this number and nobody could see it
              before — a pair sliding into their own damage reduction looked
              exactly like a pull where the damage had stopped working. */}
          {hud.separation !== null && hud.minApart > 0 && (
            <div className={`separation${hud.separation < hud.minApart ? ' hot' : ''}`}>
              <span className="sep-lab">Apart</span>
              <span className="sep-num">{Math.round(hud.separation)}<em>yd</em></span>
              <span className="sep-need">hold {hud.minApart}+</span>
            </div>
          )}
        </div>
        {role === 'tank' && (
          <div className={`tankwatch${hud.tanking ? ' mine' : ''}`}>
            <span className="tankwatch-lab">{hud.tanking ? 'YOU ARE TANKING' : 'co-tank has it'}</span>
            <span className="tankwatch-stacks">{Math.floor(hud.stacks)} stacks</span>
          </div>
        )}
        {drillId ? (
          // A drill has no clock. What matters is how many clean reps you have
          // strung together.
          <div className="timer drill-score">
            {hud.drillClean}<span>/{hud.drillReps} clean</span>
          </div>
        ) : (
          <div className="timer">{Math.ceil(remaining)}s</div>
        )}
        {voiceSupported() && (
          <button
            className={`voice-toggle${voiceOn ? ' on' : ''}`}
            onClick={() => { setVoiceEnabled(!voiceOn); setVoiceOn(!voiceOn) }}
            title="Spoken callouts"
          >{voiceOn ? '🔊' : '🔇'}</button>
        )}
        {/* Leaving the pull lives in the top bar, alongside the other chrome.
            Bottom-left put it straight on top of the health bars. */}
        <button className="arena-quit" onClick={onQuit} title="Back to boss select (Esc)">
          ← Bosses
        </button>
      </div>

      {hud.prompt && (
        <div className={`prompt${hud.prompt.urgency > 0.6 ? ' urgent' : ''}`}>
          <span className="prompt-verb">{hud.prompt.verb}</span>
          <span className="prompt-mech">{hud.prompt.mechanic}</span>
        </div>
      )}

      {toast && (
        <div className="fail-toast" key={toast.id}>{toast.text}</div>
      )}

      {banner && (
        <div className="phase-banner" key={banner.id} role="status">
          <span className="phase-name">{banner.name}</span>
          <span className="phase-line">{banner.banner}</span>
        </div>
      )}

      {/* Your four orbs, during Stasis. Deliberately the largest thing on the
          HUD: colliding with the wrong partner is instantly fatal, so a raider
          must be able to read their own count without looking for it. */}
      {hud.marked && (
        <div className="orbs" role="status">
          <div className="orb-row">
            {Array.from({ length: ORB_COUNT }, (_, i) => (
              <span key={i} className={`orb ${i < hud.green ? 'green' : 'red'}`} />
            ))}
          </div>
          <div className="orb-need">
            {needGreen > 0
              ? <>Partner needs <strong>{needGreen} green</strong></>
              : <>Partner needs <strong>no green</strong></>}
          </div>
          <div className="orb-warn">The wrong partner kills you</div>
        </div>
      )}

      <div className="next-up">
        <span className="next-lab">Next</span>
        {hud.next.map((n, i) => (
          <span key={i} className={`next-item${i === 0 ? ' soon' : ''}`}>
            {n.name} <em>{n.inSec.toFixed(0)}s</em>
          </span>
        ))}
      </div>

      {/* The briefing. First sight of a mechanic pauses the fight and puts this
          on the left: what it is, what is happening, and what YOU do about it.
          The last part is role-specific, because "get out of it" and "point it
          away from the raid" are the same mechanic seen from two jobs. */}
      {callout && <div className="teaching-veil" />}
      {callout && (() => {
        const b = calloutAdd ? briefForAdd(calloutAdd, role) : briefFor(callout, role)
        return (
          <aside className="brief" role="dialog" aria-label={`${callout.name} briefing`}>
            <div className="brief-tag">{calloutAdd ? 'New add — paused' : 'New mechanic — paused'}</div>
            <h2 className="brief-name">{callout.name}</h2>

            {callout.what && (
              <section className="brief-sec">
                <h3>What is happening</h3>
                <p>{callout.what}</p>
              </section>
            )}

            <section className={`brief-sec brief-you${b.yours ? ' mine' : ''}`}>
              <h3>
                <RoleIcon role={role} size={15} />
                {b.yours ? `Your job as ${role}` : `Not your job (${role})`}
              </h3>
              <p className="brief-verb">{b.verb}</p>
              <p>{b.line}</p>
            </section>

            <section className="brief-sec">
              <h3>What good looks like</h3>
              <p className="brief-good">{callout.good}</p>
            </section>

            <button className="brief-resume" onClick={resume} autoFocus>
              Resume <span>space</span>
            </button>
          </aside>
        )
      })()}

      {!hud.alive && <div className="dead-banner">DOWN</div>}
      {hud.bossHp <= 0 && <div className="dead-banner win">BOSS DOWN</div>}

      <div className="hud hud-bottom">
        <div className="bars">
          <div className="bar">
            <span className="bar-label with-icon"><RoleIcon role={role} size={15} /> You</span>
            <div className="bar-track"><div className="bar-fill hp" style={{ width: `${hud.health * 100}%` }} /></div>
          </div>
          <div className="bar">
            <span className="bar-label">Raid</span>
            <div className="bar-track"><div className="bar-fill raid" style={{ width: `${hud.raid * 100}%` }} /></div>
            <span className="bar-num">{hud.raidAlive} up</span>
          </div>
        </div>

        {/* Both Marks, always both, even at zero. They never fall off, so the
            only thing you can do about them is not collect the second one —
            and you cannot decide that without seeing the pair. */}
        {hud.marks.length > 0 && (
          <div className="marks">
            {hud.marks.map(m => (
              <div
                key={m.id}
                className={`mark${m.side ? ` side-${m.side}` : ''}${m.stacks > 0 ? ' on' : ''}`}
              >
                <span className="mark-num">{m.stacks}</span>
                <span className="mark-name">{m.name}</span>
              </div>
            ))}
            {bothMarks && <span className="mark-both">In range of both — pick a golem</span>}
          </div>
        )}

        <div className="abilities">
          {abilities.map((ab, i) => {
            const cd = hud.cooldowns[ab]
            return (
              <div key={ab} className={`ability${cd ? ' on-cd' : ''}`}>
                <span className="ability-key">{i + 1}</span>
                <span className="ability-name">{ab}</span>
                {cd ? <span className="ability-cd">{Math.ceil(cd / 1000)}</span> : null}
                {cd ? <div className="ability-sweep" style={{ height: `${(cd / COOLDOWN_MS[ab]) * 100}%` }} /> : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
