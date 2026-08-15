import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  Ability, AddDef, BossDef, MechanicDef, PhaseDef, Prompt, Role, RunResult, Side,
} from '../engine/types'
import { COOLDOWN_MS, TICK_MS, abilitiesFor, buildResult, createDrill, createWorld, currentTank, primaryBoss, step, upcoming } from '../engine/sim'
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

/**
 * One fountain, as a raider needs to read it.
 *
 * The raid calls this fight by colour — "red and orange are up, walk him east"
 * — so the colour the boss file declares is the label here, not decoration.
 */
interface AltarSample {
  id: string
  /** The fountain's full name, for the tooltip. */
  name: string
  /** Its colour, which is also what the raid calls it. */
  colour: string
  /** Infusion stacks: consecutive drinks that took this fountain. */
  infusion: number
  /** Taken by the most recent drink — its add and its infection are live now. */
  drained: boolean
  /** Nearest the boss THIS INSTANT, so the next drink takes it. */
  next: boolean
}

/**
 * The fountains, sampled off the world.
 *
 * `drained` and `infusion` are the simulation's own book-keeping and are only
 * read, never recomputed: sim.ts keeps `lastDrained` on the world precisely so
 * that the renderer, this HUD and the debrief cannot disagree about which pair
 * actually fired, and a HUD that re-derived it against a boss who has since
 * walked away would name the wrong two.
 *
 * `next` is the opposite case and has to be worked out here, because it is a
 * question about where the boss is standing right now and the answer changes
 * with every step the tank takes. It is computed the way the simulation
 * computes it — the `count` nearest the entity being tanked — and it is the
 * whole point of the readout: the boss follows its tank, so the tank's feet are
 * choosing the raid's next two infections, and nothing on screen said so.
 */
function altarsOf(w: World, count: number): AltarSample[] {
  if (!w.altars.length) return []
  const at = primaryBoss(w).pos
  const gap = (p: { x: number; y: number }) => Math.hypot(p.x - at.x, p.y - at.y)
  const next = new Set(
    [...w.altars]
      .sort((a, b) => gap(a.def.pos) - gap(b.def.pos))
      .slice(0, Math.max(1, Math.min(count, w.altars.length)))
      .map(a => a.def.id))
  const drained = new Set(w.lastDrained)
  return w.altars.map(a => ({
    id: a.def.id,
    name: a.def.name,
    colour: a.def.colour,
    infusion: a.infusion,
    drained: drained.has(a.def.id),
    next: next.has(a.def.id),
  }))
}

/**
 * The hazard everything on the floor is walking at.
 *
 * Read off the rule rather than off the boss: a lethalGround pool pinned to the
 * middle of the room is Vashnik's Malignant Cavity and Nek'zali's Soulcoil Well
 * alike, and on both fights the question a raider actually has is the same one
 * — how far is the nearest thing that must not arrive.
 */
function goalOf(boss: BossDef): MechanicDef | null {
  const pools = boss.mechanics.filter(m => m.rule.type === 'lethalGround')
  return pools.find(m => m.atCentre) ?? pools[0] ?? null
}

/**
 * How many things are still walking at the pool, and how much floor the nearest
 * one has left.
 *
 * Measured to the pool's EDGE, not to the middle of the room, because the edge
 * is where arriving happens — and arriving is the whole stake: one venom
 * reaching the Malignant Cavity is a Malignant Burst on the entire raid, which
 * is what ends a slow pull. The gap is taken from the arena centre because
 * that is where these pools sit; `goalOf` prefers the one that says so.
 */
function inboundOf(w: World, edge: number): { count: number; gapYards: number } {
  let count = 0
  let gap = Infinity
  for (const a of w.adds) {
    if (!a.alive || !a.def.onLeak) continue
    count++
    gap = Math.min(gap, Math.max(0, Math.hypot(a.pos.x, a.pos.y) - edge))
  }
  return { count, gapYards: Number.isFinite(gap) ? gap : 0 }
}

/**
 * Is this mechanic something the boss simply does, or something that only
 * happens when the raid lets it?
 *
 * Read off the schedules the boss file declares: its full-energy cast, its
 * loop, its ambient list, and the same three on every stage. Anything in there
 * arrives whatever anybody does; anything absent from all of them is fired by
 * consequence — a leaked add, a channel off another cast — and means somebody
 * could have stopped it.
 */
function isScheduled(boss: BossDef, id: string): boolean {
  if (boss.atFullEnergy === id) return true
  const lists: string[][] = [boss.loop, boss.ambient ?? []]
  for (const p of boss.phases ?? []) lists.push(p.loop, p.ambient ?? [])
  return lists.some(l => l.includes(id))
}

/**
 * Permanent stacking counters, and whether each one is a clock or a scoreboard.
 *
 * A mechanic that another mechanic `stacks` into is a running total that never
 * falls off, and the count lives in `player.marks` keyed by mechanic id because
 * that is where the engine puts every permanent stack.
 *
 * The two kinds look identical on screen — a number that only goes up — and
 * mean opposite things. Toxic Vapor arrives with every Imbibe whatever the raid
 * does, and its tactic file could not be blunter: deaths on it are kill speed,
 * never player failure. Ritual Burn on Nek'zali is stacked by Soulcoil Rite,
 * which that boss file deliberately keeps out of every loop and ambient list
 * because "every Rite has a cause" — so its count is a record of what leaked.
 * Labelling that one "not a mistake" would teach the exact opposite of the
 * fight, so the label follows where the stacking cast comes from.
 */
function enrageDefsOf(boss: BossDef): { def: MechanicDef; clock: boolean }[] {
  const out: { def: MechanicDef; clock: boolean }[] = []
  for (const src of boss.mechanics) {
    const id = src.stacks?.defId
    if (!id || out.some(o => o.def.id === id)) continue
    const def = boss.mechanics.find(m => m.id === id)
    if (def) out.push({ def, clock: isScheduled(boss, src.id) })
  }
  return out
}

/**
 * The fountain readouts style themselves inline rather than out of styles.css,
 * for two reasons that are both about the data. A chip's colour comes from the
 * boss file — a stylesheet cannot know what colours a fight declares — and
 * these blocks only ever draw on a boss with altars, so the rules would sit
 * unused for the other seven. Everything else borrows the interface's own CSS
 * variables, so it still reads as part of the same HUD.
 */
const S = {
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 1 },
  chip: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '2px 8px', borderRadius: 7,
    background: 'rgba(22, 16, 42, .8)', border: '1px solid var(--line)',
  },
  dot: { width: 9, height: 9, borderRadius: '50%', flex: 'none' },
  colour: {
    fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '.08em',
    textTransform: 'uppercase', color: 'var(--text)',
  },
  tag: { fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' },
  lab: {
    fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '.08em',
    textTransform: 'uppercase', color: 'var(--muted)',
  },
  num: { fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)' },
  note: { fontSize: 11, color: 'var(--muted)' },
  warn: { fontSize: 11, color: '#ffd0cd' },
  // `satisfies` rather than an annotation: it checks every value against
  // CSSProperties the same way, and still catches a mistyped key at the use
  // site, which a Record<string, …> would quietly hand back as undefined.
} satisfies Record<string, CSSProperties>

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
  /**
   * The fight's stack counter: what you are carrying, and the worst any one
   * raider is carrying.
   *
   * Both, because they fail in opposite directions and the answer is different
   * for each. Yours climbing is your footwork. The raid's climbing while yours
   * does not is the soak rota drowning — and since a raider who reaches the cap
   * dies, that number is also the clearest warning available that bodies are
   * about to start dropping out of the globule rota.
   */
  venom: number
  venomRaid: number
  /** Helical Toxins: the player's orbs, and what a partner has to bring. */
  marked: boolean
  green: number
  pairTarget: number
  /** The stage the fight is in, or null on a boss with no stages. */
  phase: PhaseDef | null
  /** The fountains, in the boss file's order. Empty on the other seven fights. */
  altars: AltarSample[]
  /** Stacks that never fall off, and whether each is the clock or a scoreboard. */
  enrage: { id: string; name: string; stacks: number; clock: boolean }[]
  /**
   * Adds still walking at the centre pool, and how far the nearest one has left.
   * Null on a fight with no such pool or nothing that walks at it.
   */
  inbound: { count: number; gapYards: number } | null
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
    altars: [], enrage: [], inbound: null, venom: 0, venomRaid: 0,
  })
  // The fight's stack counter, read off the boss file the same way the
  // separation and the orb target are. Zero on the seven fights without one,
  // and the whole readout then draws nothing.
  const counterDef = boss.mechanics.find(m => m.counter)
  const venomCap = counterDef?.counter?.lethalAt ?? 0
  const venomName = counterDef?.name ?? ''
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

    // The fountains, read the same way: how many the drink takes comes off the
    // drainNearest rule, the pool the venoms walk at comes off the lethalGround
    // rule, and the stack counters come off whatever the boss file stacks into.
    // A fight that declares none of it samples empty and draws nothing.
    const drainDef = boss.mechanics.find(m => m.rule.type === 'drainNearest')
    const drainCount = drainDef?.rule.type === 'drainNearest' ? drainDef.rule.count : 0
    const goal = goalOf(boss)
    // Only adds with an `onLeak` are walking at anything: arriving has to mean
    // something, or the distance is just trivia.
    const leakers = (boss.adds ?? []).some(a => a.onLeak)
    const goalEdge = goal?.shape?.kind === 'circle' ? goal.shape.radius : 0
    const enrageDefs = enrageDefsOf(boss)

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
          venom: world.player.venom,
          // The worst any one raider is carrying, not the average. An average
          // hides the body that is one globule from dying, which is the only
          // thing about the raid's count anybody can act on.
          venomRaid: world.allies.reduce((n, a) => (a.alive ? Math.max(n, a.venom) : n), 0),
          pairTarget,
          // The PhaseDef itself, so its identity is stable while the phase runs
          // and the banner below fires once per stage rather than ten times a
          // second.
          phase: boss.phases?.[world.phaseIndex] ?? null,
          altars: altarsOf(world, drainCount),
          enrage: enrageDefs.map(e => ({
            id: e.def.id, name: e.def.name, clock: e.clock,
            // Floored: a stack is a whole cast that happened, and a fractional
            // one would read as a bug rather than as the enrage ticking on.
            stacks: Math.floor(world.player.marks[e.def.id] ?? 0),
          })),
          inbound: goal && leakers ? inboundOf(world, goalEdge) : null,
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
  // The pair the boss is standing nearest, which is the pair his next drink
  // takes. One that is ALSO still flagged drained would be taken twice running,
  // stacking its Infusion — the fight's own punishment for a tank who has not
  // moved, and the only thing anyone can do about it is move him now.
  const nextPair = hud.altars.filter(a => a.next)
  const repeating = hud.altars.filter(a => a.drained && a.next)
  // What the adds are walking at, named by the boss file rather than by us.
  const goalName = goalOf(boss)?.name ?? ''

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

          {/* The fountains. Three chips, in the colours the raid calls them by:
              which two the last drink took, how deep each one's Infusion has
              stacked, and which two the boss is nearest right now — which is
              to say, what his tank is about to hand everybody else. A raider
              could see the adds and the debuffs arriving but never the rotation
              driving them, so the fight looked random from the floor. */}
          {hud.altars.length > 0 && (
            <div className="altars" style={S.row}>
              {hud.altars.map(a => {
                const lit = a.drained || a.next
                return (
                  <span
                    key={a.id}
                    className={`altar${a.drained ? ' drained' : ''}${a.next ? ' next' : ''}`}
                    title={a.name}
                    style={{
                      ...S.chip,
                      borderColor: lit ? a.colour : 'var(--line)',
                      opacity: lit ? 1 : 0.5,
                    }}
                  >
                    <span style={{ ...S.dot, background: a.colour }} />
                    <span style={S.colour}>{a.colour}</span>
                    {a.infusion > 0 && (
                      <span style={S.num} title="Infusion stacks">×{a.infusion}</span>
                    )}
                    {a.drained && <span style={S.tag}>drained</span>}
                  </span>
                )
              })}
              {nextPair.length > 0 && (
                <span style={S.note}>
                  next drink: <strong>{nextPair.map(a => a.colour).join(' + ')}</strong>
                </span>
              )}
            </div>
          )}

          {/* The same fountain twice running is the one mistake this readout
              exists to catch: it stacks that altar's Infusion and empowers both
              its add and its debuff. Phrased as a prediction, because it is one
              — the boss has not drunk yet, and the tank can still walk him off. */}
          {repeating.length > 0 && (
            <div style={S.row}>
              <span style={S.warn}>
                {repeating.map(a => a.colour).join(' and ')} would drain again — walk the boss off
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

          {/* Everything still walking at the pool, and how much floor the
              nearest one has left. Killing them is a race against a distance,
              not against a health bar, and the distance was the half nobody
              could see. */}
          {hud.inbound && (
            <div className="inbound" style={S.row}>
              <span style={S.lab}>Inbound</span>
              <span style={S.num}>{hud.inbound.count}</span>
              <span style={S.note}>
                {hud.inbound.count === 0
                  ? `nothing walking at the ${goalName}`
                  : `nearest ${Math.round(hud.inbound.gapYards)}yd from the ${goalName}`}
              </span>
            </div>
          )}

          {/* The stacks that never come off. Labelled as the clock rather than
              as a mistake, because that is what the tactic files say they are:
              deaths at high stacks are kill speed, never player failure, and a
              readout that scolded the raid for them would teach the wrong
              lesson twice a pull. */}
          {hud.enrage.length > 0 && (
            <div className="soft-enrage" style={S.row}>
              {hud.enrage.map(e => (
                <span key={e.id} style={S.row}>
                  <span style={S.chip}>
                    <span style={S.num}>{e.stacks}</span>
                    <span style={S.lab}>{e.name}</span>
                  </span>
                  <span style={S.note}>
                    {e.clock
                      ? 'soft enrage — kill speed, not a mistake'
                      : 'only stacks when something goes wrong'}
                  </span>
                </span>
              ))}
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

        {/* The stack counter, from zero, for the same reason the Marks are:
            a count you only see once it is dangerous is a count you can no
            longer do anything about. On the one fight that keeps one this is
            the fight, so it sits beside your own health bar rather than in the
            top-bar chrome with the boss's book-keeping.

            The raid's worst is next to it because the two are answered
            differently. Yours climbing is where you have been standing; theirs
            climbing is the soak rota losing, and a raider who reaches the cap
            dies and stops soaking — which makes the next one worse. */}
        {venomCap > 0 && (
          <div className={`venom-count${hud.venom >= venomCap - 3 ? ' hot' : ''}`}>
            <span className="venom-num">{hud.venom}<em>/{venomCap}</em></span>
            <span className="venom-name">{venomName}</span>
            <span className="venom-raid" title="Worst any single raider is carrying">
              raid {hud.venomRaid}
            </span>
          </div>
        )}

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
