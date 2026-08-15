// The whole game is authored as data against these types. A boss is a list of
// MechanicDefs plus a loop; the engine knows nothing about any specific fight.
//
// Distances are in YARDS throughout, matching the source tactic files. The
// renderer is the only place that converts to pixels.

export type Role = 'tank' | 'healer' | 'dps'

/**
 * A compass bearing, for the mechanics that are about direction rather than
 * position.
 *
 * The arena is a clock: 12 is north, 3 is east, 6 is south, 9 is west. Sszorak
 * is the only fight in the tier that needs it, and it needs it twice — Raging
 * Crosswinds hands every raider one of these, and a Viscous Cyst has to land on
 * one of them or the Maelstrom has nothing to blow the raid into.
 *
 * Deliberately NOT drawn on the floor. The four marks are how the ENGINE places
 * a glob so a gale can be aimed at it, not a grid the player is meant to read —
 * painted on, they were four numerals nobody needed and a clock face on a room
 * that is not one.
 *
 * Screen coordinates, so +y is SOUTH.
 */
export type Compass = 'N' | 'E' | 'S' | 'W'

export const COMPASS: Record<Compass, Vec> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
}

export const OPPOSITE: Record<Compass, Compass> = { N: 'S', S: 'N', E: 'W', W: 'E' }

/** The clock face, in order, for anything that has to pick one of the four. */
export const CLOCK: Compass[] = ['N', 'E', 'S', 'W']

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
   * Contact kills outright — a hole in the floor, not a mechanic. Checked every
   * tick rather than at a resolve moment, and it never expires.
   *
   * Nek'zali's Soulcoil Well is the case. Its tactic file's target is "zero
   * contact events all pull", and modelling it as damage the player could heal
   * through taught the exact opposite of what the fight demands.
   */
  | { type: 'lethalGround' }
  /**
   * Collide with another marked raider so your two marks combine to exactly
   * `target`.
   *
   * Helical Toxins: Vitriolic Stasis gives everyone four orbs split green and
   * red, and a pair has to sum to four green between them. The tactic file calls
   * this "the mechanic that ends pulls". Colliding with the wrong partner is
   * fatal, and so is letting it expire — the file's Cultivated Burst.
   *
   * The inverse mechanic on the same fight is Shifting Protovenom, where
   * touching another player is what kills you. The file warns "do not confuse
   * them during Stasis", which is precisely why both are worth practising.
   */
  | { type: 'pairUp'; target: number }
  /**
   * Drain the `count` altars nearest the boss.
   *
   * Imbibe, and the whole shape of Vashnik. Because the boss follows its tank,
   * where the tank stands decides which two fountains fire — which adds spawn
   * and which two debuffs land on the raid. Draining the same altar on
   * consecutive casts stacks its Infusion and empowers both, so the tank has to
   * keep walking the boss to a fresh pair. Standing still is the failure.
   */
  | { type: 'drainNearest'; count: number }
  /**
   * A debuff that drops a hazard under the carrier every `everyMs` until it
   * falls off, and falls off sooner if a healer spends a heal on them.
   *
   * Stygian Infection. Modelled this way because the trainer abstracts healing
   * everywhere else: a raider's real job here is to keep walking so the trail
   * they leave misses everyone, and that lesson survives without an absorb model.
   */
  | { type: 'trail'; defId: string; everyMs: number; healShortensMs: number }
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
  /**
   * Several entities that must die within seconds of each other.
   *
   * Twin Fangs: "Vexhul and Ithraz ... do NOT share a health pool — only
   * Uncoiled Wrath, the uncapped rage the survivor gains when the first dies,
   * forces a synchronised kill." The Coiled Altar links its pair the same way
   * in Stage Three: "killing one berserks the other".
   */
  | { type: 'syncKill'; withinSec: number }
  /** The boss's facing must not sweep the arena centre. Tank job. */
  | { type: 'faceAway' }
  /**
   * A frontal fired from a stationary caster at whoever it fixated, so the
   * MARKED PLAYER'S FEET aim it. Where they stand decides where the line goes.
   *
   * Corrosive Spit. Three Spawn of Vexhul surface in the venom pocket, each
   * fixates a non-tank raider, and each fires a line from the pocket through
   * that raider. The abilities.json separates the two halves for us — 1293979
   * is "the 5s targeting marker on the intended player ... use it to separate
   * the aimed target from players clipped by the line" — and they are exactly
   * the two jobs this rule scores:
   *
   *   • Marked   — the line pivots about the caster as you move. Stand where it
   *                crosses nobody. Pointing it through the raid is the failure.
   *                Being targeted is not: the marked player takes no damage from
   *                their own line, the same way a Coiling Ichor carrier is
   *                "chosen, never at fault".
   *   • Everyone — an ordinary frontal to sidestep, scored exactly like `avoid`.
   *
   * This is `faceAway` with the decision moved from the tank's turning to the
   * marked player's footwork, and it is the only other rule where a telegraph
   * may track a player. Normally that is forbidden — an avoid-shape glued to you
   * is something the game tells you to leave and then fails you for not leaving
   * — but here the tracking IS the mechanic.
   */
  | { type: 'aimAway' }
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
   * One cast that fires several others back-to-back, in a RANDOM order.
   *
   * Apex Predator. The ability data calls 1277025 a "window marker for the
   * Ravage/Mutilate flurry — server-side dummy with no events, so it never
   * produces a failure", which is exactly what this is: a container that can
   * never itself be failed, holding five real abilities that each can.
   *
   * The order being random is the whole point. Two Ravages, two Mutilates and a
   * Tempest in a known sequence is a dance you memorise; in an unknown one it is
   * a fight you have to read, and reading which of the two frontals is coming is
   * the skill the flurry actually tests.
   *
   * `gapMs` is the BREATHER AFTER a cast resolves, not the period between casts
   * starting. Those are very different things and the difference was the whole
   * bug: dealt out on a fixed period shorter than a cone's own telegraph, the
   * Ravage and the Mutilate were in the air together and there was no moment at
   * which the answer to one of them was not also the wrong answer to the other.
   * Each cast now lands before the next one begins, whatever their cast times
   * are, and reading the flurry is a sequence of decisions rather than one.
   */
  | { type: 'combo'; parts: string[]; gapMs: number }
  /**
   * A frontal soak that must land on ONE of the raid's two stack groups, and
   * must not land on the same one twice running.
   *
   * Mutilate. The damage is split among everyone struck, so too few bodies is a
   * raid-wide hit — but every body struck also takes a Mutilated Gash, and a
   * second Gash on a body that still has one kills it. So the two demands pull
   * against each other: enough bodies, and never the same bodies twice.
   *
   * Measured per cast and never per player, exactly as the tactic file asks:
   * "Not a per-player failure — track soak count per cast ... and attribute
   * deaths to the DoT damage". Missing the soak costs the raid; dying to a
   * second Gash is attributed to the Gash, which is the Deadly id.
   */
  | { type: 'groupSoak'; bodies: number; dotId: string }
  /**
   * A DoT that kills the body carrying it if it is applied again before the
   * first application has fallen off.
   *
   * Mutilated Gash — 1285998, the Deadly damage id the tactic file says to
   * attribute deaths to. It is never cast directly; a `groupSoak` applies it.
   */
  | { type: 'stackingDot'; maxStacks: number; durationMs: number }
  /**
   * Every raider is given a compass bearing and is thrown that way when it
   * expires. Two raiders thrown into each other cancel out and neither moves.
   *
   * Raging Crosswinds, and the fight. The knock is NOT clamped to the rim the
   * way `survive` is: being blown off the platform is the single biggest killer
   * in the real logs — `Falling` took 31 killing blows in 6 pulls, more than
   * every boss ability combined — and a knockback that cannot do that is not
   * teaching this fight.
   */
  | { type: 'windPair'; pushYards: number }

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
   * Never moves. It is not tanked TO anywhere — it sits where it starts, all
   * pull, and the raid comes to it.
   *
   * The Twin Fangs are coiled in the acid off the top edge of their platform and
   * no tank drags them anywhere. Every other tanked entity in this raid walks
   * after whoever holds it, which is what makes "hold them 40 yards apart" a
   * thing a tank can get right or wrong; here there is no such decision, and
   * pretending otherwise has a tank towing a serpent around a room it never
   * leaves.
   *
   * An entity flagged this way may also stand OFF the floor, which is the other
   * reason the flag has to exist: the follow step clamps a moving boss into the
   * arena every tick, and would otherwise haul these two out of the acid and up
   * onto the platform within a second of the pull starting.
   */
  stationary?: boolean
  /**
   * Cannot be shot. Mor'zahi is the confirmed case: he took 0 damage across
   * 10,001 player damage events in a Mythic PTR log while casting constantly,
   * so he sits outside the health pool and puppets the council. Shooting him
   * would teach a raider to waste a pull on a target that cannot die.
   */
  untargetable?: boolean
  /**
   * Which group is parked on this entity. Only meaningful on a `sided` fight,
   * where each half of the raid owns one golem and must stay out of the other's
   * range.
   */
  side?: Side
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
  /**
   * Surfaces at one fixed point on the floor instead of anywhere on a ring.
   *
   * The Spawn of Vexhul come out of the venom pocket at the mouth of the
   * platform, all three of them, every time. That is not decoration: the pocket
   * is one end of every Corrosive Spit line, so the raid can read where the
   * frontals will come FROM before any of them is cast, and a wave scattered
   * around the rim would throw that away.
   */
  spawnAt?: Vec
  /**
   * Picks a raider on spawn and keeps them for life, ignoring `roles` the way a
   * real fixate does — non-tanks only.
   *
   * Tanks are excluded because they are welded to a serpent 19 yards away; a
   * fixate that dragged a tank's line across the raid would be asking them to
   * choose between their boss and the mechanic, which the fight never does.
   */
  fixates?: boolean
  /**
   * Repeats this mechanic every `everySec` for as long as it is alive, aimed at
   * whoever it fixated.
   *
   * This is what makes "deal with them quickly" mean something mechanically
   * rather than being a slogan: a spawn nobody killed is not a static tax, it is
   * another frontal every few seconds. Kill speed IS the lever.
   */
  casts?: { defId: string; everySec: number }
  /**
   * Spawns beside this entity instead of on a ring around the room.
   *
   * Venom Coagulation is summoned by Breath and is the green group's problem, so
   * putting it on a generic spawn ring could drop it in the red half — a job
   * handed to people who must not walk over and do it. It belongs next to the
   * golem that made it.
   */
  spawnAtEntity?: string
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
  /**
   * Leaves a corpse where it died, which stays until something burns it.
   *
   * Nek'zali's Restless Amani do this, and it is the reason the intermission has
   * a job at all: Cremation "incinerates Vessels of Awakening and Amani
   * corpses", and any corpse still lying there when the intermission ends gets
   * back up and resumes walking at the well.
   */
  leavesCorpse?: boolean
  /** Energy granted to the boss when this add reaches its goal. */
  leakEnergy?: number
  /**
   * Only ever arrives because a stage asked for it — never from the wave timer.
   *
   * The Echoes of Jawae are the intermission. They were being dealt out as
   * ordinary trash in Stages One and Two too, because the wave timer cycles
   * through every entry in `adds` and had no way to know that one of them was a
   * set piece. A test checks that a `phaseOnly` add is named by some phase's
   * `onEnter`, so flagging one cannot quietly stop it spawning at all.
   */
  phaseOnly?: boolean
  /**
   * On death it becomes this many copies of `splitsInto`, which carry on toward
   * the goal. Clotting Venom does this, and it is why killing it early and far
   * from the pool matters more than killing it fast.
   */
  splits?: { intoId: string; count: number }
  /**
   * On death, drop `defId` at EVERY player's position rather than at the corpse.
   *
   * Shrouded Venom does this. It turns one add dying into a whole-raid
   * relocation, which is a completely different demand from "dodge the puddle
   * where it fell" and the reason the purple side feels chaotic.
   */
  deathSpawnsAtAllPlayers?: string
  /**
   * Two of these dying within `withinSec` of each other wipes the raid.
   *
   * The Burning Venom pair. "Kill it fast" is the wrong reflex here — the raid
   * has to hold one deliberately — so the trainer has to punish the reflex.
   */
  noSimultaneousDeath?: { withinSec: number }
}

/**
 * A dead add left on the floor. Persists until burned, and stands back up if a
 * phase's `resurrectCorpsesAs` catches it still lying there.
 */
export interface Corpse {
  uid: number
  addId: string
  pos: Vec
  burned: boolean
  /** ms timestamp it was burned, for the incineration flash. */
  burnedAtMs: number
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
  /**
   * What the ability actually does, in plain language.
   *
   * Lifted from the tactic file's own "**What it does:**" line for that
   * mechanic, falling back to the ability note in abilities.json. Not written
   * fresh — the point is that the briefing a raider reads here is the same
   * description the raid leader is working from.
   */
  what?: string
  /** The tactic file's "Good:" line, shown once as a teaching callout. */
  good: string
  /** Short human failure clause. Never a combat-log query. */
  failText: string
  /**
   * Never produces a per-player failure, whatever the rule says.
   *
   * Some mechanics are measured collectively by their own tactic file and must
   * not name anyone. Sszorak's Mutilate is the clearest: "Bad: Not a per-player
   * failure — track soak count per cast". The player is still told to get into
   * it, the raid still eats the unsplit hit, and the debrief never puts their
   * name against it — which is exactly how the analyser reports it.
   */
  collective?: boolean
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
  /**
   * Where a carried debuff is meant to END UP, in words.
   *
   * Some carries are liabilities to be dumped anywhere empty; some are tools
   * with a destination. Slithering Flame is the second kind — it has to expire
   * on the Amani corpses, because Cremation is what stops them getting back up.
   * The briefing said "walk 24 yards clear of the group and drop it" while the
   * live prompt said BURN A CORPSE and the Good line said walk it onto the pile:
   * three instructions, one of them wrong, all on screen at once.
   */
  carryTarget?: string
  /**
   * Replaces the generated instruction line for this one mechanic.
   *
   * The briefing is derived from the rule type on purpose — 98 mechanics times
   * three roles is 294 hand-written lines to keep in step with the engine, and
   * they would drift. But a rule type describes the SHAPE of a demand, not
   * every demand that shares that shape: Siphon Blood is a `beInside` whose
   * damage is not split among the soakers at all, and where only un-debuffed
   * players may go in. Derivation cannot know that.
   *
   * Use sparingly, and only where the derived line would be actively wrong. The
   * verb still comes from the rule, so the shared vocabulary survives.
   */
  brief?: string
  /** Leaves a persistent hazard behind when it resolves. */
  spawns?: { defId: string; delayMs?: number }
  /**
   * On resolve, summon adds rather than drop a hazard.
   *
   * Venomous Emergence is "a 3s cast summoning three Spawn of Vexhul ... an
   * add-spawn marker, not a failure", and that is the whole mechanic: the cast
   * itself cannot be failed, and everything it costs the raid is downstream of
   * the bodies arriving. An add summoned this way is never ALSO dealt out by the
   * wave timer — the scheduler reads this field and takes it out of the trash
   * rotation, so wiring up a summon cannot forget to switch the wave off.
   */
  summons?: { addId: string; count?: number }
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
  /**
   * A `line` mechanic that fires from where it spawned back into the entity
   * that cast it, reaching exactly that far.
   *
   * Toxic Droplets are defused by standing on them, and each one soaked shoots
   * a Living Venom back into Breath. Drawn as an ordinary floor circle it read
   * as "another puddle"; drawn as a beam between the droplet and the golem it
   * reads as the thing it is, and the raid can see which lane to leave clear.
   */
  aimsAtCaster?: boolean
  /** Hazards that drift, e.g. Sszorak's Tempest vortices. */
  driftSpeed?: number
  /**
   * Fire this many copies at once, fanned around the origin.
   *
   * Tempest is "nine vortices sent out from the boss"; Caustic Claws flings six
   * globs of toxin around where he is standing. Drawn as one shape each was a
   * different mechanic entirely — a single circle to sidestep, rather than a
   * room filling up with things that are all still moving.
   */
  count?: number
  /**
   * The copies travel OUTWARD from where they spawned rather than on random
   * bearings.
   *
   * The Tempest vortices leave the boss like spokes. Random drift put half of
   * them straight back through him, which is the one part of the floor the melee
   * and both tanks cannot leave.
   */
  radialDrift?: boolean
  /**
   * Whatever this spawns lands on the nearest of 12, 3, 6 or 9 o'clock.
   *
   * A Viscous Cyst has to be somewhere the Maelstrom's gales can blow the raid
   * INTO it, and a gale only blows on one of the four compass bearings. A cyst
   * dropped between two of them is a gale with nothing at the end of it, which
   * is a wipe nobody can play out of — so the drop is snapped, and the carrier's
   * job is to get it to the right QUARTER of the room rather than to hit a pixel.
   */
  clockDrop?: boolean
  /**
   * Consuming this hazard throws the WHOLE raid this far from it.
   *
   * The cyst. It does not matter where you were standing — the burst reaches
   * everybody — which is what makes it usable as the answer to a gale rather
   * than as one more puddle. Anyone it throws is thrown toward the middle,
   * because the cyst itself is out at the rim.
   */
  raidKnockYards?: number
  /**
   * Touching this slows you, and the slow is dispellable.
   *
   * Tempest is the fight's only dispel — 1287083 is the single `dispellable`
   * entry in the ability data and the logs show 76 healer removals — and the
   * tactic file is explicit that "the slow is the lethal part, because it
   * strands you in the wind". Modelled as a real movement penalty rather than as
   * damage, so it costs you the thing it actually costs you.
   */
  slowMs?: number
  /**
   * The caster keeps walking after its tank while this is in the air.
   *
   * The engine roots a caster under its own telegraph by default, so a frontal
   * never fires from somewhere the boss has already left. A frontal that TRACKS
   * its caster does not have that problem — its shape is re-anchored every tick
   * — and Sszorak's whole opening premise is that he follows the tanks, which he
   * cannot do if five back-to-back casts pin him in place for the entire flurry.
   */
  mobileCaster?: boolean
  /** Pushes the player this many yards away from the shape's origin. */
  knockbackYards?: number
  /**
   * Which half of a split raid this belongs to. A side-tagged mechanic only
   * fires at that group, and is only scored against the player when they are
   * running with it.
   */
  side?: Side
  /**
   * The hazard never expires; `lingerMs` is ignored and it is part of the floor
   * for the rest of the pull.
   *
   * A real constraint rather than a convenience. Blood Venom pools and Essence
   * Rend puddles accumulate, so an encounter steadily consumes its own floor and
   * gets harder because of where people stood ten minutes ago. That is the whole
   * lesson of both mechanics, and a pool that quietly despawns removes it.
   */
  permanent?: boolean
  /** Spawned once at the pull and never resolved — furniture, not a cast. */
  fixture?: boolean
  /** Anchored to the middle of the room rather than to a caster or a spawn roll. */
  atCentre?: boolean
  /**
   * Instead of one hazard where this resolved, every body that soaked it drops
   * one at their own feet.
   *
   * Unstable Miasma does this: the soak is correct play, and the pools it leaves
   * behind are the price the red group pays for splitting the damage.
   */
  spawnsAtSoakers?: string
  /**
   * A permanent stacking aura on everyone within `radius` of the casting entity.
   *
   * Mark of Acid and Mark of Blood are exactly this — "hit everyone in 40yd,
   * 40s, stacking, forever". Modelled per-entity so that standing in range of
   * both golems stacks both, which is the specific mistake a split raid makes
   * and the reason its healers suffer for it.
   */
  proximityStack?: { radius: number; everySec: number; damagePerStack: number }
  /**
   * On resolve, fire `defId` this many times, `everyMs` apart.
   *
   * Soulcoil Ignition is four Soulcoil Rites a second apart. Rolling it into a
   * single lump of damage would hide the thing the healer actually has to cover.
   */
  channel?: { defId: string; count: number; everyMs: number }
  /**
   * Energy granted to the boss when this resolves.
   *
   * Nek'zali's bar is fed by events, never by the clock: every point on it is a
   * Rite that happened — ten per scripted Ignition, five more for every Amani
   * that reached the water — so the bar reads backwards as a history of the pull.
   */
  energy?: number
  /**
   * Adds a permanent stack of the named mechanic, raising all later damage taken.
   * Ritual Burn is the running score of what this pull has already cost you.
   */
  stacks?: { defId: string; amountPct: number }
  /**
   * A mechanic that splits the raid in two. On alternate casts the player is
   * handed `defId` instead of being scored on this one, so a single intermission
   * trains both halves rather than whichever one they happened to be assigned.
   */
  alternatesWith?: { defId: string }
}

/**
 * A non-circular floor, in yards, arena-centre origin.
 *
 * Almost every room in this raid is round and `arenaRadius` says all there is to
 * say. The Entombed Sentinels' is not: it is an octagon with an alcove at each
 * end. That is not decoration — the fight asks the tanks to hold the golems 40+
 * yards apart while each group stays inside its own 40-yard bubble and outside
 * the other's, and whether that is even possible is a question about the shape
 * of the floor.
 *
 * The measured evidence agrees. The circle fitted to 126,814 position samples
 * over 34 PTR pulls came out with a corner/axis ratio of 0.89 — players reach
 * measurably less far on the diagonals than on the axes, which is what an
 * octagon looks like when you fit a circle to it. A true circle would be 1.0.
 */
export type Arena = { kind: 'polygon'; points: Vec[] }

/**
 * Which half of a split raid something belongs to.
 *
 * The Entombed Sentinels are two golems held apart with a group parked on each,
 * so nearly everything on that fight is owned by one side or the other. A
 * mechanic that fires at the wrong group teaches the wrong reflex.
 */
export type Side = 'green' | 'red'

/**
 * A stage of a fight, when a fight has stages.
 *
 * Only two bosses in this tier need them — PHASES.md records that three of the
 * eight have no phases at all and two say so in as many words — so this is
 * optional and a boss that omits it behaves exactly as before, driven by `loop`
 * and the energy bar.
 */
export interface PhaseDef {
  id: string
  name: string
  /** Shown as a banner the moment it begins. */
  banner: string
  loop: string[]
  loopIntervalSec: number
  ambient?: string[]
  /** Ends when the boss drops to this fraction of health. */
  endsAtBossHp?: number
  /** Ends when the shared energy bar fills. */
  endsAtFullEnergy?: boolean
  /** Ends when every add with this id is dead. */
  endsWhenAddsDead?: string
  /** On entry, spawn this add once, outside the normal wave cadence. */
  onEnter?: { addId: string; count: number }[]
  /**
   * A mechanic fired the instant the stage begins, rather than one interval in.
   *
   * Dig In is the case. It IS the intermission — he plants himself and takes
   * +30% for 25 seconds — so a stage that waited a full loop interval before
   * casting it would spend its opening seconds being an intermission that had
   * not started yet, and the burn window would run out after the gales rather
   * than during them.
   */
  opensWith?: string
  /**
   * No ordinary add waves for the duration.
   *
   * A set-piece stage used to be detected by "does it bring its own adds", which
   * silently failed for an intermission that brings none — Vitriolic Stasis is
   * the orb game and nothing else, but the wave timer kept delivering Venom
   * Coagulations into the middle of it. Stating it beats inferring it.
   */
  suppressAddWaves?: boolean
  /** Every entity takes this much reduced damage for the duration, 0..1. */
  entitiesReduction?: number
  /** The entities walk toward one another instead of being held at station. */
  entitiesConverge?: boolean
  /**
   * On exit, the weaker entity is healed up to match the healthier one. The
   * tactic file calls the health delta at Stasis "the most actionable number on
   * the fight" — this is why it is actionable.
   */
  levelEntitiesOnExit?: boolean
  /** On exit, the tanks trade entities and drag them back to their own sides. */
  swapEntitiesOnExit?: boolean
  /** On exit, any add corpse nobody burned stands back up as this add. */
  resurrectCorpsesAs?: string
  /**
   * The gales, and the one stretch of the fight you face alone.
   *
   * Howling Maelstrom, which the ability data describes as "a succession of
   * directional gales" and says to "detect the phase via Dig In" because the
   * marker itself has no cast events. So it is authored as a property of the
   * stage rather than as a mechanic anybody can fail — the deaths inside it land
   * under `Falling`, exactly as the tactic file records them.
   *
   * The sequence, per gale: the wind carries you at a Viscous Cyst, your body
   * bursts it, the burst throws you back at the boss, and for five seconds the
   * wind keeps blowing but cannot move you. Then it turns and does it again from
   * the other side. Two globs, two gales, and the stage ends on the second brace
   * rather than the instant the last one pops.
   *
   * The raid is off the floor for it. Nineteen allies riding the same wind
   * arrive first and burst the glob for you, which is a stage you watch rather
   * than one you play.
   *
   * The stage guarantees exactly two cysts, on two different quarters of the
   * room. Fewer and a gale has nothing at the end of it — a wipe caused a minute
   * earlier by something the debrief cannot name. More, or two on the same mark,
   * and the wind either runs a beat nobody expected or never reverses.
   */
  windToCysts?: boolean
}

/**
 * A fountain Vashnik drinks from, and everything that drinking brings.
 *
 * The three altars are colour-coded — red north, orange south-west, purple
 * south-east — and the colour is not decoration. It is how the raid calls which
 * pair is about to fire, so the renderer has to carry it as faithfully as the
 * mechanics do.
 *
 * Imbibe drains the two NEAREST the boss, and the boss follows its tank. That
 * makes this the only mechanic in the raid where the tank's footwork chooses
 * what everybody else has to deal with — the tactic file puts it exactly that
 * way: "his position picks the fountains, so the tank picks the raid's next
 * mechanics". Draining the same altar twice running stacks its Infusion and
 * empowers both its add and its debuff, so standing still is the failure.
 */
export interface AltarDef {
  id: string
  name: string
  /** Where it stands, in yards from the arena centre. */
  pos: Vec
  /** The raid's name for it, and the colour the arena paints it. */
  colour: string
  /** Real spell id of the Infusion draining it grants. */
  infusionSpellId: number
  /** The add it sends toward the Cavity. */
  addId: string
  /** The Adaptive Infection variant it puts on the raid. */
  debuffId: string
  /** The unavoidable Expulsion it fires when drained. */
  expulsionId: string
}

export interface BossDef {
  key: string
  name: string
  /** Fountains the boss drinks from. Vashnik is the only fight with them. */
  altars?: AltarDef[]
  /** Playable radius in yards. Leaving it is a fall — the real killer on Sszorak. */
  arenaRadius: number
  /** A non-circular floor. When absent the room is a circle of `arenaRadius`. */
  arena?: Arena
  /**
   * The floor is a platform in a sea of acid, and the renderer bubbles it.
   *
   * Placed off the arena shape rather than off a second list of coordinates:
   * anywhere that is not floor is acid, which covers both the sea around the
   * platform and the venom sitting in a bite taken out of it. Flavour, but
   * load-bearing flavour on the Twin Fangs — the pocket the Spawn of Vexhul
   * surface in has to read as somewhere you cannot stand, and an unmarked gap in
   * a dark floor does not.
   */
  acid?: boolean
  /** The player picks a side before the pull, and the raid splits in two. */
  sided?: boolean
  /** Stages, when the fight has them. Omit and `loop` drives the whole pull. */
  phases?: PhaseDef[]
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
  /**
   * The raider this instance is aimed at: an `Ally.id`, or -1 for the player.
   *
   * Only ever set by a fixate. The shape stays anchored on its caster and swings
   * to follow this target for as long as it is telegraphing, which is why an
   * `aimAway` line can be re-pointed by walking and an ordinary frontal cannot.
   */
  aimedAt?: number
  /**
   * Overrides a `line` shape's length for this instance only.
   *
   * A beam that travels from where it started to a thing that moves cannot have
   * its length written down in advance. Living Venom is shot back from the
   * droplet that was soaked into the golem that spat it, so its reach is the
   * distance between those two at the moment it fires — anything else either
   * falls short of the boss or shoots straight through and out the far side.
   */
  reach?: number
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
  /** Which group they run with on a split fight. */
  side: Side
  /**
   * Helical Toxins: how many of their four orbs are green. Only meaningful while
   * `marked`, and the number a partner has to complement to reach four.
   */
  green: number
  marked: boolean
  /**
   * Which of the two stack groups this raider runs with, 0 or 1.
   *
   * Distinct from `side`. A side is half a raid parked on its own boss and is
   * about where you stand all pull; a group is a soak rota and is about WHOSE
   * TURN it is — the two Mutilate groups alternate, and the whole demand is that
   * the second cone finds the bodies the first one did not.
   */
  group: number
  /** Which way Raging Crosswinds will throw them, or null while it is not up. */
  wind: Compass | null
  /**
   * The raider they are lining up with this Crosswinds, or -1.
   *
   * Paired off when the bearings are dealt rather than searched for each tick.
   * "Nearest body with the opposite arrow" looks equivalent and is not: two
   * raiders walking past each other swap partners mid-approach, and a raid that
   * keeps changing its mind never finishes lining up before the timer expires.
   */
  windMate: number
  /** Mutilated Gash stacks. A second one on a live stack kills them. */
  gash: number
  gashMs: number
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
  /** Which group the player chose on a split fight. */
  side: Side
  /** Helical Toxins: how many of the player's four orbs are green. */
  green: number
  marked: boolean
  /**
   * Permanent proximity-aura stacks by mechanic id — Mark of Acid, Mark of
   * Blood. Two entries at once is the split raid's characteristic mistake.
   */
  marks: Record<string, number>
  /** Which of the two Mutilate stack groups you were assigned before the pull. */
  group: number
  /** Which way Raging Crosswinds will throw you, or null while it is not up. */
  wind: Compass | null
  /** Mutilated Gash stacks, and how long the current one has left. */
  gash: number
  gashMs: number
  /** ms of Tempest slow left. The healer's dispel is what clears it. */
  slowMs: number
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
  /** Which group the player ran with, on a split fight. */
  side?: Side
  /** Furthest phase reached, for a pull that ended early. */
  phaseReached?: string
  /** The pull ended because the energy bar filled rather than on the clock. */
  enraged?: boolean
  /** Corpses left unburned when an intermission ended, so they stood back up. */
  resurrected?: number
  /**
   * Health gap between the entities when the intermission began — the tactic
   * file's "most actionable number on the fight", because the weaker one is
   * healed up to match and the difference is progress thrown away.
   */
  entityDelta?: number
}
