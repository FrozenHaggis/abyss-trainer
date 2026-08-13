import type {
  Ability, AddDef, Ally, BossDef, BossEntityDef, FailureRow, Instance, MechanicDef,
  PlayerState, Prompt, Role, RunResult, Vec,
} from './types'

// The simulation. Deliberately framework-free and side-effect-free so it can be
// stepped by a test as easily as by requestAnimationFrame.
//
// The one rule that matters: a mechanic is judged ONCE, at its resolve moment.
// No per-frame scoring. That keeps the debrief unambiguous — a failure is a
// specific instance of a specific mechanic, not an accumulation of frames.

export const TICK_MS = 1000 / 60
const PLAYER_SPEED = 14 // yards/sec, roughly a WoW run speed
const MELEE_RANGE = 5
const BURST_WINDOW_MS = 10000
/** Shot travel speed in yards/sec — fast enough to feel instant at melee range. */
const SHOT_SPEED = 62
const SHOTS_PER_SEC = 5
const FIRE_INTERVAL_MS = 1000 / SHOTS_PER_SEC
/** How close a shot must pass to an entity to count. Generous: aiming is not the skill being taught. */
const BOSS_HIT_RADIUS = 4.5
/** Adds are smaller targets than a boss, so they take real aim. */
const ADD_HIT_RADIUS = 2.8

export interface Input {
  up: boolean; down: boolean; left: boolean; right: boolean
  pressed: Ability[] // abilities pressed since the last tick
  /** Where the player is aiming, in yards. null = not aiming. */
  aim: Vec | null
  /** Trigger held. */
  firing: boolean
}

/** A live add. */
export interface Add {
  uid: number
  def: AddDef
  pos: Vec
  hp: number
  shield: number
  /** ms until its threat lands. */
  fuse: number
  /** `kick` adds: ms until the current cast completes, or -1 when not casting. */
  castMs: number
  /** The current cast was interrupted. */
  kicked: boolean
  alive: boolean
}

/** A shot in flight. The boss only dies from these. */
export interface Shot {
  pos: Vec
  vel: Vec
  /** ms of life left, so a miss expires instead of flying forever. */
  life: number
}

/**
 * A boss entity on the field. Most fights have one; four in this tier have more.
 * Position is fixed at its station — the boss does not chase, the tank comes to
 * it — so what changes each tick is its facing and who holds it.
 */
export interface BossUnit {
  def: BossEntityDef
  pos: Vec
  angle: number
  /**
   * Ally id holding this entity, 0 for the player, or -1 for an entity nobody
   * is tanking (a stationary caster). Only the primary and anything flagged
   * `tankedApart` is tanked — this raid has exactly two tanks.
   */
  targetId: number
}

export interface World {
  boss: BossDef
  player: PlayerState
  /** The rest of the raid. Simulated so group mechanics have bodies. */
  allies: Ally[]
  /** Every entity in the encounter, primary first. */
  bosses: BossUnit[]
  /** How long the current tank has been over the swap threshold, in ms. */
  overStackMs: number
  alliesLost: number
  instances: Instance[]
  /** Live adds. */
  adds: Add[]
  addTimerMs: number
  addWave: number
  addsKilled: number
  addsLeaked: number
  /** Shots in flight. */
  shots: Shot[]
  /** ms until the weapon can fire again. */
  fireCooldown: number
  /** Shots fired and shots that connected, for the debrief's accuracy line. */
  shotsFired: number
  shotsHit: number
  bossEnergy: number // 0..100
  bossHp: number     // 0..1 — you win by emptying it
  killed: boolean
  elapsedMs: number
  raidHealth: number // 0..1, the abstract raid the healer keeps up
  raidHealthLow: number
  failures: Map<string, FailureRow>
  resolvedCount: number
  /** Mechanic ids already introduced, so the teaching callout fires once. */
  seen: Set<string>
  /** Set when a mechanic should be announced this tick. */
  announce: MechanicDef | null
  deathCause: string | null
  nextUid: number
  loopIndex: number
  loopTimerMs: number
  ambientTimerMs: number
  /** Screen-shake impulse, purely cosmetic. */
  shake: number
  /** Tank stacks on the player, mirroring Ally.stacks. */
  playerStacks: number
  /** What the player should be doing this instant, or null. */
  prompt: Prompt | null
  /** The most recent failure, for an immediate toast. */
  lastFailure: { name: string; failText: string; atMs: number } | null
  /** True while two tanked entities are close enough to gain their damage reduction. */
  bossesLinked: boolean
  linkedMs: number
  /** Set in drill mode: the one mechanic being practised. */
  drillId: string | null
  /** Drill mode only: reps attempted and reps survived. */
  drillReps: number
  drillClean: number
}

const ABILITIES_BY_ROLE: Record<Role, Ability[]> = {
  tank: ['taunt', 'defensive', 'interrupt', 'burst'],
  healer: ['dispel', 'raidcd', 'defensive', 'interrupt'],
  dps: ['interrupt', 'defensive', 'burst', 'dispel'],
}

export const COOLDOWN_MS: Record<Ability, number> = {
  interrupt: 12000, dispel: 8000, defensive: 90000,
  taunt: 10000, burst: 120000, raidcd: 100000,
}

export function abilitiesFor(role: Role): Ability[] {
  return ABILITIES_BY_ROLE[role]
}

/**
 * The raid: one co-tank, four healers, fourteen dps. If the player is the tank
 * the co-tank is the one they swap with; otherwise both tanks are AI and handle
 * it themselves.
 */
function makeAllies(playerRole: Role): Ally[] {
  const out: Ally[] = []
  const comp: Role[] = [
    'tank',
    ...Array<Role>(4).fill('healer'),
    ...Array<Role>(14).fill('dps'),
  ]
  // A second AI tank when the player is not tanking, so swaps still happen.
  if (playerRole !== 'tank') comp.push('tank')
  comp.forEach((r, i) => {
    out.push({
      id: i + 1, role: r,
      pos: { x: 0, y: 0 }, want: { x: 0, y: 0 },
      health: 1, alive: true, stacks: 0, debuff: null, debuffMs: 0,
      // Tanks are on the boss from the pull; everyone else walks on when needed.
      presence: r === 'tank' ? 1 : 0,
    })
  })
  return out
}

/**
 * Build the encounter's entities. A fight that declares none gets a single
 * unnamed one at the centre, which is exactly how every boss behaved before
 * multi-boss support existed — so single-boss fights are untouched.
 */
function makeBosses(boss: BossDef, allies: Ally[]): BossUnit[] {
  const defs: BossEntityDef[] = boss.entities?.length
    ? boss.entities
    : [{ id: boss.key, name: boss.name, npcId: 0, start: { x: 0, y: 0 } }]

  // Two tanks exist, so at most two entities can be held. The primary opens on
  // the co-tank; a `tankedApart` entity takes the other tank.
  const tanks = allies.filter(a => a.role === 'tank').map(a => a.id)
  let nextTank = 0
  return defs.map((d, i) => {
    const wants = i === 0 || d.tankedApart
    return {
      def: d,
      pos: { ...d.start },
      angle: -Math.PI / 2,
      targetId: wants && nextTank < tanks.length ? tanks[nextTank++] : -1,
    }
  })
}

/** The entity the player's tank holds, and the anchor for anything untagged. */
export function primaryBoss(w: World): BossUnit {
  return w.bosses[0]
}

/** The entity that casts a given mechanic, falling back to the primary. */
export function bossUnitFor(w: World, from?: string): BossUnit {
  if (!from) return w.bosses[0]
  return w.bosses.find(b => b.def.id === from) ?? w.bosses[0]
}

/** Nearest entity to a point — what "in range" and "in melee" mean with several. */
export function nearestBoss(w: World, p: Vec): BossUnit {
  let best = w.bosses[0]
  let bd = Infinity
  for (const b of w.bosses) {
    const d = dist(b.pos, p)
    if (d < bd) { bd = d; best = b }
  }
  return best
}

/**
 * Where the bulk of the raid is standing — what a tank frontal must not sweep.
 *
 * Previously this was hard-coded to the arena centre, which is only true when
 * the single boss is at the centre. With entities held apart the raid stacks
 * between them, so the honest reference is where the raid actually is.
 */
function raidAnchor(w: World): Vec {
  let x = 0, y = 0, n = 0
  for (const a of w.allies) {
    if (!a.alive) continue
    x += a.pos.x; y += a.pos.y; n++
  }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 }
}

/**
 * Drill mode: one mechanic, on loop, no enrage and no boss health.
 *
 * Dying to Blast Wave at 50 seconds and having to replay the whole pull to see
 * it again is how raiders stay bad at a mechanic. A drill gives you twenty reps
 * in the time a pull gives you two.
 */
export function createDrill(boss: BossDef, role: Role, mechanicId: string): World {
  const w = createWorld(boss, role)
  w.drillId = mechanicId
  // Only the drilled mechanic fires, every few seconds, forever.
  w.boss = {
    ...boss,
    loop: [mechanicId],
    introEverySec: 1,
    loopIntervalSec: Math.max(3.5, boss.loopIntervalSec * 0.7),
    atFullEnergy: undefined,
    // Ambient attrition and adds are the fight, not the mechanic — they would
    // just kill you slowly while you practise something else.
    ambient: [],
    adds: [],
    // No enrage. You leave a drill when you are done with it, not when a timer
    // decides you are.
    pullLengthSec: 3600,
  }
  return w
}

export function createWorld(boss: BossDef, role: Role): World {
  const allies = makeAllies(role)
  // Boss opens on the co-tank, so a player tank's first job is to taunt it off.
  return {
    boss,
    allies,
    bosses: makeBosses(boss, allies),
    overStackMs: 0,
    alliesLost: 0,
    player: {
      pos: { x: 0, y: 12 }, role, health: 1, alive: true,
      carrying: {}, cooldowns: {}, aloft: 0,
    },
    instances: [],
    adds: [],
    addTimerMs: 0,
    addWave: 0,
    addsKilled: 0,
    addsLeaked: 0,
    shots: [],
    fireCooldown: 0,
    shotsFired: 0,
    shotsHit: 0,
    bossEnergy: 0,
    bossHp: 1,
    killed: false,
    elapsedMs: 0,
    raidHealth: 1,
    raidHealthLow: 1,
    failures: new Map(),
    resolvedCount: 0,
    seen: new Set(),
    announce: null,
    deathCause: null,
    nextUid: 1,
    loopIndex: 0,
    loopTimerMs: 0,
    ambientTimerMs: 0,
    shake: 0,
    playerStacks: 0,
    prompt: null,
    lastFailure: null,
    bossesLinked: false,
    linkedMs: 0,
    drillId: null,
    drillReps: 0,
    drillClean: 0,
  }
}

/** Whoever is holding an entity — the primary unless told otherwise. */
export function currentTank(w: World, unit = w.bosses[0]): { pos: Vec; stacks: number; isPlayer: boolean } {
  if (unit.targetId === 0) return { pos: w.player.pos, stacks: w.playerStacks, isPlayer: true }
  const a = w.allies.find(x => x.id === unit.targetId)
  return a
    ? { pos: a.pos, stacks: a.stacks, isPlayer: false }
    : { pos: unit.pos, stacks: 0, isPlayer: false }
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
const lenOf = (v: Vec) => Math.hypot(v.x, v.y)

/** Shortest signed angle from a to b, in radians. */
function angleDelta(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Is the player inside this instance's telegraph? */
export function isInside(inst: Instance, p: Vec): boolean {
  const s = inst.def.shape
  if (!s) return false
  const dx = p.x - inst.pos.x
  const dy = p.y - inst.pos.y
  const d = Math.hypot(dx, dy)
  switch (s.kind) {
    case 'circle':
      return d <= s.radius
    case 'annulus':
      return d >= s.inner && d <= s.outer
    case 'cone': {
      if (d > s.radius) return false
      const to = Math.atan2(dy, dx)
      return Math.abs(angleDelta(inst.angle, to)) <= (s.arcDeg * Math.PI) / 360
    }
    case 'line': {
      // Project onto the line's axis; inside if within length and half-width.
      const ca = Math.cos(inst.angle)
      const sa = Math.sin(inst.angle)
      const along = dx * ca + dy * sa
      const across = -dx * sa + dy * ca
      return along >= 0 && along <= s.length && Math.abs(across) <= s.width / 2
    }
  }
}

function def_scored(w: World, def: MechanicDef): boolean {
  return def.roles.includes(w.player.role)
}

function recordFailure(w: World, def: MechanicDef) {
  if (def.failText) {
    w.lastFailure = { name: def.name, failText: def.failText, atMs: w.elapsedMs }
  }
  const row = w.failures.get(def.id)
  if (row) row.count++
  else w.failures.set(def.id, { mechanicId: def.id, name: def.name, failText: def.failText, count: 1 })
}

const MAX_SINGLE_HIT = 0.55

/**
 * A mechanic that kills outright. No cap, no mitigation, no healing through it —
 * that IS the lesson. These are the `category: "Deadly"` abilities, and the
 * whole point of separating them from chip damage is that you cannot heal your
 * way out of standing in one.
 */
function killPlayer(w: World, cause: string) {
  if (!w.player.alive) return
  w.player.alive = false
  w.player.health = 0
  w.deathCause = cause
  w.shake = 1
}

function hurt(w: World, amount: number, cause: string) {
  // Cap any one hit. You should be able to eat a mechanic, see the failure, and
  // carry on — three mistakes in quick succession is what kills you, not one.
  const capped = Math.min(amount, MAX_SINGLE_HIT)
  const mitigated = w.player.cooldowns.defensive && w.player.cooldowns.defensive > COOLDOWN_MS.defensive - 8000
    ? capped * 0.4
    : capped
  w.player.health -= mitigated
  w.shake = Math.min(1, w.shake + mitigated * 2)
  if (w.player.health <= 0 && w.player.alive) {
    w.player.alive = false
    w.player.health = 0
    w.deathCause = cause
  }
}

function spawn(w: World, def: MechanicDef, at?: Vec, angle?: number) {
  // Whichever entity casts this. On a two-boss fight a frontal has to come out
  // of the boss that actually casts it, or "get behind Ithraz" means nothing.
  const src = bossUnitFor(w, def.from)
  let pos: Vec
  switch (def.origin) {
    case 'boss': pos = { ...src.pos }; break
    case 'player': pos = { ...w.player.pos }; break
    case 'targeted': {
      // Mechanics that pick a raider pick YOU most of the time. This is a
      // trainer: watching an ally carry a debuff teaches nothing, and a DPS
      // whose only job is dodging circles is not learning the fight.
      const onPlayer = Math.random() < 0.72
      if (onPlayer) pos = { ...w.player.pos }
      else {
        const live = w.allies.filter(a => a.alive)
        const a = live[Math.floor(Math.random() * Math.max(1, live.length))]
        pos = a ? { ...a.pos } : { ...w.player.pos }
      }
      break
    }
    case 'edge': {
      const a = Math.random() * Math.PI * 2
      const r = w.boss.arenaRadius
      pos = { x: Math.cos(a) * r, y: Math.sin(a) * r }
      break
    }
    default: {
      // Floor AoE lands where the raid is, not uniformly across the map.
      //
      // This used to scatter over the whole arena, and once the radii were
      // measured from real logs — 58 yards on Vashnik against the 42 it was
      // being played at — the floor area nearly doubled and a 5-yard circle
      // stopped reaching anybody. You could stand still and never be touched,
      // which is not a mechanic, it is scenery.
      //
      // Anchoring on a raider and jittering keeps it dodgeable (you always have
      // somewhere to go) while guaranteeing it is somewhere that matters.
      const live = w.allies.filter(a => a.alive)
      const anchor = Math.random() < 0.4 || !live.length
        ? w.player.pos
        : live[Math.floor(Math.random() * live.length)].pos
      const jitter = (w.boss.arenaRadius * 0.16) + 6
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * jitter
      pos = { x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r }
      // Never outside the floor.
      const len = lenOf(pos)
      const rim = w.boss.arenaRadius * 0.92
      if (len > rim) { pos.x = (pos.x / len) * rim; pos.y = (pos.y / len) * rim }
    }
  }
  if (at) pos = { ...at }

  // Cones and lines from the boss point at the player, which is what makes
  // `faceAway` a real decision for a tank.
  let ang = angle ?? 0
  if (angle === undefined && def.origin === 'boss') {
    ang = Math.atan2(w.player.pos.y - pos.y, w.player.pos.x - pos.x)
  } else if (angle === undefined) {
    ang = Math.random() * Math.PI * 2
  }

  const inst: Instance = {
    uid: w.nextUid++, def, pos, angle: ang,
    fromId: src.def.id,
    timer: def.telegraphMs, resolved: false, answered: false,
    // Did this land on the player? Drives both the "it follows you" behaviour
    // and where its pool drops.
    carriedByPlayer:
      def.origin === 'player' ||
      (def.origin === 'targeted' && Math.hypot(pos.x - w.player.pos.x, pos.y - w.player.pos.y) < 0.01),
  }
  if (def.driftSpeed) {
    const a = Math.random() * Math.PI * 2
    inst.drift = { x: Math.cos(a) * def.driftSpeed, y: Math.sin(a) * def.driftSpeed }
  }
  w.instances.push(inst)

  if (!w.seen.has(def.id)) {
    w.seen.add(def.id)
    w.announce = def
  }
}

/** Fire a mechanic by id. Exported so bosses can chain mechanics. */
export function fire(w: World, id: string, at?: Vec, angle?: number) {
  const def = w.boss.mechanics.find(m => m.id === id)
  if (!def) return
  if (def.rule.type === 'collect') {
    // Scattered pickups, not one shape. Each is its own instance so each can be
    // eaten independently, which is what "one player walks in first and eats it
    // alone" actually means.
    const n = def.rule.count
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + w.elapsedMs / 3000
      const r = w.boss.arenaRadius * (0.28 + 0.42 * ((i % 3) / 2))
      spawn(w, def, { x: Math.cos(a) * r, y: Math.sin(a) * r })
    }
    return
  }
  spawn(w, def, at, angle)
}

function resolveInstance(w: World, inst: Instance) {
  const { def } = inst
  inst.resolved = true
  w.resolvedCount++
  const scored = def.roles.includes(w.player.role)
  const inside = isInside(inst, w.player.pos)

  switch (def.rule.type) {
    case 'avoid':
      // A contact hazard's "resolve" is the moment it appears on the floor, not
      // a hit landing. It sits there until something touches it, and the linger
      // tick below is what punishes touching it.
      //
      // Without this, Coalesced Venom — a 1 ms telegraph, spawned at a random
      // point, and Deadly — could materialise on top of you and kill you
      // outright with no reaction window. That is not a mechanic, it is a coin
      // flip, and it killed all three roles at the 90 second mark in playtests.
      if (inside && !def.popsOnContact) {
        if (scored) recordFailure(w, def)
        // Deadly means deadly. Everything else is damage you get healed through.
        if (def.lethal) killPlayer(w, def.name)
        else hurt(w, def.damage ?? 0.3, def.name)
      }
      break

    case 'collect':
      // `answered` means somebody ran over it in time. Only the ones nobody
      // reached rupture, and only those are ever reported — eating one is
      // correct play, so a soaker can never appear as a failure.
      if (!inst.answered) {
        if (scored) recordFailure(w, def)
        w.raidHealth -= def.lethal ? 0.16 : 0.09
      }
      break

    case 'beInside':
      if (!inside) {
        if (scored) recordFailure(w, def)
        // Missing a shared soak hurts the RAID, not you — even when the ability
        // is Deadly. An unsoaked hit lands on the group; killing the player for
        // being late to it would blame one person for a collective miss.
        w.raidHealth -= def.lethal ? 0.3 : 0.12
      }
      break

    case 'faceAway': {
      // Fails if the cone sweeps the raid.
      const raid = raidAnchor(w)
      const toRaid = Math.atan2(raid.y - inst.pos.y, raid.x - inst.pos.x)
      const arc = def.shape?.kind === 'cone' ? (def.shape.arcDeg * Math.PI) / 360 : 0.5
      if (Math.abs(angleDelta(inst.angle, toRaid)) <= arc) {
        if (scored) recordFailure(w, def)
        w.raidHealth -= 0.1
      }
      if (inside) hurt(w, def.damage ?? 0.25, def.name)
      break
    }

    case 'press':
      if (!inst.answered) {
        if (scored) recordFailure(w, def)
        if (def.damage) hurt(w, def.damage, def.name)
        else w.raidHealth -= 0.08
      }
      break

    case 'carryOut': {
      const d = lenOf(w.player.pos)
      if (w.player.carrying[def.id] !== undefined && d < def.rule.minDistance) {
        if (scored) recordFailure(w, def)
        // You detonated it on top of the raid. A Deadly one kills you where you
        // stand and takes a chunk of the group with it — which is why running
        // it out is the mechanic.
        if (def.lethal) {
          w.raidHealth -= 0.25
          killPlayer(w, def.name)
        } else {
          w.raidHealth -= 0.1
        }
      }
      delete w.player.carrying[def.id]
      break
    }

    case 'survive':
      if (inside && def.knockbackYards) {
        const away = Math.atan2(w.player.pos.y - inst.pos.y, w.player.pos.x - inst.pos.x)
        let nx = w.player.pos.x + Math.cos(away) * def.knockbackYards
        let ny = w.player.pos.y + Math.sin(away) * def.knockbackYards
        const r = Math.hypot(nx, ny)
        const rim = w.boss.arenaRadius - 1.5
        if (r > rim) {
          // Clamped to the rim, and it counts as a failure: you were standing
          // somewhere the knock could not survive.
          nx = (nx / r) * rim
          ny = (ny / r) * rim
          if (scored) recordFailure(w, def)
          hurt(w, def.damage ?? 0.25, def.name)
        }
        w.player.pos.x = nx
        w.player.pos.y = ny
        w.player.aloft = 1200
        w.shake = 1
      }
      break

    case 'tankSwap': {
      // Applies a stack to whoever holds the entity that cast it. The failure is
      // checked continuously in step(), not here.
      const unit = bossUnitFor(w, def.from)
      if (unit.targetId === 0) w.playerStacks += 1
      else {
        const t = w.allies.find(a => a.id === unit.targetId)
        if (t) t.stacks += 1
      }
      break
    }

    case 'raidDamage':
    case 'keepApart':
      // Never resolved here. Both are judged continuously in step().
      break
  }

  // Anything that lands on the floor sets off the orbs it covers.
  //
  // This is the Coiled Altar, expressed: "it is arena management, not reflexes:
  // every orb left where an axe or a tank cone will destroy it is a Rupture
  // waiting to happen." Sever's own note says it "also destroys Coalesced Venom
  // in its path", and Axegrinder's ricochets do the same. Nothing connected the
  // two, so orbs were only ever detonated by shooting them — and the fight's
  // central tension, where you point your cone, did nothing at all.
  if (def.shape) {
    for (const add of w.adds) {
      if (!add.alive || add.def.job !== 'leave') continue
      if (!isInside(inst, add.pos)) continue
      add.alive = false
      recordAddFailure(w, add.def)
      w.raidHealth -= 0.16
      w.shake = Math.min(1, w.shake + 0.5)
    }
  }

  if (def.spawns) {
    const child = w.boss.mechanics.find(m => m.id === def.spawns!.defId)
    if (child) {
      // A carried debuff leaves its pool wherever the carrier is standing when
      // it expires — that is the point of running it out.
      const carried = def.rule.type === 'carryOut' && inst.carriedByPlayer
      const at = carried ? { ...w.player.pos } : inst.pos
      spawn(w, child, at, inst.angle)
      if (carried) {
        // Give the carrier a beat to walk clear. Without it the pool lands on
        // top of you and resolves in the same frame, which is not a mechanic —
        // it is an ambush.
        const dropped = w.instances[w.instances.length - 1]
        if (dropped && dropped.timer < 1200) dropped.timer = 1200
      }
    }
  }
}

const ALLY_SPEED = 12
const SWAP_GRACE_MS = 2500
/** How fast a boss walks to its tank. Slower than a player, so leading one is deliberate. */
const BOSS_FOLLOW_SPEED = 7
/** How long the pair may sit inside the link range before it is scored. */
const LINK_GRACE_MS = 2500
/**
 * How long the co-tank takes to taunt off you once your stacks are up. Long
 * enough that you see the stacks climb and understand why the swap happened,
 * short enough that you are never punished for a swap that is their job.
 */
const CO_TANK_REACTION_MS = 1400

/**
 * Ally AI. Deliberately assignment-based rather than emergent: when a mechanic
 * telegraphs, each ally is handed one destination and walks to it. Emergent
 * flocking looks clever and fails unpredictably, which would leave the player
 * unable to tell their own mistakes from the raid's.
 *
 * Allies are competent on purpose. If they missed soaks at random, a failed
 * pull would teach nothing.
 */
/**
 * A point INSIDE a mechanic's shape, for an ally assigned to soak it.
 *
 * This matters more than it looks. A cone is anchored at the boss, so its
 * `pos` is the apex — sending soakers to `inst.pos` walked them into the boss
 * instead of into the cone. Soakers have to stand in the body of the shape,
 * fanned out so they do not stack in one spot.
 */
function soakPoint(inst: Instance, slot: number, of: number): Vec {
  const sh = inst.def.shape
  if (!sh) return { ...inst.pos }
  // Fan the soakers across the shape rather than piling them on one pixel.
  const t = of <= 1 ? 0.5 : slot / (of - 1)
  switch (sh.kind) {
    case 'cone': {
      const half = (sh.arcDeg * Math.PI) / 360
      const ang = inst.angle + (t - 0.5) * half * 1.3
      const r = sh.radius * (0.5 + 0.22 * ((slot % 2) ? 1 : -1))
      return { x: inst.pos.x + Math.cos(ang) * r, y: inst.pos.y + Math.sin(ang) * r }
    }
    case 'circle': {
      const ang = t * Math.PI * 2
      const r = sh.radius * 0.55
      return { x: inst.pos.x + Math.cos(ang) * r, y: inst.pos.y + Math.sin(ang) * r }
    }
    case 'line': {
      const along = sh.length * (0.3 + 0.4 * t)
      return { x: inst.pos.x + Math.cos(inst.angle) * along, y: inst.pos.y + Math.sin(inst.angle) * along }
    }
    case 'annulus': {
      const ang = t * Math.PI * 2
      const r = (sh.inner + sh.outer) / 2
      return { x: inst.pos.x + Math.cos(ang) * r, y: inst.pos.y + Math.sin(ang) * r }
    }
  }
}

/** Is this point inside the shape, treated generously so allies keep clear? */
function threatAt(inst: Instance, x: number, y: number): number {
  const sh = inst.def.shape
  if (!sh) return 0
  const dx = x - inst.pos.x
  const dy = y - inst.pos.y
  const d = Math.hypot(dx, dy) || 0.001
  switch (sh.kind) {
    case 'circle': return d < sh.radius + 5 ? (sh.radius + 5) - d : 0
    case 'annulus': return d > sh.inner - 2 ? d - (sh.inner - 2) : 0
    case 'cone': {
      if (d > sh.radius + 4) return 0
      const to = Math.atan2(dy, dx)
      let a = to - inst.angle
      while (a > Math.PI) a -= Math.PI * 2
      while (a < -Math.PI) a += Math.PI * 2
      return Math.abs(a) <= (sh.arcDeg * Math.PI) / 360 + 0.15 ? (sh.radius + 4) - d : 0
    }
    case 'line': {
      const ca = Math.cos(inst.angle), sa = Math.sin(inst.angle)
      const along = dx * ca + dy * sa
      const across = -dx * sa + dy * ca
      return along > -3 && along < sh.length + 3 && Math.abs(across) < sh.width / 2 + 4
        ? (sh.width / 2 + 4) - Math.abs(across) : 0
    }
  }
}

/**
 * Ally AI. Assignment-based rather than emergent: each ally is handed one
 * destination per tick and walks to it. Emergent flocking looks clever and
 * fails unpredictably, which would leave the player unable to tell their own
 * mistakes from the raid's.
 *
 * Priority, highest first: get out of what will hurt you, then soak what needs
 * soaking, then hold formation. Allies are competent on purpose — if they
 * missed soaks at random, a failed pull would teach nothing.
 */
function allyThink(w: World) {
  const arena = w.boss.arenaRadius

  // Where melee stands: the midpoint of everything being tanked. With one boss
  // that is the boss. With Vexhul and Ithraz held apart it is the gap between
  // them, which is exactly where the tactic file puts melee.
  const tanked = w.bosses.filter(b => b.targetId >= 0)
  const anchor: Vec = tanked.length
    ? {
        x: tanked.reduce((s, b) => s + b.pos.x, 0) / tanked.length,
        y: tanked.reduce((s, b) => s + b.pos.y, 0) / tanked.length,
      }
    : { ...w.bosses[0].pos }

  // Soak slots. All but one are filled by allies; the last is the player's, so
  // a group mechanic is always personally consequential.
  const soaks: { inst: Instance; slots: number; taken: number }[] = []
  for (const inst of w.instances) {
    if (inst.resolved || inst.def.rule.type !== 'beInside') continue
    soaks.push({ inst, slots: Math.max(1, (inst.def.soakers ?? 4) - 1), taken: 0 })
  }

  // Pickups. Raiders run over all but one of them; the last is yours, so a
  // collect mechanic is always personally consequential without being scripted.
  const pickups = w.instances.filter(i =>
    !i.resolved && !i.answered && i.def.rule.type === 'collect')
  const claimable = pickups.slice(0, Math.max(0, pickups.length - 1))
  let claimed = 0

  for (const a of w.allies) {
    if (!a.alive) continue

    // 1. Formation. Melee on a tight ring, ranged further out, all of it
    //    drifting slowly so the raid never looks frozen in place.
    // Fixed station per raider, derived from their id. No time term: raiders
    // hold their spot and only move when a mechanic makes them, which is what
    // a real raid looks like. An orbiting drift made them circle forever.
    const isMelee = a.role === 'tank' || a.id % 3 === 0
    const ringR = isMelee ? 9 : 21 + (a.id % 4) * 2.5
    const spread = (a.id / Math.max(1, w.allies.length)) * Math.PI * 2
    a.want.x = anchor.x + Math.cos(spread) * ringR
    a.want.y = anchor.y + Math.sin(spread) * ringR

    // 2. Tanks. A tank stands in front of whatever it is holding, so the frontal
    //    stays put and points away from the raid. On a fight where two entities
    //    are held apart that puts a tank at each — which is the mechanic. A tank
    //    holding nothing waits behind the primary, clear of the frontal, ready
    //    to take the swap.
    const held = w.bosses.find(b => b.targetId === a.id)
    if (held?.def.tankedApart) {
      // Hold it at its assigned corner. Standing relative to the boss made the
      // tank and the boss chase each other now that a tanked entity follows its
      // tank — a slow crawl that eventually walked the pair together, which is
      // the one thing this fight forbids.
      a.want.x = held.def.start.x
      a.want.y = held.def.start.y
    } else if (held) {
      a.want.x = held.pos.x + Math.cos(held.angle) * 5
      a.want.y = held.pos.y + Math.sin(held.angle) * 5
    } else if (a.role === 'tank') {
      const p = w.bosses[0]
      a.want.x = p.pos.x - Math.cos(p.angle) * 7
      a.want.y = p.pos.y - Math.sin(p.angle) * 7
    }

    // 3. Go and eat a globule if one is unclaimed. Tanks stay on the boss.
    if (a.role !== 'tank' && claimed < claimable.length) {
      const p = claimable[claimed++]
      a.want.x = p.pos.x
      a.want.y = p.pos.y
    }

    // 3a. Soak, if a slot is going spare. Tanks stay on the boss.
    if (a.role !== 'tank') {
      for (const sk of soaks) {
        if (sk.taken >= sk.slots) continue
        const pt = soakPoint(sk.inst, sk.taken, sk.slots)
        a.want.x = pt.x
        a.want.y = pt.y
        sk.taken++
        break
      }
    }

    // 3b. Demonstrate the rest of the mechanic vocabulary. A raid standing
    //     still through a knockback or a debuff teaches nothing, so each rule
    //     type gets a legible group movement you can copy.
    for (const inst of w.instances) {
      if (inst.resolved) continue
      const rt = inst.def.rule.type

      if (rt === 'carryOut') {
        // Carriers walk it out. A third of the raid plays carrier so the
        // "run to the edge, drop it, come back" shape is visible.
        if (a.id % 3 === 0 && a.role !== 'tank') {
          const r = Math.hypot(a.pos.x, a.pos.y) || 1
          const out = Math.min(arena * 0.82, inst.def.rule.minDistance + 6)
          a.want.x = (a.pos.x / r) * out
          a.want.y = (a.pos.y / r) * out
        }
      } else if (rt === 'survive') {
        // A knockback is coming: spread out and stand where the push carries
        // you ACROSS the platform, not off it. Everyone drifts inward first.
        const r = Math.hypot(a.pos.x, a.pos.y) || 1
        const safe = arena * 0.42
        a.want.x = (a.pos.x / r) * safe + Math.cos(a.id) * 5
        a.want.y = (a.pos.y / r) * safe + Math.sin(a.id) * 5
      } else if (rt === 'press' && inst.def.rule.ability === 'dispel') {
        // A drifting hazard: the raid gives it a wide berth rather than
        // walking through it.
        if (inst.def.shape?.kind === 'circle') {
          const dx = a.pos.x - inst.pos.x
          const dy = a.pos.y - inst.pos.y
          const d = Math.hypot(dx, dy) || 1
          if (d < inst.def.shape.radius + 8) {
            a.want.x = inst.pos.x + (dx / d) * (inst.def.shape.radius + 11)
            a.want.y = inst.pos.y + (dy / d) * (inst.def.shape.radius + 11)
          }
        }
      }
    }

    // 4. Get clear of anything lethal. Highest priority, overrides the above —
    //    and checked against where they ARE as well as where they are going, so
    //    a hazard landing on a standing ally makes them move.
    for (const inst of w.instances) {
      if (!inst.def.shape || inst.def.rule.type !== 'avoid') continue
      const sh = inst.def.shape
      const threatWant = threatAt(inst, a.want.x, a.want.y)
      const threatNow = threatAt(inst, a.pos.x, a.pos.y)
      if (threatWant <= 0 && threatNow <= 0) continue

      if (sh.kind === 'annulus') {
        // The ring is the danger, so safety is inward. Running "away" from an
        // annulus runs you off the platform.
        const dx = a.pos.x - inst.pos.x
        const dy = a.pos.y - inst.pos.y
        const d = Math.hypot(dx, dy) || 1
        const safe = Math.max(2, sh.inner - 6)
        a.want.x = inst.pos.x + (dx / d) * safe
        a.want.y = inst.pos.y + (dy / d) * safe
        continue
      }
      // Push out from wherever they currently stand, so the escape is a real
      // move away rather than a teleport to the far side.
      let dx = a.pos.x - inst.pos.x
      let dy = a.pos.y - inst.pos.y
      let d = Math.hypot(dx, dy)
      if (d < 0.5) {
        // Standing on the origin: no direction to flee, so pick one away from
        // the arena centre.
        const r = Math.hypot(a.pos.x, a.pos.y) || 1
        dx = a.pos.x / r; dy = a.pos.y / r; d = 1
      }
      const clear = (sh.kind === 'circle' ? sh.radius : sh.kind === 'cone' ? sh.radius * 0.75 : 12) + 7
      a.want.x = inst.pos.x + (dx / d) * clear
      a.want.y = inst.pos.y + (dy / d) * clear
    }

    // 5. Clean floor. If the station is now sitting in a lingering pool, walk
    //    to the nearest clear ground. This is what keeps the raid moving between
    //    mechanics: pools accumulate, so the group steadily relocates.
    let fouled = 0
    for (const inst of w.instances) {
      if (!inst.resolved || !inst.def.lingerMs || !inst.def.shape) continue
      fouled += threatAt(inst, a.want.x, a.want.y) > 0 ? 1 : 0
    }
    if (fouled > 0) {
      // Sample a ring of candidate spots and take the cleanest one nearest home.
      let bestX = a.want.x, bestY = a.want.y, bestScore = Infinity
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2 + a.id
        for (const dist2 of [10, 18, 26]) {
          const cx = a.want.x + Math.cos(ang) * dist2
          const cy = a.want.y + Math.sin(ang) * dist2
          if (Math.hypot(cx, cy) > arena * 0.86) continue
          let bad = 0
          for (const inst of w.instances) {
            if (!inst.def.shape) continue
            if (!inst.resolved && inst.def.rule.type !== 'avoid') continue
            if (threatAt(inst, cx, cy) > 0) bad += inst.resolved ? 1 : 2
          }
          const score = bad * 100 + dist2
          if (score < bestScore) { bestScore = score; bestX = cx; bestY = cy }
        }
      }
      a.want.x = bestX
      a.want.y = bestY
    }

    // 6. A small idle sway so a raider at station never looks switched off.
    //    Deliberately tiny — a couple of yards, not an orbit.
    a.want.x += Math.sin(w.elapsedMs / 2600 + a.id * 1.7) * 1.6
    a.want.y += Math.cos(w.elapsedMs / 3100 + a.id * 2.3) * 1.6

    // 7. Never walk off the platform.
    const r = Math.hypot(a.want.x, a.want.y)
    if (r > arena * 0.9) {
      a.want.x *= (arena * 0.9) / r
      a.want.y *= (arena * 0.9) / r
    }
  }
}

function allyMove(w: World, dt: number) {
  // The raid shows up for group work. A soak, a spread, a debuff to dispel —
  // anything that needs other bodies brings them in; otherwise the floor stays
  // clear so you can actually read your own telegraphs. Tanks never leave.
  const groupWork = w.instances.some(i => !i.resolved && (
    i.def.rule.type === 'beInside' ||
    i.def.rule.type === 'carryOut' ||
    (i.def.rule.type === 'press' && i.def.rule.ability === 'dispel')))

  for (const a of w.allies) {
    if (!a.alive) { a.presence = Math.max(0, a.presence - dt * 3); continue }
    const wanted = a.role === 'tank' || groupWork || a.debuff ? 1 : 0
    // Walk on briskly, drift off gently — a raid that blinks out mid-mechanic
    // reads as a bug.
    a.presence += Math.max(-dt * 1.1, Math.min(dt * 3.4, wanted - a.presence))
    a.presence = Math.max(0, Math.min(1, a.presence))
    // Reaction time, staggered by id: a raid does not move as one object.
    // Deterministic rather than random so playtests stay reproducible.
    const lag = 0.06 + (a.id % 5) * 0.035
    const ease = Math.min(1, dt / Math.max(0.016, lag))
    const dx = (a.want.x - a.pos.x) * ease
    const dy = (a.want.y - a.pos.y) * ease
    const d = Math.hypot(dx, dy)
    // Deadzone: close enough is close enough, but small enough that the idle
    // sway still reads as a living raider rather than a statue.
    if (d > 0.6) {
      const stepLen = Math.min(d, ALLY_SPEED * dt)
      a.pos.x += (dx / d) * stepLen
      a.pos.y += (dy / d) * stepLen
    }
    if (a.debuffMs > 0) {
      a.debuffMs -= dt * 1000
      if (a.debuffMs <= 0) { a.debuff = null; a.debuffMs = 0 }
    }
    if (a.health < 1 && a.health > 0) a.health = Math.min(1, a.health + 0.06 * dt)
  }
}

/**
 * What should the player do right now?
 *
 * Ordered by how quickly it will hurt: a kick you are about to miss beats a
 * puddle you are standing in. Only one instruction is ever shown — a wall of
 * competing advice teaches nothing.
 */
function computePrompt(w: World): Prompt | null {
  let best: Prompt | null = null
  let bestRank = Infinity
  const consider = (p: Prompt, rank: number) => {
    if (rank >= bestRank) return
    bestRank = rank
    best = { ...p, urgency: Math.max(0, Math.min(1, p.urgency)) }
  }

  // Tank swap: the boss has been on one tank too long and you are the other.
  const swapDef = w.boss.mechanics.find(m => m.rule.type === 'tankSwap')
  if (swapDef && swapDef.rule.type === 'tankSwap' && w.player.role === 'tank') {
    // The entity that casts the swap, not just whatever is listed first.
    const tank = currentTank(w, bossUnitFor(w, swapDef.from))
    if (!tank.isPlayer && tank.stacks >= swapDef.rule.maxStacks - 1) {
      // Called a stack early so you have time to react rather than being told
      // at the instant the clock starts running on a failure.
      consider({ verb: 'TAUNT', mechanic: swapDef.name, urgency: 1 }, 0)
    }
  }

  // Linked bosses beat everything else: at 99% damage reduction nothing you do
  // to them matters until they are pulled apart again.
  if (w.bossesLinked) {
    const d = w.boss.mechanics.find(m => m.rule.type === 'keepApart')
    if (d) consider({ verb: 'PULL THEM APART', mechanic: d.name, urgency: 1 }, 0)
  }

  // Adds first — a cast landing in two seconds beats any floor telegraph.
  for (const add of w.adds) {
    if (!add.alive) continue
    const d = add.def
    if (d.job === 'kick' && add.castMs >= 0 && !add.kicked) {
      const t = 1 - add.castMs / ((d.castEverySec ?? 8) * 1000)
      if (abilitiesFor(w.player.role).includes('interrupt')) {
        consider({ verb: 'KICK IT', mechanic: d.name, urgency: t }, 0)
      }
    } else if (d.job === 'intercept') {
      const t = 1 - lenOf(add.pos) / Math.max(1, w.boss.arenaRadius)
      consider({ verb: 'BLOCK IT', mechanic: d.name, urgency: t }, 1)
    } else if (d.job === 'kill') {
      const t = 1 - add.fuse / Math.max(1, d.fuseSec * 1000)
      if (t > 0.4) consider({ verb: add.shield > 0 ? 'BREAK THE SHIELD' : 'KILL IT', mechanic: d.name, urgency: t }, 2)
    } else if (d.job === 'leave') {
      if (dist(add.pos, w.player.pos) < 9) {
        consider({ verb: 'DO NOT TOUCH', mechanic: d.name, urgency: 0.5 }, 2)
      }
    }
  }

  for (const inst of w.instances) {
    if (inst.resolved) continue
    const { def } = inst
    const t = def.telegraphMs > 0 ? 1 - inst.timer / def.telegraphMs : 1
    const inside = isInside(inst, w.player.pos)
    const mine = def.roles.includes(w.player.role)

    switch (def.rule.type) {
      case 'press':
        if (!inst.answered && mine) {
          const verb = def.rule.ability === 'interrupt' ? 'KICK IT' : 'DISPEL'
          consider({ verb, mechanic: def.name, urgency: t }, 1)
        }
        break
      case 'beInside':
        if (!inside) consider({ verb: 'GET IN', mechanic: def.name, urgency: t }, 2)
        break
      case 'collect':
        // Only prompt for the nearest one — a instruction per globule is noise.
        if (!inst.answered && dist(inst.pos, w.player.pos) < 22) {
          consider({ verb: 'RUN OVER IT', mechanic: def.name, urgency: t }, 2)
        }
        break
      case 'carryOut':
        if (inst.carriedByPlayer) {
          const d = Math.hypot(w.player.pos.x, w.player.pos.y)
          if (d < def.rule.minDistance) {
            consider({ verb: 'RUN IT OUT', mechanic: def.name, urgency: t }, 2)
          }
        }
        break
      case 'avoid':
        if (inside) consider({ verb: 'MOVE OUT', mechanic: def.name, urgency: t }, 3)
        break
      case 'survive':
        if (inside) consider({ verb: 'BRACE — KNOCKBACK', mechanic: def.name, urgency: t }, 4)
        break
      case 'faceAway':
        // Only your problem when you are the one holding the thing casting it.
        if (w.player.role === 'tank' && bossUnitFor(w, def.from).targetId === 0) {
          consider({ verb: 'POINT IT AWAY', mechanic: def.name, urgency: t }, 2)
        }
        break
      default:
        break
    }
  }
  return best
}

/**
 * How many of the loop's mechanics are in play yet.
 *
 * Mechanics arrive one at a time: you meet one, get a few reps on it, and only
 * then does the next join the rotation. Firing the whole loop from the first
 * second is how a trainer turns into noise — you never find out which telegraph
 * was the one that killed you.
 */
export function unlockedCount(w: World): number {
  // A clean pull kills in roughly 0.46 x pullLengthSec — about 69 seconds on
  // most of these bosses. At the old 14-second cadence that unlocked only five
  // of a twelve-mechanic loop before the boss died, so you could burst it to
  // 20% having seen almost none of the fight. Five seconds gets the whole loop
  // in play inside a minute while still introducing them one at a time.
  const every = w.boss.introEverySec ?? 5
  const n = 2 + Math.floor(w.elapsedMs / 1000 / every)
  return Math.max(1, Math.min(w.boss.loop.length, n))
}

/** Spawn a wave of one add type. */
function spawnAdds(w: World, def: AddDef) {
  const r = def.spawnRadius ?? w.boss.arenaRadius * 0.72
  for (let i = 0; i < def.count; i++) {
    // Fanned around the rim so a wave arrives from several sides at once and
    // has to be prioritised rather than cleaved down in one spot.
    const a = (w.addWave * 1.7) + (i / def.count) * Math.PI * 2
    w.adds.push({
      uid: w.nextUid++,
      def,
      pos: { x: Math.cos(a) * r, y: Math.sin(a) * r },
      hp: def.hp,
      shield: def.shieldHp ?? 0,
      fuse: def.fuseSec * 1000,
      castMs: -1,
      kicked: false,
      alive: true,
    })
  }
  if (!w.seen.has(def.id)) {
    w.seen.add(def.id)
    // Adds announce through the same teaching channel as mechanics, so the
    // first Doomscale Warden gets explained rather than just appearing.
    w.announce = {
      id: def.id, name: def.name, spellId: def.spellId, roles: ['tank', 'healer', 'dps'],
      telegraphMs: 0, origin: 'random', rule: { type: 'avoid' },
      good: def.good, failText: def.failText,
    }
  }
}

const ADD_SHOT_DAMAGE = 1
const MAX_CONCURRENT_ADDS = 5
/** Raid health lost when an add gets where it was going. */
const ADD_LEAK_COST = 0.11
/** Raid health lost to a cast you failed to interrupt. */
const ADD_KICK_COST = 0.09

/**
 * Adds. Four jobs, because the ability data says four jobs — see ADDS.md.
 *
 * The important one is `leave`: the Coiled Altar orbs must NOT be killed, and
 * shooting one is the failure. A trainer that rewards killing everything on
 * screen would teach precisely the habit that fight punishes hardest.
 */
function stepAdds(w: World, dtMs: number, dt: number) {
  for (const add of w.adds) {
    if (!add.alive) continue
    const d = add.def

    // Aura pressure compounds with how many you have let live. One add up is a
    // nuisance; four is the raid drowning — that escalation is what "the adds
    // set the clock" means, and a flat per-add drain never conveyed it.
    if (d.auraDps) w.raidHealth -= (d.auraDps / 100) * dt * (1 + 0.35 * (w.adds.length - 1))

    if (d.job === 'intercept' && d.marchSpeed) {
      // Walks to the centre. Standing in its path stops it; killing it is not
      // the job and for some of these is not even possible.
      const len = lenOf(add.pos) || 1
      add.pos.x -= (add.pos.x / len) * d.marchSpeed * dt
      add.pos.y -= (add.pos.y / len) * d.marchSpeed * dt
      if (dist(add.pos, w.player.pos) < 3.5) {
        add.alive = false
        w.addsKilled++
        continue
      }
      if (lenOf(add.pos) < 4) {
        add.alive = false
        w.addsLeaked++
        recordAddFailure(w, d)
        w.raidHealth -= ADD_LEAK_COST
        continue
      }
    }

    if (d.job === 'kick') {
      // Casts on a cycle. Miss the kick and the cast lands.
      if (add.castMs < 0) {
        add.castMs = (d.castEverySec ?? 8) * 1000
        add.kicked = false
      }
      add.castMs -= dtMs
      if (add.castMs <= 0) {
        if (!add.kicked) {
          recordAddFailure(w, d)
          if (d.lethal) killPlayer(w, d.name)
          else w.raidHealth -= ADD_KICK_COST
        }
        add.castMs = -1
      }
    }

    // Every add has a lifetime. Without one, `kick` and `leave` adds never left
    // the field: they piled up wave on wave, each casting on its own cycle, and
    // no amount of skill could keep up. That is a death spiral, not a mechanic.
    add.fuse -= dtMs
    if (add.fuse <= 0) {
      add.alive = false
      if (d.job === 'kill') {
        // Only a `kill` add running its fuse out is a failure — that is the add
        // getting where it was going. The rest simply despawn.
        w.addsLeaked++
        recordAddFailure(w, d)
        if (d.lethal) killPlayer(w, d.name)
        else w.raidHealth -= ADD_LEAK_COST
        // What the leak sets off. Named and announced so the cause and the
        // consequence are visibly the same event.
        if (d.onLeak) {
          const conseq = w.boss.mechanics.find(m => m.id === d.onLeak)
          if (conseq) {
            w.raidHealth -= 0.14
            w.shake = 1
            w.lastFailure = { name: conseq.name, failText: d.failText, atMs: w.elapsedMs }
            if (!w.seen.has(conseq.id)) { w.seen.add(conseq.id); w.announce = conseq }
          }
        }
      }
    }
  }
  w.adds = w.adds.filter(a => a.alive)

  // ── the wave scheduler ──
  if (w.boss.adds?.length) {
    w.addTimerMs += dtMs
    const every = (w.boss.addEverySec ?? 22) * 1000
    // Never more than a handful on the field. A wave landing on top of a wave
    // you have not cleared is a wipe you cannot play out of, and it teaches
    // nothing except that the trainer is unfair.
    if (w.addTimerMs >= every && w.adds.length < (w.boss.maxAdds ?? MAX_CONCURRENT_ADDS)) {
      w.addTimerMs = 0
      const list = w.boss.adds
      spawnAdds(w, list[w.addWave % list.length])
      w.addWave++
    }
  }
}

function recordAddFailure(w: World, d: AddDef) {
  if (!d.failText) return
  w.lastFailure = { name: d.name, failText: d.failText, atMs: w.elapsedMs }
  const row = w.failures.get(d.id)
  if (row) row.count++
  else w.failures.set(d.id, { mechanicId: d.id, name: d.name, failText: d.failText, count: 1 })
}

/** The next few mechanics the loop will fire, for the anticipation strip. */
export function upcoming(w: World, count = 3): { name: string; inSec: number }[] {
  const out: { name: string; inSec: number }[] = []
  const period = w.boss.loopIntervalSec * 1000
  const untilNext = period - w.loopTimerMs
  const live = unlockedCount(w)
  for (let i = 0; i < count; i++) {
    const id = w.boss.loop[(w.loopIndex + i) % live]
    const def = w.boss.mechanics.find(m => m.id === id)
    if (def) out.push({ name: def.name, inSec: (untilNext + i * period) / 1000 })
  }
  return out
}

/** One fixed timestep. dtMs is always TICK_MS. */
export function step(w: World, input: Input, dtMs: number) {
  // Drill mode: a death is a rep, not the end of the session. You see what
  // killed you, you get put back on your feet, and you go again — which is the
  // entire reason drill mode exists.
  if (w.drillId && !w.player.alive) {
    w.player.alive = true
    w.player.health = 1
    w.player.pos = { x: 0, y: 12 }
    w.deathCause = null
    w.raidHealth = Math.max(w.raidHealth, 0.7)
  }
  if (!w.player.alive) return
  w.announce = null
  w.elapsedMs += dtMs
  const dt = dtMs / 1000

  // ── movement ──
  let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  let my = (input.down ? 1 : 0) - (input.up ? 1 : 0)
  if (mx || my) {
    const m = Math.hypot(mx, my)
    mx /= m; my /= m
    // Airborne from a knockback: you drift, you do not steer. This is what
    // makes Sszorak's wind dangerous rather than an inconvenience.
    const speed = w.player.aloft > 0 ? PLAYER_SPEED * 0.25 : PLAYER_SPEED
    w.player.pos.x += mx * speed * dt
    w.player.pos.y += my * speed * dt
  }
  if (w.player.aloft > 0) w.player.aloft -= dtMs

  // Falling off the platform. On Sszorak this is the single biggest killer in
  // the real logs, so it is a hard fail rather than a soft push-back.
  if (lenOf(w.player.pos) > w.boss.arenaRadius) {
    w.player.alive = false
    w.player.health = 0
    w.deathCause = 'Fell off the platform'
    recordFailure(w, {
      id: 'falling', name: 'Falling', spellId: 3, roles: [w.player.role],
      telegraphMs: 0, origin: 'random', rule: { type: 'avoid' },
      good: 'Move with the wind and never let it carry you past the edge.',
      failText: 'Blown off the platform',
    })
    return
  }

  // ── cooldowns and carried debuffs ──
  for (const k of Object.keys(w.player.cooldowns) as Ability[]) {
    const v = w.player.cooldowns[k]!
    w.player.cooldowns[k] = v - dtMs <= 0 ? undefined : v - dtMs
  }
  for (const id of Object.keys(w.player.carrying)) {
    w.player.carrying[id] -= dtMs
    if (w.player.carrying[id] <= 0) delete w.player.carrying[id]
  }

  // ── abilities ──
  for (const ab of input.pressed) {
    if (!abilitiesFor(w.player.role).includes(ab)) continue
    if (w.player.cooldowns[ab]) continue
    w.player.cooldowns[ab] = COOLDOWN_MS[ab]
    if (ab === 'raidcd') {
      w.raidHealth = Math.min(1, w.raidHealth + 0.35)
      for (const a of w.allies) if (a.alive) a.health = Math.min(1, a.health + 0.4)
    }
    if (ab === 'taunt') {
      // A taunt takes the nearest entity. Anything else you were holding goes
      // back to a free tank — you have one target, same as in the game.
      const u = nearestBoss(w, w.player.pos)
      for (const b of w.bosses) {
        if (b === u || b.targetId !== 0) continue
        const free = w.allies.find(x =>
          x.role === 'tank' && x.alive && !w.bosses.some(o => o.targetId === x.id))
        b.targetId = free ? free.id : -1
      }
      u.targetId = 0
      w.overStackMs = 0
    }
    if (ab === 'dispel') {
      // Clear the nearest debuffed ally — the healer's actual job.
      let bestAlly: Ally | null = null
      let bd = 40
      for (const a of w.allies) {
        if (!a.alive || !a.debuff) continue
        const d = dist(a.pos, w.player.pos)
        if (d < bd) { bd = d; bestAlly = a }
      }
      if (bestAlly) { bestAlly.debuff = null; bestAlly.debuffMs = 0 }
    }
    // Kick the nearest add that is mid-cast. Adds are checked before mechanics
    // because an add casting at you now is more urgent than a telegraph.
    if (ab === 'interrupt') {
      let target: Add | null = null
      let bd = 40
      for (const add of w.adds) {
        if (!add.alive || add.def.job !== 'kick' || add.castMs < 0 || add.kicked) continue
        const d = dist(add.pos, w.player.pos)
        if (d < bd) { bd = d; target = add }
      }
      if (target) target.kicked = true
    }

    // Answer the nearest unresolved mechanic that wants this ability.
    let best: Instance | null = null
    for (const inst of w.instances) {
      if (inst.resolved || inst.answered) continue
      if (inst.def.rule.type !== 'press' || inst.def.rule.ability !== ab) continue
      if (!best || inst.timer < best.timer) best = inst
    }
    if (best) best.answered = true
  }

  // ── the raid ──
  allyThink(w)
  allyMove(w, dt)

  // ── adds ──
  stepAdds(w, dtMs, dt)

  // ── tank swap ──
  // The boss stacks its debuff on whoever holds it; the off-tank taunts before
  // it turns lethal. That is only YOUR job when you are the tank — otherwise the
  // two AI tanks swap between themselves and it is never scored against you.
  const swapDef = w.boss.mechanics.find(m => m.rule.type === 'tankSwap')
  if (swapDef && swapDef.rule.type === 'tankSwap') {
    // The swap belongs to whichever entity casts it, not to "the boss".
    const unit = bossUnitFor(w, swapDef.from)
    const tank = currentTank(w, unit)
    const playerIsTank = w.player.role === 'tank'
    /**
     * Hand `unit` to the other tank.
     *
     * When every entity is already tanked — Entombed Sentinels, Twin Fangs —
     * there IS no free tank, and looking for one meant the swap silently never
     * fired. The fight's own answer is a trade: "Breath tanks swap" and "Blood
     * tanks trade" are two halves of the same exchange, with each tank taking
     * the golem the other just put down.
     */
    const handOff = (): Ally | undefined => {
      const other = w.allies.find(a =>
        a.role === 'tank' && a.alive && a.id !== unit.targetId)
      if (!other) return undefined
      const theirs = w.bosses.find(b => b !== unit && b.targetId === other.id)
      // Whoever had `unit` picks up whatever the other tank was holding.
      if (theirs) theirs.targetId = unit.targetId
      return other
    }
    const freeTank = handOff
    if (tank.stacks >= swapDef.rule.maxStacks) {
      w.overStackMs += dtMs
      if (tank.isPlayer) {
        // YOU are holding it and your stacks are up. Taunting off you is the
        // co-tank's job, and a competent co-tank does it — so this is not your
        // failure and must never be scored as one.
        //
        // It used to fall through to the failure branch below: the off-tank
        // never taunted proactively and only ever took the boss after you had
        // already been marked down for holding too long. That taught a swap
        // partnership that does not exist.
        if (w.overStackMs > CO_TANK_REACTION_MS) {
          const other = freeTank()
          if (other) { unit.targetId = other.id; w.overStackMs = 0 }
        }
      } else if (!playerIsTank) {
        // Two AI tanks: they handle it between themselves, quickly.
        if (w.overStackMs > 800) {
          const other = freeTank()
          if (other) { unit.targetId = other.id; w.overStackMs = 0 }
        }
      } else if (w.overStackMs > SWAP_GRACE_MS) {
        // The co-tank is holding it, over the threshold, and you have not
        // taunted. This is the one tank-swap failure that is actually yours.
        recordFailure(w, swapDef)
        w.overStackMs = 0
        unit.targetId = 0
      }
    } else {
      w.overStackMs = 0
    }
    // Stacks fall off anyone not currently holding something.
    for (const a of w.allies) {
      if (a.stacks > 0 && !w.bosses.some(b => b.targetId === a.id)) {
        a.stacks = Math.max(0, a.stacks - 0.35 * dt)
      }
    }
    if (!w.bosses.some(b => b.targetId === 0) && w.playerStacks > 0) {
      w.playerStacks = Math.max(0, w.playerStacks - 0.35 * dt)
    }
  }

  // ── the raid covers what is not your job ──
  for (const inst of w.instances) {
    if (inst.resolved || inst.answered) continue
    if (inst.def.rule.type !== 'press') continue
    // Can the player actually press this? If not, it is not their job, whatever
    // the boss file's `roles` says.
    if (abilitiesFor(w.player.role).includes(inst.def.rule.ability)) continue
    const need: Role = inst.def.rule.ability === 'dispel' ? 'healer' : 'dps'
    // React late enough that you can see them do it, early enough to be safe.
    if (inst.timer < inst.def.telegraphMs * 0.45 && w.allies.some(a => a.alive && a.role === need)) {
      inst.answered = true
    }
  }

  // ── boss ──
  // Faces the player unless a tank is holding it: a tank who stays put keeps
  // the cone pointed away from centre, which is the whole `faceAway` game.
  for (const b of w.bosses) {
    // An untanked entity — a stationary caster — faces the raid instead.
    const face = b.targetId >= 0 ? currentTank(w, b).pos : raidAnchor(w)
    const turn = angleDelta(b.angle, Math.atan2(face.y - b.pos.y, face.x - b.pos.x))
    b.angle += Math.max(-1.4 * dt, Math.min(1.4 * dt, turn))

    // A tanked entity follows its tank. Without this the bosses were bolted to
    // their spawn points, and "hold them 40 yards apart" was not something a
    // tank could get right or wrong — the separation was whatever the boss file
    // hard-coded. Slower than a player so leading one somewhere is deliberate.
    if (b.targetId >= 0) {
      const to = currentTank(w, b).pos
      const d = dist(b.pos, to)
      if (d > MELEE_RANGE) {
        const step = Math.min(d - MELEE_RANGE, BOSS_FOLLOW_SPEED * dt)
        b.pos.x += ((to.x - b.pos.x) / d) * step
        b.pos.y += ((to.y - b.pos.y) / d) * step
      }
      const r = lenOf(b.pos)
      const rim = w.boss.arenaRadius * 0.88
      if (r > rim) { b.pos.x = (b.pos.x / r) * rim; b.pos.y = (b.pos.y / r) * rim }
    }
  }

  // ── keep them apart ──
  // 99% damage reduction while the pair is close: your shots stop mattering,
  // which is the honest consequence and a far better teacher than a number
  // ticking up somewhere.
  const apartDef = w.boss.mechanics.find(m => m.rule.type === 'keepApart')
  w.bossesLinked = false
  if (apartDef && apartDef.rule.type === 'keepApart' && w.bosses.length > 1) {
    const held = w.bosses.filter(b => b.targetId >= 0)
    if (held.length > 1 && dist(held[0].pos, held[1].pos) < apartDef.rule.minYards) {
      w.bossesLinked = true
      w.linkedMs += dtMs
      if (w.linkedMs > LINK_GRACE_MS) {
        w.linkedMs = 0
        if (apartDef.roles.includes(w.player.role)) recordFailure(w, apartDef)
      }
      if (!w.seen.has(apartDef.id)) { w.seen.add(apartDef.id); w.announce = apartDef }
    } else {
      w.linkedMs = 0
    }
  }
  w.bossEnergy = Math.min(100, w.bossEnergy + w.boss.energyPerSec * dt)

  // ── scheduler ──
  w.loopTimerMs += dtMs
  if (w.loopTimerMs >= w.boss.loopIntervalSec * 1000) {
    w.loopTimerMs = 0
    // Only what has been introduced so far — see unlockedCount().
    const id = w.boss.loop[w.loopIndex % unlockedCount(w)]
    w.loopIndex++
    fire(w, id)
  }
  if (w.bossEnergy >= 100 && w.boss.atFullEnergy) {
    w.bossEnergy = 0
    fire(w, w.boss.atFullEnergy)
  }

  // Ambient attrition ticks continuously — the healer's baseline problem.
  for (const id of w.boss.ambient ?? []) {
    const def = w.boss.mechanics.find(m => m.id === id)
    if (def?.rule.type === 'raidDamage') {
      w.raidHealth -= (def.rule.dps / 100) * dt
      if (!w.seen.has(def.id)) { w.seen.add(def.id); w.announce = def }
    }
  }
  // Healers regenerate the raid passively; other roles rely on their raid CD.
  const regen = w.player.role === 'healer' ? 0.045 : 0.038
  w.raidHealth = Math.max(0, Math.min(1, w.raidHealth + regen * dt))
  // Ambient attrition is shared, so the raid visibly suffers when it is unhealed.
  for (const a of w.allies) {
    if (!a.alive) continue
    if (w.raidHealth < 0.75) a.health -= (0.75 - w.raidHealth) * 0.09 * dt
    if (a.health <= 0) { a.alive = false; a.health = 0; w.alliesLost++ }
  }
  w.raidHealthLow = Math.min(w.raidHealthLow, w.raidHealth)

  // You are being healed. There are healers in the fiction even though they are
  // not on screen, and without this every scratch is permanent — one mistake in
  // the first 20s would doom a pull, which teaches nothing. Healing scales with
  // the raid bar, so letting the raid drop makes your own mistakes bite harder.
  if (w.player.health < 1) {
    const throughput = 0.062 * (0.35 + 0.65 * w.raidHealth)
    w.player.health = Math.min(1, w.player.health + throughput * dt)
  }

  // ── instances ──
  let pooledThisTick = false
  for (const inst of w.instances) {
    if (inst.drift && !inst.resolved) {
      inst.pos.x += inst.drift.x * dt
      inst.pos.y += inst.drift.y * dt
      if (lenOf(inst.pos) > w.boss.arenaRadius) {
        inst.drift.x *= -1; inst.drift.y *= -1
      }
    }
    // A cone from the boss tracks its facing ONLY when the tracking is the
    // mechanic — that is, a tank frontal you are meant to point away.
    //
    // An `avoid` frontal must NOT track. The boss faces whoever is tanking it,
    // so a tracking avoid-cone follows you forever: the game tells you to move
    // out of something it has glued to you, then fails you for not doing the
    // impossible. Real frontals fire where they were aimed and you sidestep.
    if (!inst.resolved && inst.def.origin === 'boss' && inst.def.shape?.kind !== 'circle') {
      const src = bossUnitFor(w, inst.fromId)
      inst.pos = { ...src.pos }
      if (inst.def.rule.type === 'faceAway') inst.angle = src.angle
    }
    // A carried debuff rides its carrier. Anchoring it where it landed meant the
    // marker stayed on the floor while you ran, and the pool then dropped where
    // you were when you got it rather than where you took it — which is exactly
    // backwards, since walking it out IS the mechanic.
    if (!inst.resolved && inst.def.rule.type === 'carryOut' && inst.carriedByPlayer) {
      inst.pos = { ...w.player.pos }
      w.player.carrying[inst.def.id] = inst.timer
    }

    // Pickups vanish the moment anyone touches them — you, or a raider doing
    // their job. Seeing an ally eat one is half the lesson.
    if (!inst.resolved && !inst.answered && inst.def.rule.type === 'collect') {
      const r = inst.def.shape?.kind === 'circle' ? inst.def.shape.radius : 2.5
      if (dist(inst.pos, w.player.pos) <= r) {
        inst.answered = true
        inst.timer = 0
      } else if (w.allies.some(a => a.alive && dist(inst.pos, a.pos) <= r)) {
        inst.answered = true
        inst.timer = 0
      }
    }

    inst.timer -= dtMs
    if (!inst.resolved && inst.timer <= 0) {
      const before = w.failures.get(inst.def.id)?.count ?? 0
      resolveInstance(w, inst)
      if (w.drillId === inst.def.id) {
        w.drillReps++
        if ((w.failures.get(inst.def.id)?.count ?? 0) === before) w.drillClean++
      }
    }

    // Lingering hazards keep hurting anyone standing in them.
    if (inst.resolved && inst.def.lingerMs && isInside(inst, w.player.pos)) {
      if (inst.def.popsOnContact) {
        // "pops on contact for damage and a 30% slow" — one hit, then it is
        // gone. Modelling it as a persistent field instead made it the leading
        // cause of death in playtesting, which is not what the fight does.
        if (!inst.answered) {
          inst.answered = true
          inst.timer = -1e9          // retire it
          if (def_scored(w, inst.def)) recordFailure(w, inst.def)
          hurt(w, inst.def.damage ?? 0.15, inst.def.name)
        }
      } else if (!pooledThisTick) {
        // Only the worst pool you are standing in ticks. Overlapping pools used
        // to multiply, which is how a player with three failures ended up dead.
        pooledThisTick = true
        hurt(w, (inst.def.damage ?? 0.15) * 0.5 * dt, inst.def.name)
      }
    }
  }
  w.instances = w.instances.filter(i =>
    !i.resolved || (i.def.lingerMs !== undefined && -i.timer < i.def.lingerMs))

  // ── your damage ──
  // The boss only dies from shots you actually land. Passive HP drain meant you
  // could win by running in circles and never looking at the boss; having to
  // aim is what makes dodging cost something, because every second spent
  // running is a second not shooting.
  w.fireCooldown -= dtMs
  if (input.firing && w.fireCooldown <= 0 && w.player.alive) {
    // Aim at the cursor, or at the nearest entity when nothing is aimed.
    const target = input.aim ?? nearestBoss(w, w.player.pos).pos
    const a = Math.atan2(target.y - w.player.pos.y, target.x - w.player.pos.x)
    w.shots.push({
      pos: { ...w.player.pos },
      vel: { x: Math.cos(a) * SHOT_SPEED, y: Math.sin(a) * SHOT_SPEED },
      // Long enough to cross the arena. Tying this to ATTACK_RANGE meant shots
      // expired at 32 yards on a 44-yard floor, so a ranged player physically
      // could not hit the boss — accuracy fell to 2% on the wider fights.
      life: ((w.boss.arenaRadius * 2.1) / SHOT_SPEED) * 1000,
    })
    w.shotsFired++
    w.fireCooldown = FIRE_INTERVAL_MS
  }

  // Tuned so all three roles can clear a clean pull inside the enrage, with dps
  // fastest and healer slowest — nobody locked out of a kill for their role.
  const base = w.player.role === 'dps' ? 1.0 : w.player.role === 'tank' ? 0.82 : 0.75
  const bursting = (w.player.cooldowns.burst ?? 0) > COOLDOWN_MS.burst - BURST_WINDOW_MS
  const perShot = (base * (bursting ? 3 : 1)) / (w.boss.pullLengthSec * SHOTS_PER_SEC * 0.46)

  for (const s of w.shots) {
    if (s.life <= 0) continue
    s.pos.x += s.vel.x * dt
    s.pos.y += s.vel.y * dt
    s.life -= dtMs

    // Adds are checked first: they are closer, smaller, and the whole point of
    // an add is that it competes with the boss for your damage.
    let consumed = false
    for (const add of w.adds) {
      if (!add.alive || dist(s.pos, add.pos) > ADD_HIT_RADIUS) continue
      s.life = 0
      consumed = true
      w.shotsHit++
      if (add.def.job === 'leave') {
        // Shooting it IS the failure. Coiled Altar's orbs detonate on being
        // destroyed and that is the single biggest killer in the fight.
        add.alive = false
        recordAddFailure(w, add.def)
        w.raidHealth -= 0.16
        if (add.def.lethal) hurt(w, 0.4, add.def.name)
        break
      }
      // Shields eat damage first and the add cannot be hurt until one breaks.
      if (add.shield > 0) add.shield -= ADD_SHOT_DAMAGE
      else add.hp -= ADD_SHOT_DAMAGE
      if (add.hp <= 0) { add.alive = false; w.addsKilled++ }
      break
    }
    if (consumed) continue

    for (const b of w.bosses) {
      if (b.def.untargetable) continue
      if (dist(s.pos, b.pos) > BOSS_HIT_RADIUS) continue
      s.life = 0
      w.shotsHit++
      // 99% damage reduction while the pair is linked.
      w.bossHp -= w.bossesLinked ? perShot * 0.01 : perShot
      break
    }
  }
  w.shots = w.shots.filter(s => s.life > 0)

  if (w.bossHp <= 0 && !w.killed) {
    w.bossHp = 0
    w.killed = true
  }

  // Melee-range mechanics: raid damage if the raid bar empties.
  if (w.raidHealth <= 0 && w.player.alive) {
    w.player.alive = false
    w.deathCause = 'Raid wiped — healing could not keep up'
  }

  w.shake = Math.max(0, w.shake - dt * 3)
  w.prompt = computePrompt(w)
}

export function isInMelee(w: World): boolean {
  return dist(w.player.pos, nearestBoss(w, w.player.pos).pos) <= MELEE_RANGE
}

export function buildResult(w: World): RunResult {
  const survived = w.elapsedMs / 1000
  return {
    bossKey: w.boss.key,
    role: w.player.role,
    survivedSec: Math.round(survived),
    pullLengthSec: w.boss.pullLengthSec,
    cleared: w.killed,
    bossHpLeft: w.bossHp,
    deathCause: w.deathCause,
    failures: [...w.failures.values()].sort((a, b) => b.count - a.count),
    mechanicsResolved: w.resolvedCount,
    raidHealthLow: w.raidHealthLow,
    alliesLost: w.alliesLost,
    shotsFired: w.shotsFired,
    shotsHit: w.shotsHit,
    addsKilled: w.addsKilled,
    addsLeaked: w.addsLeaked,
  }
}
