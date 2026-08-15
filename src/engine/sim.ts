import type {
  Ability, AddDef, Ally, AltarDef, BossDef, BossEntityDef, Compass, Corpse, FailureRow, Instance,
  MechanicDef, PhaseDef, PlayerState, Prompt, Role, RunResult, Side, Vec,
} from './types'
import { CLOCK, COMPASS, OPPOSITE } from './types'

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
/**
 * Health per second the OTHER half of a split raid takes off its own entity.
 *
 * Only ever applied on a `sided` fight, and never to the entity the player is
 * responsible for. Tuned just under a competent player's own throughput so the
 * two golems drift apart in health rather than staying locked together — that
 * gap is what Vitriolic Stasis punishes.
 */
const OFFSIDE_DPS = 0.009
/**
 * How far behind your own golem the other group is allowed to fall.
 *
 * The gap Vitriolic Stasis heals away. Big enough that the delta readout means
 * something and the intermission has a cost to teach, small enough that the pair
 * finish together.
 */
const OFFSIDE_LAG = 0.06
/** Adds are smaller targets than a boss, so they take real aim. */
const ADD_HIT_RADIUS = 2.8
/**
 * How close you have to get to another marked raider to collide with them.
 *
 * Deliberately short. Helical Toxins is a decision — which body do you run at —
 * and a generous radius turns it into "be roughly near the right half of the
 * room", which is not the mechanic and is not what kills raids on it.
 */
const PAIR_RANGE = 4
/** How long the raid takes to sort its own pairs out. */
const PAIR_AI_DELAY_MS = 3200
/**
 * How long before a collision counts.
 *
 * The orbs take a beat to settle over everyone's head, and the raid takes a beat
 * to give each other room. Without this the mechanic is decided on the frame it
 * lands — whoever happened to be standing next to you kills you before anybody
 * could have read a count, which is a coin flip wearing the costume of a puzzle.
 */
const PAIR_ARM_MS = 750
/** How close a body has to be standing to a corpse to count as standing on it. */
const CORPSE_RANGE = 3

// ── the wind ─────────────────────────────────────────────────────────────────
//
// Raging Crosswinds is the fight. Everyone is handed a bearing and thrown that
// way, and two raiders thrown into each other cancel out — so the whole mechanic
// is a question about where you are standing relative to one specific other
// body, which is a completely different demand from every other telegraph in
// this raid.

/**
 * How far apart two raiders may be and still be thrown into each other.
 *
 * Generous, and it has to be. This is not a collision you walk into — it is a
 * line-up you set before the timer expires, judged once, and the two of you are
 * thrown together from wherever you stand. Sized just over the push itself so a
 * pair lined up at the limit genuinely meet in the middle.
 */
const WIND_REACH = 26
/**
 * How far off the axis a partner may sit and still count as lined up.
 *
 * The lesson is "get on their line", so there has to be a line to get on and a
 * way to be off it. Two glyphs are about 2 yards wide at this camera, so a 6
 * yard lane is a couple of body widths — visibly a lane rather than a coin flip,
 * and tight enough that standing vaguely nearby is not the answer.
 */
const WIND_LANE = 6
/** How hard the Maelstrom's gales push, in yards/sec. Below run speed on purpose. */
const GALE_SPEED = 8.5
/**
 * How long you are planted at his feet after a cyst throws you there.
 *
 * The gale does not stop — it keeps blowing and the floor keeps streaming past —
 * it simply cannot move you for these few seconds. That is the whole beat of the
 * stage: thrown in, a moment to burn him with the wind screaming past, and then
 * it turns and sends you at the other glob.
 */
const GALE_BRACE_MS = 5000
/**
 * How long a cyst burst takes to carry you.
 *
 * Long enough to be a flight rather than a jump cut, short enough that you are
 * not a passenger. Sixty-odd yards over two thirds of a second is fast, which is
 * what being thrown by an exploding glob of venom ought to look like.
 */
const CYST_KNOCK_MS = 650
/** How long a raider is aloft after a Crosswinds knock, in ms. */
const WIND_ALOFT_MS = 1500

/** The compass bearing nearest a point, as seen from the middle of the room. */
function clockOf(p: Vec): Compass {
  let best: Compass = 'N'
  let bd = -Infinity
  const len = Math.hypot(p.x, p.y) || 1
  for (const c of CLOCK) {
    const dot = (p.x / len) * COMPASS[c].x + (p.y / len) * COMPASS[c].y
    if (dot > bd) { bd = dot; best = c }
  }
  return best
}

/**
 * Where a cyst dropped on this bearing actually lands.
 *
 * Out near the rim, because the gale has to have room to build before it gets
 * there — and back far enough from the edge that the burst throws the raid
 * inward rather than over it.
 */
function clockPoint(boss: BossDef, c: Compass): Vec {
  const r = boss.arenaRadius * 0.74
  return { x: COMPASS[c].x * r, y: COMPASS[c].y * r }
}

/**
 * Is `partner` positioned so the two of them cancel?
 *
 * Three things, all of them necessary. They must be blown the OTHER way, or
 * both of you simply travel in company. They must be on the side of you that
 * you are about to be thrown toward, or you are thrown apart rather than
 * together. And they must be close to your axis, because "lined up" is the
 * instruction and a body twenty yards off to one side is not lined up with
 * anybody.
 */
function windCancels(mine: Compass, from: Vec, theirs: Compass | null, at: Vec): boolean {
  if (!theirs || theirs !== OPPOSITE[mine]) return false
  const dir = COMPASS[mine]
  const dx = at.x - from.x
  const dy = at.y - from.y
  const along = dx * dir.x + dy * dir.y
  const across = Math.abs(dx * -dir.y + dy * dir.x)
  return along > 0 && along <= WIND_REACH && across <= WIND_LANE
}

// ── randomness ───────────────────────────────────────────────────────────────
// Seedable, so a headless balance run is reproducible.
//
// The playtest is the only tool that tells us whether a tuning change helped,
// and with bare rnd() it swung 21-24 clears between identical runs. That
// is wider than most of the changes being measured, so a real regression could
// hide inside the noise and a lucky run could pass a broken build. Seeding it
// turns the clear count into a signal instead of a mood.
//
// The browser stays random: createWorld seeds from the clock unless a caller has
// already chosen a seed.
let rngState = 0
let seeded = false

/** Fix the sequence. Called by the playtest; never called by the game. */
export function seedRng(seed: number): void {
  rngState = seed >>> 0
  seeded = true
}

/** mulberry32 — small, fast, and good enough for picking spawn points. */
function rnd(): number {
  rngState = (rngState + 0x6D2B79F5) >>> 0
  let t = rngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

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
  /**
   * Who this add has fixated: an `Ally.id`, -1 for the player, -2 for nobody.
   *
   * Picked once when it surfaces and kept for life — that is what makes it a
   * fixate rather than a re-roll. Three Spawn of Vexhul therefore hold three
   * DIFFERENT raiders, because each one excludes the targets its siblings
   * already took.
   */
  fixate: number
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
  /** 0..1. Twin Fangs "do NOT share a health pool", and neither does the Altar. */
  hp: number
  alive: boolean
  /**
   * Where its tank holds it NOW, which after a trade is not where it started.
   *
   * When the tanks swap golems they drag them to their own end of the room, so a
   * golem's home moves with whoever holds it. Reading the static `def.start`
   * after a trade put each golem on the opposite side from its tank: the golem
   * walked toward the tank while the tank walked toward the old station, they
   * met in the middle, and the pair sat there at 99% damage reduction for ninety
   * seconds with neither tank able to pull them out.
   */
  station: Vec
}

/**
 * A fountain on the field, and the record of who has been drinking from it.
 *
 * Vashnik is the only fight in this tier with altars, and everything that makes
 * it a fight is in this struct. Imbibe drains the two NEAREST the boss, the boss
 * walks after its tank, and draining the same one twice running stacks its
 * Infusion — so `infusion` is a written record of where the tank has been
 * standing, and it is the one number on this fight anybody can do something
 * about.
 */
export interface AltarState {
  def: AltarDef
  /**
   * Empowerment stacks. 1 the first time it is drained, +1 for every consecutive
   * re-drain, and back to 0 the moment a drink passes it by — walking the boss
   * to a fresh pair has to be visibly worth something, or the tank's footwork is
   * just decoration.
   */
  infusion: number
  /** Taken by the PREVIOUS drink. Taking it again is what stacks the Infusion. */
  drainedLast: boolean
  /** When it last fired, for the renderer's drain flash. -1 if it never has. */
  drainedAtMs: number
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
  /** Set alongside `announce` when the thing being announced is an add. */
  announceAdd: AddDef | null
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
  /** ms remaining in a burn window, and what it multiplies your damage by. */
  /** ms since the first of a pair died, for the synchronised-kill check. */
  soloMs: number
  burnMs: number
  burnMult: number
  /** The burn window's mechanic id, and whether you used burst inside it. */
  burnId: string | null
  burnUsed: boolean
  /** True while two tanked entities are close enough to gain their damage reduction. */
  bossesLinked: boolean
  linkedMs: number
  /** ms of unscored grace after a converge stage, for the drag back apart. */
  separationGraceMs: number
  /** Set in drill mode: the one mechanic being practised. */
  drillId: string | null
  /** Drill mode only: reps attempted and reps survived. */
  drillReps: number
  drillClean: number

  // ── stages, corpses and the rest of the split-raid machinery ──
  /**
   * Dead adds still lying on the floor. They are not scenery: an Amani corpse
   * nobody burns during the intermission stands back up and walks at the Well
   * again, so the pile is the intermission's scoreboard.
   */
  corpses: Corpse[]
  /** Which stage is running. Always 0 on a boss with no `phases`. */
  phaseIndex: number
  /** Furthest stage reached — not the same as the current one on a fight that cycles. */
  phaseMax: number
  /** ms since the current stage began. */
  phaseElapsedMs: number
  /** Set on entry to a stage, so the UI can bannerise it. */
  phaseBanner: { text: string; atMs: number } | null
  /** 0..1 damage reduction on every entity, from the current stage. */
  entityReduction: number
  /** True once an add named by the stage's end condition has actually spawned. */
  phaseAddsSpawned: boolean
  /**
   * Worst health gap between the entities on the way INTO a levelling
   * intermission — read on the way in, because that is while it is still real.
   */
  entityDelta: number
  /** Corpses nobody burned, which stood back up. */
  resurrected: number
  /** The pull ended because the bar filled rather than on the clock. */
  enraged: boolean
  /** Mechanic id -> ms until its next proximity stack lands. */
  proxTimers: Record<string, number>
  /** Mechanic id -> extra damage taken per stack, so two marks compound. */
  markPct: Record<string, number>
  /** Mechanics a channel has queued: what to fire, and when. */
  queue: { id: string; atMs: number }[]
  /** How many times each mechanic that splits the raid in half has been cast. */
  altCount: Record<string, number>
  /** Helical Toxins: the sum a pair has to reach between them. */
  pairTarget: number
  /**
   * The ally holding the count that completes YOURS.
   *
   * Reserved and kept out of the raid's own pairing, so there is always exactly
   * one right answer on the floor. A puzzle whose only valid partner may have
   * already cleared is not a puzzle, it is a coin flip.
   */
  pairPartnerId: number
  /** ms since the current pairUp began, for the raid's own reaction time. */
  pairMs: number
  /** True once a pairUp has fired in this stage — its end condition needs to know. */
  pairFired: boolean
  /**
   * Which raider is carrying which instance: instance uid -> ally id.
   *
   * A carried debuff has to stay with the body that took it. Following "whoever
   * is nearest" each tick looks equivalent and is not — the marker hops between
   * raiders as they walk past each other, so the flame the raid was carrying to
   * the corpse pile quietly stayed behind with somebody standing still, and
   * every delivery landed on empty floor.
   */
  carriers: Record<number, number>
  /**
   * The pickups being held back for the player, by instance uid.
   *
   * A `collect` mechanic reserves one for you so it is always personally
   * consequential, and that reservation used to be "all but the LAST one in the
   * array", recomputed from scratch every tick. Three things were wrong with
   * that, and the fight this was written for breaks on all three:
   *
   * - It held one back whether or not the mechanic was ever the player's. A
   *   TANK on the Twin Fangs is not on the globule rota — `globule.roles` is
   *   dps and healer — so the raid was forbidden from clearing the last one and
   *   a globule ruptured on everybody every single Caustic Deluge, ten times a
   *   rotation, with nobody in the room allowed to stop it.
   * - It carried no identity. As raiders swept globules the array shrank, "the
   *   last one" became a different globule, and everybody re-targeted mid-run:
   *   the raid dithered across the floor instead of clearing it.
   * - Nothing stopped a raider simply walking over the reserved one on their way
   *   somewhere else, which handed the player's stack to an ally and left the
   *   player with nothing to do.
   *
   * So the reservation is a uid, made once and kept until that instance is gone.
   */
  reservedPickups: Set<number>

  // ── the fountains ────────────────────────────────────────────────────────
  /** One per `boss.altars`, in the order the boss file lists them. Empty elsewhere. */
  altars: AltarState[]
  /**
   * The altar ids the most recent Imbibe took, and when.
   *
   * Kept on the world rather than worked out again by whoever wants it: the
   * renderer paints those two fountains draining, the HUD names the pair, and
   * the debrief reads the same list. Three places re-deriving "nearest two"
   * against a boss that has since walked away would disagree with each other and
   * with what actually fired.
   */
  lastDrained: string[]
  lastDrainAtMs: number
  /**
   * Mechanic id -> damage multiplier from the Infusion behind it.
   *
   * The Infusion empowers an altar's Expulsion and its infection, and those are
   * ordinary MechanicDefs shared by every world — mutating their `damage` would
   * leak one pull's mistakes into the next. So the empowerment lives here, on
   * the run, and defaults to 1 for every mechanic on every other boss.
   */
  infusionMult: Record<string, number>
  /** Instance uid -> ms until a `trail` debuff drops its next hazard. */
  trailTimers: Record<number, number>
  /**
   * Add id -> when one was last killed, for `noSimultaneousDeath`.
   *
   * Only deaths, never leaks: the Burning Venom pair wipes the raid when the
   * two are BURNED DOWN together, and an add that walked into the Cavity has
   * already been paid for as a leak.
   */
  addDeathMs: Record<string, number>

  // ── the flurry, the groups and the wind ──────────────────────────────────
  /**
   * How long each tank-swap mechanic's holder has been over its threshold.
   *
   * Keyed by mechanic id, because Sszorak has two of them and the ability data
   * names them as a pair — Corroding Venom stacking on every melee, and Ravage's
   * +300% on every cone. A single counter served whichever mechanic happened to
   * be declared first and the other silently never fired at all.
   */
  overStackBy: Record<string, number>
  /**
   * Which of the two stack groups the next `groupSoak` must land on.
   *
   * Not a choice the fight makes freely: it is whichever group is not still
   * carrying a Gash. That is the entire mechanic, so it is derived from
   * `groupGashMs` rather than alternated on a counter that could drift out of
   * step with what the raid is actually carrying.
   */
  calledGroup: number
  /** ms of Mutilated Gash left on each stack group. */
  groupGashMs: number[]
  /** Where the two stack groups are standing, in yards. Empty off Sszorak. */
  groupMarks: Vec[]
  /** True while a Crosswinds is in the air, so the renderer draws the arrows. */
  windUp: boolean
  /**
   * The ally holding YOUR opposite bearing.
   *
   * Reserved out of the raid's own pairing for the same reason the orb partner
   * is: a puzzle whose only valid answer may already have paired off with
   * somebody else is not a puzzle, and this one throws you off the platform.
   */
  windPartnerId: number
  /** The cyst the current gale is blowing the raid into, by instance uid. */
  galeTargetUid: number
  /** How many cysts this Maelstrom has burst. */
  cystsBurst: number
  /**
   * ms the player is braced for after a cyst has thrown them back at the boss.
   *
   * The gale does not stop when the glob bursts — it keeps blowing, and the
   * renderer keeps showing it — but for these few seconds it cannot move you.
   * That is the beat the stage is built around: you are thrown into him, you get
   * a moment planted at his feet with the wind screaming past, and then it turns
   * and sends you at the other glob.
   */
  galeImmuneMs: number
  /** Which way the gale is blowing, kept for the renderer while you are braced. */
  galeDir: Vec
  /** ms the flurry runs until. The ordinary rotation stands down for it. */
  comboUntilMs: number

  // ── the stack economy ─────────────────────────────────────────────────────
  /**
   * The highest the player's counter has reached, and the worst any one ally
   * has. Watermarks rather than live values, because the live ones are on the
   * bodies and these are what the debrief has to report after the fact — a
   * player who died at ten and an ally who died at ten both read zero
   * afterwards if you only look at the corpse.
   */
  venomPeak: number
  venomRaidPeak: number
  /**
   * The floating "+1" over the player's head: how many stacks just landed and
   * how long the float has left.
   *
   * A stack economy the player cannot watch climbing is not a teach. The number
   * on the HUD says where they are; this says that something just charged them,
   * at the moment it charged them, which is the half that connects the count to
   * the thing they stood in.
   */
  venomFlash: { n: number; ms: number } | null
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
function makeAllies(playerRole: Role, playerSide: Side): Ally[] {
  const out: Ally[] = []
  const comp: Role[] = [
    'tank',
    ...Array<Role>(4).fill('healer'),
    ...Array<Role>(14).fill('dps'),
  ]
  // A second AI tank when the player is not tanking, so swaps still happen.
  if (playerRole !== 'tank') comp.push('tank')
  comp.forEach((r, i) => {
    // A fanned opening spot rather than the arena centre. Everyone starting on
    // the same pixel is a cosmetic problem right up until the middle of the room
    // is a hole in the floor: the vector fleeing a hazard you are standing on
    // the origin of has zero length, and nineteen raiders sit in the Soulcoil
    // Well for the whole pull.
    const a = i * 2.39996            // golden angle, so no two share a spoke
    const p = { x: Math.cos(a) * 14, y: Math.sin(a) * 14 }
    out.push({
      id: i + 1, role: r,
      pos: { ...p }, want: { ...p },
      health: 1, alive: true, stacks: 0, debuff: null, debuffMs: 0,
      // Tanks are on the boss from the pull; everyone else walks on when needed.
      presence: r === 'tank' ? 1 : 0,
      side: 'green', green: 0, marked: false,
      // Dealt alternately WITHIN each role, for the same reason the sides are:
      // a stack group with no healer is a group that dies to its own Gash, and
      // a raid that discovered that by luck of array order would read as the
      // trainer being broken rather than as a mechanic.
      group: i % 2, wind: null, windMate: -1, gash: 0, gashMs: 0, venom: 0,
    })
  })
  assignSides(out, playerRole, playerSide)
  return out
}

/**
 * Split the raid in two.
 *
 * Roughly half each — but the split is made WITHIN each role rather than across
 * the list, so the two tanks land one per golem and the four healers two per
 * golem instead of by luck. A group with no tank is not a group, and on a fight
 * whose whole shape is "each half stays with its own golem" an unlucky deal
 * would read to the player as the trainer being broken.
 */
function assignSides(allies: Ally[], playerRole: Role, playerSide: Side) {
  const other: Side = playerSide === 'green' ? 'red' : 'green'
  for (const role of ['tank', 'healer', 'dps'] as Role[]) {
    // The player already fills one of their own role's slots, so that role
    // starts dealing on the far side — otherwise a player tank leaves the other
    // golem untanked.
    let far = role === playerRole
    for (const a of allies) {
      if (a.role !== role) continue
      a.side = far ? other : playerSide
      far = !far
    }
  }
}

/**
 * Where a synthesised single boss stands at the pull.
 *
 * The middle of the room, unless the middle of the room kills. Vashnik's
 * Malignant Cavity is a lethal fixture at the centre, so the default put him
 * inside it — and every raider who walked to melee walked into a hole in the
 * floor until his tank had dragged him clear. A boss does not open standing in
 * his own fight's furniture.
 */
function synthStart(boss: BossDef): Vec {
  const pit = boss.mechanics.find(m =>
    m.atCentre && m.rule.type === 'lethalGround' && m.shape?.kind === 'circle')
  if (!pit || pit.shape?.kind !== 'circle') return { x: 0, y: 0 }
  return { x: 0, y: pit.shape.radius + 10 }
}

/**
 * Build the encounter's entities. A fight that declares none gets a single
 * unnamed one at the centre, which is exactly how every boss behaved before
 * multi-boss support existed — so single-boss fights are untouched.
 */
function makeBosses(boss: BossDef, allies: Ally[]): BossUnit[] {
  const defs: BossEntityDef[] = boss.entities?.length
    ? boss.entities
    : [{ id: boss.key, name: boss.name, npcId: 0, start: synthStart(boss) }]

  // Two tanks exist, so at most two entities can be held. The primary opens on
  // the co-tank; a `tankedApart` entity takes the other tank.
  const tanks = allies.filter(a => a.role === 'tank')
  const taken = new Set<number>()
  /**
   * The tank who belongs on this entity.
   *
   * Matched by SIDE first, in order only as a fallback. Taking them in order
   * happened to pair correctly for a green-side player and cross-paired for a
   * red-side one — the red tank held the green golem and vice versa. Each then
   * walked to their own group's half of the room, dragging both golems together
   * and parking the pair at 99% damage reduction for the whole pull. Red side
   * was unplayable and green worked purely by luck of array order.
   */
  const pickTank = (d: BossEntityDef): number => {
    const bySide = d.side && tanks.find(t => t.side === d.side && !taken.has(t.id))
    const t = bySide || tanks.find(x => !taken.has(x.id))
    if (!t) return -1
    taken.add(t.id)
    return t.id
  }
  return defs.map((d, i) => {
    const wants = i === 0 || d.tankedApart
    return {
      def: d,
      pos: { ...d.start },
      angle: -Math.PI / 2,
      targetId: wants ? pickTank(d) : -1,
      hp: 1,
      alive: true,
      station: { ...d.start },
    }
  })
}

/**
 * On a multi-entity fight, a tanking player holds an entity from the pull.
 *
 * On a split fight it is their OWN side's entity. Otherwise the assignment is
 * arbitrary: a green-side tank could open holding the red golem, which puts
 * them permanently in the wrong half of the room — their group's mechanics fire
 * at them across the arena, and dragging their golem back to where they are
 * supposed to stand walks the pair together. That is a fight you cannot play
 * rather than one you are playing badly, and it is why one side's tank failed
 * the separation twelve times more often than the other's.
 *
 * The `sided` test used to be the gate on the whole function, and on a
 * multi-entity fight that is NOT sided it meant a tanking player held nothing
 * at all, all pull. `makeAllies` only builds a second AI tank when the player is
 * not tanking, so on the Twin Fangs `pickTank` hands Vexhul to the one AI tank
 * and leaves Ithraz on -1: the player is a tank with no boss and Ithraz is a
 * boss with no tank. Everything keyed on `bosses[0].targetId === 0` — the taunt
 * prompt, `hud.tanking`, `faceAway`, the melee leash the Twin Fangs is about to
 * grow — is dead for that player. There is no side to match on, so the primary
 * is theirs.
 *
 * Scoped to `bosses.length > 1` on purpose. On a single-boss fight the co-tank
 * opens holding the boss and the player TAUNTS it off them — that is the tank's
 * first job and there is a test for it. Seating the player from tick one there
 * would delete the mechanic rather than fix a bug.
 */
function seatPlayerTank(w: World) {
  if (w.player.role !== 'tank') return
  const ours = w.boss.sided
    ? w.bosses.find(b => b.def.side === w.player.side)
    : w.bosses.length > 1 ? w.bosses[0] : undefined
  if (!ours) return
  const displaced = ours.targetId
  ours.targetId = 0
  // Whoever the player just took the golem from picks up the other one.
  //
  // The old version looked for an entity already held by the player, which
  // never exists at this point — so on a green-side tank the displaced ally was
  // simply left idle and the red golem stayed untanked all pull, walking
  // wherever it liked. Hand them the first entity that wants a tank and has
  // none; only fall back to a swap if everything is already held.
  //
  // "Wants a tank" is `makeBosses`' own test, not merely "is untanked". Several
  // fights carry entities that are deliberately never held — the Hex Lord, two
  // of the four Explorers — and handing one of them the displaced ally would
  // start it walking after a tank it was authored to ignore. If nothing on the
  // floor wants them, the displaced ally simply has no boss, which is the same
  // position the player was in a line ago and is the honest state of a fight
  // with two tanks and one tankable entity.
  if (displaced <= 0) return
  const wantsTank = (b: BossUnit) =>
    !b.def.untargetable && (b.def.tankedApart || b === w.bosses[0])
  const orphan = w.bosses.find(b => b !== ours && b.targetId === -1 && wantsTank(b))
  if (orphan) { orphan.targetId = displaced; return }
  const other = w.bosses.find(b => b !== ours && b.targetId === 0)
  if (other) other.targetId = displaced
}

/** The entity the player's tank holds, and the anchor for anything untagged. */
export function primaryBoss(w: World): BossUnit {
  return w.bosses[0]
}

// ── the two stack groups ─────────────────────────────────────────────────────
//
// Mutilate has to land on one group and then on the other, so the raid needs two
// places to be that are far enough apart for a 60-degree cone to take one and
// miss the other, and near enough the boss that both are reachable inside a
// telegraph.
//
// Both marks are painted on the FLOOR, on fixed bearings from the middle of the
// room — not hung off the boss.
//
// Hanging them off the boss was the obvious thing and it was wrong, in the way
// this engine has been wrong before. The boss walks after his tank, so a tank
// standing "five yards along the mark's bearing from the boss" moves his own
// target every time the boss closes on him: he drifts a yard out, the boss
// follows, his mark moves a yard further out, and the pair crawl to the wall
// together. They reached the west rim by seventy seconds, the cone pointed at
// nothing but floor from there, and every Mutilate for the rest of the pull
// landed on zero bodies. It is the same runaway the `tankedApart` tanks already
// had, and it has the same answer: hold a station, do not orbit a thing that is
// following you.

/** South-west and south-east of the arena centre, 90 degrees apart. */
const GROUP_BEARINGS = [(3 * Math.PI) / 4, Math.PI / 4]
/**
 * How far out the marks sit. Inside the cone's reach, well outside its apex —
 * and outside the ring of Caustic Claws globs, which land around the boss and
 * would otherwise foul both stacks every time he throws them.
 */
const GROUP_RANGE = 16
/** How far a raider may stray from their mark while a cone is in the air. */
const GROUP_LEASH = 7
/**
 * How far out the tank stands to aim.
 *
 * Short, deliberately. The boss stops a melee range behind whoever he is
 * chasing, so a tank at seven yards keeps him near the middle of the room —
 * which is where the rest of this fight needs him, because Caustic Claws eats
 * the floor he is standing on and the Maelstrom's gales measure from the centre.
 */
const AIM_RANGE = GROUP_RANGE

function baseMark(g: number): Vec {
  const a = GROUP_BEARINGS[((g % 2) + 2) % 2]
  return { x: Math.cos(a) * GROUP_RANGE, y: Math.sin(a) * GROUP_RANGE }
}

/**
 * Where a tank has to stand to put the cone on a given group: ON THE MARK, with
 * them.
 *
 * This one number took three attempts and each failure was instructive, so both
 * are written down.
 *
 * A station relative to the boss — "five yards along the mark's bearing from
 * him" — runs away. He walks after his tank, so the tank drifts a yard out, he
 * follows, the station moves out another yard, and the pair reach the west rim
 * by seventy seconds with the cone pointing at nothing. The `tankedApart` tanks
 * had the identical bug.
 *
 * A fixed station SHORT of the mark does not aim. He stops a melee range from
 * his tank along whatever line he happened to approach on, so when the rota
 * flips he settles on the chord between the two stations rather than on the
 * bearing — everybody perfectly positioned, cone forty-five degrees off, zero
 * bodies struck. Two points do not define a bearing when they sit at the same
 * radius.
 *
 * Standing ON the mark fixes both at once, because the cone is aimed at wherever
 * the tank IS. He faces his tank; the tank is in the middle of the group; the
 * cone therefore covers the group no matter which way he came from. It is also
 * the version that matches how the fight is described — the boss follows the
 * tanks, and the tanks walk him between the two stacks.
 */
function aimStation(w: World, g: number): Vec {
  const i = ((g % 2) + 2) % 2
  return w.groupMarks[i] ?? baseMark(i)
}

/**
 * Where a tank has to stand to point a frontal AWAY from the raid.
 *
 * Directly opposite the bulk of the raid, in melee — the boss faces his tank, so
 * putting yourself on the far side of him from everybody else is the whole of
 * "point it away". With both stack groups parked south of him this comes out
 * north, which is the shape the fight is described in: the raid stacks behind
 * him and the tank holds his face.
 */
function faceAwayStation(w: World): Vec {
  const raid = raidAnchor(w)
  const d = Math.hypot(raid.x, raid.y)
  // Measured from the MIDDLE OF THE ROOM, not from the boss. Anchoring it on him
  // is the same runaway as before wearing a different hat: he walks away from
  // the raid to follow his tank, which makes "away from the raid" point further
  // out again, and the pair leave the platform together.
  const dir = d < 1 ? { x: 0, y: -1 } : { x: -raid.x / d, y: -raid.y / d }
  return clampToArena(w.boss, { x: dir.x * AIM_RANGE, y: dir.y * AIM_RANGE }, 4)
}

/**
 * Where the tank holding `unit` should be standing right now.
 *
 * The fight asks a tank for two opposite things and gives them under two seconds
 * to switch: Ravage must point AWAY from everybody, and Mutilate must point
 * straight AT one of the two stacks. Both come out of the same face, both are in
 * the air at once during a flurry, and the only sane reading is that you aim for
 * whichever one lands FIRST and then move for the next. That is what a tank on
 * this fight is actually doing, and it is why the flurry order being random is
 * the thing worth practising.
 */
function tankStation(w: World, unit: BossUnit): Vec | null {
  let next: Instance | null = null
  for (const i of w.instances) {
    if (i.resolved || i.fromId !== unit.def.id) continue
    const rt = i.def.rule.type
    if (rt !== 'faceAway' && rt !== 'groupSoak') continue
    if (!next || i.timer < next.timer) next = i
  }
  if (next) {
    return next.def.rule.type === 'faceAway'
      ? faceAwayStation(w)
      : aimStation(w, w.calledGroup)
  }
  // Nothing in the air: stand ready on the next group's line. The cone that
  // needs aiming is the one that is hard to fix late.
  return hasGroups(w) ? aimStation(w, w.calledGroup) : null
}

/** Does this fight run the two-group rota at all? */
function hasGroups(w: World): boolean {
  return w.boss.mechanics.some(m => m.rule.type === 'groupSoak')
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
    // Never auto-aim at a corpse or at something that cannot be damaged.
    // Mor'zahi sits closest to the raid on the Lost Explorers and is
    // untargetable, so unfiltered this pointed every shot at him and accuracy
    // collapsed to half on a fight nobody could then kill.
    if (b.def.untargetable || !b.alive) continue
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
export function createDrill(boss: BossDef, role: Role, mechanicId: string, side: Side = 'green'): World {
  const w = createWorld(boss, role, side)
  w.drillId = mechanicId
  /**
   * Some mechanics have no meaning without the body that casts them.
   *
   * Corrosive Spit is fired by a Spawn of Vexhul at the raider it fixated. Put
   * it in the drill's `loop` like anything else and it comes off a serpent,
   * aimed at nobody, with no mark and no marked-player job — which is the exact
   * mechanic this fight was changed to STOP teaching. The drill was quietly
   * showing the old behaviour while the pull showed the new one.
   *
   * So a drill for an add-cast mechanic keeps the add instead of the loop entry:
   * the caster is the drill.
   */
  const caster = boss.adds?.find(a => a.casts?.defId === mechanicId)
  // Only the drilled mechanic fires, every few seconds, forever.
  w.boss = {
    ...boss,
    loop: caster ? [] : [mechanicId],
    introEverySec: 1,
    loopIntervalSec: Math.max(3.5, boss.loopIntervalSec * 0.7),
    atFullEnergy: undefined,
    // Ambient attrition and adds are the fight, not the mechanic — they would
    // just kill you slowly while you practise something else.
    ambient: [],
    // The casting add is the one exception: it IS the mechanic. It arrives
    // straight away and keeps arriving, so a drill still gives you twenty reps
    // rather than two.
    adds: caster ? [caster] : [],
    addEverySec: caster ? Math.max(6, (caster.fuseSec ?? 20) * 0.5) : boss.addEverySec,
    // ...and the summon link has to go with it, or the wave scheduler drops the
    // add straight back out again: it refuses to deal out anything some mechanic
    // summons, which in the pull is exactly right and in a drill leaves the
    // player staring at an empty room. The summoning cast is not in the drill's
    // loop, so nothing else notices it is gone.
    mechanics: caster
      ? boss.mechanics.map(m => (m.summons?.addId === caster.id ? { ...m, summons: undefined } : m))
      : boss.mechanics,
    // Stages and the energy bar are both the fight rather than the mechanic. A
    // drill that phased out from under you, or ended in an enrage because the
    // bar filled while you practised, would be a pull with extra steps.
    phases: undefined,
    energyPerSec: 0,
    // No enrage. You leave a drill when you are done with it, not when a timer
    // decides you are.
    pullLengthSec: 3600,
  }
  return w
}

export function createWorld(boss: BossDef, role: Role, side: Side = 'green'): World {
  // Real pulls vary; a seeded caller (the playtest) keeps its sequence.
  if (!seeded) rngState = (Date.now() & 0xffffffff) >>> 0
  const allies = makeAllies(role, side)
  // Boss opens on the co-tank, so a player tank's first job is to taunt it off.
  const w: World = {
    boss,
    allies,
    bosses: makeBosses(boss, allies),
    overStackMs: 0,
    alliesLost: 0,
    player: {
      pos: { x: 0, y: 12 }, role, health: 1, alive: true,
      carrying: {}, cooldowns: {}, aloft: 0,
      side, green: 0, marked: false, marks: {},
      // You are always group 0. Which group you are in is arbitrary — what
      // matters is that it never changes mid-pull, so "is this one mine?" stays
      // a question about the cone rather than about your own assignment.
      group: 0, wind: null, gash: 0, gashMs: 0, venom: 0, slowMs: 0, knock: null,
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
    announceAdd: null,
    deathCause: null,
    nextUid: 1,
    loopIndex: 0,
    loopTimerMs: 0,
    ambientTimerMs: 0,
    shake: 0,
    playerStacks: 0,
    prompt: null,
    lastFailure: null,
    soloMs: 0,
    burnMs: 0,
    burnMult: 1,
    burnId: null,
    burnUsed: false,
    bossesLinked: false,
    linkedMs: 0,
    separationGraceMs: 0,
    drillId: null,
    drillReps: 0,
    drillClean: 0,
    corpses: [],
    phaseIndex: 0,
    phaseMax: 0,
    phaseElapsedMs: 0,
    phaseBanner: null,
    entityReduction: 0,
    phaseAddsSpawned: false,
    entityDelta: 0,
    resurrected: 0,
    enraged: false,
    proxTimers: {},
    markPct: {},
    queue: [],
    altCount: {},
    pairTarget: 0,
    pairPartnerId: -1,
    pairMs: 0,
    pairFired: false,
    carriers: {},
    reservedPickups: new Set(),
    // Seeded from the boss file, in its own order, so "the red one" means the
    // same thing to the engine, the renderer and the raid calling the fight.
    altars: (boss.altars ?? []).map(def => ({
      def, infusion: 0, drainedLast: false, drainedAtMs: -1,
    })),
    lastDrained: [],
    lastDrainAtMs: -1,
    infusionMult: {},
    trailTimers: {},
    addDeathMs: {},
    overStackBy: {},
    calledGroup: 0,
    groupGashMs: [0, 0],
    groupMarks: [],
    windUp: false,
    windPartnerId: -1,
    galeTargetUid: -1,
    cystsBurst: 0,
    galeImmuneMs: 0,
    galeDir: { x: 0, y: 1 },
    comboUntilMs: 0,
    venomPeak: 0,
    venomRaidPeak: 0,
    venomFlash: null,
  }
  // A split fight seats the player on their own side’s entity before the first
  // tick, so their group, their mechanics and their golem are all in one place.
  seatPlayerTank(w)
  return w
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

// ── the floor ────────────────────────────────────────────────────────────────
//
// Almost every room in this raid is round and `arenaRadius` says everything
// there is to say about it. The Entombed Sentinels' room is an octagon with an
// alcove at each end, and there the shape is load-bearing: the fight asks each
// half of the raid to sit inside its own 40-yard bubble and outside the other's
// while the tanks hold the golems 40+ apart, and whether that fits is a question
// about the floor rather than about the players.
//
// So every bound in this file is asked of the arena, never of a radius
// comparison. A `arena` polygon that the engine only drew would be scenery; one
// that the engine measures against is a room.

function polyOf(boss: BossDef): Vec[] | null {
  const a = boss.arena
  return a && a.kind === 'polygon' && a.points.length > 2 ? a.points : null
}

/** Is this point on the floor at all? Leaving it is a fall. */
export function inArena(boss: BossDef, p: Vec): boolean {
  const poly = polyOf(boss)
  if (!poly) return lenOf(p) <= boss.arenaRadius
  // Ray cast along +x: an odd number of edge crossings means inside.
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** Closest point to `p` on the segment a-b. */
function nearestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
  return { x: a.x + vx * t, y: a.y + vy * t }
}

/**
 * The nearest point on the rim to `p`, and how far away it is.
 *
 * Lifted verbatim out of `clampToArena`, which walked the polygon inline. It is
 * pulled out because "how close to the edge is this?" is a question three other
 * things want to ask without moving anything — a carry-out that has to be
 * dropped AT the rim, a sweep that has to prove a drop spot exists, a hazard
 * deciding whether it has left the floor — and none of them want the clamp's
 * side effect of returning a different point.
 *
 * `yards` is unsigned: it is the distance to the boundary, not a signed depth,
 * so a point just outside the floor reads the same as one just inside. Callers
 * that care about the difference already have `inArena`.
 */
export function nearestEdge(boss: BossDef, p: Vec): { at: Vec; yards: number } {
  const poly = polyOf(boss)
  // A round arena has no vertices to walk: the nearest rim point is straight
  // out along the bearing. `clampToArena` never reaches this — it handles the
  // circle case and returns before asking — but `edgeDistance` is asked about
  // every floor in the tier, and six of the eight are circles.
  if (!poly) {
    const r = lenOf(p) || 1
    return {
      at: { x: (p.x / r) * boss.arenaRadius, y: (p.y / r) * boss.arenaRadius },
      yards: Math.abs(boss.arenaRadius - lenOf(p)),
    }
  }
  let at: Vec = poly[0]
  let yards = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const q = nearestOnSegment(p, poly[j], poly[i])
    const d = dist(p, q)
    if (d < yards) { yards = d; at = q }
  }
  return { at, yards }
}

/** How far `p` is from the nearest rim. The half of `nearestEdge` most callers want. */
export function edgeDistance(boss: BossDef, p: Vec): number {
  return nearestEdge(boss, p).yards
}

/**
 * The same point when it is comfortably on the floor, otherwise the nearest spot
 * `inset` yards inside the edge. Used everywhere something is placed rather than
 * judged — spawn scatter, ally stations, where a boss may be dragged.
 */
export function clampToArena(boss: BossDef, p: Vec, inset = 0): Vec {
  const poly = polyOf(boss)
  if (!poly) {
    const r = lenOf(p)
    const max = Math.max(1, boss.arenaRadius - inset)
    return r > max ? { x: (p.x / r) * max, y: (p.y / r) * max } : { ...p }
  }
  const { at: best, yards: bd } = nearestEdge(boss, p)
  if (inArena(boss, p) && bd >= inset) return { ...p }
  // Step in from the edge toward the middle of the room. Every floor in this
  // tier is convex, so "toward the centre" is always further inside.
  let cx = 0
  let cy = 0
  for (const q of poly) { cx += q.x; cy += q.y }
  cx /= poly.length
  cy /= poly.length
  const dx = cx - best.x
  const dy = cy - best.y
  const d = Math.hypot(dx, dy) || 1
  const step = Math.max(inset, 0.001)
  return { x: best.x + (dx / d) * step, y: best.y + (dy / d) * step }
}

/**
 * Where the rim is in a given direction — where `edge` mechanics telegraph and
 * where adds walk in from. On an octagon that distance depends on the bearing,
 * which is the whole reason the polygon exists.
 */
export function arenaEdge(boss: BossDef, angle: number, inset = 0): Vec {
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  const poly = polyOf(boss)
  let hit = Infinity
  if (poly) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j]
      const b = poly[i]
      const ex = b.x - a.x
      const ey = b.y - a.y
      const den = dir.x * ey - dir.y * ex
      if (Math.abs(den) < 1e-9) continue
      const t = (a.x * ey - a.y * ex) / den
      if (t <= 0) continue
      const s = ((t * dir.x - a.x) * ex + (t * dir.y - a.y) * ey) / (ex * ex + ey * ey)
      if (s < 0 || s > 1) continue
      hit = Math.min(hit, t)
    }
  }
  const r = Math.max(1, (Number.isFinite(hit) ? hit : boss.arenaRadius) - inset)
  return { x: dir.x * r, y: dir.y * r }
}

// ── stages ───────────────────────────────────────────────────────────────────
// A boss with no `phases` never touches any of this and behaves exactly as it
// did before stages existed: `loop`, `loopIntervalSec` and `ambient` off the
// BossDef. Five of the eight fights in this tier are in that position and
// PHASES.md says so, so the flat path stays the default rather than a fallback.

/** The stage currently running, or null on a boss that has none. */
function activePhase(w: World): PhaseDef | null {
  const list = w.boss.phases
  return list && list.length ? list[w.phaseIndex % list.length] : null
}

function activeLoop(w: World): string[] {
  return activePhase(w)?.loop ?? w.boss.loop
}

function activeInterval(w: World): number {
  return activePhase(w)?.loopIntervalSec ?? w.boss.loopIntervalSec
}

function activeAmbient(w: World): string[] {
  return activePhase(w)?.ambient ?? w.boss.ambient ?? []
}

// ── the split raid ───────────────────────────────────────────────────────────

/** The entity a side's group is parked on. */
function entityForSide(w: World, side: Side): BossUnit | undefined {
  return w.bosses.find(b => b.def.side === side)
}

/** Everyone running with a given side, or the whole raid when untagged. */
function sideAllies(w: World, side?: Side): Ally[] {
  const live = w.allies.filter(a => a.alive)
  return side ? live.filter(a => a.side === side) : live
}

/** Is this the player's problem? A side-tagged mechanic fires at one group only. */
function onPlayersSide(w: World, def: MechanicDef): boolean {
  return !def.side || def.side === w.player.side
}

/**
 * How far a group may stand from its own golem, and how far it must stay from
 * the other one. Both numbers are read off the fight rather than chosen: the
 * bubble is the Marks' own radius, and the exclusion is the tank job's own
 * `keepApart` distance.
 */
function sideBubble(w: World): number {
  for (const m of w.boss.mechanics) if (m.proximityStack) return m.proximityStack.radius
  return 40
}

function sideExclusion(w: World): number {
  for (const m of w.boss.mechanics) if (m.rule.type === 'keepApart') return m.rule.minYards
  return sideBubble(w)
}

/**
 * Push a floor placement into the band that belongs to one group: inside its own
 * golem's Mark radius, and outside the other golem's entirely.
 *
 * Toxic Droplets are the green group's job, so a droplet in the red half is a
 * job nobody can do, and one in the overlap drags a green sweeper into range of
 * Blood and double-stacks their Marks for the rest of the pull. Anchoring on a
 * green raider got most of the way there, but the jitter still crossed the line
 * often enough to matter — a soft tendency is not a rule.
 */
function confineToSide(w: World, side: Side, p: Vec): Vec {
  const own = w.bosses.find(b => b.def.side === side)
  const other = w.bosses.find(b => b.def.side && b.def.side !== side)
  if (!own) return p
  const R = sideBubble(w)
  // Margin on both bounds: the golems walk to their tanks, so a placement
  // sitting exactly on a boundary is outside it a second later.
  const inner = R - 8
  const clear = R + 4
  const okHere = (q: Vec) =>
    dist(q, own.pos) <= inner && (!other || dist(q, other.pos) >= clear)
  if (okHere(p) || !other) return clampToArena(w.boss, p, 2)

  // Two nudges cannot solve this. Pushing clear of the far golem and then
  // pulling back inside our own drags the point straight back towards the far
  // one whenever the pair are closer than twice the Mark radius — which they
  // are for most of a pull, because the tanks drift. The second correction
  // silently undid the first and a droplet landed in the overlap.
  //
  // The region that always works is the lobe on the far side of our own golem,
  // directly away from theirs: distance from them is the separation PLUS the
  // offset, so it can only get safer. The original placement’s sideways spread
  // is kept so droplets still scatter rather than stacking on one spot.
  const ax = own.pos.x - other.pos.x
  const ay = own.pos.y - other.pos.y
  const al = Math.hypot(ax, ay) || 1
  const ux = ax / al, uy = ay / al
  const px = -uy, py = ux
  const perp = (p.x - own.pos.x) * px + (p.y - own.pos.y) * py
  const spread = Math.max(-inner * 0.55, Math.min(inner * 0.55, perp))
  const out = {
    x: own.pos.x + ux * inner * 0.5 + px * spread,
    y: own.pos.y + uy * inner * 0.5 + py * spread,
  }
  return clampToArena(w.boss, out, 2)
}

/**
 * Everything the pull has already cost you, as a damage-taken multiplier.
 *
 * Marks of Acid and Blood stack forever and Ritual Burn never falls off, so a
 * mistake at forty seconds is genuinely cheaper than the same mistake at two
 * minutes. Standing in range of BOTH golems stacks both — that is the split
 * raid's characteristic mistake, and it has to be felt rather than counted.
 */
function damageTakenMult(w: World): number {
  let extra = 0
  for (const id of Object.keys(w.player.marks)) extra += w.player.marks[id] * (w.markPct[id] ?? 0)
  return 1 + extra
}

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
      // A beam carries its own reach; a fixed frontal uses the shape’s.
      const len = inst.reach ?? s.length
      return along >= 0 && along <= len && Math.abs(across) <= s.width / 2
    }
  }
}

function def_scored(w: World, def: MechanicDef): boolean {
  // A side-tagged mechanic is only ever yours when you are running with that
  // group. Scoring a green player for a red mechanic would blame them for
  // standing where the fight told them to stand.
  return def.roles.includes(w.player.role) && onPlayersSide(w, def)
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

/**
 * Damage that is not a mechanic: a DoT ticking, attrition, the Marks.
 *
 * Deliberately outside `hurt`. It is neither capped nor multiplied by your
 * stacks — "+15% mechanic damage taken" is about mechanics, and a stacking DoT
 * that inflated its own tick would compound into a wall no healer could argue
 * with. There is nothing to press and nothing to dodge; the answer is healing.
 */
function chip(w: World, amount: number, cause: string) {
  w.player.health -= amount
  if (w.player.health <= 0 && w.player.alive) {
    w.player.alive = false
    w.player.health = 0
    w.deathCause = cause
  }
}

function hurt(w: World, amount: number, cause: string) {
  // Your permanent stacks first, then the cap. Ritual Burn is +15% on
  // everything that comes after it, so a pull that leaked early really is
  // harder later — but the cap still holds, because "you can eat a mechanic,
  // see the failure and carry on" is a promise this trainer makes and a stack
  // count is not allowed to withdraw it. What the stacks buy is how few
  // mistakes it takes to reach the cap, not a one-shot at minute two.
  const capped = Math.min(amount * damageTakenMult(w), MAX_SINGLE_HIT)
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

// ── the stack economy ────────────────────────────────────────────────────────
//
// One fight in this tier is a resource problem rather than a dodging problem.
// The Twin Fangs tactic file says so in its first paragraph: Eternal Venom
// "arrives from seven sources continuously ... and is shed only one per player
// per Ravenous Feast", and every decision on that fight — who soaks the globule,
// which spawn dies first, whether a bite is yours — is an argument about the
// count rather than about the damage.
//
// So the count is a first-class thing the engine tracks on every body, driven
// entirely from data: one `counter` mechanic per fight declares what kills you,
// and every mechanic that feeds it declares `applies`. Nothing below names a
// spell, and on the seven fights that declare no counter every one of these is
// a no-op that costs a `find` over fifteen mechanics.

/**
 * How long the "+1" hangs over your head after a stack lands.
 *
 * Exported because the renderer needs the same number to fade the float, and
 * two copies of a duration are two durations the moment somebody tunes one.
 */
export const VENOM_FLASH_MS = 900

/**
 * The mechanic that IS this fight's counter, or undefined on the other seven.
 *
 * Looked up rather than cached on the World for the same reason `empowerment` is
 * looked up: MechanicDefs are shared between every world, and a pull's own state
 * has no business living on them. Only ever reached from a body that is being
 * charged, so it is a handful of calls a second, not one a frame.
 */
function counterDef(w: World): MechanicDef | undefined {
  return w.boss.mechanics.find(m => m.counter)
}

/**
 * May this instance charge this body again yet?
 *
 * Default is once per instance per body, and that is the honest default: a
 * splash that resolves on you resolves once. A hazard that lingers and can be
 * walked back into declares `applies.everyMs` and gets billed on that period
 * instead — without which a beam charges the first tick you touch it and is
 * free floor for the rest of its life, which teaches standing in it.
 */
function canTouch(inst: Instance, body: number, everyMs: number, nowMs: number): boolean {
  const seen = inst.touchMs ?? (inst.touchMs = {})
  const last = seen[body]
  if (last !== undefined && nowMs - last < everyMs) return false
  seen[body] = nowMs
  return true
}

/**
 * The player hit the cap. The pull is over and the debrief names the counter.
 *
 * Named rather than left to chip damage on purpose. Dying at ten stacks is not
 * "the healers could not keep up" — it is a specific economy the player lost
 * over ninety seconds, and a death screen that blamed the last globule instead
 * of the count would send them away practising the wrong thing.
 */
function venomWipe(w: World, def: MechanicDef, lethalAt: number) {
  // It is a wipe, not a death: the count is on the whole raid and everyone is
  // at or near it. The bar is emptied so the debrief's lowest-raid-HP line
  // agrees with what actually happened, rather than reporting a comfortable 60%
  // beside a dead player.
  w.raidHealth = 0
  w.raidHealthLow = 0
  killPlayer(w, `${def.name} — ${lethalAt} stacks`)
}

/**
 * Hand `n` stacks to one body: the player when `who` is null, an ally otherwise.
 *
 * The two bodies are judged DIFFERENTLY and deliberately. You reaching the cap
 * ends the pull. An ally reaching it dies where they stand and the fight carries
 * on — the raid loses their health and their share of the soak rota, which is
 * consequence enough, and a pull that ended because the AI misplayed its
 * globules would be a wipe with nothing the player could have done about it.
 */
function giveVenom(w: World, who: Ally | null, n = 1) {
  const def = counterDef(w)
  const cap = def?.counter
  if (!def || !cap || n <= 0) return
  if (who) {
    if (!who.alive) return
    who.venom += n
    w.venomRaidPeak = Math.max(w.venomRaidPeak, who.venom)
    if (who.venom >= cap.lethalAt) {
      who.alive = false
      who.health = 0
      w.alliesLost++
    }
    return
  }
  if (!w.player.alive) return
  w.player.venom += n
  w.venomPeak = Math.max(w.venomPeak, w.player.venom)
  // The float stacks rather than restarts: two sources landing in the same
  // second are one "+2", because two "+1"s drawn on top of each other read as
  // one and the player is then short a stack they never saw arrive.
  w.venomFlash = { n: (w.venomFlash?.n ?? 0) + n, ms: VENOM_FLASH_MS }
  if (w.player.venom >= cap.lethalAt) venomWipe(w, def, cap.lethalAt)
}

/**
 * Everybody, player and raid alike. Venomous Emergence, and a globule nobody
 * swept — the two ways this fight charges the room rather than a person.
 */
function payRaid(w: World, def: MechanicDef) {
  const n = def.applies?.raid
  if (!n) return
  giveVenom(w, null, n)
  for (const a of w.allies) giveVenom(w, a, n)
}

/**
 * Charge one body for standing in something.
 *
 * Gated through the instance, so a lingering hazard cannot bill the same body
 * twice a frame. Never called for the body a mechanic was AIMED at: being chosen
 * is not billed anywhere in this engine — a Corrosive Spit target eating an
 * unavoidable +1 every eight seconds per living spawn is a wipe nobody can play
 * out of, and it matches the standing rule that a fixate's own carrier takes no
 * damage from their own line.
 */
function payHit(w: World, inst: Instance, who: Ally | null) {
  const app = inst.def.applies
  if (!app?.hit) return
  if (!canTouch(inst, who ? who.id : -1, app.everyMs ?? Infinity, w.elapsedMs)) return
  giveVenom(w, who, app.hit)
}

/**
 * Take stacks back off a body. The only direction of travel that is not upward.
 *
 * Exported and, for now, uncalled. Ravenous Feast is the fight's one shedder —
 * "shed only one per player per Ravenous Feast" — and it lands as its own step;
 * this is here so that the removal has exactly one home from the moment the
 * economy exists, and so the test that asserts nothing ELSE ever decrements a
 * counter has something to point at. One removal is the fight's central claim
 * and the easiest thing in it to erode by accident.
 */
export function shedVenom(w: World, who: Ally | null, n = 1) {
  if (who) who.venom = Math.max(0, who.venom - n)
  else w.player.venom = Math.max(0, w.player.venom - n)
}

/**
 * Somewhere on the floor that matters — where a rolled ('random') hazard lands.
 *
 * Floor AoE lands where the raid is, not uniformly across the map.
 *
 * This used to scatter over the whole arena, and once the radii were measured
 * from real logs — 58 yards on Vashnik against the 42 it was being played at —
 * the floor area nearly doubled and a 5-yard circle stopped reaching anybody.
 * You could stand still and never be touched, which is not a mechanic, it is
 * scenery.
 *
 * Anchoring on a raider and jittering keeps it dodgeable (you always have
 * somewhere to go) while guaranteeing it is somewhere that matters.
 *
 * Lifted out of `spawn`'s `default:` case unchanged, including the order it
 * draws from `rnd()`, because a second caller needs it: the `count` fan in
 * `fire` had no floor-aware fallback and used the CASTER's position instead.
 * On a boss standing off the platform that is a point in the acid, and every
 * copy in the fan then clamps to the nearest rim — which is not a fan, it is a
 * pile on the edge nearest the boss.
 */
function floorAnchor(w: World, def: MechanicDef): Vec {
  const group = sideAllies(w, def.side).filter(a => def.roles.includes(a.role))
  const mine = def_scored(w, def)
  const anchor = (mine && rnd() < 0.4) || !group.length
    ? w.player.pos
    : group[Math.floor(rnd() * group.length)].pos
  const jitter = (w.boss.arenaRadius * 0.16) + 6
  const a = rnd() * Math.PI * 2
  const r = rnd() * jitter
  let pos = { x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r }
  // Never outside the floor — and on an octagon "outside" is not a radius.
  pos = clampToArena(w.boss, pos, w.boss.arenaRadius * 0.08)
  // A side's floor mechanic lands on that side's floor. Not a preference.
  if (def.side) pos = confineToSide(w, def.side, pos)
  return pos
}

/**
 * `n` points fanned across an arc in front of a caster, each pulled onto the floor.
 *
 * Different placement mechanism from the `count` fan in `fire`, and deliberately
 * kept apart from it: the fan puts a whole ring AROUND a point and re-rolls its
 * spin every cast, which is right for globs flung in every direction and wrong
 * for a sequence of pools laid down in front of a boss. This one is a bounded
 * arc, centred on a bearing the caller chose, with the endpoints included — so
 * `arcDeg` is the angle the whole spread subtends, and the first and last point
 * are exactly that far apart in bearing.
 *
 * Every point goes through `clampToArena`, which means a caster standing off the
 * floor (both serpents are coiled in the acid) still lays its arc ON the floor.
 * The clamp is not shape-preserving, so the post-clamp spacing is not the
 * pre-clamp spacing and the caller has to measure the real gaps rather than
 * trust the arithmetic — whether three pools can be covered from one spot is
 * decided by those clamped positions, not by `ringYards`.
 *
 * No caller yet. It lands with the other extractions so the mechanic that wants
 * it arrives as a boss-file change rather than as an engine change plus a boss
 * file change in one unreviewable commit.
 */
export function arcOnFloor(
  boss: BossDef, from: Vec, facing: number, n: number,
  ringYards: number, arcDeg: number, inset = 2,
): Vec[] {
  const span = (arcDeg * Math.PI) / 180
  const out: Vec[] = []
  for (let i = 0; i < n; i++) {
    // One point sits on the bearing itself rather than off to one side of it.
    const t = n === 1 ? 0 : i / (n - 1) - 0.5
    const a = facing + t * span
    out.push(clampToArena(
      boss,
      { x: from.x + Math.cos(a) * ringYards, y: from.y + Math.sin(a) * ringYards },
      inset))
  }
  return out
}

function spawn(w: World, def: MechanicDef, at?: Vec, angle?: number) {
  // Whichever entity casts this. On a two-boss fight a frontal has to come out
  // of the boss that actually casts it, or "get behind Ithraz" means nothing.
  const src = bossUnitFor(w, def.from)
  // A side-tagged mechanic only ever fires at its own group. Landing a green
  // mechanic on a red player would teach them to answer a call that is not
  // theirs, which is worse than not practising it at all.
  // Candidates for anything that picks a raider: the right side, AND a role the
  // ability actually lands on. Essence Rend never touches a tank, so a tank has
  // to be able to watch rent players walk it to the wall without ever being
  // handed it themselves — which they were, because the filter was side-only.
  const group = sideAllies(w, def.side).filter(a => def.roles.includes(a.role))
  const mine = def_scored(w, def)
  let pos: Vec
  switch (def.origin) {
    case 'boss': pos = { ...src.pos }; break
    case 'player': pos = { ...w.player.pos }; break
    case 'targeted': {
      // Mechanics that pick a raider pick YOU most of the time. This is a
      // trainer: watching an ally carry a debuff teaches nothing, and a DPS
      // whose only job is dodging circles is not learning the fight.
      const onPlayer = mine && rnd() < 0.72
      if (onPlayer) pos = { ...w.player.pos }
      else {
        // Fall back to the whole group rather than to the player: if this
        // ability cannot land on the player's role, putting it on them anyway
        // is precisely the bug being fixed.
        const pool = group.length ? group : sideAllies(w, def.side)
        const a = pool[Math.floor(rnd() * Math.max(1, pool.length))]
        pos = a ? { ...a.pos } : { ...src.pos }
      }
      break
    }
    case 'edge': {
      pos = arenaEdge(w.boss, rnd() * Math.PI * 2)
      break
    }
    default: pos = floorAnchor(w, def)
  }
  // Furniture sits in the middle of the room and stays there: the Soulcoil Well
  // is not aimed at anybody, it is where the room is.
  if (def.atCentre) pos = { x: 0, y: 0 }
  if (at) pos = { ...at }

  // Cones and lines from the boss point at the player, which is what makes
  // `faceAway` a real decision for a tank.
  let ang = angle ?? 0
  if (angle === undefined && def.origin === 'boss') {
    ang = Math.atan2(w.player.pos.y - pos.y, w.player.pos.x - pos.x)
  } else if (angle === undefined) {
    ang = rnd() * Math.PI * 2
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
    // A radial hazard leaves on the bearing it was fanned onto. The Tempest
    // vortices are spokes coming out of the boss, and rolling a fresh bearing
    // for each one sent about a third of them straight back through him — over
    // the melee and both tanks, which is the one patch of floor nobody on this
    // fight is allowed to leave.
    const a = def.radialDrift ? ang : rnd() * Math.PI * 2
    inst.drift = { x: Math.cos(a) * def.driftSpeed, y: Math.sin(a) * def.driftSpeed }
  }
  // Furniture is already on the floor. It has no telegraph and no resolve
  // moment, so it is spawned in the state a hazard reaches after it lands —
  // there is no instant at which the Soulcoil Well "goes off".
  if (def.fixture) {
    inst.resolved = true
    inst.timer = 0
  }
  // A trail starts dripping after one interval rather than instantly, so the
  // carrier gets the beat they need to walk clear of whoever they were stood
  // next to when it landed.
  if (def.rule.type === 'trail') w.trailTimers[inst.uid] = def.rule.everyMs
  // A debuff that landed on a raider stays with that raider until it expires.
  // Trails ride their carrier for exactly the same reason a carried bomb does:
  // the pools have to come out from under the body that is walking, not from
  // the patch of floor where the debuff was applied.
  if ((def.rule.type === 'carryOut' || def.rule.type === 'trail') && !inst.carriedByPlayer) {
    let best: Ally | null = null
    let bd = Infinity
    for (const a of group) {
      const d = dist(a.pos, pos)
      if (d < bd) { bd = d; best = a }
    }
    if (best) w.carriers[inst.uid] = best.id
  }
  w.instances.push(inst)

  // Teach it once, and only if it is yours to do something about.
  //
  // `roles` and `side` used to govern blame alone: a mechanic you could not be
  // scored on still stopped the fight to explain itself. So a dps had the
  // encounter pause for Hollowing Strikes, and a green-side raider had it pause
  // for red-side mechanics they were never going to be handed. Visuals stay
  // unconditional — a tank should watch rent players walk Essence Rend to the
  // wall, and green should see what red is dealing with — but attention is not
  // free, and spending it on somebody else's job is worse than saying nothing.
  if (!w.seen.has(def.id) && def_scored(w, def)) {
    w.seen.add(def.id)
    w.announce = def
  }
}

/** Fire a mechanic by id. Exported so bosses can chain mechanics. */
export function fire(w: World, id: string, at?: Vec, angle?: number) {
  const def = w.boss.mechanics.find(m => m.id === id)
  if (!def) return

  // A mechanic that splits the raid in half hands the player the other half on
  // alternate casts. Hungering Pyre is the case: half the raid soaks it and the
  // other half is running a flame to the corpse pile, and a trainer that only
  // ever gave you the half you were assigned would teach one of the two jobs.
  if (def.alternatesWith) {
    const n = (w.altCount[def.id] ?? 0) + 1
    w.altCount[def.id] = n
    if (n % 2 === 0) {
      const other = w.boss.mechanics.find(m => m.id === def.alternatesWith!.defId)
      // The soak still happens — the raid still has to cover it — but this time
      // it lands on them and the flame lands on you. `resolveInstance` reads the
      // flame you are holding and does not score you on the soak.
      if (other) {
        spawn(w, other, { ...w.player.pos })
        // And on some of the raid, because that is what "the other half of the
        // raid gets the red circle" means. Without it the corpse pile is a job
        // for one person, and an intermission that asks nineteen people to burn
        // a pile of bodies is unwinnable single-handed.
        for (const a of sideAllies(w, other.side).filter(x => x.id % 3 === 0).slice(0, 3)) {
          spawn(w, other, { ...a.pos })
        }
      }
    }
  }

  if (def.rule.type === 'pairUp') {
    dealOrbs(w, def)
  }

  if (def.rule.type === 'windPair') {
    dealWinds(w, def)
  }

  /**
   * Several at once, fanned around wherever this comes from.
   *
   * Tempest is nine vortices sent out of the boss and Caustic Claws is six globs
   * flung around him, and both were single circles before — which is not the
   * same mechanic slightly smaller, it is a different one. Nine spokes leaving
   * the boss is a room you have to pick a way through; one drifting circle is a
   * sidestep.
   *
   * Each copy is spawned on its own bearing and handed that bearing as its
   * angle, so a `radialDrift` hazard travels the way it was thrown.
   */
  if (def.count && def.count > 1 && def.rule.type !== 'collect') {
    const src = bossUnitFor(w, def.from)
    // Where the ring is centred. The last arm used to be `src.pos` as well —
    // "if it is not off the boss and not off the player, put it on the boss
    // anyway" — which is only harmless while every caster stands on the floor.
    // Both Twin Fangs serpents are coiled in the acid three yards off the top
    // edge, so a rolled fan centred on one of them is a ring in the venom, and
    // `clampToArena` then drags every copy onto the nearest floor: the tanks'
    // ledge, all of it, in a heap, on top of the two people who are not allowed
    // to leave. A rolled origin should roll a place on the FLOOR, which is
    // exactly what `floorAnchor` is.
    const base = at ?? (def.origin === 'boss' ? src.pos
      : def.origin === 'player' ? w.player.pos
      : floorAnchor(w, def))
    // A whole-turn offset per cast, so the spokes are not in the same place
    // twice and the gaps between them have to be read rather than remembered.
    const spin = rnd() * Math.PI * 2
    const ring = (def.shape?.kind === 'circle' ? def.shape.radius : 5) * 1.6
    for (let i = 0; i < def.count; i++) {
      const a = spin + (i / def.count) * Math.PI * 2
      const p = clampToArena(
        w.boss, { x: base.x + Math.cos(a) * ring, y: base.y + Math.sin(a) * ring }, 2)
      spawn(w, def, p, a)
    }
    return
  }

  if (def.rule.type === 'collect') {
    // Scattered pickups, not one shape. Each is its own instance so each can be
    // eaten independently, which is what "one player walks in first and eats it
    // alone" actually means.
    const n = def.rule.count
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + w.elapsedMs / 3000
      const r = w.boss.arenaRadius * (0.28 + 0.42 * ((i % 3) / 2))
      // Clamped to the floor: a ring drawn as a circle puts its diagonals
      // outside an octagon, and a droplet nobody can stand on is a droplet
      // nobody can sweep.
      let p = clampToArena(w.boss, { x: Math.cos(a) * r, y: Math.sin(a) * r }, 3)
      // And onto the right half. This ring is drawn around the ARENA CENTRE, so
      // on a split fight it happily scattered green droplets across the red side
      // and through the overlap — sending the green sweepers into Blood's Mark
      // radius to do their job, or handing the job to people who must not cross.
      if (def.side) p = confineToSide(w, def.side, p)
      spawn(w, def, p)
    }
    return
  }
  spawn(w, def, at, angle)
}

/**
 * Deal the four orbs.
 *
 * Everyone is handed a green count between 1 and target-1, and one ally is
 * reserved holding exactly the count that completes yours. The reservation is
 * the point: the raid pairs itself off on a short delay, and without a partner
 * held back for you the puzzle could resolve itself into having no right answer
 * left on the floor. Colliding with the wrong body kills you, so "there is no
 * right answer" is not a difficulty setting, it is a broken mechanic.
 */
function dealOrbs(w: World, def: MechanicDef) {
  if (def.rule.type !== 'pairUp') return
  const target = def.rule.target
  const hand = () => 1 + Math.floor(rnd() * Math.max(1, target - 1))
  w.pairTarget = target
  w.pairMs = 0
  w.pairFired = true
  w.player.green = hand()
  w.player.marked = true
  const live = w.allies.filter(a => a.alive)
  // Your complement comes from the half of the raid nearest you. Anywhere in the
  // room and the answer might be behind five wrong bodies before you can even
  // read a count; always the nearest and the puzzle answers itself, teaching the
  // reflex the fight punishes. The nearest half is a reachable choice you still
  // have to make.
  const near = [...live].sort((x, y) => dist(x.pos, w.player.pos) - dist(y.pos, w.player.pos))
  const pool = near.slice(0, Math.max(3, Math.floor(near.length / 2)))
  const reserved = pool[Math.floor(rnd() * Math.max(1, pool.length))]
  w.pairPartnerId = reserved ? reserved.id : -1
  for (const a of live) {
    a.marked = true
    a.green = a === reserved ? target - w.player.green : hand()
  }
}

/**
 * Deal the compass bearings for Raging Crosswinds.
 *
 * Everybody gets one, and they are dealt in OPPOSED PAIRS rather than rolled
 * independently. That is not a kindness: a roll can hand nineteen raiders north
 * and one south, and a raid where most people have no possible partner is not a
 * hard mechanic, it is a broken one. The real fight throws the raid two ways at
 * once and every raider has an opposite number somewhere.
 *
 * One ally is reserved holding YOUR opposite and kept out of the raid's own
 * pairing, exactly as the orb partner is — and for the same reason. They walk
 * onto your axis and stop short, because closing the last stretch themselves
 * would answer the mechanic for you.
 */
function dealWinds(w: World, def: MechanicDef) {
  if (def.rule.type !== 'windPair') return
  w.windUp = true
  // The axis this cast throws along. Two directions at a time, which is what
  // the ability data has at Heroic — the third and fourth bearings are Mythic.
  // Which axis is rolled per cast, so the answer is never the same twice.
  const axis = rnd() < 0.5 ? (['N', 'S'] as Compass[]) : (['E', 'W'] as Compass[])
  const live = w.allies.filter(a => a.alive)
  w.player.wind = axis[Math.floor(rnd() * 2)]

  // Your partner comes from the half of the raid nearest you, so the answer is
  // reachable inside the telegraph from wherever the last mechanic left you.
  const near = [...live].sort((x, y) => dist(x.pos, w.player.pos) - dist(y.pos, w.player.pos))
  const pool = near.slice(0, Math.max(3, Math.floor(near.length / 2)))
  const reserved = pool[Math.floor(rnd() * Math.max(1, pool.length))]
  w.windPartnerId = reserved ? reserved.id : -1
  if (reserved) reserved.wind = OPPOSITE[w.player.wind]

  // The rest, two at a time, so every one of them has somebody to meet. Paired
  // by index and told who, rather than left to find each other: a raid that
  // re-picks the nearest opposite arrow every tick swaps partners mid-approach
  // and never finishes lining up.
  const rest = live.filter(a => a !== reserved)
  for (let i = 0; i < rest.length; i++) {
    rest[i].wind = i % 2 === 0 ? axis[0] : axis[1]
    const mate = rest[i ^ 1]
    rest[i].windMate = mate ? mate.id : -1
  }
  // An odd body out is thrown, and has to be able to survive it: they are sent
  // to the middle so the push crosses the floor instead of leaving it. Nobody
  // is ever knocked off for an arithmetic leftover.
  if (rest.length % 2 === 1) rest[rest.length - 1].windMate = -1
  if (reserved) reserved.windMate = 0
}

/** Cysts still on the floor, oldest first — what the gales have to work with. */
function liveCysts(w: World): Instance[] {
  return w.instances.filter(i => i.def.raidKnockRoom && i.resolved && !i.answered)
}

/**
 * A Viscous Cyst bursts, and throws the entire raid clear of it.
 *
 * "Regardless of where they are" is the whole point and the reason this is not
 * an ordinary puddle: the burst is what the Maelstrom's gale is aimed at, so it
 * has to reach the people the gale is carrying rather than only the one who
 * touched it. Everyone is thrown directly away from the glob — and the cyst sits
 * out at the rim, so away from it is toward the middle, which is where the fight
 * needs the raid to end up.
 *
 * Deliberately clamped to the floor, unlike a Crosswinds knock. This one is the
 * ANSWER to being blown off the platform; a version of it that could finish the
 * job would make the intermission unsurvivable by design.
 */
function burstCyst(w: World, inst: Instance, toBoss = false) {
  if (inst.answered) return
  inst.answered = true
  // Not retired to minus infinity: it stays a beat so the impact flash can
  // draw, and the instance filter drops it once that is over. A cyst is
  // `permanent` so that it survives a whole rotation on the floor — which means
  // nothing else would ever remove it.
  inst.timer = 0
  // A fraction of the ROOM, not a distance that happens to suit this one. The
  // throw carries you most of the way across the floor — from a glob at the rim
  // that means past the boss and out the other side, which is what being blown
  // back by an exploding cyst should look like.
  const push = (inst.def.raidKnockRoom ?? 0.5) * w.boss.arenaRadius * 2

  /**
   * Which way the burst throws a body.
   *
   * Toward the boss during a gale, away from the glob the rest of the time.
   * "Away" is the honest physics and it is the wrong answer inside the
   * Maelstrom: a player who reached the glob from the far side would be thrown
   * outward, off a platform the stage had just spent five seconds walking them
   * across.
   */
  const bearing = (p: Vec) => {
    const to = toBoss ? w.bosses[0].pos : inst.pos
    const dx = toBoss ? to.x - p.x : p.x - to.x
    const dy = toBoss ? to.y - p.y : p.y - to.y
    const d = Math.hypot(dx, dy) || 1
    return { x: dx / d, y: dy / d }
  }
  const shove = (p: Vec) => {
    const dir = bearing(p)
    const to = clampToArena(w.boss, { x: p.x + dir.x * push, y: p.y + dir.y * push }, 2)
    p.x = to.x
    p.y = to.y
  }
  // The player TRAVELS. Everyone else is teleported, which is what this used to
  // do to the player as well — and at sixty-odd yards an instant reposition does
  // not read as being thrown, it reads as a teleport. It was called one.
  //
  // Never capped at the distance to the boss, either. That was the actual bug:
  // the step was `min(push, distance)`, so however hard the burst hit you it
  // always stopped exactly on him. A knockback whose landing spot is fixed is
  // not a knockback.
  const dir = bearing(w.player.pos)
  w.player.knock = {
    vx: (dir.x * push) / (CYST_KNOCK_MS / 1000),
    vy: (dir.y * push) / (CYST_KNOCK_MS / 1000),
    ms: CYST_KNOCK_MS,
    safe: true,
  }
  w.player.aloft = WIND_ALOFT_MS
  for (const a of w.allies) {
    if (!a.alive) continue
    shove(a.pos)
    a.want.x = a.pos.x
    a.want.y = a.pos.y
  }
  w.cystsBurst++
  w.shake = 1
}

/**
 * Which mechanics burn a corpse.
 *
 * Only while an intermission that would raise them is running, and only the
 * mechanic the raid is deliberately aiming at the pile: a carried flame, and
 * the blast that flame detonates into. Both are recognised structurally — a
 * `carryOut` and whatever it `spawns` — so nothing here keys off an ability's
 * name, and no ordinary floor AoE quietly clears the pile that the whole
 * intermission is about.
 */
function burnsCorpses(w: World, def: MechanicDef): boolean {
  if (!activePhase(w)?.resurrectCorpsesAs) return false
  if (def.rule.type === 'carryOut') return true
  return w.boss.mechanics.some(m => m.spawns?.defId === def.id && m.rule.type === 'carryOut')
}

/** Burn every corpse this blast covers, or that a body is standing on. */
function burnCorpses(w: World, at: Vec, radius: number): number {
  let burned = 0
  for (const c of w.corpses) {
    if (c.burned) continue
    // The blast itself, or somebody standing on the corpse when it lands.
    // Without the second clause only the player could ever burn one and a raid
    // of nineteen would stand and watch the intermission fail.
    const hit = dist(c.pos, at) <= radius ||
      w.allies.some(a => a.alive && dist(a.pos, c.pos) < CORPSE_RANGE && dist(a.pos, at) <= radius + CORPSE_RANGE)
    if (!hit) continue
    c.burned = true
    c.burnedAtMs = w.elapsedMs
    burned++
  }
  return burned
}

// ── the fountains ────────────────────────────────────────────────────────────

/**
 * What one Infusion stack is worth.
 *
 * Linear and deliberately unsubtle. The lesson is that re-draining a fountain
 * makes both the venom it sends and the infection it hands out worse; a curve
 * nobody can read teaches that less well than a number that plainly climbs.
 */
const infusionMultiplier = (stacks: number) => 1 + 0.5 * Math.max(0, stacks - 1)

/** How hard an altar-fed mechanic hits this pull. 1 on every other fight. */
function empowerment(w: World, def: MechanicDef): number {
  return w.infusionMult[def.id] ?? 1
}

/** The `count` fountains nearest a point — which is all Imbibe is choosing. */
function nearestAltars(w: World, count: number, from: Vec = w.bosses[0].pos): AltarState[] {
  return [...w.altars]
    .sort((a, b) => dist(a.def.pos, from) - dist(b.def.pos, from))
    .slice(0, Math.max(1, Math.min(count, w.altars.length)))
}

/**
 * Imbibe. The fountains nearest the boss drain, and everything the raid deals
 * with for the next ninety seconds follows from which ones those were.
 *
 * The boss walks after its tank, so this is the only mechanic in the raid where
 * one player's footwork picks everybody else's job. Each drained altar sends its
 * venom at the Cavity, fires its unavoidable Expulsion and hands its infection
 * to somebody — BOTH of them do, every drink, which is why the raid is always
 * juggling two of the three infection types at once.
 *
 * Re-draining the same fountain stacks its Infusion and empowers both halves of
 * that. It is the fight's own answer to a tank who stands still, and it is the
 * reason the boss has to be walked.
 */
function drainAltars(w: World, def: MechanicDef, count: number) {
  if (!w.altars.length) return
  const taken = nearestAltars(w, count)
  const chosen = new Set(taken)

  // A fountain this drink passed by loses its Infusion. The stacks are not a
  // running total of the pull — they are a statement about where the boss has
  // been standing for the last two drinks, and walking him off one has to be
  // worth something the moment it happens.
  for (const a of w.altars) {
    if (chosen.has(a)) continue
    a.infusion = 0
    a.drainedLast = false
    w.infusionMult[a.def.debuffId] = 1
    w.infusionMult[a.def.expulsionId] = 1
  }

  // Did the boss not move at all?
  //
  // The whole PAIR, never a single fountain. Three fountains and two drinks
  // means any two consecutive pairs share exactly one altar — there is no
  // footwork on earth that avoids re-draining something — so scoring "an altar
  // repeated" would put a failure on the tank every single Imbibe for playing it
  // perfectly. That is precisely the defect this project keeps having to re-fix,
  // and here it would have been unavoidable by construction. What a tank can
  // actually get wrong is standing still, which is both of them repeating.
  //
  // The forced single repeat still stacks its own Infusion. Good footwork holds
  // that at one stack and resets the other fountain to nothing; standing still
  // climbs both, forever.
  const stoodStill = taken.every(a => a.drainedLast)

  for (const a of taken) {
    a.infusion = a.drainedLast ? a.infusion + 1 : 1
    a.drainedLast = true
    a.drainedAtMs = w.elapsedMs
    const mult = infusionMultiplier(a.infusion)
    w.infusionMult[a.def.debuffId] = mult
    w.infusionMult[a.def.expulsionId] = mult

    // Its venom, out of the fountain itself rather than off the rim — the raid
    // has to be able to see which colour it came from and how far it still has
    // to walk before it reaches the Cavity.
    const add = w.boss.adds?.find(x => x.id === a.def.addId)
    if (add) spawnAdds(w, add, add.count, mult, a.def.pos)
    fire(w, a.def.expulsionId)
    fire(w, a.def.debuffId)
  }

  w.lastDrained = taken.map(a => a.def.id)
  w.lastDrainAtMs = w.elapsedMs
  if (taken.length) w.shake = Math.min(1, w.shake + 0.4)

  // Only ever answered against the tank who is actually holding him. Nobody else
  // in the raid has a lever on where the boss stands, so nobody else can be
  // blamed for it — and a healer being told they drained the wrong fountain
  // would be the trainer inventing a job for them.
  if (stoodStill && w.player.role === 'tank' && w.bosses[0].targetId === 0
      && !def.collective && def.roles.includes('tank')) {
    recordFailure(w, def)
  }
}

/**
 * Where the boss ought to be standing next: out toward the pair of fountains
 * carrying the least Infusion.
 *
 * Pushed away from the middle on purpose. The Malignant Cavity is a hole in the
 * floor at the centre of the room and the midpoint of two altars is very nearly
 * in it, so the honest mark is out along the pair's bearing rather than between
 * them.
 */
function altarStation(w: World): Vec | null {
  if (w.altars.length < 2) return null
  let best: Vec | null = null
  let bestScore = Infinity
  for (let i = 0; i < w.altars.length; i++) {
    for (let j = i + 1; j < w.altars.length; j++) {
      const l = w.altars[i]
      const r = w.altars[j]
      // Infusion first, then whether the last drink already took it — a fresh
      // pair beats a rested one, which is what keeps the boss circling rather
      // than rocking between the same two marks.
      const score = l.infusion + r.infusion + (l.drainedLast ? 2 : 0) + (r.drainedLast ? 2 : 0)
      if (score >= bestScore) continue
      bestScore = score
      const mid = { x: (l.def.pos.x + r.def.pos.x) / 2, y: (l.def.pos.y + r.def.pos.y) / 2 }
      const len = lenOf(mid) || 1
      const out = Math.max(w.boss.arenaRadius * 0.45, len)
      best = { x: (mid.x / len) * out, y: (mid.y / len) * out }
    }
  }
  return best ? clampToArena(w.boss, best, w.boss.arenaRadius * 0.12) : null
}

function resolveInstance(w: World, inst: Instance) {
  const { def } = inst
  inst.resolved = true
  w.resolvedCount++
  // Are you holding the other half of a split mechanic? Then this half is the
  // raid's and scoring you on it would blame you for an assignment you do not
  // have this cast.
  const otherHalf = !!def.alternatesWith && w.instances.some(i =>
    i.def.id === def.alternatesWith!.defId && !i.resolved && i.carriedByPlayer)
  // `collective` mechanics are measured per cast, not per player, so they can
  // never name anyone — see MechanicDef.collective. A side-tagged mechanic is
  // only ever yours when you are running with that group.
  const scored = def.roles.includes(w.player.role) && !def.collective
    && onPlayersSide(w, def) && !otherHalf
  const inside = isInside(inst, w.player.pos)
  // Corpse burning is judged before the rule is, because delivering a flame to
  // the pile is what the carry was FOR.
  const burnRadius = def.shape?.kind === 'circle' ? def.shape.radius : CORPSE_RANGE
  const burned = burnsCorpses(w, def) ? burnCorpses(w, inst.pos, burnRadius) : 0

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
        // Deadly means deadly. Everything else is damage you get healed through
        // — scaled by the Infusion behind it, so an Expulsion off a fountain
        // drained twice running really does hit harder than the first one did.
        if (def.lethal) killPlayer(w, def.name)
        else hurt(w, (def.damage ?? 0.3) * empowerment(w, def), def.name)
        // And the stack, on the fight that keeps one. On this fight the damage
        // is the smaller half of what standing in something costs you.
        payHit(w, inst, null)
      }
      break

    case 'collect':
      // `answered` means somebody ran over it in time. Only the ones nobody
      // reached rupture, and only those are ever reported — eating one is
      // correct play, so a soaker can never appear as a failure.
      if (!inst.answered) {
        if (scored) recordFailure(w, def)
        w.raidHealth -= def.lethal ? 0.16 : 0.09
        payRaid(w, def)   // it ruptured on everybody, which is what a miss costs
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
      // Struck by a tank cone you are not tanking.
      //
      // Ravage "stacks +300% Ravage damage taken for 25s on everyone struck",
      // so the second one genuinely kills a body the first one clipped — and
      // there are two of them in every Apex Predator flurry. That is the whole
      // reason it is a swap driver, and it is why "only the active tank in the
      // cone" is the tactic file's Good line rather than a preference.
      //
      // Lethality here is NOT a balance choice dressed up: the first hit cannot
      // kill, and the second only kills a body already carrying the amp the
      // ability's own tooltip applies. `lethal` stays unset because 1277002 is
      // not category Deadly, and it must keep matching the data.
      if (inside && !currentTank(w, bossUnitFor(w, inst.fromId)).isPlayer) {
        if (w.player.carrying[def.id] !== undefined) {
          if (scored) recordFailure(w, def)
          killPlayer(w, `${def.name} — struck at +300%`)
        } else {
          w.player.carrying[def.id] = 25000
          hurt(w, def.damage ?? 0.25, def.name)
        }
      } else if (inside) {
        hurt(w, def.damage ?? 0.25, def.name)
      }
      break
    }

    case 'aimAway': {
      // One cast, two entirely different jobs, decided by whether it marked you.
      if (inst.carriedByPlayer) {
        // Yours to aim. The line runs from the pocket through you and out the
        // far side, so the question is never "am I standing in it" — you always
        // are — but "what else is behind me". Judged against where the raid
        // actually is, the same reference `faceAway` uses, because a raid that
        // has spread for something else has moved the answer.
        const raid = raidAnchor(w)
        if (isInside(inst, raid)) {
          if (scored) recordFailure(w, def)
          w.raidHealth -= 0.11
        }
        // Deliberately no damage to the marked player. They were chosen, and
        // this project does not bill people for being chosen — the carrier of a
        // Coiling Ichor is "never at fault" for the same reason. What they are
        // answerable for is where they pointed it, which is the check above.
      } else if (inside) {
        // Everyone else: an ordinary frontal, scored exactly like `avoid`, and
        // charged the same stack for the same reason. Note where this sits — in
        // the bystander branch, never the carrier's. Being marked by a Spawn of
        // Vexhul is not billed; walking through somebody else's line is.
        if (scored) recordFailure(w, def)
        if (def.lethal) killPlayer(w, def.name)
        else hurt(w, (def.damage ?? 0.3) * empowerment(w, def), def.name)
        payHit(w, inst, null)
      }
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
      // Putting a flame on the corpse pile IS the delivery, whatever the
      // distance says. The intermission asks you to walk it onto a body that
      // may be lying near the middle of the room, and failing you for obeying
      // the fight is the defect this project keeps having to re-fix.
      if (burned > 0) { delete w.player.carrying[def.id]; break }
      if (w.player.carrying[def.id] !== undefined && d < def.rule.minDistance) {
        if (scored) recordFailure(w, def)
        // You detonated it on top of the raid. A Deadly one kills you where you
        // stand and takes a chunk of the group with it — which is why running
        // it out is the mechanic.
        if (def.lethal) {
          w.raidHealth -= 0.25 * empowerment(w, def)
          killPlayer(w, def.name)
        } else {
          w.raidHealth -= 0.1 * empowerment(w, def)
        }
      }
      delete w.player.carrying[def.id]
      break
    }

    case 'trail': {
      // It simply ends. Dropping the trail was the mechanic working, not the
      // player failing it — their job was to keep walking so the pools they left
      // missed everybody, and the pools already said whether they managed it.
      // Scoring the carrier here would blame them for having been targeted.
      delete w.player.carrying[def.id]
      delete w.trailTimers[inst.uid]
      break
    }

    case 'drainNearest':
      drainAltars(w, def, def.rule.count)
      break

    case 'survive':
      if (inside && def.knockbackYards) {
        const away = Math.atan2(w.player.pos.y - inst.pos.y, w.player.pos.x - inst.pos.x)
        const landing = {
          x: w.player.pos.x + Math.cos(away) * def.knockbackYards,
          y: w.player.pos.y + Math.sin(away) * def.knockbackYards,
        }
        if (!inArena(w.boss, landing)) {
          // Clamped to the rim, and it counts as a failure: you were standing
          // somewhere the knock could not survive.
          const held = clampToArena(w.boss, landing, 1.5)
          landing.x = held.x
          landing.y = held.y
          if (scored) recordFailure(w, def)
          hurt(w, def.damage ?? 0.25, def.name)
        }
        w.player.pos.x = landing.x
        w.player.pos.y = landing.y
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

    case 'burnWindow':
      // Opens on resolve and runs on a clock. Judged when it closes, in step().
      w.burnMs = def.rule.durationMs
      w.burnMult = def.rule.multiplier
      w.burnId = def.id
      w.burnUsed = false
      break

    case 'pairUp':
      // Time is up. Anyone still carrying orbs dies where they stand — the
      // tactic file's Cultivated Burst — and that includes you.
      if (w.player.marked) {
        if (scored) recordFailure(w, def)
        killPlayer(w, def.name)
      }
      for (const a of w.allies) {
        if (a.marked) { a.marked = false; a.green = 0 }
      }
      w.player.marked = false
      w.player.green = 0
      w.pairPartnerId = -1
      break

    case 'raidDamage':
      // Ambient attrition is ticked in step() and never arrives here. One fired
      // as a CAST does: a channelled Rite has to land as a discrete lump or the
      // healer cannot see what they are covering. Unavoidable either way, and it
      // can never name anybody — an empowered Expulsion is a bigger number for
      // the healer to cover, never a bigger stick to beat them with.
      w.raidHealth -= (def.rule.dps / 100) * empowerment(w, def)
      payRaid(w, def)   // Venomous Emergence: a stack on everybody, nothing to dodge
      break

    case 'combo': {
      // The flurry. Five real abilities dealt out back-to-back in an order
      // nobody can memorise, from a marker that can never itself be failed.
      //
      // Staggered rather than simultaneous, and not only for readability: the
      // announcement channel is a single slot cleared every tick, so two
      // first-sight mechanics landing on one frame would teach one of them and
      // silently mark the other as already seen, forever.
      const parts = [...def.rule.parts]
      const gap = def.rule.gapMs
      for (let i = parts.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1))
        const t = parts[i]
        parts[i] = parts[j]
        parts[j] = t
      }
      // Each cast is scheduled to begin after the previous one has RESOLVED, so
      // no two cones are ever in the air together. On a fixed period this was
      // two frontals overlapping — one asking you into it and the other asking
      // you out, with no instant at which both answers existed. The two cones
      // here are 3s casts and the period was 1.9s, so it was not close.
      let at = w.elapsedMs
      for (const id of parts) {
        w.queue.push({ id, atMs: at })
        at += (w.boss.mechanics.find(m => m.id === id)?.telegraphMs ?? 0) + gap
      }
      // Nothing else lands during a flurry. It is a set piece — five casts the
      // fight delivers one at a time — and the ordinary rotation arriving on top
      // of it puts a floor AoE under a cone you are already committed to.
      w.comboUntilMs = at
      break
    }

    case 'groupSoak': {
      // Two demands pulling against each other, which is the mechanic.
      //
      // Enough bodies, or the hit is not split and it lands on the raid whole.
      // And never the same bodies twice, because every body struck takes a Gash
      // and a second Gash on a live one kills it. So the cone has to find a
      // crowd, and it has to find a DIFFERENT crowd than last time.
      const dotId = def.rule.dotId
      const need = def.rule.bodies
      const dot = w.boss.mechanics.find(m => m.id === dotId)
      // The tank holding him is exempt from the Gash, and only the tank.
      //
      // Aiming this cone means standing on the bearing you are aiming it down,
      // so the active tank is inside their own frontal on every single cast by
      // construction — they cannot be in a stack group and cannot step out
      // without pointing it somewhere else. Giving them a Gash a cast killed
      // them on the second one for doing their job perfectly, which is the exact
      // defect class this project keeps having to re-fix. They still count as a
      // body: they are genuinely in it, and the damage genuinely splits.
      const holder = currentTank(w, bossUnitFor(w, inst.fromId))
      const struck: Ally[] = []
      let bodies = inside ? 1 : 0
      for (const a of w.allies) {
        if (!a.alive || !isInside(inst, a.pos)) continue
        bodies++
        if (a.pos !== holder.pos) struck.push(a)
      }
      const playerSoaks = inside && !holder.isPlayer

      if (bodies < need) {
        // Measured per cast, never per player — the tactic file is explicit
        // ("Not a per-player failure — track soak count per cast"), and `def` is
        // `collective`, so `scored` is already false and nobody is named. What
        // it costs is the raid, and it costs them nearly all of it: an unsplit
        // Mutilate is one hit away from a wipe rather than a scratch.
        w.raidHealth -= 0.55
        w.shake = 1
        if (def.failText) w.lastFailure = { name: def.name, failText: def.failText, atMs: w.elapsedMs }
      }

      const life = dot && dot.rule.type === 'stackingDot' ? dot.rule.durationMs : 22000
      const cap = dot && dot.rule.type === 'stackingDot' ? dot.rule.maxStacks : 2
      const hitGroups = new Set<number>()

      if (playerSoaks) {
        hitGroups.add(w.player.group)
        w.player.gash += 1
        if (w.player.gash >= cap && dot) {
          // Attributed to the Gash, which is the Deadly id the tactic file says
          // to attribute these deaths to — never to Mutilate, which is a soak
          // and can never name anybody.
          if (def_scored(w, dot)) recordFailure(w, dot)
          killPlayer(w, dot.name)
        } else {
          w.player.gashMs = life
          chip(w, (dot?.damage ?? 0.1), dot?.name ?? def.name)
        }
      }
      for (const a of struck) {
        hitGroups.add(a.group)
        a.gash += 1
        if (a.gash >= cap) {
          // The raid genuinely loses the group that ate two. Without this the
          // rota is an instruction with no consequence attached, and a tank
          // could aim at the same crowd all night.
          a.alive = false
          a.health = 0
          w.alliesLost++
        } else {
          a.gashMs = life
          a.health = Math.max(0.15, a.health - 0.25)
        }
      }
      for (const g of hitGroups) w.groupGashMs[g] = life
      break
    }

    case 'stackingDot':
      // Never cast on its own. A `groupSoak` applies it, and step() runs the
      // clock down — so arriving here at all means a boss file put it in a loop,
      // and doing nothing is the honest response to that.
      break

    case 'windPair': {
      w.windUp = false
      const push = def.rule.pushYards
      const mine = w.player.wind
      if (mine) {
        const met = w.allies.some(a => a.alive && windCancels(mine, w.player.pos, a.wind, a.pos))
        if (!met) {
          if (scored) recordFailure(w, def)
          const v = COMPASS[mine]
          // Deliberately NOT clamped to the rim, which is what `survive` does.
          // Falling off the platform took 31 killing blows in six pulls here —
          // more than every boss ability combined — and a knock that politely
          // stops at the edge is a different fight from the one being taught.
          // The floor check at the top of step() turns this into the fall.
          w.player.pos.x += v.x * push
          w.player.pos.y += v.y * push
          w.player.aloft = WIND_ALOFT_MS
          hurt(w, def.damage ?? 0.18, def.name)
          w.shake = 1
        }
      }
      for (const a of w.allies) {
        if (!a.alive || !a.wind) continue
        const partner = w.allies.some(o =>
          o !== a && o.alive && windCancels(a.wind!, a.pos, o.wind, o.pos)) ||
          windCancels(a.wind, a.pos, w.player.wind, w.player.pos) ||
          // An odd body out was never given anybody to meet. Throwing them off
          // the platform for an arithmetic leftover would put a death in the
          // debrief that the player could not have prevented — the same line the
          // orb puzzle draws for exactly the same reason.
          a.windMate < 0
        if (!partner) {
          const v = COMPASS[a.wind]
          a.pos.x += v.x * push
          a.pos.y += v.y * push
          if (!inArena(w.boss, a.pos)) {
            a.alive = false
            a.health = 0
            w.alliesLost++
          }
        }
        a.want.x = a.pos.x
        a.want.y = a.pos.y
        a.wind = null
      }
      w.player.wind = null
      w.windPartnerId = -1
      break
    }

    case 'keepApart':
    case 'lethalGround':
      // Never resolved. Both are judged continuously in step(): one is a state
      // you are allowed to sit in for a moment, and the other is a hole in the
      // floor, which has no resolve moment at all.
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
      w.raidHealth -= 0.09
      w.shake = Math.min(1, w.shake + 0.5)
    }
  }

  // A cast whose whole point is what it leaves standing on the floor. The
  // summon ignores the concurrency cap on purpose: the cap governs the trash
  // timer, and a scripted cast that silently declined to summon would leave the
  // raid reading a 3-second telegraph that did nothing.
  if (def.summons) {
    const kind = w.boss.adds?.find(a => a.id === def.summons!.addId)
    if (kind) spawnAdds(w, kind, def.summons.count ?? kind.count)
  }

  if (def.spawns) {
    const child = w.boss.mechanics.find(m => m.id === def.spawns!.defId)
    if (child) {
      // A carried debuff leaves its pool wherever the carrier is standing when
      // it expires — that is the point of running it out.
      const carried = def.rule.type === 'carryOut' && inst.carriedByPlayer
      let at: Vec = carried ? { ...w.player.pos } : { ...inst.pos }
      // Snapped onto the clock face.
      //
      // A Viscous Cyst has to end up somewhere a gale can blow the raid into,
      // and a gale only comes from one of the four compass quarters. Dropping
      // one between two of them is a Maelstrom with nothing at the end of it,
      // which is a wipe nobody in the room could have played out of. So the
      // carrier's job is the QUARTER, not the pixel — walk it north-ish and it
      // lands on north.
      if (def.clockDrop) at = clockPoint(w.boss, clockOf(at))
      // A beam fires from where it spawned back into whatever cast the parent,
      // and reaches exactly that far — not the parent's own facing, which for a
      // floor circle is a random number.
      let ang = inst.angle
      if (child.aimsAtCaster) {
        const tgt = bossUnitFor(w, child.from ?? def.from)
        ang = Math.atan2(tgt.pos.y - at.y, tgt.pos.x - at.x)
      }
      spawn(w, child, at, ang)
      if (child.aimsAtCaster) {
        const beam = w.instances[w.instances.length - 1]
        const tgt = bossUnitFor(w, child.from ?? def.from)
        if (beam) beam.reach = dist(at, tgt.pos)
      }
      if (carried) {
        // Give the carrier a beat to walk clear. Without it the pool lands on
        // top of you and resolves in the same frame, which is not a mechanic —
        // it is an ambush.
        const dropped = w.instances[w.instances.length - 1]
        if (dropped && dropped.timer < 1200) dropped.timer = 1200
      }
    }
  }

  // One pool per body that soaked, rather than one where the cast landed.
  //
  // Unstable Miasma works this way and it is the whole bargain of the mechanic:
  // stacking up is correct play, and the pools left behind are what the red
  // group pays for splitting the damage. Capped at the head count the soak asked
  // for, so a stray bystander does not double the bill.
  if (def.spawnsAtSoakers) {
    const child = w.boss.mechanics.find(m => m.id === def.spawnsAtSoakers)
    if (child) {
      const bodies: Vec[] = []
      if (inside) bodies.push({ ...w.player.pos })
      for (const a of sideAllies(w, def.side)) {
        if (bodies.length >= (def.soakers ?? 6)) break
        if (isInside(inst, a.pos)) bodies.push({ ...a.pos })
      }
      for (const at of bodies) spawn(w, child, at)
    }
  }

  // A channel is several casts, not one lump. Soulcoil Ignition is four Rites a
  // second apart; rolling them into a single hit would hide exactly the thing
  // the healer has to cover, and the energy it feeds the boss would arrive as a
  // number instead of as four events you watched happen.
  if (def.channel) {
    for (let i = 0; i < def.channel.count; i++) {
      w.queue.push({ id: def.channel.defId, atMs: w.elapsedMs + i * def.channel.everyMs })
    }
  }

  // Energy is fed by events, never by the clock — see the bar in step().
  if (def.energy) w.bossEnergy = Math.min(100, w.bossEnergy + def.energy)

  // A permanent stack of something. Ritual Burn is the running score of what
  // this pull has already cost you, and it never falls off.
  if (def.stacks) {
    w.markPct[def.stacks.defId] = def.stacks.amountPct / 100
    w.player.marks[def.stacks.defId] = (w.player.marks[def.stacks.defId] ?? 0) + 1
  }

  // A mechanic with a speed but no shape of its own draws nothing: it sets the
  // floor moving. Invoke is the case — Stage Two is Stage One plus the Essence
  // Rend pools travelling across the room — and what it moves is what is already
  // lying there rather than anything new, which is why it has nothing to render.
  if (def.driftSpeed && !def.shape) {
    for (const other of w.instances) {
      if (other === inst || !other.def.permanent || other.drift) continue
      // Furniture does not walk. The Soulcoil Well is `permanent` because it
      // never expires, not because it is a puddle somebody dropped — and it was
      // being swept up by this and sent wandering around the room in Stage Two.
      // A fixed hazard the whole fight is built around has to stay where the
      // fight put it, or every route the raid learned in Stage One is a lie.
      if (other.def.fixture || other.def.atCentre) continue
      const a = rnd() * Math.PI * 2
      other.drift = { x: Math.cos(a) * def.driftSpeed, y: Math.sin(a) * def.driftSpeed }
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
 * How long after a stage stops deliberately walking two entities together the
 * separation rule stays unscored, so the tanks can drag them back to their
 * corners without being blamed for the seconds that takes.
 *
 * Sized to the drag itself, not guessed: the pair converge to the middle, and
 * the tanks then walk them back to stations 68 yards apart at tank pace. The
 * stages also cycle, so this happens every Stasis — at 14s it was short by about
 * ten seconds each time, which is where twenty-eight phantom failures a pull
 * came from.
 */
const SEPARATION_GRACE_MS = 24000
/** How long a resolved instance is kept so the impact flash can draw. */
export const IMPACT_FLASH_MS = 260
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

/** Every pickup still on the floor and still worth walking to. */
function livePickups(w: World): Instance[] {
  return w.instances.filter(i =>
    !i.resolved && !i.answered && i.def.rule.type === 'collect')
}

/**
 * Hold one pickup back for the player — per side, by uid, and only when the
 * mechanic is actually theirs.
 *
 * See `World.reservedPickups` for the three defects this replaces. The shape of
 * the answer is worth spelling out here:
 *
 * - **Per side, still.** Toxic Droplets belong to the green group and the red
 *   group must never be sent across the room to sweep one, so the reservation is
 *   made inside each side's own pile exactly as the claim list always was.
 * - **`def_scored`, not merely `roles`.** A green player is no more on the red
 *   side's rota than a tank is on the globule rota, and the engine already has
 *   one predicate that answers both halves of that question at once.
 * - **The one nearest you.** Array order picked an arbitrary instance, and since
 *   the array shrinks as the raid sweeps, it picked a DIFFERENT arbitrary
 *   instance every tick. Nearest-at-the-moment-of-reservation is stable
 *   afterwards — the uid is remembered, not re-derived — and it is the globule
 *   the player was already closest to, which is the one they would have gone
 *   for.
 *
 * Called from the top of `allyThink`, which runs before the scheduler. A pickup
 * that spawns this tick therefore has no reservation until the next one, ~17ms
 * later; that is harmless, because a brand-new pickup has nothing to protect yet
 * and if a raider does eat it the next tick simply reserves another.
 */
function reservePickups(w: World) {
  // Nothing is held back for a corpse. Without this the reservation outlives the
  // player and the globule under it could never be cleared by anybody.
  if (!w.player.alive) {
    w.reservedPickups.clear()
    return
  }
  const live = livePickups(w)
  const uids = new Set(live.map(i => i.uid))
  for (const uid of w.reservedPickups) if (!uids.has(uid)) w.reservedPickups.delete(uid)

  for (const side of [undefined, 'green', 'red'] as (Side | undefined)[]) {
    const of = live.filter(i => i.def.side === side)
    if (!of.length) continue
    // Not the player's job — so the raid clears all of them. A tank on the Twin
    // Fangs used to watch one globule rupture on the raid every Deluge because
    // the engine was saving it for somebody who was never coming.
    if (!of.some(i => def_scored(w, i.def))) continue
    if (of.some(i => w.reservedPickups.has(i.uid))) continue
    let pick = of[0]
    let bd = dist(pick.pos, w.player.pos)
    for (const i of of) {
      const d = dist(i.pos, w.player.pos)
      if (d < bd) { bd = d; pick = i }
    }
    w.reservedPickups.add(pick.uid)
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
  // Is a stack-group cone in the air, or about to be? While one is, holding the
  // mark outranks clean feet — the acid costs a healer's cooldown and missing
  // the soak costs half the raid bar.
  const groupsUp = w.groupMarks.length > 0 && w.instances.some(i =>
    !i.resolved && (i.def.rule.type === 'combo' || i.def.rule.type === 'groupSoak'))

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

  // Pickups. Raiders run over all but the one being held back for the player,
  // so a collect mechanic is always personally consequential without being
  // scripted — and when it is not the player's mechanic at all, the raid clears
  // the floor completely. `reservePickups` owns that decision; everything below
  // is only who walks to what.
  reservePickups(w)
  const claimable = livePickups(w).filter(i => !w.reservedPickups.has(i.uid))

  // Who sweeps, and in what order they get to pick.
  //
  // LOWEST STACK FIRST. The Twin Fangs boss file has said all along that "low
  // stack players soak globules", and until now that line was decoration: the
  // rota was array order, so the raider closest to dying of Eternal Venom was as
  // likely to be sent onto a globule as the one carrying none. Eating one costs
  // a stack, the stack is uncapped and lethal, and the raid loses that body and
  // its share of the next rota when somebody tips over — so the order the raid
  // picks in IS the mechanic, not flavour on top of it.
  //
  // Ties broken by who is nearest the work, then by id so a pull is
  // reproducible. On every other fight in the raid nobody carries a counter, so
  // the venom term is a constant, every sweeper ties, and this degrades to
  // "nearest first" — which is a straight improvement on array order there too.
  //
  // Then each sweeper in that order takes the nearest pickup nobody has claimed,
  // still filtered to their own side. Greedy rather than optimal, deliberately:
  // a real raid calls "closest one, go", and an assignment that minimised total
  // travel would send raiders past each other in a way no room ever looks like.
  const claimedBy = new Map<number, Instance>()
  if (claimable.length) {
    const nearestWork = new Map<number, number>()
    const sweepers = w.allies.filter(a => a.alive && a.role !== 'tank')
    for (const a of sweepers) {
      nearestWork.set(a.id, Math.min(...claimable.map(p => dist(p.pos, a.pos))))
    }
    sweepers.sort((x, y) =>
      (x.venom - y.venom) ||
      (nearestWork.get(x.id)! - nearestWork.get(y.id)!) ||
      (x.id - y.id))
    const taken = new Set<number>()
    for (const a of sweepers) {
      let best: Instance | null = null
      let bd = Infinity
      for (const p of claimable) {
        if (taken.has(p.uid)) continue
        if (p.def.side && p.def.side !== a.side) continue
        const d = dist(p.pos, a.pos)
        if (d < bd) { bd = d; best = p }
      }
      if (!best) continue
      taken.add(best.uid)
      claimedBy.set(a.id, best)
    }
  }

  // Corpse duty. While an intermission that would raise the bodies is running,
  // the raid stands on them so the flames have something to land on — all but
  // one, on the same bargain as a pickup. Nineteen raiders watching the player
  // burn a pile of corpses single-handed is not the fight.
  const unburned = w.corpses.filter(c => !c.burned)
  const claimableCorpses = activePhase(w)?.resurrectCorpsesAs
    ? unburned.slice(0, Math.max(0, unburned.length - 1))
    : []
  let corpseNext = 0

  // Anything that kills on contact, so the raid can be told to keep off it.
  const lethalFloor = w.instances.filter(i => i.def.rule.type === 'lethalGround' && i.def.shape)

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
    // On a split fight a raider stands with their OWN golem, not with the raid.
    // Half the encounter is tagged to one side or the other, and a group milling
    // about in the middle would be in range of both Marks — which is precisely
    // the mistake the fight punishes and the trainer is supposed to demonstrate.
    const own = w.boss.sided ? entityForSide(w, a.side) : undefined
    const home = own ? own.pos : anchor
    a.want.x = home.x + Math.cos(spread) * ringR
    a.want.y = home.y + Math.sin(spread) * ringR

    // On a fight with two stack groups, a raider's home is their group's mark
    // rather than a ring around the boss — and it is a STACK, not a ring. A cone
    // has to be able to take one group whole and miss the other entirely, which
    // a raid spread evenly around the room can never offer it.
    if (w.groupMarks.length && a.role !== 'tank') {
      const gm = w.groupMarks[((a.group % w.groupMarks.length) + w.groupMarks.length) % w.groupMarks.length]
      const fan = a.id * 2.39996
      const tight = 2.4 + (a.id % 4) * 1.1
      a.want.x = gm.x + Math.cos(fan) * tight
      a.want.y = gm.y + Math.sin(fan) * tight
    }

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
      a.want.x = held.station.x
      a.want.y = held.station.y
    } else if (held) {
      a.want.x = held.pos.x + Math.cos(held.angle) * 5
      a.want.y = held.pos.y + Math.sin(held.angle) * 5
      // Two stack groups turn "stand in front of him" into a decision. The cone
      // comes out of his face, his face follows his tank, so where the tank
      // stands is which group eats the Mutilate — and a group that eats two in a
      // row dies to the second Gash. The AI tank therefore holds the CALLED
      // group's bearing at all times rather than a fixed mark, which is exactly
      // the footwork a player tank has to copy, performed where they can watch
      // it happen.
      if (hasGroups(w)) {
        const st = tankStation(w, held)
        if (st) {
          a.want.x = st.x
          a.want.y = st.y
        }
      }
      // On a fight with fountains, standing in front of the boss is not enough.
      // The two nearest him are the two that drain, and a tank who holds station
      // feeds the same pair every drink and stacks its Infusion forever — the
      // one thing this fight asks a tank never to do. So the AI tank walks him
      // to the freshest pair, which is exactly the footwork a player tank has to
      // copy, performed where they can watch it.
      const mark = altarStation(w)
      if (mark) {
        a.want.x = mark.x
        a.want.y = mark.y
      }
    } else if (a.role === 'tank') {
      const p = w.bosses[0]
      a.want.x = p.pos.x - Math.cos(p.angle) * 7
      a.want.y = p.pos.y - Math.sin(p.angle) * 7
    }

    // 3. Go and eat the globule this raider was given. Tanks stay on the boss,
    //    and the assignment was made above rather than here so the whole raid's
    //    stack counts could be weighed against each other in one place.
    const sweep = claimedBy.get(a.id)
    if (sweep) {
      a.want.x = sweep.pos.x
      a.want.y = sweep.pos.y
    }

    // 3a. Stand on a corpse, if one is going unburned.
    let onCorpseDuty = false
    if (a.role !== 'tank' && corpseNext < claimableCorpses.length) {
      const c = claimableCorpses[corpseNext++]
      a.want.x = c.pos.x
      a.want.y = c.pos.y
      onCorpseDuty = true
    }

    // 3b. Soak, if a slot is going spare. Tanks stay on the boss, and nobody
    //     soaks the other group's mechanic.
    if (a.role !== 'tank') {
      for (const sk of soaks) {
        if (sk.taken >= sk.slots) continue
        if (sk.inst.def.side && sk.inst.def.side !== a.side) continue
        const pt = soakPoint(sk.inst, sk.taken, sk.slots)
        a.want.x = pt.x
        a.want.y = pt.y
        sk.taken++
        break
      }
    }

    // 3c. Demonstrate the rest of the mechanic vocabulary. A raid standing
    //     still through a knockback or a debuff teaches nothing, so each rule
    //     type gets a legible group movement you can copy.
    for (const inst of w.instances) {
      if (inst.resolved) continue
      const rt = inst.def.rule.type

      if (rt === 'carryOut') {
        // Carriers walk it out. Whoever is actually holding this one does, plus
        // a third of the raid regardless, so the "run to the edge, drop it, come
        // back" shape stays visible even when the debuff only ever lands on you.
        // If there are bodies on the floor to burn, that is where a flame is
        // supposed to go and the raid takes it there instead.
        const holding = w.carriers[inst.uid] === a.id
        if ((holding || a.id % 3 === 0) && a.role !== 'tank') {
          const pile = burnsCorpses(w, inst.def) ? unburned[a.id % Math.max(1, unburned.length)] : null
          if (pile) {
            a.want.x = pile.pos.x
            a.want.y = pile.pos.y
            onCorpseDuty = true
          } else {
            const r = Math.hypot(a.pos.x, a.pos.y) || 1
            const out = Math.min(arena * 0.82, inst.def.rule.minDistance + 6)
            a.want.x = (a.pos.x / r) * out
            a.want.y = (a.pos.y / r) * out
          }
        }
      } else if (rt === 'trail') {
        // The carrier keeps walking, so the trail they leave behind falls on
        // empty floor. A raider who stood still with one would bury the raid in
        // pools — that is the mechanic played backwards, and it is the single
        // thing worth demonstrating about it.
        if (w.carriers[inst.uid] === a.id) {
          const r = Math.hypot(a.pos.x, a.pos.y) || 1
          const out = Math.min(arena * 0.8, r + 14)
          a.want.x = (a.pos.x / r) * out + Math.cos(w.elapsedMs / 700 + a.id) * 6
          a.want.y = (a.pos.y / r) * out + Math.sin(w.elapsedMs / 700 + a.id) * 6
        }
      } else if (rt === 'survive') {
        // A knockback is coming: spread out and stand where the push carries
        // you ACROSS the platform, not off it. Everyone drifts inward first.
        const r = Math.hypot(a.pos.x, a.pos.y) || 1
        const safe = arena * 0.42
        a.want.x = (a.pos.x / r) * safe + Math.cos(a.id) * 5
        a.want.y = (a.pos.y / r) * safe + Math.sin(a.id) * 5
      } else if (rt === 'groupSoak') {
        // Mutilate. The called group walks into the cone; everybody else gets
        // well clear of it. Both halves are the mechanic — a body from the other
        // group standing in this one takes a second Gash and dies — so the raid
        // has to visibly do two different things at once, which is the only way
        // a player can read which of the two they are supposed to be doing.
        if (a.role !== 'tank') {
          if (a.group === w.calledGroup && a.gash <= 0) {
            const pt = soakPoint(inst, a.id % 9, 9)
            a.want.x = pt.x
            a.want.y = pt.y
          } else {
            // Their OWN mark, which is ninety degrees off the cone and already
            // clear of it. Sending them to the called group's mark instead —
            // the obvious "get away from the cone" — walked the whole raid into
            // one pile, so the next cast could not miss anybody and the group
            // that had just taken a Gash took a second one.
            const own = w.groupMarks[((a.group % 2) + 2) % 2]
            if (own) {
              const fan = a.id * 2.39996
              a.want.x = own.x + Math.cos(fan) * 3
              a.want.y = own.y + Math.sin(fan) * 3
            }
          }
        }
      } else if (rt === 'windPair' && a.wind) {
        // Raging Crosswinds. Two raiders thrown into each other cancel, so a
        // pair walks onto a shared axis and stops eight yards short on their own
        // side of it. Standing next to somebody is not the answer and must not
        // look like it: they line up FACING each other down the wind.
        const mate = w.allies.find(o => o.id === a.windMate && o.alive)
        const dir = COMPASS[a.wind]
        if (mate) {
          const mid = { x: (a.pos.x + mate.pos.x) / 2, y: (a.pos.y + mate.pos.y) / 2 }
          const hold = clampToArena(w.boss, mid, arena * 0.28)
          a.want.x = hold.x - dir.x * 8
          a.want.y = hold.y - dir.y * 8
        } else if (a.windMate === 0) {
          // Holding YOUR opposite. They come to your axis and stop just outside
          // the range that would cancel it, because closing the last few yards
          // themselves would answer the mechanic for you — the same bargain the
          // orb partner makes on the Coiled Altar.
          const held = clampToArena(w.boss, {
            x: w.player.pos.x + COMPASS[OPPOSITE[a.wind]].x * (WIND_REACH + 4),
            y: w.player.pos.y + COMPASS[OPPOSITE[a.wind]].y * (WIND_REACH + 4),
          }, arena * 0.12)
          a.want.x = held.x
          a.want.y = held.y
        } else {
          // An odd body out with nobody to meet. They go to the middle, so the
          // throw crosses the floor instead of leaving it — nobody in this raid
          // dies to an arithmetic leftover.
          a.want.x = -dir.x * 6
          a.want.y = -dir.y * 6
        }
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

    // 3d. Orbs. A marked raider goes looking for the body that completes their
    //     count — except the one holding YOUR complement, who comes to you and
    //     stops a yard outside collision range. They stop short on purpose:
    //     closing the last yard themselves would resolve the mechanic for you,
    //     and there is nothing to practise in a puzzle that solves itself.
    if (a.marked) {
      if (a.id === w.pairPartnerId) {
        const dx = w.player.pos.x - a.pos.x
        const dy = w.player.pos.y - a.pos.y
        const d = Math.hypot(dx, dy) || 1
        const hold = PAIR_RANGE + 1
        a.want.x = w.player.pos.x - (dx / d) * hold
        a.want.y = w.player.pos.y - (dy / d) * hold
      } else {
        const mate = w.allies.find(o =>
          o.alive && o.marked && o.id !== a.id && o.id !== w.pairPartnerId &&
          o.green + a.green === w.pairTarget)
        if (mate) {
          a.want.x = (a.pos.x + mate.pos.x) / 2
          a.want.y = (a.pos.y + mate.pos.y) / 2
        }
        // They do not steer around you. The floor is supposed to be full of
        // bodies carrying the wrong count — that is the mechanic — and the
        // player is protected by the fact that a collision only counts when
        // they walked into it, not by the raid tiptoeing around them.
      }
    }

    // 3e. The gales are not theirs. The raid is off the floor for the Maelstrom,
    //     so they simply hold their marks and walk back on when it ends — the
    //     glob is the player's to reach.
    const gale = activePhase(w)?.windToCysts
      ? w.instances.find(i => i.uid === w.galeTargetUid)
      : undefined

    // 4. Get clear of anything lethal. Highest priority, overrides the above —
    //    and checked against where they ARE as well as where they are going, so
    //    a hazard landing on a standing ally makes them move.
    //
    //    `lethalGround` is in here too. It is furniture rather than a cast, but
    //    a raider walking through the Soulcoil Well because the engine only
    //    taught them to dodge telegraphs would be a raid the player cannot
    //    learn from.
    for (const inst of w.instances) {
      if (!inst.def.shape) continue
      const rt = inst.def.rule.type
      // A tank frontal is ground to leave for everybody except the tank holding
      // the thing casting it. Ravage kills anyone else it strikes on the second
      // application, and a raid that stood in it because the engine only taught
      // them to dodge `avoid` shapes is a raid the player cannot learn from.
      if (rt === 'faceAway') {
        if (w.bosses.some(b => b.def.id === inst.fromId && b.targetId === a.id)) continue
      } else if (rt !== 'avoid' && rt !== 'lethalGround') continue
      // The cyst the gale is aimed at is the way OUT of the Maelstrom, not a
      // puddle. Fleeing it is how a raid gets blown off the far rim.
      if (gale && inst.uid === gale.uid) continue
      // A raider on corpse duty, or one with ten seconds to find a partner,
      // stands in a puddle to get the job done. Pools on these two fights never
      // expire, so bodies and partners both end up standing in them: a raid that
      // treated clean feet as the higher priority would refuse to burn a single
      // corpse and would never cross the room to pair, and both intermissions
      // would be lost to tidiness. Ground that KILLS is still absolute.
      // A raider with a wind arrow over their head is in the same position as
      // one holding orbs: they have eight seconds to be on somebody's line and
      // nothing else matters, because the alternative is the abyss. Stepping
      // around a puddle costs a few points of health; stepping off the line
      // costs the pull.
      if ((onCorpseDuty || a.marked || a.wind) && inst.resolved && inst.def.rule.type === 'avoid') continue
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
        // Standing on the origin: there is no direction to flee in, because the
        // vector out of a point you are standing on has zero length.
        //
        // This used to fall back to "away from the arena centre", which is the
        // same zero-length vector again the moment the hazard IS the centre of
        // the room — so the whole raid sat in the Soulcoil Well and stayed
        // there. Fan them out by id instead: every raider gets a different
        // bearing, and the pile disperses like a raid rather than a queue.
        const ang = a.id * 2.39996
        dx = Math.cos(ang); dy = Math.sin(ang); d = 1
      }
      const clear = (sh.kind === 'circle' ? sh.radius : sh.kind === 'cone' ? sh.radius * 0.75 : 12) + 7
      a.want.x = inst.pos.x + (dx / d) * clear
      a.want.y = inst.pos.y + (dy / d) * clear
    }

    // 5. Clean floor. If the station is now sitting in a lingering pool, walk
    //    to the nearest clear ground. This is what keeps the raid moving between
    //    mechanics: pools accumulate, so the group steadily relocates — and on
    //    the two fights whose pools never expire the floor genuinely runs out.
    let fouled = 0
    for (const inst of w.instances) {
      // A raider with orbs over their head has ten seconds to find a partner and
      // nothing else matters; clean feet are a luxury for the rest of the pull.
      if (onCorpseDuty || a.marked || a.wind || !inst.resolved || !inst.def.shape) continue
      if (!inst.def.lingerMs && !inst.def.permanent) continue
      fouled += threatAt(inst, a.want.x, a.want.y) > 0 ? 1 : 0
    }
    for (const inst of lethalFloor) fouled += threatAt(inst, a.want.x, a.want.y) > 0 ? 2 : 0
    if (fouled > 0) {
      // Sample a ring of candidate spots and take the cleanest one nearest home.
      let bestX = a.want.x, bestY = a.want.y, bestScore = Infinity
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2 + a.id
        for (const dist2 of [10, 18, 26]) {
          const cx = a.want.x + Math.cos(ang) * dist2
          const cy = a.want.y + Math.sin(ang) * dist2
          if (!inArena(w.boss, { x: cx, y: cy })) continue
          let bad = 0
          for (const inst of w.instances) {
            if (!inst.def.shape) continue
            const rt = inst.def.rule.type
            if (!inst.resolved && rt !== 'avoid' && rt !== 'lethalGround') continue
            // Ground that kills outright is never worth a shorter walk.
            if (threatAt(inst, cx, cy) > 0) bad += rt === 'lethalGround' ? 40 : inst.resolved ? 1 : 2
          }
          const score = bad * 100 + dist2
          if (score < bestScore) { bestScore = score; bestX = cx; bestY = cy }
        }
      }
      a.want.x = bestX
      a.want.y = bestY
    }

    // 6. A small idle sway so a raider at station never looks switched off.
    //    Deliberately tiny — a couple of yards, not an orbit. Not while the orbs
    //    are up: a partner holding station two yards outside collision range is
    //    the difference between a pairing and a death, and idling across that
    //    line is not a decision anybody made.
    if (!a.marked && !a.wind) {
      a.want.x += Math.sin(w.elapsedMs / 2600 + a.id * 1.7) * 1.6
      a.want.y += Math.cos(w.elapsedMs / 3100 + a.id * 2.3) * 1.6
    }

    // 6b. A tank holding an entity that must be kept apart stays near its
    //     station. Sidestepping is allowed, wandering is not — the boss walks
    //     after its tank, so two tanks fleeing the same telegraph dragged their
    //     bosses together and linked them. That reads as the raid failing a
    //     mechanic the AI is simply not careful enough to play.
    //
    //     The fountains are the same problem wearing a different hat. Where the
    //     boss stands picks which two drain, so a tank talked a few yards off
    //     their mark by every telegraph on the floor re-drains the pair they
    //     were walking away from — and the Infusion the raid then eats is the
    //     AI's dithering rather than anything a player did. Sidestep, yes;
    //     wander, no.
    //     A tank aiming a group cone is leashed for exactly the same reason,
    //     and it is the reason the pair stopped walking to the wall: the aim
    //     mark is a place in the room, and wandering off it is what turned every
    //     later Mutilate into a cone pointed at empty floor.
    const rawStation = w.bosses.find(b => b.targetId === a.id && b.def.tankedApart)?.def.start
      ?? (w.bosses[0].targetId === a.id
        ? (hasGroups(w) ? tankStation(w, w.bosses[0]) : altarStation(w))
        : null)
    // Onto the floor, always. A station is where a tank is told to stand, and an
    // entity's own position is not automatically somewhere a body can be: the
    // Twin Fangs sit in the acid off the top edge, so parking their tanks on
    // them would march both of them off the platform at the pull.
    const station = rawStation ? clampToArena(w.boss, rawStation, 2) : null
    if (station) {
      const sdx = a.want.x - station.x
      const sdy = a.want.y - station.y
      const sd = Math.hypot(sdx, sdy)
      // Tight on purpose. A boss walks to its tank, so every yard a tank
      // wanders is a yard the pair closes — at 11 the Lost Explorers' two
      // tanked council members drifted 22 yards together and sat inside
      // United Defense for the whole pull, barking PULL THEM APART forever.
      const leash = 6
      if (sd > leash) {
        a.want.x = station.x + (sdx / sd) * leash
        a.want.y = station.y + (sdy / sd) * leash
      }
    }

    // 6c. Stay inside your own bubble and outside the other one.
    //
    //     Each group has to be within its golem's range to do its job and out of
    //     the other's or it stacks both Marks. Enforced after every other
    //     preference, because a raider who chases a soak into the far bubble has
    //     answered one mechanic by failing a different one — and the split raid's
    //     characteristic mistake belongs to the player, not to the AI.
    //
    //     Suspended while the orbs are up. Stasis is the one window where the
    //     split does not apply — the golems are walking into each other in the
    //     middle and everybody has to find a partner, whichever group they came
    //     from — so a raider held in their own half could never reach yours.
    if (w.boss.sided && !a.marked) {
      const own = entityForSide(w, a.side)
      const far = entityForSide(w, a.side === 'green' ? 'red' : 'green')
      if (own) {
        const dx = a.want.x - own.pos.x
        const dy = a.want.y - own.pos.y
        const d = Math.hypot(dx, dy) || 1
        const reach = sideBubble(w) * 0.7
        if (d > reach) {
          a.want.x = own.pos.x + (dx / d) * reach
          a.want.y = own.pos.y + (dy / d) * reach
        }
      }
      if (far) {
        const dx = a.want.x - far.pos.x
        const dy = a.want.y - far.pos.y
        const d = Math.hypot(dx, dy) || 1
        const keep = sideExclusion(w) + 4
        if (d < keep) {
          a.want.x = far.pos.x + (dx / d) * keep
          a.want.y = far.pos.y + (dy / d) * keep
        }
      }
    }

    // 6d. Hold your stack.
    //
    //     Enforced after every other preference, and it has to be. A cone that
    //     needs one group whole and the other one clear only works if both are
    //     actually WHERE they are supposed to be, and every other rule in this
    //     function is happy to walk a raider twenty-six yards to find cleaner
    //     floor. Caustic Claws lands six globs around the boss, the marks sit
    //     just outside them, and the tidying pass dragged group one out to
    //     thirty-two yards — so the next Mutilate found a single body and the
    //     raid ate an unsplit hit for something nobody did.
    //
    //     A leash, not a clamp: sidestepping a vortex is still allowed, leaving
    //     the stack is not. Same shape as the tank leash above, same reason.
    if (groupsUp && a.role !== 'tank' && w.groupMarks.length) {
      const gm = w.groupMarks[((a.group % w.groupMarks.length) + w.groupMarks.length) % w.groupMarks.length]
      const dx = a.want.x - gm.x
      const dy = a.want.y - gm.y
      const d = Math.hypot(dx, dy)
      if (d > GROUP_LEASH) {
        a.want.x = gm.x + (dx / d) * GROUP_LEASH
        a.want.y = gm.y + (dy / d) * GROUP_LEASH
      }
    }

    // 7. Never walk off the platform. Asked of the floor, which on an octagon is
    //    a shorter walk on the diagonals than it is on the axes.
    //
    //    The pickup a raider was SENT to is the one exception, and it has to be.
    //    This inset is a tenth of the arena — 3.2 yards on the Twin Fangs — while
    //    a hazard is scattered onto the floor with an inset of two or three, so
    //    anything landing in the yard between them sits somewhere the ally AI is
    //    forbidden to stand. On a `collect` that is not a near miss, it is a
    //    globule nobody in the raid is allowed to sweep: it ruptures every single
    //    time, on every seed, and nothing anybody does can change it. Measured
    //    over a Caustic Deluge, one of the ten landed inside that band on three
    //    pulls in seven.
    //
    //    So a sweeper's bound relaxes to wherever their own globule is, and no
    //    further. Everyone else, and every other destination this raider might
    //    have been given since, keeps the full inset — this widens the floor for
    //    one body walking to one place, not for the raid.
    const reach = sweep ? Math.min(arena * 0.1, edgeDistance(w.boss, sweep.pos)) : arena * 0.1
    const bounded = clampToArena(w.boss, a.want, reach)
    a.want.x = bounded.x
    a.want.y = bounded.y
  }
}

function allyMove(w: World, dt: number) {
  // The raid shows up for group work. A soak, a spread, a debuff to dispel —
  // anything that needs other bodies brings them in; otherwise the floor stays
  // clear so you can actually read your own telegraphs. Tanks never leave.
  const groupWork = w.instances.some(i => !i.resolved && (
    i.def.rule.type === 'beInside' ||
    i.def.rule.type === 'carryOut' ||
    i.def.rule.type === 'pairUp' ||
    // Both of Sszorak's group mechanics, and they are the clearest case of why
    // this list exists at all. You cannot line up with a raider who is not being
    // drawn, and you cannot tell which stack group a cone is about to take if
    // neither group is on the floor.
    i.def.rule.type === 'groupSoak' ||
    i.def.rule.type === 'windPair' ||
    // A trail is one raider's job, but it is a job about everybody else: the
    // point of walking it is that the pools miss the raid, and with an empty
    // floor there is nothing for them to miss.
    i.def.rule.type === 'trail' ||
    (i.def.rule.type === 'press' && i.def.rule.ability === 'dispel')))
  // Corpse duty is group work too — a pile of bodies to burn between nineteen
  // people is the most collective thing in the raid.
  const corpseWork = !!activePhase(w)?.resurrectCorpsesAs && w.corpses.some(c => !c.burned)
  // An add that drops a pool at every body when it dies turns its death into a
  // whole-raid relocation. That only reads as one if the bodies are on the floor
  // when it happens.
  const relocateWork = w.adds.some(a => a.alive && a.def.deathSpawnsAtAllPlayers)
  // The Maelstrom is the one stretch of this fight you face alone. The raid is
  // off the floor for it — he has buried himself and the wind has the room — so
  // the glob is burst by your body or not at all. Nineteen allies riding the
  // same gale turned a solo sequence into a crowd arriving first and popping it
  // for you, which is a stage you watch rather than one you play.
  const galeSolo = !!activePhase(w)?.windToCysts
  // The two stack groups stay on the floor for the whole flurry, not only while
  // a cone happens to be in the air. Which group is carrying a Gash is a state
  // the player has to be able to read between casts — that is when the decision
  // is made — and a raid that blinked out between Mutilates would hide it.
  const groupsUp = w.groupMarks.length > 0 && w.instances.some(i =>
    !i.resolved && (i.def.rule.type === 'combo' || i.def.rule.type === 'groupSoak'))

  for (const a of w.allies) {
    if (!a.alive) { a.presence = Math.max(0, a.presence - dt * 3); continue }
    const wanted = galeSolo ? 0
      : (a.role === 'tank' || groupWork || corpseWork || relocateWork
        || groupsUp || a.wind || a.debuff || a.marked ? 1 : 0)
    // Walk on briskly, drift off gently — a raid that blinks out mid-mechanic
    // reads as a bug.
    a.presence += Math.max(-dt * 1.1, Math.min(dt * 3.4, wanted - a.presence))
    a.presence = Math.max(0, Math.min(1, a.presence))
    // Reaction time, staggered by id: a raid does not move as one object.
    // Deterministic rather than random so playtests stay reproducible.
    const lag = 0.06 + (a.id % 5) * 0.035
    const ease = Math.min(1, dt / Math.max(0.016, lag))
    const dx = a.want.x - a.pos.x
    const dy = a.want.y - a.pos.y
    const d = Math.hypot(dx, dy)
    // Deadzone: close enough is close enough, but small enough that the idle
    // sway still reads as a living raider rather than a statue.
    //
    // Measured in YARDS ON THE FLOOR, which it was not. The deadzone used to be
    // tested against the EASED delta — `(want - pos) * ease`, where `ease` is
    // between 0.083 and 0.278 depending on `id % 5` — so "0.6" actually meant
    // "between 2.2 and 7.2 yards, and a different one for every fifth raider".
    // Allies converged to somewhere in that band and then stopped dead, which is
    // invisible on a formation ring and fatal on anything you have to physically
    // arrive at: a globule is 2.6 yards across, so a sweeper sent to one from
    // more than a couple of yards away parked next to it forever and it ruptured
    // on the raid. Caustic Deluge is what exposed it — ten pickups instead of
    // three means most of them are answered by somebody walking rather than by
    // somebody already standing there, and three of the ten were missed every
    // single pull, on every seed, deterministically.
    //
    // The easing is unchanged and still does its job: `stepLen` is the eased
    // fraction, so a raider still accelerates into a move rather than snapping,
    // and `id % 5` still staggers the raid so it does not move as one object.
    // The only thing that changed is where they are allowed to stop.
    if (d > 0.6) {
      const stepLen = Math.min(d * ease, ALLY_SPEED * dt)
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
  // Every driver, not the first declared — Sszorak has two, and being told about
  // only one of them is how a tank eats the other.
  if (w.player.role === 'tank') {
    for (const swapDef of w.boss.mechanics) {
      if (swapDef.rule.type !== 'tankSwap') continue
      // The entity that casts the swap, not just whatever is listed first.
      const tank = currentTank(w, bossUnitFor(w, swapDef.from))
      if (!tank.isPlayer && tank.stacks >= swapDef.rule.maxStacks - 1) {
        // Called a stack early so you have time to react rather than being told
        // at the instant the clock starts running on a failure.
        consider({ verb: 'TAUNT', mechanic: swapDef.name, urgency: 1 }, 0)
      }
    }
  }

  // A burn window you have not spent your cooldown in.
  if (w.burnMs > 0 && !w.burnUsed && abilitiesFor(w.player.role).includes('burst')
      && !w.player.cooldowns.burst) {
    const d = w.boss.mechanics.find(m => m.id === w.burnId)
    if (d) consider({ verb: 'BURN IT', mechanic: d.name, urgency: 1 - w.burnMs / 20000 }, 0)
  }

  // Linked bosses beat everything else: at 99% damage reduction nothing you do
  // to them matters until they are pulled apart again.
  if (w.bossesLinked) {
    const d = w.boss.mechanics.find(m => m.rule.type === 'keepApart')
    if (d) consider({ verb: 'PULL THEM APART', mechanic: d.name, urgency: 1 }, 0)
  }

  // Where the boss is standing, on a fight with fountains.
  //
  // Deliberately NOT tied to a live Imbibe instance. He is rooted while he
  // drinks, so a warning that only appears during the cast is a warning about
  // something the tank can no longer change. The window to fix this is the whole
  // gap between drinks, and the urgency is how full the bar is.
  const drainDef = w.boss.mechanics.find(m => m.rule.type === 'drainNearest')
  if (drainDef && drainDef.rule.type === 'drainNearest' && w.altars.length
      && w.player.role === 'tank' && w.bosses[0].targetId === 0) {
    // Every one of them, not any of them. One repeat is forced by there being
    // three fountains and two drinks, so a prompt that fired on `some` would be
    // lit for the whole pull and would be telling the tank to fix something that
    // cannot be fixed. Both repeating means he has not moved.
    if (nearestAltars(w, drainDef.rule.count).every(a => a.drainedLast)) {
      consider({ verb: 'WALK HIM OFF', mechanic: drainDef.name, urgency: w.bossEnergy / 100 }, 1)
    }
  }

  // Adds first — a cast landing in two seconds beats any floor telegraph.
  for (const add of w.adds) {
    if (!add.alive) continue
    const d = add.def

    // One of these just died and the next must not follow it yet. The
    // instruction is the exact opposite of what every other add in this raid
    // asks for, so it outranks all of them: the reflex to burn the second one
    // down is what wipes the raid, and telling you to stop is the only warning
    // the fight gives. The clock lives on `addDeathMs`, so the HUD can count it
    // down beside this.
    if (d.noSimultaneousDeath) {
      const last = w.addDeathMs[d.id]
      if (last !== undefined && w.elapsedMs - last < d.noSimultaneousDeath.withinSec * 1000) {
        consider({ verb: 'HOLD IT — STOP DPS', mechanic: d.name, urgency: 1 }, 0)
      }
    }
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

  // Ground that kills on contact. Handled outside the instance loop below,
  // because furniture is spawned already resolved — it never has a telegraph
  // and never has a resolve moment, so the only urgency it has is proximity.
  for (const inst of w.instances) {
    if (inst.def.rule.type !== 'lethalGround' || inst.def.shape?.kind !== 'circle') continue
    const gap = dist(inst.pos, w.player.pos) - inst.def.shape.radius
    if (gap < 6) {
      consider({ verb: 'GET OFF IT', mechanic: inst.def.name, urgency: 1 - Math.max(0, gap) / 6 }, 0)
    }
  }

  // The gales. There is no telegraph to read and no shape to leave — the whole
  // instruction is a direction, and the thing at the end of it is the only way
  // out of the stage. Ranked above the floor because being blown past the glob
  // ends the pull and standing in a puddle does not.
  if (activePhase(w)?.windToCysts) {
    const target = w.instances.find(i => i.uid === w.galeTargetUid && !i.answered)
    if (w.galeImmuneMs > 0) {
      // Planted at his feet with the wind unable to move you. There is exactly
      // one thing to do with those seconds and it is not repositioning.
      const dig = w.boss.mechanics.find(m => m.rule.type === 'burnWindow')
      consider({
        verb: 'BRACED — HIT HIM',
        mechanic: dig?.name ?? 'Howling Maelstrom',
        urgency: 1 - w.galeImmuneMs / GALE_BRACE_MS,
      }, 1)
    } else if (target) {
      const gap = dist(target.pos, w.player.pos)
      consider({
        verb: 'RIDE IT INTO THE CYST',
        mechanic: target.def.name,
        urgency: Math.max(0.2, 1 - gap / Math.max(1, w.boss.arenaRadius)),
      }, 1)
    }
  }

  // Orbs beat everything: a wrong collision kills you outright, and the window
  // is the only one on the fight where standing still is also fatal.
  if (w.player.marked) {
    const pair = w.boss.mechanics.find(m => m.rule.type === 'pairUp')
    if (pair) {
      const live = w.instances.find(i => !i.resolved && i.def.rule.type === 'pairUp')
      const t = live && pair.telegraphMs > 0 ? 1 - live.timer / pair.telegraphMs : 0.5
      consider({ verb: `PAIR TO ${w.pairTarget}`, mechanic: pair.name, urgency: t }, 0)
    }
  }

  for (const inst of w.instances) {
    if (inst.resolved) continue
    const { def } = inst
    // The other group's mechanic is not your instruction. Being told to soak
    // something firing at the far side of the room is how a split raid learns
    // to answer calls that were never theirs.
    if (!onPlayersSide(w, def)) continue
    const t = def.telegraphMs > 0 ? 1 - inst.timer / def.telegraphMs : 1
    const inside = isInside(inst, w.player.pos)
    /**
     * Is this instruction for me?
     *
     * The line is between "this will hurt you" and "this is your job". Damage
     * lands on whoever is standing in it whatever the roles say, so `avoid` and
     * `survive` still warn everybody. Everything else is an assignment, and
     * handing a dps a tank's assignment is worse than silence.
     *
     * A tank-only mechanic goes further: it only speaks to the tank who is
     * actually holding the entity casting it. Possession Barrage is aimed at
     * whoever has aggro, so an off-tank being told to run out is being told to
     * solve somebody else's problem.
     */
    const mine = def.roles.includes(w.player.role)
      && (!(def.roles.length === 1 && def.roles[0] === 'tank')
        || currentTank(w, bossUnitFor(w, def.from)).isPlayer)

    switch (def.rule.type) {
      case 'press':
        if (!inst.answered && mine) {
          const verb = def.rule.ability === 'interrupt' ? 'KICK IT' : 'DISPEL'
          consider({ verb, mechanic: def.name, urgency: t }, 1)
        }
        break
      case 'beInside':
        if (!inside && mine) consider({ verb: 'GET IN', mechanic: def.name, urgency: t }, 2)
        break
      case 'collect':
        // Only prompt for the nearest one — a instruction per globule is noise.
        if (!inst.answered && mine && dist(inst.pos, w.player.pos) < 22) {
          consider({ verb: 'RUN OVER IT', mechanic: def.name, urgency: t }, 2)
        }
        break
      case 'carryOut':
        if (inst.carriedByPlayer) {
          // While the pile is up, a flame is a tool rather than a liability:
          // the intermission wants it walked onto a corpse, not to the wall.
          if (burnsCorpses(w, def) && w.corpses.some(c => !c.burned)) {
            consider({ verb: 'BURN A CORPSE', mechanic: def.name, urgency: t }, 1)
            break
          }
          const d = Math.hypot(w.player.pos.x, w.player.pos.y)
          if (d < def.rule.minDistance) {
            consider({ verb: 'RUN IT OUT', mechanic: def.name, urgency: t }, 2)
          }
        }
        break

      case 'trail':
        // There is nothing to press and nowhere to be. The whole instruction is
        // "do not stand still", so that is the whole instruction.
        if (inst.carriedByPlayer) consider({ verb: 'KEEP MOVING', mechanic: def.name, urgency: t }, 1)
        break

      case 'avoid':
        if (inside) consider({ verb: 'MOVE OUT', mechanic: def.name, urgency: t }, 3)
        break
      case 'survive':
        if (inside) consider({ verb: 'BRACE — KNOCKBACK', mechanic: def.name, urgency: t }, 4)
        break
      case 'faceAway':
        // Only your problem when you are the one holding the thing casting it —
        // unless you are standing in it, in which case it is very much your
        // problem whatever your role is. Ravage kills a second time.
        if (w.player.role === 'tank' && bossUnitFor(w, def.from).targetId === 0) {
          consider({ verb: 'POINT IT AWAY', mechanic: def.name, urgency: t }, 2)
        } else if (inside) {
          consider({
            verb: w.player.carrying[def.id] !== undefined ? 'GET OUT — IT KILLS' : 'GET OUT OF THE CONE',
            mechanic: def.name,
            urgency: t,
          }, 1)
        }
        break
      case 'aimAway':
        if (inst.carriedByPlayer) {
          // Only nags while the line is actually crossing the raid. Told to
          // "point it away" from the moment it lands, a marked player who has
          // already walked it somewhere sensible would be shouted at for doing
          // the right thing, and would learn to tune the prompt out.
          if (isInside(inst, raidAnchor(w))) {
            consider({ verb: 'POINT IT AWAY', mechanic: def.name, urgency: t }, 1)
          }
        } else if (inside) {
          consider({ verb: 'MOVE OUT', mechanic: def.name, urgency: t }, 3)
        }
        break

      case 'groupSoak': {
        const called = w.calledGroup
        if (w.player.role === 'tank' && bossUnitFor(w, def.from).targetId === 0) {
          // The tank is the only person who decides where this lands.
          consider({ verb: `AIM AT GROUP ${called === 0 ? 'A' : 'B'}`, mechanic: def.name, urgency: t }, 1)
        } else if (w.player.group === called && w.player.gash <= 0) {
          if (!inside) consider({ verb: 'GET IN — YOUR GROUP', mechanic: def.name, urgency: t }, 2)
        } else if (inside) {
          // Your group already has a Gash. A second one kills you, so being in
          // this cone is the failure — the exact inverse of the instruction the
          // other half of the raid is reading off the same telegraph.
          consider({ verb: 'GET OUT — YOU HAVE A GASH', mechanic: def.name, urgency: t }, 0)
        }
        break
      }

      case 'windPair':
        if (w.player.wind) {
          const met = w.allies.some(a =>
            a.alive && windCancels(w.player.wind!, w.player.pos, a.wind, a.pos))
          consider({
            verb: met ? `LINED UP — ${w.player.wind}` : `LINE UP — BLOWN ${w.player.wind}`,
            mechanic: def.name,
            urgency: met ? t * 0.4 : t,
          }, met ? 3 : 0)
        }
        break

      case 'combo':
        // A window marker with no shape and nothing to answer. What it is worth
        // saying is that five things are about to arrive at once.
        consider({ verb: 'BRACE — FLURRY', mechanic: def.name, urgency: t }, 5)
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
  return Math.max(1, Math.min(activeLoop(w).length, n))
}

/** How long after surfacing a fixating add starts its first cast. */
const FIXATE_FIRST_CAST_MS = 1800

/**
 * Add ids some mechanic summons, and which the trash timer must therefore skip.
 *
 * Exported so the honesty tests can assert the link both ways round: that every
 * `summons` names an add that exists, and that a summoned add is not also being
 * dealt out on the wave timer behind the summoning cast's back.
 */
export function summonedIds(boss: BossDef): Set<string> {
  const out = new Set<string>()
  for (const m of boss.mechanics) if (m.summons) out.add(m.summons.addId)
  return out
}

/**
 * Which raider an add fixates on.
 *
 * "Three random non-tank players" — with two constraints the word "random" does
 * not carry on its own. The three spawns must hold three DIFFERENT raiders, so
 * whoever a sibling already took is off the table; and the player is taken
 * first whenever they are eligible, because this is a trainer and watching an
 * ally kite a line teaches nothing. A tank is never eligible: they are welded to
 * a serpent 19 yards away, and a fixate would ask them to choose between their
 * boss and the mechanic, which the real fight never does.
 *
 * Returns -1 for the player, an `Ally.id`, or -2 when there is nobody left.
 */
function pickFixate(w: World, self: Add): number {
  const taken = new Set(w.adds.filter(a => a.alive && a !== self).map(a => a.fixate))
  if (w.player.alive && w.player.role !== 'tank' && !taken.has(-1)) return -1
  const pool = w.allies.filter(a => a.alive && a.role !== 'tank' && !taken.has(a.id))
  if (!pool.length) return -2
  return pool[Math.floor(rnd() * pool.length)].id
}

/** Where a fixate target is standing right now, or null if they are gone. */
function fixatePos(w: World, id: number): Vec | null {
  if (id === -1) return w.player.alive ? w.player.pos : null
  const a = w.allies.find(x => x.id === id && x.alive)
  return a ? a.pos : null
}

/**
 * Fire an add's fixated cast: anchored on the add, aimed through its target.
 *
 * The instance keeps `aimedAt`, so the line goes on tracking that raider for the
 * whole telegraph. That is the mechanic — the marked player re-points it by
 * walking — and it is why this cannot go through the ordinary `origin` path,
 * which would either glue the shape to the boss or roll a random bearing.
 */
function fireFixated(w: World, add: Add, defId: string) {
  const def = w.boss.mechanics.find(m => m.id === defId)
  if (!def) return
  const tgt = fixatePos(w, add.fixate)
  if (!tgt) return
  const ang = Math.atan2(tgt.y - add.pos.y, tgt.x - add.pos.x)
  spawn(w, def, { ...add.pos }, ang)
  const inst = w.instances[w.instances.length - 1]
  if (!inst) return
  inst.aimedAt = add.fixate
  // The marked player owns this line whoever else is standing in it.
  inst.carriedByPlayer = add.fixate === -1
  // And the line belongs to THIS add, so it can die with it. `spawn` sets
  // `fromId` off the def's owning entity, which for Corrosive Spit is Vexhul —
  // nineteen yards away, still alive, and no help at all in answering "did the
  // thing that cast this survive long enough to fire it".
  inst.castByAddUid = add.uid
}

/**
 * Spawn a wave of one add type.
 *
 * `count` overrides the def's own, for a stage that summons a set piece: the two
 * Echoes arrive at opposite ends of the room because there are two of them and
 * the fan below is a full circle, not because anything hard-codes "opposite".
 *
 * `empower` is an Infusion multiplier and `at` a spawn point, both for the
 * fountains: a venom dragged out of a fountain that was drained last time too is
 * a tougher venom, and it comes out of the fountain rather than off the rim.
 * Both default to the old behaviour, so every other fight spawns as it did.
 */
function spawnAdds(w: World, def: AddDef, count = def.count, empower = 1, at?: Vec) {
  const r = def.spawnRadius ?? w.boss.arenaRadius * 0.72
  // An add with a home comes out of it every time. The Spawn of Vexhul surface
  // in the venom pocket at the mouth of the platform, and that fixed point is
  // half of what makes the frontals readable: the raid knows where every line
  // will start before a single one is cast.
  at = at ?? def.spawnAt
  // An add that walks at the middle starts at the wall, so the raid has the
  // whole room to stop it in.
  const ph = activePhase(w)
  if (ph?.endsWhenAddsDead === def.id) w.phaseAddsSpawned = true
  for (let i = 0; i < count; i++) {
    // Fanned around the rim so a wave arrives from several sides at once and
    // has to be prioritised rather than cleaved down in one spot. A wave with a
    // spawn point of its own fans around THAT instead, tightly, so a pair out of
    // one fountain reads as two bodies rather than one.
    const a = at ? (i / Math.max(1, count)) * Math.PI * 2 : (w.addWave * 1.7) + (i / count) * Math.PI * 2
    // Summoned beside a named golem, dropped at an explicit point, or scattered
    // on a ring around the room. Venom Coagulation is Breath's, and a generic
    // ring could put it in the red half — a job handed to the people who are
    // specifically not allowed to walk over and do it.
    const host = def.spawnAtEntity
      ? w.bosses.find(b => b.def.id === def.spawnAtEntity)
      : undefined
    const pos = at
      ? { x: at.x + Math.cos(a) * 3.5, y: at.y + Math.sin(a) * 3.5 }
      : host
        ? { x: host.pos.x + Math.cos(a) * 9, y: host.pos.y + Math.sin(a) * 9 }
        : { x: Math.cos(a) * r, y: Math.sin(a) * r }
    w.adds.push({
      uid: w.nextUid++,
      def,
      // Clamped to the floor rather than to a radius: on the octagon a spawn
      // ring drawn as a circle would put half a wave outside the room.
      //
      // An add with a `spawnAt` is NOT clamped. The Spawn of Vexhul surface in
      // the venom pocket, which is a bite taken out of the platform rather than
      // part of it — clamping would shove all three up onto the floor the raid
      // is standing on, and the pocket would stop being a place you cannot go.
      // A stated spawn point is a fact about the fight; the clamp exists to stop
      // a generic ring falling off an octagon.
      pos: def.spawnAt ? pos : clampToArena(w.boss, pos, 1),
      hp: Math.max(1, Math.round(def.hp * empower)),
      shield: Math.round((def.shieldHp ?? 0) * empower),
      fuse: def.fuseSec * 1000,
      // A fixating add winds up its first cast almost immediately — the beat is
      // there to let you find the marker on yourself, not to give you a free
      // one. Everything after it comes on the def's own cycle.
      castMs: def.casts ? FIXATE_FIRST_CAST_MS : -1,
      kicked: false,
      alive: true,
      fixate: -2,
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
    w.announceAdd = def
  }
}

/**
 * Take an add off the field, leaving a body if it leaves one.
 *
 * A corpse is only left by an add that DIED. One that got where it was going did
 * not die, it arrived — and the intermission's pile is a record of the adds the
 * raid stopped, which is the whole reason looking at it tells you anything.
 */
function killAdd(w: World, add: Add, credited: boolean) {
  add.alive = false
  if (credited) w.addsKilled++
  if (add.def.leavesCorpse) {
    w.corpses.push({
      uid: w.nextUid++, addId: add.def.id, pos: { ...add.pos }, burned: false, burnedAtMs: 0,
    })
  }

  // Two of these dying together wipes the raid.
  //
  // The Burning Venom pair: each one erupts as it dies and the raid cannot eat
  // two eruptions at once, so "kill it fast" — the reflex every other add in
  // this raid rewards — is precisely the wrong answer, and the trainer has to
  // punish the reflex or it is teaching the habit that wipes the pull.
  //
  // Only deaths count, never leaks. An add that reached the Cavity has already
  // been paid for as a leak, and charging the raid twice for one mistake would
  // put a wipe in the debrief with nothing anybody could have done about it.
  const sync = add.def.noSimultaneousDeath
  if (sync) {
    const last = w.addDeathMs[add.def.id]
    if (last !== undefined && w.elapsedMs - last < sync.withinSec * 1000) {
      recordAddFailure(w, add.def)
      w.raidHealth = 0
      w.shake = 1
      killPlayer(w, `${add.def.name} — two died within ${sync.withinSec}s`)
    }
    w.addDeathMs[add.def.id] = w.elapsedMs
  }

  // It splits, and the pieces keep walking. Killing a Clotting Venom early and
  // FAR from the pool is what matters, not killing it quickly — the splits
  // inherit the march, so a clot killed on the doorstep is two clots on the
  // doorstep.
  const sp = add.def.splits
  if (sp) {
    // An add that split into itself would double on every death until the field
    // was nothing else. Refused rather than trusted: a boss file typo should not
    // be able to end a pull with an unreadable swarm.
    const into = sp.intoId === add.def.id ? undefined : w.boss.adds?.find(x => x.id === sp.intoId)
    if (into) spawnAdds(w, into, sp.count, 1, add.pos)
  }

  // It drops a pool at EVERY body rather than where it fell. One add dying is
  // then a whole-raid relocation, which is a completely different demand from
  // "dodge the puddle where it died" and the reason the purple side feels like
  // chaos rather than like a dps check.
  if (add.def.deathSpawnsAtAllPlayers) {
    const child = w.boss.mechanics.find(m => m.id === add.def.deathSpawnsAtAllPlayers)
    if (child) {
      spawn(w, child, { ...w.player.pos })
      for (const a of w.allies) if (a.alive) spawn(w, child, { ...a.pos })
    }
  }
}

/**
 * An add got where it was going. What that costs, in one place, because a leak
 * means the same thing whether the add walked there or its fuse ran out.
 */
function addLeaked(w: World, d: AddDef) {
  w.addsLeaked++
  recordAddFailure(w, d)
  if (d.lethal) killPlayer(w, d.name)
  else w.raidHealth -= ADD_LEAK_COST
  // Every spirit that reaches the water is five more energy on her bar. This is
  // why the bar reads backwards as a history of the pull: nothing on it happened
  // because time passed.
  if (d.leakEnergy) w.bossEnergy = Math.min(100, w.bossEnergy + d.leakEnergy)
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
    if (d.auraDps) w.raidHealth -= (d.auraDps / 100) * dt * (1 + 0.2 * (w.adds.length - 1))

    // Anything with a march walks at the middle of the room, whatever its job
    // is. Marching used to be an `intercept` privilege, which made "all the
    // venoms are walking at the Cavity and one arriving is what wipes you" —
    // the whole shape of Vashnik — impossible to express for an add you are
    // supposed to shoot rather than body-block.
    if (d.marchSpeed) {
      const len = lenOf(add.pos) || 1
      add.pos.x -= (add.pos.x / len) * d.marchSpeed * dt
      add.pos.y -= (add.pos.y / len) * d.marchSpeed * dt
      // Standing in its path stops an `intercept` add; killing it is not the job
      // and for some of these is not even possible. A venom is not stopped by a
      // body — it is stopped by being killed, and walking into one does nothing.
      if (d.job === 'intercept' && dist(add.pos, w.player.pos) < 3.5) {
        killAdd(w, add, true)
        continue
      }
      if (lenOf(add.pos) < 4) {
        // It reached the Well. No corpse — it went into the water.
        add.alive = false
        addLeaked(w, d)
        continue
      }
    }

    // A fixating add locks onto a raider and spits at them until it dies.
    //
    // Retargeted only when its mark is gone — a fixate that re-rolled every
    // cast would be three lines wandering the raid at random, and the reason
    // the mechanic is survivable at all is that each marked player knows the
    // line is theirs and stays responsible for it.
    if (d.casts) {
      if (add.fixate === -2 || !fixatePos(w, add.fixate)) add.fixate = pickFixate(w, add)
      if (add.fixate !== -2) {
        add.castMs -= dtMs
        if (add.castMs <= 0) {
          fireFixated(w, add, d.casts.defId)
          add.castMs = d.casts.everySec * 1000
        }
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
      // Only a `kill` add running its fuse out is a failure — that is the add
      // getting where it was going. The rest simply despawn.
      if (d.job === 'kill') addLeaked(w, d)
    }
  }
  w.adds = w.adds.filter(a => a.alive)

  // ── the wave scheduler ──
  //
  // It stands down during a set-piece stage — one that brings its own adds. An
  // intermission you are meant to burn down two Echoes in is not the moment for
  // the next wave of trash to arrive on top of it.
  // Stated, not inferred. "Does this stage bring its own adds" was a decent
  // proxy right up against an intermission that brings none: Vitriolic Stasis is
  // the orb game and nothing else, and the timer kept delivering Venom
  // Coagulations into the middle of it because the stage declared no `onEnter`.
  const ph = activePhase(w)
  const setPiece = (ph?.onEnter?.length ?? 0) > 0 || (ph?.suppressAddWaves ?? false)
  if (w.boss.adds?.length && !setPiece) {
    w.addTimerMs += dtMs
    const every = (w.boss.addEverySec ?? 22) * 1000
    // Set-piece adds are never dealt out as trash. The Echoes of Jawae belong to
    // the intermission; cycling them into the Stage One rotation gave the fight
    // two enormous tanked adds it was never supposed to have.
    // Summoned adds are never dealt out as trash either. The Spawn of Vexhul
    // arrive because Venomous Emergence was cast, and a wave timer handing out
    // three more would put fixate frontals on the raid with no cast to read
    // them off. Derived from the mechanic list rather than flagged on the add,
    // so wiring up a summon cannot forget to switch the wave off.
    const list = w.boss.adds.filter(a => !a.phaseOnly && !summonedIds(w.boss).has(a.id))
    // Never more than a handful on the field. A wave landing on top of a wave
    // you have not cleared is a wipe you cannot play out of, and it teaches
    // nothing except that the trainer is unfair.
    if (list.length && w.addTimerMs >= every
        && w.adds.length < (w.boss.maxAdds ?? MAX_CONCURRENT_ADDS)) {
      w.addTimerMs = 0
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
  const period = activeInterval(w) * 1000
  const untilNext = period - w.loopTimerMs
  const live = unlockedCount(w)
  const loop = activeLoop(w)
  // Walk further than `count` so the strip still fills up when most of the loop
  // belongs to somebody else — a green-side healer's next three are three of
  // their own, not "red mechanic, red mechanic, red mechanic".
  for (let i = 0; i < live * 2 && out.length < count; i++) {
    const id = loop[(w.loopIndex + i) % live]
    const def = w.boss.mechanics.find(m => m.id === id)
    if (def && def_scored(w, def)) {
      out.push({ name: def.name, inSec: (untilNext + i * period) / 1000 })
    }
  }
  return out
}

/**
 * The nearest spot that is not a hole in the floor.
 *
 * Used for the opening position and for a drill respawn. Being put back on your
 * feet inside the Soulcoil Well, dying instantly, and being put back there again
 * is a loop, not a lesson.
 */
function safeSpot(w: World, from: Vec): Vec {
  let p = { ...from }
  for (const inst of w.instances) {
    if (inst.def.rule.type !== 'lethalGround' || inst.def.shape?.kind !== 'circle') continue
    const d = dist(inst.pos, p)
    const need = inst.def.shape.radius + 6
    if (d >= need) continue
    const ang = d < 0.5 ? Math.PI / 2 : Math.atan2(p.y - inst.pos.y, p.x - inst.pos.x)
    p = { x: inst.pos.x + Math.cos(ang) * need, y: inst.pos.y + Math.sin(ang) * need }
  }
  return clampToArena(w.boss, p, 2)
}

/** Put one add back on its feet where its corpse was lying. */
function raiseAdd(w: World, def: AddDef, at: Vec) {
  w.adds.push({
    uid: w.nextUid++,
    def,
    pos: { ...at },
    hp: def.hp,
    shield: def.shieldHp ?? 0,
    fuse: def.fuseSec * 1000,
    castMs: def.casts ? FIXATE_FIRST_CAST_MS : -1,
    kicked: false,
    alive: true,
    // One that got back up picks a fresh mark. It is a new body as far as the
    // raid is concerned, and inheriting a corpse's target would silently hand
    // it to whoever the dead one happened to be chasing.
    fixate: -2,
  })
}

/** Begin a stage: banner, rotation from the top, and whatever it summons. */
function enterPhase(w: World, index: number) {
  const list = w.boss.phases
  if (!list?.length) return
  const i = ((index % list.length) + list.length) % list.length
  const ph = list[i]
  w.phaseIndex = i
  w.phaseMax = Math.max(w.phaseMax, i)
  w.phaseBanner = { text: ph.banner, atMs: w.elapsedMs }
  w.phaseElapsedMs = 0
  // A stage runs its own rotation from the top rather than continuing the
  // previous one. It is a different fight, not a bookmark.
  w.loopIndex = 0
  w.loopTimerMs = 0
  w.entityReduction = ph.entitiesReduction ?? 0
  w.phaseAddsSpawned = false
  w.pairFired = false
  // "The most actionable number on the fight" is read on the way IN, because on
  // the way out the intermission has already erased it.
  if (ph.levelEntitiesOnExit) {
    const live = w.bosses.filter(b => !b.def.untargetable)
    if (live.length > 1) {
      const hi = Math.max(...live.map(b => b.hp))
      const lo = Math.min(...live.map(b => b.hp))
      w.entityDelta = Math.max(w.entityDelta, hi - lo)
    }
  }
  for (const s of ph.onEnter ?? []) {
    const def = w.boss.adds?.find(a => a.id === s.addId)
    if (def) {
      spawnAdds(w, def, s.count)
      w.phaseAddsSpawned = true
    }
  }
  if (ph.opensWith) fire(w, ph.opensWith)
  if (ph.windToCysts) {
    w.cystsBurst = 0
    w.galeTargetUid = -1
    w.galeImmuneMs = 0
    // The Maelstrom guarantees its own cysts.
    //
    // Two gales need two globs to blow the raid into, and a raid that walked
    // through one during the last rotation would otherwise arrive at a wind with
    // nothing at the end of it — a wipe caused sixty seconds earlier by a
    // mistake the debrief has no way to attribute. So whatever the rotation left
    // on the floor is used, and anything missing is made up on a free compass
    // point. Where the raid actually dropped them still decides which quarters
    // the winds come from, which is the part worth practising.
    const cystDef = w.boss.mechanics.find(m => m.raidKnockRoom)
    if (cystDef) {
      // EXACTLY two, on two different quarters of the room.
      //
      // Two because the stage is two gales, and different quarters because the
      // second gale is supposed to be a reversal — a wind that turns eleven
      // degrees is not something anybody needs to react to. A rotation that
      // dropped three globs, or two on the same mark, gave a Maelstrom that
      // either ran an extra beat nobody expected or blew the same way twice.
      const keep: Instance[] = []
      const used = new Set<Compass>()
      for (const i of liveCysts(w)) {
        const c = clockOf(i.pos)
        if (keep.length >= 2 || used.has(c)) { i.answered = true; i.timer = 0; continue }
        used.add(c)
        keep.push(i)
      }
      while (keep.length < 2) {
        // Opposite whatever is already down, so the wind genuinely reverses.
        const want = keep.length ? OPPOSITE[clockOf(keep[0].pos)] : 'S'
        const c = used.has(want) ? (CLOCK.find(x => !used.has(x)) ?? want) : want
        used.add(c)
        spawn(w, cystDef, clockPoint(w.boss, c))
        keep.push(w.instances[w.instances.length - 1])
      }
    }
  }
}

/** Has this stage done what it was waiting for? */
function phaseComplete(w: World, ph: PhaseDef): boolean {
  if (ph.endsAtBossHp !== undefined && w.bossHp <= ph.endsAtBossHp) return true
  if (ph.endsAtFullEnergy && w.bossEnergy >= 100) return true
  if (ph.endsWhenAddsDead && w.phaseAddsSpawned
      && !w.adds.some(a => a.alive && a.def.id === ph.endsWhenAddsDead)) return true
  // "The intermission ends once everyone has paired." No field says so because
  // the mechanic already does: nobody still marked, and nothing left in the air.
  const pairs = ph.loop.some(id =>
    w.boss.mechanics.find(m => m.id === id)?.rule.type === 'pairUp')
  if (pairs && w.pairFired && !w.player.marked
      && !w.allies.some(a => a.alive && a.marked)
      && !w.instances.some(i => !i.resolved && i.def.rule.type === 'pairUp')) return true
  // "The intermission ends once both cysts have knocked the raid back into him."
  // Same shape as the pairing exit above and for the same reason: no field is
  // needed because the mechanic already says so. Every glob on the floor has
  // burst, and entering the stage guaranteed there were two.
  // ...and only once the last brace has run out, so the stage ends on the beat
  // the fight gives you at his feet rather than the instant the glob pops.
  if (ph.windToCysts) return w.cystsBurst > 0 && liveCysts(w).length === 0 && w.galeImmuneMs <= 0
  return false
}

/**
 * The two tanks trade entities.
 *
 * Group assignments do not change, so each golem goes back to its own side and
 * the tank now holding it follows it there — which is why the entities are put
 * back on their stations rather than left in the middle where they met.
 *
 * Lifted out of `exitPhase` because the trade is not really a property of a
 * stage ending. On the Sentinels it happens to be, because Vitriolic Stasis is
 * where the swap is called; on the Twin Fangs the swap is the reward for a
 * clean set of Stone Breaker soaks and fires in the middle of a rotation, with
 * no stage boundary anywhere near it. One trade, two triggers.
 */
function tradeTanks(w: World) {
  const held = w.bosses.filter(b => b.targetId !== -1)
  if (held.length !== 2) return
  const t = held[0].targetId
  held[0].targetId = held[1].targetId
  held[1].targetId = t
  // The stations trade too, so each golem's home is now its NEW tank's end
  // of the room. "The tanks swap bosses and drag them over to their side" —
  // the tanks do not cross, the golems do, and each group follows its own
  // golem to the far end. Swapping the holders but leaving the stations put
  // every golem on the opposite side from the tank holding it: the golem
  // walked toward its tank, the tank walked toward the old station, and the
  // pair met in the middle and stayed linked for the rest of the pull.
  const s = held[0].station
  held[0].station = held[1].station
  held[1].station = s
  // A tank's side follows the golem they now hold.
  //
  // Without this a tank holds one golem while their group parks at the
  // other, so the side-parking pass drags them back toward their group and
  // the golem they are holding comes with them. Both tanks did that at once
  // and the pair settled 28 yards apart, linked, with neither tank able to
  // pull out — they were each obeying two instructions that pointed in
  // opposite directions.
  for (const b of held) {
    if (b.targetId <= 0 || !b.def.side) continue
    const holder = w.allies.find(a => a.id === b.targetId)
    if (holder) holder.side = b.def.side
  }
  // And the player keeps their own group's golem regardless — their side is
  // a choice they made before the pull, not something a swap takes off them.
  //
  // READ THIS BEFORE CALLING `tradeTanks` FROM A FIGHT THAT IS NOT `sided`.
  // On a sided fight this line re-asserts a CHOICE — the player's side — and
  // the golem it hands them is the one that just came to their side, so the
  // trade stands. With no side to match on, `seatPlayerTank` seats the player
  // on `bosses[0]` instead, which is precisely the entity the trade just took
  // off them: it hands it straight back and gives the displaced ally the other
  // one, and the swap is undone in the same tick it happened. A mid-fight tank
  // swap on an unsided fight has to suppress this or re-seat around it.
  seatPlayerTank(w)
  // Deliberately NOT teleported. They are dragged, and the dragging is the
  // mechanic — a grace window covers the seconds it takes so nobody is scored
  // for a separation the fight itself just closed.
}

/** Wind a stage up and hand the fight to the next one. */
function exitPhase(w: World, ph: PhaseDef) {
  if (ph.endsAtFullEnergy) w.bossEnergy = 0
  // The gale is over. Left set, a stale uid told the raid AI and the balance
  // harness that some instance was still the thing to run at for the rest of the
  // pull — and once that uid was reused by a later hazard, they ran at that.
  if (ph.windToCysts) w.galeTargetUid = -1
  if (ph.levelEntitiesOnExit) {
    // The weaker one is healed up to match the healthier. Uneven damage is a
    // reset rather than a meter problem, and this is the moment it is thrown
    // away — `entityDelta` recorded how much.
    const live = w.bosses.filter(b => !b.def.untargetable && b.alive)
    if (live.length > 1) {
      const hi = Math.max(...live.map(b => b.hp))
      for (const b of live) b.hp = hi
    }
  }
  if (ph.swapEntitiesOnExit) tradeTanks(w)
  if (ph.resurrectCorpsesAs) {
    const def = w.boss.adds?.find(a => a.id === ph.resurrectCorpsesAs)
    for (const c of w.corpses) {
      if (c.burned) continue
      w.resurrected++
      if (def) raiseAdd(w, def, c.pos)
    }
    // The ones that stood up are adds again; the burned ones stay on the floor
    // as evidence that somebody did their job.
    w.corpses = w.corpses.filter(c => c.burned)
    if (w.resurrected > 0) w.shake = 1
  }
  enterPhase(w, w.phaseIndex + 1)
}

/** One fixed timestep. dtMs is always TICK_MS. */
export function step(w: World, input: Input, dtMs: number) {
  // Drill mode: a death is a rep, not the end of the session. You see what
  // killed you, you get put back on your feet, and you go again — which is the
  // entire reason drill mode exists.
  if (w.drillId && !w.player.alive) {
    w.player.alive = true
    w.player.health = 1
    w.player.pos = safeSpot(w, { x: 0, y: 12 })
    w.player.marked = false
    // A drill rep is a fresh pull of one mechanic, so the counter starts over
    // with you. Left standing, a drill on anything that `applies` a stack would
    // hand you your twenty reps and kill you on rep ten with a death the drill
    // itself caused — and then do it again, faster, forever.
    w.player.venom = 0
    w.venomFlash = null
    w.deathCause = null
    w.raidHealth = Math.max(w.raidHealth, 0.7)
  }
  if (!w.player.alive) return
  w.announce = null
  w.announceAdd = null
  w.elapsedMs += dtMs
  w.phaseElapsedMs += dtMs
  const dt = dtMs / 1000

  // The pull opens. Furniture goes on the floor and the first stage begins.
  //
  // Deliberately on the first tick rather than in createWorld: an announcement
  // made before the first step is cleared by the line above without ever being
  // shown, and a well that kills on contact is precisely the thing a player has
  // to be told about before they walk into it.
  if (w.elapsedMs === dtMs) {
    for (const def of w.boss.mechanics) if (def.fixture) spawn(w, def)
    if (w.boss.phases?.length) enterPhase(w, 0)
    w.player.pos = safeSpot(w, w.player.pos)
  }
  const phase = activePhase(w)

  // ── movement ──
  let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  let my = (input.down ? 1 : 0) - (input.up ? 1 : 0)
  if (mx || my) {
    const m = Math.hypot(mx, my)
    mx /= m; my /= m
    // Airborne from a knockback: you drift, you do not steer. This is what
    // makes Sszorak's wind dangerous rather than an inconvenience.
    //
    // The Tempest slow is on top of that, and the tactic file says exactly why
    // it matters: "the slow is the lethal part, because it strands you in the
    // wind". A vortex costs you almost nothing in damage and nearly everything
    // in the next mechanic.
    const slowed = w.player.slowMs > 0 ? 0.7 : 1
    const speed = (w.player.aloft > 0 ? PLAYER_SPEED * 0.25 : PLAYER_SPEED) * slowed
    w.player.pos.x += mx * speed * dt
    w.player.pos.y += my * speed * dt
  }
  if (w.player.aloft > 0) w.player.aloft -= dtMs

  // Being thrown. Applied after your own input rather than instead of it, so a
  // player mid-flight can still lean — you have no real say in where you land,
  // which is the point, but a knock that froze the controls outright would feel
  // like the game had stopped rather than like the room had thrown you.
  const knock = w.player.knock
  if (knock) {
    const use = Math.min(dtMs, knock.ms) / 1000
    const to = { x: w.player.pos.x + knock.vx * use, y: w.player.pos.y + knock.vy * use }
    // A safe knock is one the fight is using to RESCUE you — the cyst burst that
    // ends a gale — so it stops at the rim instead of finishing what the wind
    // started.
    const landed = knock.safe ? clampToArena(w.boss, to, 2) : to
    w.player.pos.x = landed.x
    w.player.pos.y = landed.y
    knock.ms -= dtMs
    if (knock.ms <= 0) w.player.knock = null
  }

  // Falling off the platform. On Sszorak this is the single biggest killer in
  // the real logs, so it is a hard fail rather than a soft push-back. Asked of
  // the floor rather than of a radius: on the Sentinels' octagon the diagonals
  // genuinely end sooner than the axes, which is what the measured corner/axis
  // ratio of 0.89 was telling us all along.
  //
  // "Off the floor" is one test and it covers two ways to go: over an outer
  // edge, or into a bite taken out of the middle of one. The Twin Fangs' venom
  // pocket is the second kind and it kills exactly like the rim does — there is
  // no shallow end, and a raider who walks into the pocket chasing a globule is
  // as dead as one blown off the mouth of the platform.
  if (!inArena(w.boss, w.player.pos)) {
    w.player.alive = false
    w.player.health = 0
    w.deathCause = w.boss.acid ? 'Fell into the acid' : 'Fell off the platform'
    recordFailure(w, {
      id: 'falling', name: 'Falling', spellId: 3, roles: [w.player.role],
      telegraphMs: 0, origin: 'random', rule: { type: 'avoid' },
      good: 'Move with the wind and never let it carry you past the edge.',
      failText: 'Blown off the platform',
    })
    return
  }

  // Ground that kills on contact. Checked every tick, because it is a hole in
  // the floor rather than a cast: there is no telegraph to read and no resolve
  // moment to judge, and modelling it as damage you could heal through taught
  // the exact opposite of what the fight asks — "zero contact events all pull".
  for (const inst of w.instances) {
    if (inst.def.rule.type !== 'lethalGround') continue
    if (!isInside(inst, w.player.pos)) continue
    if (def_scored(w, inst.def) && !inst.def.collective) recordFailure(w, inst.def)
    killPlayer(w, inst.def.name)
    return
  }

  // ── the flurry, the groups and the gales ──
  //
  // Everything Sszorak needs that is not a resolve moment. A boss declaring none
  // of these mechanics never touches any of it.

  // Mutilated Gash runs down on its own, and which group is still carrying one
  // is what decides where the next Mutilate has to go. So the clock is not
  // bookkeeping — it IS the rota.
  if (w.player.gashMs > 0) {
    w.player.gashMs -= dtMs
    if (w.player.gashMs <= 0) { w.player.gash = 0; w.player.gashMs = 0 }
  }
  if (w.player.slowMs > 0) w.player.slowMs -= dtMs
  for (const a of w.allies) {
    if (a.gashMs <= 0) continue
    a.gashMs -= dtMs
    if (a.gashMs <= 0) { a.gash = 0; a.gashMs = 0 }
  }
  for (let g = 0; g < w.groupGashMs.length; g++) {
    if (w.groupGashMs[g] > 0) w.groupGashMs[g] = Math.max(0, w.groupGashMs[g] - dtMs)
  }
  if (hasGroups(w)) {
    // Recomputed only when the mark it is standing on has actually been fouled.
    // Re-derived every tick instead, the two marks twitched a yard here and
    // there as pools landed and expired, and twenty raiders plus a tank spent
    // the fight chasing a target that would not hold still — the stacks never
    // settled, and the cone found whoever happened to be mid-stride.
    w.groupMarks = [baseMark(0), baseMark(1)]
    // Whichever group is clean. Never a free choice while one of them is still
    // carrying a Gash, which is the entire mechanic — the cone has to find the
    // crowd the last one missed. With both clean it simply stays where it was,
    // so the rota reads as alternating rather than as a coin flip.
    w.calledGroup = w.groupGashMs[0] > 0 ? 1 : w.groupGashMs[1] > 0 ? 0 : w.calledGroup
  }

  // The gales. A wind pushes the whole raid at one cyst at a time; reaching it
  // bursts it, and the burst throws everybody back toward the middle — which is
  // the only way across this stage and the reason the cysts had to land on a
  // compass point in the first place.
  // The Maelstrom is the one stretch of this fight you face alone. The raid is
  // off the floor for it — see allyMove — so the glob is burst by YOUR body or
  // not at all, and the whole sequence is a solo one: blown into a cyst, thrown
  // back at him, planted at his feet while the wind screams past, then it turns
  // and does it again from the other side.
  if (phase?.windToCysts) {
    if (w.galeImmuneMs > 0) {
      w.galeImmuneMs -= dtMs
      if (w.galeImmuneMs <= 0) {
        w.galeImmuneMs = 0
        // The wind turns. Whatever glob is left is where it turns to; when
        // there is none left, the stage is over and phaseComplete says so.
        const next = liveCysts(w)[0]
        w.galeTargetUid = next ? next.uid : -1
      }
    } else {
      const held = w.instances.find(i => i.uid === w.galeTargetUid && !i.answered)
      const target = held ?? liveCysts(w)[0]
      w.galeTargetUid = target ? target.uid : -1
      if (target) {
        const len = Math.hypot(target.pos.x, target.pos.y) || 1
        w.galeDir = { x: target.pos.x / len, y: target.pos.y / len }
        const carry = GALE_SPEED * dt
        w.player.pos.x += w.galeDir.x * carry
        w.player.pos.y += w.galeDir.y * carry
        const reach = (target.def.shape?.kind === 'circle' ? target.def.shape.radius : 4) + 2.5
        if (dist(target.pos, w.player.pos) <= reach) {
          burstCyst(w, target, true)
          w.galeImmuneMs = GALE_BRACE_MS
        }
      }
    }
  }

  // ── the orbs ──
  // Collision is only tested while YOU are moving, and only against a body in
  // front of you. You walk into a partner; a partner does not walk into you.
  // Without that, an ally crossing the room could kill a stationary player with
  // a count they never chose, and the mechanic the tactic file calls "the one
  // that ends pulls" would end them for something nobody did.
  if (w.player.marked) {
    w.pairMs += dtMs
    // Keep exactly one valid partner on the floor for you.
    //
    // The reserved one can die — the raid takes damage during this window like
    // any other — and a puzzle whose only right answer just got healed through
    // the floor is not a puzzle you failed. So the raid rearranges: somebody
    // still marked takes the count that completes yours.
    const held = w.allies.find(a => a.id === w.pairPartnerId && a.alive && a.marked)
    if (!held) {
      const spare = w.allies.find(a =>
        a.alive && a.marked && a.green + w.player.green === w.pairTarget)
        ?? w.allies.find(a => a.alive && a.marked)
        // Nobody left holding orbs at all: somebody who has already paired
        // takes another set rather than leaving you with no answer on the floor.
        ?? w.allies.find(a => a.alive)
      if (spare) {
        spare.marked = true
        spare.green = w.pairTarget - w.player.green
        w.pairPartnerId = spare.id
      }
    }
    const pairDef = w.boss.mechanics.find(m => m.rule.type === 'pairUp')
    if (pairDef && (mx || my) && w.pairMs > PAIR_ARM_MS) {
      // The nearest marked body you are actually running AT. Both halves matter:
      // nearest, so you collide with the one you reached rather than the first
      // in a list; and in front of you, so a raider who wanders into your back
      // while you stand still can never be the one who kills you. Colliding is
      // something you do, not something that happens to you.
      let hit: Ally | null = null
      let hd = PAIR_RANGE
      for (const a of w.allies) {
        if (!a.alive || !a.marked) continue
        const d = dist(a.pos, w.player.pos)
        if (d > hd) continue
        if ((a.pos.x - w.player.pos.x) * mx + (a.pos.y - w.player.pos.y) * my <= 0) continue
        hd = d
        hit = a
      }
      if (hit && hit.green + w.player.green === w.pairTarget) {
        hit.marked = false
        hit.green = 0
        w.player.marked = false
        w.player.green = 0
        if (w.pairPartnerId === hit.id) w.pairPartnerId = -1
      } else if (hit) {
        // The wrong partner. Between you the count is not four, and the fight
        // kills you for it on the spot — which is why this is the mechanic that
        // ends pulls rather than the one that costs a healing cooldown.
        if (def_scored(w, pairDef)) recordFailure(w, pairDef)
        hit.marked = false
        hit.green = 0
        w.player.marked = false
        killPlayer(w, pairDef.name)
        return
      }
    }
  }
  // The raid sorts its own pairs out on a delay, so the stage can end. The ally
  // holding your complement is left out of it and waits however long you take.
  if (w.pairMs > PAIR_AI_DELAY_MS) {
    for (const a of w.allies) {
      if (!a.alive || !a.marked || a.id === w.pairPartnerId) continue
      const mate = w.allies.find(o =>
        o.alive && o.marked && o.id !== a.id && o.id !== w.pairPartnerId &&
        o.green + a.green === w.pairTarget)
      // An odd body out clears anyway once the window is nearly gone: the raid
      // found somebody. Killing an ally for an arithmetic leftover would put a
      // death in the debrief that the player could not have prevented.
      if (mate) { mate.marked = false; mate.green = 0; a.marked = false; a.green = 0 }
      else if (w.pairMs > PAIR_AI_DELAY_MS * 2) { a.marked = false; a.green = 0 }
    }
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
  // The "+1" over your head fades. The count itself never does — that is the
  // point of it — but the float is the moment of arrival, not the total.
  if (w.venomFlash) {
    w.venomFlash.ms -= dtMs
    if (w.venomFlash.ms <= 0) w.venomFlash = null
  }

  // ── abilities ──
  for (const ab of input.pressed) {
    if (!abilitiesFor(w.player.role).includes(ab)) continue
    if (w.player.cooldowns[ab]) continue
    w.player.cooldowns[ab] = COOLDOWN_MS[ab]
    if (ab === 'raidcd') {
      w.raidHealth = Math.min(1, w.raidHealth + 0.35)
      for (const a of w.allies) if (a.alive) a.health = Math.min(1, a.health + 0.4)
      // A heal spent on a trail carrier cuts the trail short.
      //
      // The only place this trainer models healing as anything but a bar, and it
      // is here because Stygian Infection makes the healer part of the answer:
      // the debuff ends early if somebody heals through the absorb, so a healer
      // who spends their cooldown genuinely stops the pools. The raid's own
      // healers stay abstracted, as they are everywhere else.
      for (const inst of w.instances) {
        const r = inst.def.rule
        if (inst.resolved || r.type !== 'trail') continue
        inst.timer -= r.healShortensMs
      }
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
      // Every swap driver's clock, not just whichever one was ticking. A taunt
      // answers all of them at once — you are holding the boss now.
      for (const k of Object.keys(w.overStackBy)) w.overStackBy[k] = 0
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
  //
  // EVERY tankSwap mechanic, not the first one declared. Sszorak has two and the
  // ability data names them as a pair — Corroding Venom stacking on every melee
  // landing, and Ravage's +300% on everyone the cone strikes — so a single
  // `.find` served whichever happened to be written first and the other never
  // fired at all. Each keeps its own over-threshold clock in `overStackBy`.
  for (const swapDef of w.boss.mechanics) {
    if (swapDef.rule.type !== 'tankSwap') continue
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
    // Its own clock. Two swap drivers sharing one counter meant a Ravage
    // landing reset the Corroding Venom timer and vice versa, so whichever
    // fired second could never reach its own threshold. `overStackMs` is kept
    // as the mirror of whatever is currently over, for the HUD and the taunt.
    const over = () => w.overStackBy[swapDef.id] ?? 0
    if (tank.stacks >= swapDef.rule.maxStacks) {
      w.overStackBy[swapDef.id] = over() + dtMs
      w.overStackMs = over()
      if (tank.isPlayer) {
        // YOU are holding it and your stacks are up. Taunting off you is the
        // co-tank's job, and a competent co-tank does it — so this is not your
        // failure and must never be scored as one.
        //
        // It used to fall through to the failure branch below: the off-tank
        // never taunted proactively and only ever took the boss after you had
        // already been marked down for holding too long. That taught a swap
        // partnership that does not exist.
        if (over() > CO_TANK_REACTION_MS) {
          const other = freeTank()
          if (other) { unit.targetId = other.id; w.overStackBy[swapDef.id] = 0; w.overStackMs = 0 }
        }
      } else if (!playerIsTank) {
        // Two AI tanks: they handle it between themselves, quickly.
        if (over() > 800) {
          const other = freeTank()
          if (other) { unit.targetId = other.id; w.overStackBy[swapDef.id] = 0; w.overStackMs = 0 }
        }
      } else if (over() > SWAP_GRACE_MS) {
        // The co-tank is holding it, over the threshold, and you have not
        // taunted. This is the one tank-swap failure that is actually yours.
        recordFailure(w, swapDef)
        w.overStackBy[swapDef.id] = 0
        w.overStackMs = 0
        unit.targetId = 0
      }
    } else {
      w.overStackBy[swapDef.id] = 0
    }
  }
  // Stacks fall off anyone not currently holding something. Outside the loop
  // above: with two swap drivers it ran twice a tick and stacks bled off at
  // double rate, so a threshold nobody could reach quietly stopped the swaps.
  if (w.boss.mechanics.some(m => m.rule.type === 'tankSwap')) {
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
    if (!b.alive) continue
    // An untanked entity — a stationary caster — faces the raid instead.
    const face = b.targetId >= 0 ? currentTank(w, b).pos : raidAnchor(w)
    const turn = angleDelta(b.angle, Math.atan2(face.y - b.pos.y, face.x - b.pos.x))
    b.angle += Math.max(-1.4 * dt, Math.min(1.4 * dt, turn))

    // A caster is rooted while it is casting.
    //
    // Possession Barrage is the case that matters — "she is stationary during
    // it, and the further the tank is from her the less it hurts" — but this is
    // a property of casting rather than a flag anyone has to remember to set:
    // an entity with an unresolved shape of its own anchored to it is standing
    // still to deliver it, and a boss that walked out from under its own
    // telegraph would make every frontal a lie.
    //
    // Unless the cast follows him. A frontal that re-anchors to its caster every
    // tick cannot be walked out from under, so there is nothing to protect — and
    // Sszorak's opening premise is that he chases the tanks, which he cannot do
    // if five back-to-back casts pin him for the whole Apex Predator flurry.
    const rooted = w.instances.some(i =>
      !i.resolved && i.fromId === b.def.id && i.def.origin === 'boss'
      && i.def.telegraphMs > 0 && !i.def.mobileCaster)

    if (phase?.entitiesConverge) {
      // The intermission: they walk at each other, or — with only one entity on
      // the field — into the middle of the room, where the well is. Nobody is
      // dragging them and nothing a tank does changes it.
      const others = w.bosses.filter(o => o !== b && o.alive)
      const to = others.length
        ? {
            x: others.reduce((s, o) => s + o.pos.x, 0) / others.length,
            y: others.reduce((s, o) => s + o.pos.y, 0) / others.length,
          }
        : { x: 0, y: 0 }
      const d = dist(b.pos, to)
      if (d > 2) {
        const step = Math.min(d - 2, BOSS_FOLLOW_SPEED * 0.6 * dt)
        b.pos.x += ((to.x - b.pos.x) / d) * step
        b.pos.y += ((to.y - b.pos.y) / d) * step
      }
    } else if (b.def.stationary) {
      // Coiled where it started and staying there. No follow step, and no clamp
      // either — these two sit in the acid off the edge of the platform, and
      // clamping would walk them onto the floor the raid is standing on.
    } else if (b.targetId >= 0 && !rooted) {
      // A tanked entity follows its tank. Without this the bosses were bolted to
      // their spawn points, and "hold them 40 yards apart" was not something a
      // tank could get right or wrong — the separation was whatever the boss file
      // hard-coded. Slower than a player so leading one somewhere is deliberate.
      //
      // A single-entity fight is included, and has to be: `makeBosses` hands the
      // synthesised entity to the co-tank, so Vashnik walks after whoever holds
      // him and the tank's footwork picks the fountains. What stays put is an
      // entity nobody is tanking — targetId -1, a caster at its station — which
      // is the only thing this branch ever excluded.
      const to = currentTank(w, b).pos
      const d = dist(b.pos, to)
      if (d > MELEE_RANGE) {
        const step = Math.min(d - MELEE_RANGE, BOSS_FOLLOW_SPEED * dt)
        b.pos.x += ((to.x - b.pos.x) / d) * step
        b.pos.y += ((to.y - b.pos.y) / d) * step
      }
      b.pos = clampToArena(w.boss, b.pos, w.boss.arenaRadius * 0.12)
    }
  }

  // ── keep them apart ──
  // 99% damage reduction while the pair is close: your shots stop mattering,
  // which is the honest consequence and a far better teacher than a number
  // ticking up somewhere.
  //
  // Suspended while a stage is walking them together on purpose. Barking PULL
  // THEM APART at a tank during an intermission that takes the golems out of
  // their hands would score them for a mechanic that is not running.
  //
  // And a grace window on the way OUT of one. A stage that deliberately walks
  // the pair into the middle leaves them there, and dragging them back to
  // opposite corners takes real seconds during which they are, unavoidably,
  // close. Scoring that made the tank eat twenty-nine Dominance failures for
  // doing exactly what the fight asked. The tactic file draws the same line:
  // Dominance counts "outside a Vitriolic Stasis window".
  //
  // The 99% damage reduction still applies and the prompt still says PULL THEM
  // APART — the consequence is real and the player should feel it. Only the
  // blame is withheld.
  const apartDef = w.boss.mechanics.find(m => m.rule.type === 'keepApart')
  const converging = phase?.entitiesConverge ?? false
  if (converging) w.separationGraceMs = SEPARATION_GRACE_MS
  else if (w.separationGraceMs > 0) w.separationGraceMs -= dtMs
  w.bossesLinked = false
  if (apartDef && apartDef.rule.type === 'keepApart' && w.bosses.length > 1
      && !converging) {
    // Every targetable entity, not only the tanked ones. The Lost Explorers are
    // a three-body council with two tanks, and United Defense keys on any pair
    // being close: "all three explorers take 99% reduced damage while within
    // 30 yds of each other".
    const held = w.bosses.filter(b => !b.def.untargetable && b.alive)
    let closest = Infinity
    for (let i = 0; i < held.length; i++) {
      for (let j = i + 1; j < held.length; j++) {
        closest = Math.min(closest, dist(held[i].pos, held[j].pos))
      }
    }
    if (held.length > 1 && closest < apartDef.rule.minYards) {
      w.bossesLinked = true
      w.linkedMs += dtMs
      if (w.linkedMs > LINK_GRACE_MS) {
        w.linkedMs = 0
        if (apartDef.roles.includes(w.player.role) && w.separationGraceMs <= 0) {
          recordFailure(w, apartDef)
        }
      }
      if (!w.seen.has(apartDef.id)) { w.seen.add(apartDef.id); w.announce = apartDef }
    } else {
      w.linkedMs = 0
    }
  }
  // ── the Marks ──
  //
  // A permanent stacking aura on everyone inside a golem's range, modelled per
  // entity so that standing in range of BOTH stacks BOTH. That is the split
  // raid's characteristic mistake and the reason its healers suffer for it, and
  // it only reads as a mistake if the two auras are two separate things.
  //
  // Nothing here decays. The stacks are the soft enrage: the only way they stop
  // climbing is the boss dying.
  //
  // What the aura costs the RAID is the mechanic's own `raidDamage` rule, ticked
  // with the rest of the ambient below. Draining the bar here as well would
  // charge the same Mark twice and wipe the raid on the arithmetic. The stacks
  // are what YOUR position costs YOU.
  for (const def of w.boss.mechanics) {
    const px = def.proximityStack
    if (!px) continue
    const left = (w.proxTimers[def.id] ?? px.everySec * 1000) - dtMs
    if (left > 0) { w.proxTimers[def.id] = left; continue }
    w.proxTimers[def.id] = px.everySec * 1000
    const src = bossUnitFor(w, def.from)
    if (src.alive && dist(src.pos, w.player.pos) <= px.radius) {
      const n = (w.player.marks[def.id] ?? 0) + 1
      w.player.marks[def.id] = n
      // `damagePerStack` is read as what one stack costs each time the aura
      // lands: the tick is `n` stacks' worth, every `everySec`. Carrying two
      // Marks therefore costs exactly twice as much as carrying one, which is
      // the whole point of modelling them per entity.
      chip(w, n * px.damagePerStack, def.name)
    }
  }

  // ── the bar ──
  //
  // A boss with no `energyPerSec` does not fill one by standing there. Nek'zali's
  // is fed by events only — ten per scripted Ignition, five more for every Amani
  // that reached the water — so the bar reads backwards as a history of the pull
  // rather than as a clock.
  //
  // It stops while he is burrowed. The bar is what brings the Maelstrom on, so
  // letting it keep climbing during the Maelstrom would mean a long intermission
  // ends in an enrage — the fight punishing the raid for the length of its own
  // set piece.
  if (w.boss.energyPerSec && !phase?.windToCysts) {
    w.bossEnergy = Math.min(100, w.bossEnergy + w.boss.energyPerSec * dt)
  }

  // ── burn window ──
  if (w.burnMs > 0) {
    w.burnMs -= dtMs
    if ((w.player.cooldowns.burst ?? 0) > COOLDOWN_MS.burst - BURST_WINDOW_MS) w.burnUsed = true
    if (w.burnMs <= 0) {
      const def = w.boss.mechanics.find(m => m.id === w.burnId)
      // Only scored if burst is actually on your bar — blaming a healer for not
      // pressing a button they do not have is the defect this project keeps
      // having to re-fix.
      if (def && !w.burnUsed && abilitiesFor(w.player.role).includes('burst')
          && def.roles.includes(w.player.role)) {
        recordFailure(w, def)
      }
      w.burnMs = 0
      w.burnMult = 1
      w.burnId = null
    }
  }

  // ── scheduler ──
  // The current stage's rotation, or the flat one on a boss with no stages.
  //
  // It stands down for a flurry. Apex Predator is five casts delivered one at a
  // time and it takes longer than one loop interval, so a rotation that kept
  // counting would drop a Caustic Claws under a cone the player was already
  // committed to. The timer is held rather than reset, so the beat after the
  // flurry lands where it would have.
  if (w.elapsedMs >= w.comboUntilMs) {
    w.loopTimerMs += dtMs
    if (w.loopTimerMs >= activeInterval(w) * 1000) {
      w.loopTimerMs = 0
      // Only what has been introduced so far — see unlockedCount().
      const id = activeLoop(w)[w.loopIndex % unlockedCount(w)]
      w.loopIndex++
      fire(w, id)
    }
  }

  // Anything a channel queued. Four Rites a second apart is four events the
  // healer watches arrive, which is what a channel is; one lump of damage with
  // the same total would hide it.
  if (w.queue.length) {
    for (const q of w.queue) if (q.atMs <= w.elapsedMs) fire(w, q.id)
    w.queue = w.queue.filter(q => q.atMs > w.elapsedMs)
  }

  // A full bar. What it means depends on whether anything is waiting to spend
  // it: a stage that ends at full energy takes it (checked with the other stage
  // transitions below), a boss with `atFullEnergy` casts and resets it — and a
  // boss where nothing spends it simply wins, because a bar nobody empties is
  // an enrage timer with a fiction attached.
  if (w.bossEnergy >= 100 && !activePhase(w)?.endsAtFullEnergy) {
    if (w.boss.atFullEnergy) {
      w.bossEnergy = 0
      fire(w, w.boss.atFullEnergy)
    } else if (!w.enraged) {
      w.enraged = true
      w.shake = 1
      killPlayer(w, 'The bar filled — enraged')
      return
    }
  }

  // Ambient attrition ticks continuously — the healer's baseline problem.
  for (const id of activeAmbient(w)) {
    const def = w.boss.mechanics.find(m => m.id === id)
    if (def?.rule.type === 'raidDamage') {
      w.raidHealth -= (def.rule.dps / 100) * dt
      if (!w.seen.has(def.id)) { w.seen.add(def.id); w.announce = def }
    }
  }
  // Healers regenerate the raid passively; other roles rely on their raid CD.
  const regen = w.player.role === 'healer' ? 0.052 : 0.046
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
  //
  // A dead caster's telegraph dies with it.
  //
  // An add that `casts` something spawns an ordinary instance and then, until
  // this existed, had no further connection to it: dead adds are dropped
  // wholesale from `w.adds` and nothing swept `w.instances`, so a five-second
  // Corrosive Spit outlived the Spawn of Vexhul that cast it and fired into the
  // player out of a corpse. Killing the spawns fast is the single biggest lever
  // on this fight's venom income — the beam surviving its caster quietly
  // punished the exact play the fight is teaching.
  //
  // The whole telegraph goes, not just its damage. A line still drawn is a line
  // the player is still running from, and teaching them to dodge a dead add's
  // beam is worse than not drawing it at all.
  //
  // Only UNRESOLVED instances. Something that already landed and left a pool is
  // on the floor now; its caster dying afterwards does not pick the pool back up.
  // And keyed on the casting add being gone rather than on any particular
  // mechanic, because every add in the raid with a `casts` link has this defect
  // from the day it is written.
  if (w.instances.some(i => i.castByAddUid !== undefined)) {
    w.instances = w.instances.filter(i =>
      i.resolved || i.castByAddUid === undefined
      || w.adds.some(a => a.alive && a.uid === i.castByAddUid))
  }
  let pooledThisTick = false
  for (const inst of w.instances) {
    // Hazards that drift, resolved or not. A pool that has landed still moves
    // if the fight set the floor moving: Invoke does exactly that to the Essence
    // Rend puddles, and a permanent pool that also travels is the reason the
    // second half of that fight is a different fight.
    if (inst.drift) {
      inst.pos.x += inst.drift.x * dt
      inst.pos.y += inst.drift.y * dt
      if (!inArena(w.boss, inst.pos)) {
        inst.drift.x *= -1
        inst.drift.y *= -1
        inst.pos = clampToArena(w.boss, inst.pos, 1)
      }
    }
    // A cone from the boss tracks its facing ONLY when the tracking is the
    // mechanic — that is, a tank frontal you are meant to point away.
    //
    // An `avoid` frontal must NOT track. The boss faces whoever is tanking it,
    // so a tracking avoid-cone follows you forever: the game tells you to move
    // out of something it has glued to you, then fails you for not doing the
    // impossible. Real frontals fire where they were aimed and you sidestep.
    //
    // `groupSoak` tracks for the same reason `faceAway` does: aiming it IS the
    // tank's job. Mutilate has to be put on one stack group and then on the
    // other, and a cone frozen at the bearing it spawned on would make that
    // impossible for the one player who is supposed to decide it.
    //
    // A fixated line is exempt from the re-anchoring. It belongs to the add that
    // cast it, not to the serpent whose `from` it inherits, and without this
    // guard every Corrosive Spit snapped out of the pocket onto Vexhul the tick
    // after it was cast — the geometry still worked, so nothing failed, but the
    // one thing the mechanic teaches (the lines all come from the pocket, so you
    // can read them before they are cast) was quietly gone.
    if (!inst.resolved && inst.def.origin === 'boss' && inst.def.shape?.kind !== 'circle'
        && inst.aimedAt === undefined) {
      const src = bossUnitFor(w, inst.fromId)
      inst.pos = { ...src.pos }
      const aimed = inst.def.rule.type === 'faceAway' || inst.def.rule.type === 'groupSoak'
      if (aimed) inst.angle = src.angle
    }
    // A fixate line swings to follow the raider it marked, pivoting about the
    // add that is casting it. This is the SAME exemption the tank frontal above
    // gets, for the same reason: tracking is only fair when re-aiming the thing
    // is the mechanic. The marked player moves and the line moves with them —
    // that is the whole job — while everyone else reads it and steps off.
    if (!inst.resolved && inst.aimedAt !== undefined) {
      const tgt = fixatePos(w, inst.aimedAt)
      if (tgt) inst.angle = Math.atan2(tgt.y - inst.pos.y, tgt.x - inst.pos.x)
    }
    // A carried debuff rides its carrier. Anchoring it where it landed meant the
    // marker stayed on the floor while you ran, and the pool then dropped where
    // you were when you got it rather than where you took it — which is exactly
    // backwards, since walking it out IS the mechanic.
    // A trail rides its carrier for the same reason: the pools have to come out
    // from under the body that is walking.
    const carried = inst.def.rule.type === 'carryOut' || inst.def.rule.type === 'trail'
    if (!inst.resolved && carried) {
      if (inst.carriedByPlayer) {
        inst.pos = { ...w.player.pos }
        w.player.carrying[inst.def.id] = inst.timer
      } else {
        // One that landed on a raider rides that raider. It used to sit where it
        // was applied, so an ally could never actually deliver anything — and an
        // intermission whose job is walking flames onto a corpse pile is
        // unwinnable if the player is the only body that can carry one.
        const holder = w.allies.find(a => a.id === w.carriers[inst.uid] && a.alive)
        if (holder) inst.pos = { ...holder.pos }
      }
    }

    // A trail drips a hazard under its carrier on a fixed cadence until it falls
    // off. Dropping one is NEVER a failure and never a scored event: the
    // carrier's whole job is to keep walking so the pools land where nobody is,
    // and the pools themselves already say whether they managed it.
    const trail = inst.def.rule
    if (!inst.resolved && trail.type === 'trail') {
      const left = (w.trailTimers[inst.uid] ?? trail.everyMs) - dtMs
      if (left > 0) w.trailTimers[inst.uid] = left
      else {
        w.trailTimers[inst.uid] = trail.everyMs
        const child = w.boss.mechanics.find(m => m.id === trail.defId)
        if (child) spawn(w, child, { ...inst.pos })
      }
    }

    // Pickups vanish the moment anyone touches them — you, or a raider doing
    // their job. Seeing an ally eat one is half the lesson.
    //
    // WHICH body touched it, not merely that one did. Eating a globule costs the
    // eater a stack of the fight's counter, and while the engine only knew that
    // "somebody" had swept it there was nowhere to put that cost: the raid
    // cleared the floor for free, and the soak rota — which on this fight is the
    // fight — had no price attached to it at all. Charged here, at the instant of
    // contact, rather than at the instance's resolve: the resolve is ten seconds
    // later and the body that ate it may not be standing by then.
    if (!inst.resolved && !inst.answered && inst.def.rule.type === 'collect') {
      const r = inst.def.shape?.kind === 'circle' ? inst.def.shape.radius : 2.5
      let eater: Ally | null = null
      let touched = dist(inst.pos, w.player.pos) <= r
      // A pickup held back for the player is the player's alone. Without this
      // the reservation only governed where the raid was SENT, and any raider
      // whose path home happened to cross it swept it anyway — so the globule
      // saved for the player quietly went to somebody else, taking the stack
      // that was meant to be theirs and leaving them with nothing to do. The
      // rota is the fight; a rota the raid can trip over by accident is not one.
      if (!touched && !w.reservedPickups.has(inst.uid)) {
        // The NEAREST raider standing on it, so two bodies arriving on the same
        // frame settle it the same way every time instead of by array order.
        let bd = r
        for (const a of w.allies) {
          if (!a.alive) continue
          const d = dist(inst.pos, a.pos)
          if (d <= bd) { bd = d; eater = a }
        }
        touched = eater !== null
      }
      if (touched) {
        inst.answered = true
        inst.timer = 0
        giveVenom(w, eater, inst.def.applies?.soak ?? 0)
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

    // Lingering hazards keep hurting anyone standing in them. A `permanent` one
    // is the same thing with no expiry: Blood Venom and Essence Rend pools
    // accumulate for the whole pull, so the encounter steadily eats its own
    // floor and gets harder because of where people stood ten minutes ago.
    // A vortex slows whoever brushes it, and the slow is the fight's one dispel.
    // Applied to the raid as well as to you: `Ally.debuff` is what a healer's
    // dispel actually targets, so without this the healer's button had nothing
    // on this boss to point at.
    if (inst.resolved && inst.def.slowMs) {
      if (isInside(inst, w.player.pos)) w.player.slowMs = Math.max(w.player.slowMs, inst.def.slowMs)
      for (const a of w.allies) {
        if (!a.alive || a.debuff || !isInside(inst, a.pos)) continue
        a.debuff = inst.def.id
        a.debuffMs = inst.def.slowMs
      }
    }

    if (inst.resolved && (inst.def.lingerMs || inst.def.permanent) && isInside(inst, w.player.pos)) {
      // The counter stack, charged per HAZARD rather than per tick — `payHit`
      // bills a body once per instance, or once per `applies.everyMs` for
      // something you can walk back into. Deliberately outside the
      // `pooledThisTick` guard below: that guard exists to stop overlapping
      // pools MULTIPLYING their damage into a wall, which is a different thing
      // from standing in two separate hazards and being charged once by each.
      payHit(w, inst, null)
      if (inst.def.raidKnockRoom) {
        // A cyst you walked into. It bursts, and the burst throws the WHOLE
        // raid — which is the mechanic, not an inconvenience. During the gales
        // that is the answer and nobody is blamed for it; the rest of the time
        // it is a raid-wide relocation nobody asked for, and it costs you the
        // cyst the Maelstrom was going to need.
        if (!inst.answered) {
          if (!phase?.windToCysts && def_scored(w, inst.def)) recordFailure(w, inst.def)
          burstCyst(w, inst)
        }
      } else if (inst.def.popsOnContact) {
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
    // A burst cyst is gone. It is `permanent` so that one glob survives a whole
    // rotation on the floor waiting for the Maelstrom, which also means nothing
    // else would ever take it away — so a glob that has already thrown you
    // stayed drawn as a hazard nobody could clear, for the rest of the pull.
    !(i.def.raidKnockRoom && i.answered && -i.timer >= IMPACT_FLASH_MS)
    && (!i.resolved
    // Furniture and pools that never expire are part of the floor now.
    || i.def.fixture
    || i.def.permanent
    // Held for a beat after resolving so the impact flash has something to draw.
    // Without this a mechanic vanished on the frame it landed and the only
    // evidence it had gone off was your health bar moving.
    || -i.timer < IMPACT_FLASH_MS
    || (i.def.lingerMs !== undefined && -i.timer < i.def.lingerMs)))

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
      // Killing it leaves a body if it leaves one — which is the whole reason
      // the intermission has a job.
      if (add.hp <= 0) killAdd(w, add, true)
      break
    }
    if (consumed) continue

    for (const b of w.bosses) {
      if (b.def.untargetable || !b.alive) continue
      if (dist(s.pos, b.pos) > BOSS_HIT_RADIUS) continue
      s.life = 0
      w.shotsHit++
      // Damage lands on the entity you actually hit. A shared pool let you
      // ignore one of a pair completely and still "kill them together", which
      // is the one thing Twin Fangs and the Altar's third stage forbid.
      //
      // Scaled by the number of targetable entities so a two-boss fight still
      // takes about as long overall — the lesson is that your damage has to be
      // SPLIT, not that these encounters last twice as long. 99% damage
      // reduction applies while a pair is linked.
      // A stage can armour them too — an intermission's 99% reduction is the
      // fight telling you to stop shooting and go and do the mechanic, and
      // damage logged inside that window is wasted.
      const live = w.bosses.filter(x => !x.def.untargetable).length || 1
      b.hp -= (w.bossesLinked ? perShot * 0.01 : perShot)
        * (1 - w.entityReduction) * (w.burnMs > 0 ? w.burnMult : 1) * live
      if (b.hp <= 0) { b.hp = 0; b.alive = false }
      break
    }
  }
  w.shots = w.shots.filter(s => s.life > 0)

  // ── the other half of a split raid ──
  //
  // This engine deliberately has no ally damage: "the boss only dies from these"
  // is what makes dodging well cost the boss health, and it must stay true of
  // the entity YOU are responsible for.
  //
  // But a sided fight parks you on one golem — the Marks punish crossing to the
  // other — so the far one has nobody shooting it and can never die, which made
  // the Entombed Sentinels unclearable for reasons that had nothing to do with
  // play. The other group is doing exactly what you are doing, over there.
  //
  // Their rate is deliberately a little below what a competent player manages,
  // so the health delta the intermission punishes is real and readable rather
  // than pinned at zero — the tactic file calls that delta "the most actionable
  // number on the fight", and it only means anything if it can move.
  if (w.boss.sided) {
    const ours = w.bosses.find(b => b.def.side === w.player.side)
    for (const b of w.bosses) {
      if (b.def.untargetable || !b.alive) continue
      if (b.def.side === w.player.side) continue
      // Paced to you, not independent of you.
      //
      // A flat rate meant the other group solo-killed their golem whether or not
      // you contributed anything: an idle green player watched Blood drain to
      // nothing while Breath sat untouched at full, and one golem died outright
      // before the intermission that is supposed to level them. The other group
      // is doing what you are doing, so they keep pace and stay a little behind
      // — which leaves a real health delta for Vitriolic Stasis to punish
      // without ever letting either golem finish first.
      const floor = Math.max(0, (ours?.hp ?? 0)) + OFFSIDE_LAG
      if (b.hp <= floor) continue
      const drain = OFFSIDE_DPS * (1 - w.entityReduction) * (w.bossesLinked ? 0.01 : 1)
      b.hp = Math.max(floor, b.hp - drain * dt)
    }
  }
  // Neither golem dies alone. The pair are killed together — a golem reaching
  // zero on its own leaves half the raid with nothing to fight and half a fight
  // that cannot end, and the encounter's own answer to uneven damage is to heal
  // the weaker back up rather than to let it fall over.
  if (w.boss.sided) {
    const live = w.bosses.filter(b => !b.def.untargetable)
    const allDown = live.every(b => b.hp <= 0.005)
    for (const b of live) {
      if (b.hp <= 0.005 && !allDown) b.hp = 0.005
      else if (allDown) { b.hp = 0; b.alive = false }
    }
  }

  const targetable = w.bosses.filter(b => !b.def.untargetable)
  w.bossHp = targetable.reduce((n, b) => n + Math.max(0, b.hp), 0) / Math.max(1, targetable.length)
  if (targetable.every(b => !b.alive) && !w.killed) {
    w.bossHp = 0
    w.killed = true
  }

  // ── stages ──
  // Checked after the health and the bar have been brought up to date, because
  // both are end conditions. A boss with no stages never enters this at all.
  if (phase && !w.killed && phaseComplete(w, phase)) exitPhase(w, phase)

  // ── they have to die together ──
  // "Only Uncoiled Wrath, the uncapped rage the survivor gains when the first
  // dies, forces a synchronised kill." Leaving one far behind is the failure.
  const syncDef = w.boss.mechanics.find(m => m.rule.type === 'syncKill')
  if (syncDef && syncDef.rule.type === 'syncKill' && targetable.length > 1) {
    const anyDead = targetable.some(b => !b.alive)
    if (anyDead && !w.killed) {
      w.soloMs += dtMs
      if (!w.seen.has(syncDef.id)) { w.seen.add(syncDef.id); w.announce = syncDef }
      if (w.soloMs > syncDef.rule.withinSec * 1000) {
        w.soloMs = 0
        if (syncDef.roles.includes(w.player.role)) recordFailure(w, syncDef)
        // The survivor's rage is uncapped, so it compounds rather than ticking.
        w.raidHealth -= 0.2
      }
    } else {
      w.soloMs = 0
    }
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
  const phases = w.boss.phases
  return {
    // Only reported where they mean something. A single-boss fight has no side,
    // a fight with no stages has no furthest stage, and a debrief that padded
    // both with defaults would be inventing findings.
    side: w.boss.sided ? w.player.side : undefined,
    phaseReached: phases?.length ? phases[Math.min(w.phaseMax, phases.length - 1)].name : undefined,
    enraged: w.enraged || undefined,
    resurrected: w.resurrected || undefined,
    entityDelta: w.entityDelta || undefined,
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
    // Only on a fight that keeps a counter. A clean pull genuinely reporting
    // zero is a finding worth printing; the seven fights with no venom in them
    // reporting zero would be the debrief inventing one, which is the rule the
    // side and the furthest stage above already follow.
    venomPeak: counterDef(w) ? w.venomPeak : undefined,
    venomRaidPeak: counterDef(w) ? w.venomRaidPeak : undefined,
  }
}
