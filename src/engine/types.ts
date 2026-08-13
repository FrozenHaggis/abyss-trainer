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
  /**
   * Several small pickups that vanish the instant someone runs over them.
   * Anything still on the floor when the timer expires ruptures onto the raid.
   *
   * Distinct from `beInside`, which is one shape you stand in and get judged on
   * at a single resolve moment. Caustic Globule is not that: "each splash leaves
   * a globule that ruptures after 10s onto the whole raid, unless one player
   * walks in first and eats it alone". Drawing that as one big circle taught the
   * opposite of the mechanic — it read as ground to avoid.
   *
   * Eating one is always correct play and can never be a failure. The tactic
   * file is explicit: report "un-soaked ruptures only, never soakers".
   */
  | { type: 'collect'; count: number }
  /**
   * Two tanked entities must be held at least this far apart.
   *
   * Entombed Sentinels: "Both bosses gain 99% DR for 10s while within ~25yd of
   * each other. Good: Tanks hold them 40+ yards apart all pull." Its own boss
   * file called this "the single most important tank job on the real fight and
   * the trainer cannot teach it", because the engine had one boss position.
   * It has several now.
   *
   * Judged continuously rather than at a resolve moment — like a tank swap, the
   * failure is a state you are allowed to sit in, not an event you miss.
   */
  | { type: 'keepApart'; minYards: number }
  /**
   * A burn window: the boss takes bonus damage for a fixed stretch.
   *
   * Every fight with one says the same thing about it — Sszorak's Dig In is
   * "the fight's only burn window", Ula'tek's Venomous Heart is "the raid's
   * burn phase", and both tactic files list missing it as the failure
   * ("cooldowns missing the Heart wastes the only burn in the stage").
   *
   * So the failure is not pressing your burst inside it. Only scored for roles
   * that actually have burst on their bar.
   */
  | { type: 'burnWindow'; multiplier: number; durationMs: number }
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

/**
 * One entity in the encounter.
 *
 * Half this raid is a multi-boss fight — Sentinels, Twin Fangs, Lost Explorers
 * and Coiled Altar each field two or more — and drawing a single dot in the
 * middle for all of them makes "keep them apart" and "the other one is casting"
 * impossible to practise.
 *
 * Names and npcIds come straight from the boss's abilities.json, and each
 * mechanic's owner is derived from which `bosses[]` entry lists its spell. None
 * of the ownership here is invented; a test re-derives it from the same data.
 */
export interface BossEntityDef {
  id: string
  name: string
  /** Real NPC id from abilities.json. */
  npcId: number
  /** Where it stands, in yards from the arena centre. */
  start: Vec
  /**
   * Held by its own tank, away from the others.
   *
   * Set this ONLY where a source states it. Twin Fangs is the one confirmed
   * case in this tier: Vexhul and Ithraz are tanked apart with melee between
   * them. Everywhere else the entities simply hold their own stations, which is
   * a claim about how many bosses there are — not about how they are tanked.
   */
  tankedApart?: boolean
  /**
   * Cannot be shot. Mor'zahi is the confirmed case: he took 0 damage across
   * 10,001 player damage events in a Mythic PTR log while casting constantly,
   * so he sits outside the health pool and puppets the council. Shooting him
   * would teach a raider to waste a pull on a target that cannot die.
   */
  untargetable?: boolean
}

/**
 * What an add asks of you. Catalogued in ADDS.md from the `adds[]` arrays in the
 * real ability data: "kill it fast" is the right answer for only about a third
 * of the 40 adds in this raid, which is exactly why the trainer needs more than
 * one verb for them.
 */
export type AddJob =
  /** Shoot it down before its fuse runs out. */
  | 'kill'
  /** It repeats a cast; interrupt it. Only four of these exist at Heroic. */
  | 'kick'
  /** It walks somewhere. Stand in its way — killing it is not the job. */
  | 'intercept'
  /**
   * Leave it completely alone. Coiled Altar's orbs: destroying one detonates
   * Venom Rupture, which took 58 Mythic killing blows — more than everything
   * else in that fight combined. Shooting it IS the failure.
   */
  | 'leave'

export interface AddDef {
  id: string
  name: string
  /** Real NPC id from the boss's abilities.json `adds[]`. */
  npcId: number
  /** The ability that makes it dangerous — real spell id. */
  spellId: number
  job: AddJob
  /** How many spawn together. */
  count: number
  /** Shots to kill, once any shield is down. */
  hp: number
  /**
   * An absorb that must break before the add can be damaged at all. Restless
   * Amani's is 25% of its health; Shrouded Venom's is a full 100%. Burning an
   * add without breaking its shield is wasted damage, and the bar shows it.
   */
  shieldHp?: number
  /** Seconds before its threat lands — the clock you are racing. */
  fuseSec: number
  /** Raid damage per second for as long as it is alive. */
  auraDps?: number
  /** Where it spawns, in yards from the arena centre. */
  spawnRadius?: number
  /** `intercept` adds walk to the centre; arriving is the failure. */
  marchSpeed?: number
  /** `kick` adds cast this often, in seconds. */
  castEverySec?: number
  /** Teaching line, shown and spoken the first time one appears. */
  good: string
  /** What went wrong. Empty means it can never be a personal failure. */
  failText: string
  /** Its threat landing kills rather than chips. */
  lethal?: boolean
  /**
   * Mechanic id fired when this add gets where it was going.
   *
   * Vashnik: "A venom reaching the Cavity casts 1280189 — 300yd Nature burst...
   * one cast is one venom leaked." The burst is not something you dodge, it is
   * what a leaked add does to the raid, and showing that link is the lesson.
   */
  onLeak?: string
}

export interface MechanicDef {
  id: string
  name: string
  /** Real spell ID from abilities.json — the link back to the analyser. */
  spellId: number
  /**
   * Which entity casts this, by `BossEntityDef.id`. Derived from the owning
   * `bosses[]` entry in abilities.json, so a frontal comes out of the boss that
   * actually casts it. Omit on single-entity fights.
   */
  from?: string
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
  /**
   * Failing this KILLS rather than chips.
   *
   * Taken from `category: "Deadly"` in the boss's abilities.json — the same
   * categorisation RaidLens uses to attribute a death to a mechanic ("a damage
   * event cross-referenced with a death within 3 seconds"). A test re-derives
   * this from the data, so it cannot drift into being a balance knob.
   *
   * What "lethal" means depends on how you fail it, and the difference matters:
   *   • `avoid`    — you stood in it. It kills you.
   *   • `carryOut` — you dropped it on the raid. It kills you and hurts them.
   *   • `beInside` — an unsoaked Deadly hit lands on the RAID, so it is a heavy
   *                  raid-damage event, not your personal death. Killing the
   *                  player for a soak they were merely late to would blame
   *                  them for the group's miss.
   */
  lethal?: boolean
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
  /**
   * The encounter's entities, PRIMARY FIRST. The primary is the one the player's
   * tank holds and the one the `faceAway` / `tankSwap` mechanics belong to — on
   * every multi-boss fight in this tier the tank mechanic already sits with a
   * single entity, so which comes first is read off the data rather than chosen.
   *
   * Omit for a single-boss fight; the engine synthesises one entity at the
   * centre.
   */
  entities?: BossEntityDef[]
  mechanics: MechanicDef[]
  /**
   * Adds this fight spawns. On Ula'tek these ARE the fight — "the adds set the
   * clock" — so a trainer without them teaches a different encounter.
   */
  adds?: AddDef[]
  /** Seconds between add waves. Omit when the boss has no adds. */
  addEverySec?: number
  /**
   * How many adds may be alive at once before waves stop arriving.
   *
   * This is the intensity dial. A low cap makes a fight readable; a high one
   * lets adds genuinely swamp the raid, which is the point on Ula'tek — "the
   * adds set the clock" — and on the Coiled Altar, where orbs accumulate until
   * somebody detonates one. Defaults to 5.
   */
  maxAdds?: number
  /**
   * Recurrence intervals are NOT in the source data, so the fight is driven off
   * an energy bar — which is how several of these bosses genuinely work. `loop`
   * cycles while energy fills; `atFullEnergy` fires and resets it.
   */
  loop: string[]
  /** Seconds between loop entries. */
  loopIntervalSec: number
  /**
   * Seconds before the next mechanic in `loop` joins the rotation. Mechanics are
   * introduced one at a time rather than all at once. Defaults to 14.
   */
  introEverySec?: number
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
  /** Entity id that cast this, so a boss-anchored shape tracks the right one. */
  fromId: string
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
  /**
   * 0..1 — how present they are on the field.
   *
   * The raid turns up when there is something for it to do and clears out
   * again. Nineteen idle glyphs standing around during a solo dodging drill
   * only make the telegraphs harder to read; when a soak lands, bodies appear
   * and the mechanic is visibly a group problem.
   */
  presence: number
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
  shotsFired: number
  shotsHit: number
  addsKilled: number
  addsLeaked: number
}
