import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  Ability, AddDef, BossDef, MechanicDef, PhaseDef, Prompt, Role, RunResult, Side,
} from '../engine/types'
import { COOLDOWN_MS, TICK_MS, abilitiesFor, buildResult, createDrill, createWorld, currentTank, primaryBoss, step, upcoming } from '../engine/sim'
import type { Input, World } from '../engine/sim'
import { makeCamera, render, stackGap } from '../engine/render'
import { briefFor, briefForAdd } from '../engine/brief'
import RoleIcon from './RoleIcon'
import { startMusic, stopMusic } from '../engine/audio'
import { initVoice, isTeaching, sayInterrupt, sayMechanic, sayVerb, setVoiceEnabled, stopVoice, voiceEnabled, voiceSupported } from '../engine/voice'

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
  /**
   * Casts on the timeline that are waiting on an event rather than on a clock.
   *
   * Carried separately from `next` precisely because they have no `inSec`. The
   * moment these are merged into the countdown list somebody has to invent a
   * number for them, and the honest display is the absence of one.
   */
  waiting: { id: string; name: string; on: string }[]
  drillReps: number
  drillClean: number
  /**
   * Every entity's health, in the boss file's own order.
   *
   * `untargetable` rides along so the readouts can drop the entity that has no
   * health to compare: Mor'zahi cannot be shot, sits permanently at full, and
   * would make the health-gap and kill-spread readouts nonsense if counted.
   * `empowered` is the fish it has eaten — permanent, once only, and the answer
   * to "which of these three is a wasted feed".
   */
  units: { id: string; name: string; side?: Side; hp: number; untargetable: boolean; empowered: boolean }[]
  /** Yards between the closest pair of entities. Null when there is only one. */
  separation: number | null
  /** The separation the fight demands, from its own `keepApart` rule. */
  minApart: number
  /**
   * The stacked pair's live gap to the body they must stay clear of.
   *
   * Replaces the generic separation row on a fight where the tanks hold two
   * entities TOGETHER, and it replaces it rather than sitting beside it: the
   * generic row reads the widest pair, and a raider shown both would be looking
   * at two numbers for one rule. Read straight off `stackGap()` in render.ts —
   * the same call the canvas draws from, so the line across the floor and the
   * number in the HUD cannot come apart.
   *
   * Null on all seven other fights, which keeps the generic row exactly as it
   * was for the Sentinels.
   */
  stack: { threat: string; yards: number; minYards: number; closing: boolean } | null
  /**
   * The melee leash on the entity the player is holding: what it is called, how
   * far out they are, and how far they may go.
   *
   * Null on the seven fights with no `holdMelee`, and null for anybody not
   * currently holding one — including the other tank, who has their own leash on
   * the other serpent and can do nothing about this one. The mirror of the
   * separation readout, shown the same way for the same reason: a raid bar
   * falling off a cliff because a tank drifted two yards is indistinguishable
   * from a healing check until somebody puts the number on screen.
   */
  leash: { name: string; yards: number; max: number } | null
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
  /**
   * The fish economy: how many of the three have been found, how many have been
   * fed, and whether you are holding one right now. Once `fishSpent` reaches the
   * total there is nothing left that can empty the bar, which is the moment the
   * enrage stops being theoretical.
   */
  fishFound: number
  fishSpent: number
  fishCarried: boolean
  /** The Frostfire element you are carrying, and how long it has left. */
  element: 'fire' | 'frost' | null
  elementMs: number
  /** ms left airborne off a Bouncy Mushroom — the only answer to a Blast Wave. */
  aloft: number
  /**
   * One entity is nearly down and another is nowhere near it.
   *
   * Read straight off `world.killSpreadWarning` rather than recomputed from the
   * bars above. The simulation owns the threshold and the live prompt already
   * barks off it; a second copy of the rule here is a second thing to keep in
   * step, and the one thing this HUD must never do is disagree with the fight.
   */
  killSpread: boolean
}

/**
 * Yards between the WIDEST pair of live entities — the quantity `keepApart` is
 * judged on, computed the same way the simulation computes it. Null on a
 * single-entity fight, where the readout has nothing to say.
 *
 * The widest pair, not the closest, because the rule these fights state is "all
 * of them within N of each other", and that is literally "the widest pair is
 * under N". On the Sentinels there are two entities and the two readings are the
 * same number. On a three-body council they are not: two explorers standing on
 * top of each other with the third across the room link nothing, and a readout
 * that showed their gap would have called every fine pull broken. If this ever
 * disagrees with the sim, the HUD is lying about the damage reduction.
 */
function separationOf(w: World): number | null {
  const live = w.bosses.filter(b => !b.def.untargetable && b.alive)
  if (live.length < 2) return null
  let widest = 0
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      widest = Math.max(widest, Math.hypot(live[i].pos.x - live[j].pos.x, live[i].pos.y - live[j].pos.y))
    }
  }
  return widest
}

/**
 * How many of the encounter's one-off pickups exist in the whole pull, read off
 * whichever mechanic hides them.
 *
 * Three Disgusting Fish, and the number is the fight: each one empties Mor'zahi's
 * bar exactly once, so "how many resets are left" is the only long-range piece of
 * information anybody has. Taken from the boss file's own `hides.maxTotal` rather
 * than written as a 3 here, because a fight that changes its mind must not be
 * able to leave this readout counting to the wrong number.
 */
function hiddenTotalOf(boss: BossDef): number {
  return boss.mechanics.find(m => m.hides)?.hides?.maxTotal ?? 0
}

/**
 * The casts that are armed by an EVENT and have not been armed yet.
 *
 * `upcoming()` deliberately gives these no number, and it is right not to: a
 * dormant timeline entry has no time to count down to, and a strip that
 * invented one would be lying on the one readout a player is entitled to
 * trust. But dropping them silently is its own lie. Throw Junk after the first
 * is the beat the whole Explorers fight is paced by — it arrives when the
 * ability the last fish bought has actually been cast — and a strip that simply
 * stopped mentioning it reads as a mechanic that is finished with.
 *
 * So they are listed as WAITING, named with what they are waiting on. The gates
 * are the same three `upcoming()` applies and for the same reason: a row for a
 * cast that can never come is noise whether or not it carries a clock.
 */
function waitingOn(w: World): { id: string; name: string; on: string }[] {
  const out: { id: string; name: string; on: string }[] = []
  const timeline = w.boss.timeline ?? []
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i]
    // A finite appointment means `upcoming()` is already counting it down.
    // Dormant with no `rearmOn` is a one-shot that has been spent, and a spent
    // cast is not waiting for anything.
    if (!t.rearmOn || Number.isFinite(w.timelineNextMs[i] ?? Infinity)) continue
    const def = w.boss.mechanics.find(m => m.id === t.id)
    if (!def) continue
    if (def.from && !w.bosses.some(b => b.def.id === def.from && b.alive)) continue
    if (def.empoweredOnly && !w.bosses.some(b => b.def.id === def.empoweredOnly && b.empowered)) continue
    if (def.unlockedByDeathOf && !def.unlockedByDeathOf.some(e => e in w.deadEntities)) continue
    // Named by the mechanics that re-arm it rather than by the ids, because the
    // player has met those by name — the whole point of the gate is that the
    // next crate is bought by playing the ability the last fish paid for.
    const on = t.rearmOn.anyOf
      .map(id => w.boss.mechanics.find(m => m.id === id)?.name)
      .filter((n): n is string => !!n)
    out.push({ id: t.id, name: def.name, on: on.join(' or ') })
  }
  return out
}

/**
 * The entity whose bar the raid should be moving to.
 *
 * Only asked while the simulation says the kill spread has opened up. "Even them
 * out" is an instruction with no object — three bars and no name is exactly the
 * moment a raider freezes — so the readout names the healthiest one, which is
 * the one the damage has to go to.
 */
function switchTargetOf(units: { name: string; hp: number }[]): string {
  let best = ''
  let hp = -1
  for (const u of units) if (u.hp > hp) { hp = u.hp; best = u.name }
  return best
}

/**
 * The leash on the entity the PLAYER is holding, measured the way the engine
 * measures it: to that entity, never to the nearest one.
 *
 * Reading it off `w.bosses` rather than off `w.leashOutMs` on purpose. The
 * readout has to be live at every distance so a tank can watch themselves drift
 * — the engine's record only exists once the leash is already broken, which is
 * the moment it stops being useful.
 */
function leashOf(w: World): { name: string; yards: number; max: number } | null {
  for (const def of w.boss.mechanics) {
    if (def.rule.type !== 'holdMelee') continue
    const unit = w.bosses.find(b => b.def.id === def.from) ?? w.bosses[0]
    if (!unit || unit.targetId !== 0 || !unit.alive) continue
    return {
      name: unit.def.name,
      yards: Math.hypot(w.player.pos.x - unit.pos.x, w.player.pos.y - unit.pos.y),
      max: def.rule.maxYards,
    }
  }
  return null
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
    prompt: null, next: [], waiting: [], drillReps: 0, drillClean: 0,
    units: [], separation: null, minApart: 0, stack: null, leash: null, marks: [],
    marked: false, green: 0, pairTarget: ORB_COUNT, phase: null,
    altars: [], enrage: [], inbound: null, venom: 0, venomRaid: 0,
    fishFound: 0, fishSpent: 0, fishCarried: false,
    element: null, elementMs: 0, aloft: 0, killSpread: false,
  })
  // The fight's stack counter, read off the boss file the same way the
  // separation and the orb target are. Zero on the seven fights without one,
  // and the whole readout then draws nothing.
  const counterDef = boss.mechanics.find(m => m.counter)
  const venomCap = counterDef?.counter?.lethalAt ?? 0
  const venomName = counterDef?.name ?? ''
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null)
  /**
   * The kick that just landed.
   *
   * The only positive toast in the app, and the reason it exists is that an
   * interrupt is the one thing a player does right that produces nothing to look
   * at — the proof is a hit that never arrives. Deliberately not the `fail-toast`
   * class: that one is red and reads as an accusation, and this is the opposite
   * event.
   */
  const [kick, setKick] = useState<{ name: string; id: number } | null>(null)
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
    // The engine stamps `interruptFlash.atMs` and never clears it, so the
    // consumer ages it. Keyed on the timestamp for exactly the reason the
    // failure toast is: a kick landing twice in one pull is two events, and a
    // flag would announce the first one every frame until the second replaced it.
    let lastKickAt = -1

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
            : briefFor(world.announce, role, boss)
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
        // A landed kick, said out loud and put on screen. The canvas already
        // breaks the cast bar over the caster; this is the half a player finds
        // when they were looking at their own feet as they pressed it, and
        // between the three of them there is no version of "did that go through"
        // left unanswered.
        if (world.interruptFlash && world.interruptFlash.atMs !== lastKickAt) {
          lastKickAt = world.interruptFlash.atMs
          setKick({ name: world.interruptFlash.name, id: lastKickAt })
          sayInterrupt(world.interruptFlash.name)
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
          waiting: waitingOn(world),
          drillReps: world.drillReps,
          drillClean: world.drillClean,
          units: world.bosses.map(b => ({
            id: b.def.id, name: b.def.name, side: b.def.side, hp: Math.max(0, b.hp),
            untargetable: !!b.def.untargetable, empowered: b.empowered,
          })),
          separation: separationOf(world),
          minApart,
          // Flattened to plain data rather than passed through as the BossUnit
          // it comes back with: everything else in this sample is a number or a
          // string, and holding a live simulation object in React state would
          // hand the HUD a handle it could read a stale frame off.
          stack: (() => {
            const sg = stackGap(world)
            return sg && {
              threat: sg.threat.def.name, yards: sg.yards,
              minYards: sg.minYards, closing: sg.closing,
            }
          })(),
          leash: leashOf(world),
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
          // All five straight off the world. Every one of these is state the
          // simulation already owns — whether a box turned out to hold a fish,
          // which element it dealt you, how long you have left in the air — and
          // re-deriving any of it here would put a second answer on screen.
          fishFound: world.fishFound,
          fishSpent: world.fishSpent,
          fishCarried: world.fishCarried,
          element: world.player.element,
          elementMs: world.player.elementMs,
          aloft: world.player.aloft,
          killSpread: world.killSpreadWarning,
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

  // Shorter than the failure toast on purpose. A mistake is worth reading twice;
  // a confirmation only has to arrive, and one that lingered would still be on
  // screen when the next cast started winding up.
  useEffect(() => {
    if (!kick) return
    const t = window.setTimeout(() => setKick(null), 1500)
    return () => window.clearTimeout(t)
  }, [kick])

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
  // Only the bodies with a health bar. An untargetable entity — Mor'zahi, who is
  // an energy bar and nothing else — sits permanently at full, and counting it
  // would report a 100% health gap for the entire pull.
  const shootable = hud.units.filter(u => !u.untargetable)
  const hps = shootable.map(u => u.hp)
  const delta = hps.length > 1 ? Math.max(...hps) - Math.min(...hps) : 0
  // Which bar the damage should be going to, asked only while the simulation
  // says the spread has opened. "Even them out" with three bars and no name is
  // where a raider freezes; the healthiest one is the answer.
  const switchTo = hud.killSpread ? switchTargetOf(shootable.filter(u => u.hp > 0)) : ''
  // The fish, and what is left of them. `fishTotal` is 0 on the seven fights
  // that hide nothing, which is what keeps the whole row off their HUD.
  const fishTotal = hiddenTotalOf(boss)
  const resetsLeft = Math.max(0, fishTotal - hud.fishSpent)
  // The name on the energy bar. It belongs to whoever is filling it — on the
  // Explorers that is a fourth boss nobody can target, and calling his ascension
  // "Energy" made the fight's actual clock look like a cast bar.
  const energyOwner = boss.entities?.find(e => e.untargetable)?.name ?? ''
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
          {/* The energy bar, named after whoever is filling it and read as a
              number. On the Explorers this is the entire fight: it is Mor'zahi's
              ascension, nothing the raid does slows it, and the only thing that
              empties it is a fish. Left as a nameless "Energy" it looked like a
              cast bar — something that would go off and then be over — rather
              than the wipe timer it is. */}
          <div className="bar bar-boss">
            <span className="bar-label">{energyOwner || 'Energy'}</span>
            <div className="bar-track"><div className="bar-fill energy" style={{ width: `${hud.energy}%` }} /></div>
            <span className="bar-num">{Math.round(hud.energy)}%</span>
          </div>
          {boss.enrageName && (
            <div style={S.row}>
              <span style={hud.energy > 70 ? S.warn : S.note}>
                100% is a wipe — {boss.enrageName}
              </span>
            </div>
          )}

          {/* The fish. Three slots and a count, because the whole encounter is
              paced by them: each one empties the bar exactly once, and when the
              last has been fed nothing can empty it again. A raider who cannot
              see how many are left cannot tell a pull that is going fine from
              one that is already lost. */}
          {fishTotal > 0 && (
            <div className="fish" style={S.row}>
              <span style={S.lab}>Fish</span>
              {Array.from({ length: fishTotal }, (_, i) => {
                const spent = i < hud.fishSpent
                const found = i < hud.fishFound
                return (
                  <span
                    key={i}
                    style={{
                      ...S.dot,
                      width: 11, height: 11,
                      background: spent ? 'transparent' : found ? 'var(--accent)' : 'transparent',
                      border: `1px solid ${found ? 'var(--accent)' : 'var(--line)'}`,
                      opacity: spent ? 0.35 : found ? 1 : 0.55,
                    }}
                    title={spent ? 'fed — bar reset spent' : found ? 'found, not yet fed' : 'still in a box'}
                  />
                )
              })}
              <span style={S.num}>{resetsLeft}</span>
              <span style={S.note}>
                {resetsLeft === 0
                  ? 'no resets left — the bar is the enrage now'
                  : hud.fishCarried
                    ? 'you are carrying one — feed a boss that has not eaten'
                    : `${resetsLeft} bar reset${resetsLeft === 1 ? '' : 's'} left`}
              </span>
            </div>
          )}

          {/* Both entities side by side, with the gap between them. The single
              aggregate bar above hides the one thing that decides a two-golem
              pull: which of them you have been feeding damage into. */}
          {shootable.length > 1 && (
            <div className="golems">
              {shootable.map(u => (
                // The one you are parked on is marked, because "stay inside 40
                // yards of YOUR golem and outside the other's" is meaningless
                // if the two bars read as interchangeable.
                <div
                  key={u.id}
                  className={`golem${u.side ? ` side-${u.side}` : ''}${u.side && u.side === side ? ' yours' : ''}`}
                >
                  <span className="golem-name">
                    {u.name}
                    {/* A gold pip for a boss that has eaten a fish. Permanent,
                        once only, and the answer to "would feeding this one be
                        a wasted reset" — which is a question you want answered
                        before the walk, not after it. */}
                    {u.empowered && (
                      <span title="Empowered — has eaten a fish" style={{ color: '#d29922', marginLeft: 5 }}>◆</span>
                    )}
                  </span>
                  <div className="bar-track">
                    <div className="bar-fill golem" style={{ width: `${u.hp * 100}%` }} />
                  </div>
                  <span className="golem-num">{Math.round(u.hp * 100)}%</span>
                </div>
              ))}
              <span className={`golem-delta${hud.killSpread || delta >= DELTA_WARN ? ' hot' : ''}`}>
                Δ {Math.round(delta * 100)}%
              </span>
            </div>
          )}

          {/* One of them is nearly dead and another is nowhere near it.
              A persistent sentence rather than a banner, because this is a
              STATE — it lasts until somebody fixes it — and the phase banner
              clears itself after three seconds. It names the boss to switch to:
              "even them out" with three bars in front of you and no name on it
              is exactly where a raider stalls. */}
          {hud.killSpread && switchTo && (
            <div style={S.row}>
              <span style={S.warn}>
                one is nearly down and the others are not — switch to <strong>{switchTo}</strong>
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

          {/* The stacked pair, and the only distance that can lose the pull.
              The pair standing on top of each other is CORRECT — the link needs
              all of them inside the radius at once — so there is no gap between
              them worth showing, and the row that used to show one was teaching
              the tanks to undo their own job. What is here instead is the pair's
              live distance to the body nobody holds, which is the number the
              engine scores and the number the canvas draws. */}
          {hud.stack && (
            <>
              <div className={`separation${hud.stack.yards < hud.stack.minYards ? ' hot' : ''}`}>
                <span className="sep-lab">Pair → {hud.stack.threat}</span>
                <span className="sep-num">{Math.round(hud.stack.yards)}<em>yd</em></span>
                <span className="sep-need">hold {hud.stack.minYards}+</span>
              </div>
              {/* Drifting in, caught before it is a link. By the time all three
                  are inside the radius the damage has already stopped counting,
                  and the walk takes a couple of seconds to fix. */}
              {hud.stack.closing && hud.stack.yards >= hud.stack.minYards && (
                <div style={S.row}>
                  <span style={S.warn}>
                    closing on {hud.stack.threat} — walk the pair round to the far side
                  </span>
                </div>
              )}
            </>
          )}

          {/* Live separation. The tanks own this number and nobody could see it
              before — a pair sliding into their own damage reduction looked
              exactly like a pull where the damage had stopped working. Stood
              down on a fight with a stacked pair, which reads the row above
              instead: two numbers for one rule is a HUD arguing with itself. */}
          {!hud.stack && hud.separation !== null && hud.minApart > 0 && (
            <div className={`separation${hud.separation < hud.minApart ? ' hot' : ''}`}>
              <span className="sep-lab">Apart</span>
              <span className="sep-num">{Math.round(hud.separation)}<em>yd</em></span>
              <span className="sep-need">hold {hud.minApart}+</span>
            </div>
          )}

          {/* The melee leash, and the same argument as the separation above it
              inverted. A tank welded to a serpent has one number to hold all
              pull and no cast bar telling them how they are doing, so it is on
              screen continuously rather than only once it has gone wrong.
              Re-uses the separation row's styling deliberately: it is the same
              kind of readout — a live yardage against a bound — and inventing a
              second look for it would say the two were different things. */}
          {hud.leash && (
            <div className={`separation${hud.leash.yards > hud.leash.max ? ' hot' : ''}`}>
              <span className="sep-lab">{hud.leash.name}</span>
              <span className="sep-num">{Math.round(hud.leash.yards)}<em>yd</em></span>
              <span className="sep-need">stay inside {hud.leash.max}</span>
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

      {/* The kick landed. Sat above the failure toast's slot so the two never
          collide, and styled inline for the same reason the fountain chips are:
          it is the only green toast in the app and a rule for it in styles.css
          would sit unused on every fight but one. */}
      {kick && (
        <div
          key={kick.id}
          role="status"
          style={{
            position: 'absolute', left: '50%', bottom: '40%', transform: 'translateX(-50%)',
            padding: '8px 18px', borderRadius: 8, pointerEvents: 'none',
            fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: '.08em',
            textTransform: 'uppercase', textAlign: 'center', whiteSpace: 'nowrap',
            background: 'rgba(10, 44, 34, .92)', border: '1px solid #2fe3a0', color: '#9dffd8',
          }}
        >
          Kicked — {kick.name}
        </div>
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
        {/* Armed by something happening rather than by a clock, so it gets a
            word where the others get a number. A countdown here would be the
            HUD making one up: the next crate arrives when the ability the last
            fish bought is actually cast, and nobody — including the engine —
            knows when that is. Muted and unstyled by `soon`, because it is not
            imminent, it is pending; the tooltip names the cast that arms it.
            Styled inline for the same reason the fountain chips are: it only
            ever draws on a fight that declares an event-gated timeline. */}
        {hud.waiting.map(wt => (
          <span
            key={wt.id}
            className="next-item"
            style={{ opacity: 0.75 }}
            title={wt.on ? `Armed when ${wt.on} lands` : 'Armed by an earlier cast landing'}
          >
            {wt.name} <em style={{ color: 'var(--muted)' }}>waiting</em>
          </span>
        ))}
      </div>

      {/* The briefing. First sight of a mechanic pauses the fight and puts this
          on the left: what it is, what is happening, and what YOU do about it.
          The last part is role-specific, because "get out of it" and "point it
          away from the raid" are the same mechanic seen from two jobs. */}
      {callout && <div className="teaching-veil" />}
      {callout && (() => {
        const b = calloutAdd ? briefForAdd(calloutAdd, role) : briefFor(callout, role, boss)
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

        {/* What you are personally carrying, in words, next to the bars.
            The canvas already draws all three on your own body, which is where
            you read them from while you are playing — this is the version you
            can find when you have lost yourself in a crowd of twenty, and the
            only place the element countdown is a number rather than a colour.
            Each one is a fact about you, never an accusation: being handed an
            element is not a mistake, and being airborne is the correct answer. */}
        {(hud.fishCarried || hud.element || hud.aloft > 0) && (
          <div className="carried" style={S.row}>
            {hud.fishCarried && (
              <span style={{ ...S.chip, borderColor: '#2fe3a0' }}>
                <span style={{ ...S.dot, background: '#2fe3a0' }} />
                <span style={S.colour}>Disgusting Fish</span>
                <span style={S.tag}>feed a boss</span>
              </span>
            )}
            {hud.element && (
              <span style={{ ...S.chip, borderColor: hud.element === 'fire' ? '#ff8a3e' : '#7ec4ff' }}>
                <span style={{ ...S.dot, background: hud.element === 'fire' ? '#ff8a3e' : '#7ec4ff' }} />
                <span style={S.colour}>{hud.element === 'fire' ? 'Burning Flames' : 'Piercing Frost'}</span>
                <span style={S.num}>{(hud.elementMs / 1000).toFixed(0)}s</span>
                <span style={S.tag}>
                  run into {hud.element === 'fire' ? 'frost' : 'fire'}
                </span>
              </span>
            )}
            {hud.aloft > 0 && (
              <span style={{ ...S.chip, borderColor: '#2fe3a0' }}>
                <span style={S.colour}>Airborne</span>
                <span style={S.num}>{(hud.aloft / 1000).toFixed(1)}s</span>
                <span style={S.tag}>the wave passes under you</span>
              </span>
            )}
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
