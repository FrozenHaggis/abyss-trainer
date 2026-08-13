import { useEffect, useRef, useState } from 'react'
import type { Ability, BossDef, MechanicDef, Prompt, Role, RunResult } from '../engine/types'
import { COOLDOWN_MS, TICK_MS, abilitiesFor, buildResult, createWorld, step, upcoming } from '../engine/sim'
import type { Input, World } from '../engine/sim'
import { makeCamera, render } from '../engine/render'
import RoleIcon from './RoleIcon'
import { startMusic, stopMusic } from '../engine/audio'
import { initVoice, isTeaching, sayMechanic, sayVerb, setVoiceEnabled, stopVoice, voiceEnabled, voiceSupported } from '../engine/voice'

// The arena. React owns the HUD; the canvas and the simulation live outside
// React entirely (in a ref + rAF loop) so a HUD re-render can never perturb the
// fight. HUD state is sampled from the world a few times a second, not per frame.

const KEY_ABILITY: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3 }

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
}

export default function Arena({ boss, role, onEnd }: {
  boss: BossDef; role: Role; onEnd: (r: RunResult) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<World | null>(null)
  const [hud, setHud] = useState<HudSample>({
    health: 1, raid: 1, bossHp: 1, energy: 0, elapsed: 0, cooldowns: {},
    alive: true, stacks: 0, tanking: false, raidAlive: 0,
    prompt: null, next: [],
  })
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null)
  const [voiceOn, setVoiceOn] = useState(voiceEnabled())
  const [callout, setCallout] = useState<MechanicDef | null>(null)
  const abilities = abilitiesFor(role)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const world = createWorld(boss, role)
    worldRef.current = world
    startMusic()
    initVoice()

    const input: Input = { up: false, down: false, left: false, right: false, pressed: [] }
    const held = new Set<string>()

    function onKey(e: KeyboardEvent, down: boolean) {
      const k = e.key.toLowerCase()
      if ('wasd'.includes(k) || k.startsWith('arrow')) e.preventDefault()
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
    let lastFailAt = -1

    function frame(now: number) {
      const realDt = Math.min(250, now - last)
      last = now
      // Slow the arena right down while a mechanic is being explained. Telling
      // you what Ravage is while Ravage is already landing is useless; this buys
      // you the beat to hear it, without stopping dead and losing the flow.
      const teaching = isTeaching()
      const scale = teaching ? 0.16 : 1
      const dt = realDt * scale
      acc += dt

      // Fixed timestep: the simulation must not vary with frame rate, or a
      // player on a 144Hz monitor would move faster than one on 60Hz.
      while (acc >= TICK_MS) {
        input.up = held.has('w') || held.has('arrowup')
        input.down = held.has('s') || held.has('arrowdown')
        input.left = held.has('a') || held.has('arrowleft')
        input.right = held.has('d') || held.has('arrowright')
        step(world, input, TICK_MS)
        input.pressed.length = 0
        acc -= TICK_MS

        if (world.announce) {
          setCallout(world.announce)
          sayMechanic(world.announce.name, world.announce.good)
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
          stacks: world.bossTargetId === 0
            ? world.playerStacks
            : (world.allies.find(a => a.id === world.bossTargetId)?.stacks ?? 0),
          tanking: world.bossTargetId === 0,
          raidAlive: world.allies.filter(a => a.alive).length,
          prompt: world.prompt,
          next: upcoming(world, 3),
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
      stopMusic()
      stopVoice()
    }
  }, [boss, role, onEnd, abilities])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(t)
  }, [toast])

  // Teaching callout: shown once, the first time a mechanic appears.
  useEffect(() => {
    if (!callout) return
    const t = window.setTimeout(() => setCallout(null), 4200)
    return () => window.clearTimeout(t)
  }, [callout])

  const remaining = Math.max(0, boss.pullLengthSec - hud.elapsed)

  return (
    <div className="arena">
      <canvas ref={canvasRef} className="arena-canvas" />

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
        </div>
        {role === 'tank' && (
          <div className={`tankwatch${hud.tanking ? ' mine' : ''}`}>
            <span className="tankwatch-lab">{hud.tanking ? 'YOU ARE TANKING' : 'co-tank has it'}</span>
            <span className="tankwatch-stacks">{Math.floor(hud.stacks)} stacks</span>
          </div>
        )}
        <div className="timer">{Math.ceil(remaining)}s</div>
        {voiceSupported() && (
          <button
            className={`voice-toggle${voiceOn ? ' on' : ''}`}
            onClick={() => { setVoiceEnabled(!voiceOn); setVoiceOn(!voiceOn) }}
            title="Spoken callouts"
          >{voiceOn ? '🔊' : '🔇'}</button>
        )}
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

      <div className="next-up">
        <span className="next-lab">Next</span>
        {hud.next.map((n, i) => (
          <span key={i} className={`next-item${i === 0 ? ' soon' : ''}`}>
            {n.name} <em>{n.inSec.toFixed(0)}s</em>
          </span>
        ))}
      </div>

      {callout && <div className="teaching-veil" />}
      {callout && (
        <div className="callout">
          <div className="callout-name">{callout.name}</div>
          <div className="callout-good">{callout.good}</div>
        </div>
      )}

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
