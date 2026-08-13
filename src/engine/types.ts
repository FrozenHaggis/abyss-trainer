// The whole game is authored as data against these types. A boss is a list of
// MechanicDefs plus a loop; the engine knows nothing about any specific fight.
//
// Distances are in YARDS throughout, matching the source tactic files. The
// renderer is the only place that converts to pixels.

export type Role = 'tank' | 'healer' | 'dps'

/** The four abilities bound to keys 1-4. Which ones you get depends on role. */
export type Ability = 'interrupt' | 'dispel' | 'defensive' | 'taunt' | 'burst' | 'raidcd'

export type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'cone'; radius: number; arcDeg: number }
  | { kind: 'line'; length: number; width: number }
  /** Correct position is the ring between inner and outer — a range band. */
  | { kind: 'annulus'; inner: number; outer: number }

/** What the player must have done by the time the mechanic resolves. */
export type Rule =
  /** Inside the shape at resolve = failure. The common ground-AoE case. */
  | { type: 'avoid' }
  /** Outside the shape at resolve = failure. Soaks, and "stay in melee". */
  | { type: 'beInside' }
  /** The boss's facing must not sweep the arena centre. Tank job. */
  | { type: 'faceAway' }
  /** Press an ability inside the window. Kicks, dispels, taunts. */
  | { type: 'press'; ability: Ability; withinMs: number }
  /**
   * Unavoidable raid damage. Drains the raid bar; NEVER produces a per-player
   * failure. Several tactic files say outright "Bad: Nothing — a healing check,
   * not a mechanic", and mislabelling those as failures is the exact defect this
   * project already had to fix once in the analyser.
   */
  | { type: 'raidDamage'; dps: number }
  /** Carry a debuff at least this far from the arena centre before it expires. */
  | { type: 'carryOut'; minDistance: number }
  /** Get knocked, but not off the platform. Failure is leaving the arena. */
  | { type: 'survive' }
  /**
   * A stacking tank debuff. The boss applies a stack to whoever it is on; the
   * off-tank taunts before it turns lethal. Only scored when you are the tank.
   */
  | { type: 'tankSwap'; maxStacks: number }

export interface MechanicDef {
  id: string
  name: string
  /** Real spell ID from abilities.json — the link back to the analyser. */
  spellId: number
  /** Whose job this is. A mechanic you are not scored on still renders. */
  roles: Role[]
  /** Telegraph duration in ms — the real cast time where the file states one. */
  telegraphMs: number
  shape?: Shape
  /**
   * Where the shape is anchored when the instance spawns.
   * - `boss`     cones and frontals; tracks the boss's facing
   * - `player`   always lands on you
   * - `targeted` picks a raider, usually you — use this for anything the real
   *              fight aims at a player, so you actually get the reps
   * - `random`   floor AoE
   * - `edge`     spawns at the arena rim
   */
  origin: 'boss' | 'player' | 'targeted' | 'random' | 'edge'
  rule: Rule
  /** The tactic file's "Good:" line, shown once as a teaching callout. */
  good: string
  /** Short human failure clause. Never a combat-log query. */
  failText: string
  /** Damage to the player on failure, as a fraction of max health. */
  damage?: number
  /** Leaves a persistent hazard behind when it resolves. */
  spawns?: { defId: string; delayMs?: number }
  /** Persistent hazards only: how long the pool lingers. */
  lingerMs?: number
  /** Hazard detonates on the first contact and is consumed, rather than ticking. */
  popsOnContact?: boolean
  /**
   * How many bodies a shared soak needs. The assigner fills all but one of
   * these with allies, so the last one is always yours — which is what makes a
   * group mechanic personally consequential without scripting it per boss.
   */
  soakers?: number
  /** Hazards that drift, e.g. Sszorak's Tempest vortices. */
  driftSpeed?: number
  /** Pushes the player this many yards away from the shape's origin. */
  knockbackYards?: number
}

export interface BossDef {
  key: string
  name: string
  /** Playable radius in yards. Leaving it is a fall — the real killer on Sszorak. */
  arenaRadius: number
  blurb: string
  mechanics: MechanicDef[]
  /**
   * Recurrence intervals are NOT in the source data, so the fight is driven off
   * an energy bar — which is how several of these bosses genuinely work. `loop`
   * cycles while energy fills; `atFullEnergy` fires and resets it.
   */
  loop: string[]
  /** Seconds between loop entries. */
  loopIntervalSec: number
  energyPerSec: number
  atFullEnergy?: string
  /** Always-on mechanics, e.g. Ula'tek's Presence attrition. */
  ambient?: string[]
  /** Enrage timer. Survive past it and the boss wins. */
  pullLengthSec: number
  /** Boss health pool. You win by emptying it, Pineapplia-style. */
  maxHp: number
  /** Real boss this parodies — kept so the training still transfers. */
  realName: string
}

// ───────────────────────────── runtime state ─────────────────────────────

export interface Vec {
  x: number
  y: number
}

/** A live mechanic on the field. */
export interface Instance {
  uid: number
  def: MechanicDef
  /** Anchor point in yards, arena-centre origin. */
  pos: Vec
  /** Facing in radians, for cones and lines. */
  angle: number
  /** ms remaining until resolve. Negative once resolved (lingering hazard). */
  timer: number
  resolved: boolean
  /** Set when the player pressed the required ability for a `press` rule. */
  answered: boolean
  /** True when this instance landed on the player, not an ally. */
  carriedByPlayer: boolean
  drift?: Vec
}

/** A simulated raid member. Nineteen of them, so group mechanics are real. */
export interface Ally {
  id: number
  role: Role
  pos: Vec
  /** Where the AI currently wants to stand. */
  want: Vec
  health: number
  alive: boolean
  /** Tank debuff stacks, for swap practice. */
  stacks: number
  /** Mechanic id of a dispellable debuff they are carrying, if any. */
  debuff: string | null
  debuffMs: number
}

export interface PlayerState {
  pos: Vec
  role: Role
  health: number // 0..1
  alive: boolean
  /** Debuffs the player is carrying: mechanic id -> ms remaining. */
  carrying: Record<string, number>
  /** Ability -> ms until usable again. */
  cooldowns: Partial<Record<Ability, number>>
  aloft: number // ms remaining airborne (Sszorak wind)
}

/** A live instruction shown to the player mid-fight. */
export interface Prompt {
  /** Imperative, two or three words: "MOVE OUT", "GET IN", "KICK IT". */
  verb: string
  mechanic: string
  /** 0..1, how close this is to resolving — drives the urgency styling. */
  urgency: number
}

export interface FailureRow {
  mechanicId: string
  name: string
  failText: string
  count: number
}

export interface RunResult {
  bossKey: string
  role: Role
  survivedSec: number
  pullLengthSec: number
  cleared: boolean
  bossHpLeft: number
  deathCause: string | null
  failures: FailureRow[]
  mechanicsResolved: number
  raidHealthLow: number
  alliesLost: number
}
