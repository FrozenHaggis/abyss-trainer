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
   * One cast that bites several times in the same place, and each bite takes a
   * stack of the fight's `counter` off every body standing in it — but only the
   * first bite a body takes. A second bite of the same cast kills them.
   *
   * Ravenous Feast, and the only thing on the Twin Fangs that moves the counter
   * downward. The raid leader states the whole rule in two sentences: "the
   * player needs to stand in it to remove 1 stack ... the player can only be in
   * the circle when it expires once and remove 1 stack, standing in the circle
   * more than one time kills them." The real ability is the same shape — the
   * tactic file's `1310096` Feasted "blocks further removal for 8s and
   * multiplies Feast damage by nine", which is a second bite being fatal
   * expressed as a number rather than as a rule.
   *
   * Emphatically NOT `beInside`. That judges the player's feet at one resolve
   * moment and scores them for being outside, and being outside is CORRECT PLAY
   * for two of the three bites. The only failure here is greed: taking a second
   * one. A raider at zero stacks who never goes near it has played it perfectly
   * and must never be named for it.
   *
   * `bites` fire `biteGapMs` apart out of one instance, re-armed at the end of
   * `resolveInstance` rather than spawned as `channel` children. Children go
   * back through `fire()`/`spawn()` and re-roll their origin, and the mechanic's
   * defining property is that the circle "will expire 3 times but spawn in the
   * same place each time" — a place the raid can commit to walking to and out of
   * three times. Re-arming one instance gives that for free, and `Instance.fed`
   * can then be the memory of who has already had theirs.
   *
   * The tank holding the entity that CAST it is exempt from all of it — no shed,
   * no feeding, no death — for the same reason `groupSoak` exempts the same body
   * from the Mutilated Gash: the melee leash welds them inside the circle and
   * walking out of it is a raid wipe, so the mechanic would kill them on bite
   * two for doing their job perfectly. They still count as a body. The
   * consequence is deliberate and worth knowing: a tank welded to the caster can
   * never shed either, so their count only ever climbs.
   */
  | { type: 'shedStack'; amount: number; bites: number; biteGapMs: number }
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
   * A tanked entity that punishes the raid whenever its own holder walks out of
   * range of it. The mirror of `keepApart`: that one is two tanks who must not
   * come together, this one is one tank who must not leave.
   *
   * Concentrated Spittle and Clotted Bolt, one per serpent. The ability data
   * calls both "a range check, not a dodgeable mechanic — Vexhul pelts her
   * current target only when they are out of melee, so any occurrence means the
   * tank walked out", and the raid leader states the consequence in one
   * sentence: "the tanks must never move out of melee range of the bosses
   * otherwise they both start doing heavy raid damage and wipe the raid very
   * quickly." So there is nothing to dodge and nothing to press. It is a place
   * you have to keep standing, all pull, while everything else in the fight
   * tries to move you.
   *
   * Judged continuously and PER HOLDER, keyed on `BossUnit.targetId`. Both halves
   * matter. Continuously, because — exactly like `keepApart` and the tank swap —
   * the failure is a state you are allowed to sit in rather than an event you
   * miss. Per holder, because there are two serpents and two tanks: the Vexhul
   * tank wandering is Vexhul's range check going off, and telling the Ithraz
   * tank about it would blame them for standing where the fight put them.
   *
   * `maxYards` is NOT melee range and must not be confused with it. `MELEE_RANGE`
   * is 5, and on this floor 5 is unsatisfiable: the serpents are coiled in the
   * acid three yards off the top edge, the nearest walkable floor to either of
   * them is 3.00 yards away, and the AI tank station is 4.947 — so a literal
   * melee leash would have both tanks permanently failing from the pull with
   * nowhere on the platform to go. The number is a leash a tank can actually
   * hold, wide enough to survive Stone Breaker's push and walk its three pools,
   * and the static sweep in invariants.test.js re-checks it against the real
   * polygon so it can never silently become unsatisfiable again.
   */
  | { type: 'holdMelee'; maxYards: number }
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
   *
   * Overrunning the window is a WIPE, not a chip off the raid bar. The raid
   * leader's words are "if one dies and the other isnt dead within 5 seconds its
   * a wipe due to uncoiled wrath", and the survivor's rage is uncapped in both
   * fights that carry this rule — there is no number at which it stops. A drain
   * taught the wrong lesson twice over: it said the sync kill was a healing
   * check, and because the clock reset and the drain repeated, a pull could
   * survive four or five overruns and still be a kill.
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
  /**
   * Carry a debuff clear of the raid before it expires.
   *
   * `minDistance` is measured from the ARENA CENTRE, not from the raid, and that
   * is the whole reason the other two fields exist. On a round room the centre
   * is where the raid stands, so "far from the middle" and "far from people" are
   * the same sentence. On a room that is not round they come apart, and the Twin
   * Fangs is the proof: the wedge is 32 yards of bounding radius but only 3.3% of
   * its floor is 26 yards from the centre, only two points in that 3.3% are 12
   * yards apart, and the whole northern ledge — where both tanks live — tops out
   * at 18.87. A three-carrier `carryOut` at 26 was therefore unsatisfiable for
   * the third carrier and automatically failed anybody standing on the ledge, on
   * a fight where two of the raid's bodies are welded there.
   *
   * `edgeWithin` says the drop has to be AT the rim rather than merely far out —
   * "the player and any ai bots that get this needs to drop at the edge of the
   * platform" — which is a demand the geometry can always meet, because every
   * room has a rim however oddly it is shaped.
   *
   * `apart` says two carriers may not drop on the same spot: "without stacking
   * on each other". Measured between the live carriers of the SAME mechanic, so
   * it is a spread rule rather than a distance-from-the-group one.
   *
   * Both are optional and both default to off, which is exactly what the other
   * nine `carryOut`s in the raid want: a round floor plus a single carrier needs
   * neither clause, and adding them there would be inventing a demand the fight
   * never made.
   */
  | { type: 'carryOut'; minDistance: number; edgeWithin?: number; apart?: number }
  /**
   * Get knocked. Failure is leaving the arena.
   *
   * By default the rim catches you — you are shoved back on, take a scrape and
   * are named for it. A `survive` that also declares `offPlatform` does not
   * catch you: the landing is left where the push put it and the floor check at
   * the top of `step` turns it into the fall. That is Stone Breaker, where being
   * thrown into the venom is the whole reason the knock is a decision.
   */
  | { type: 'survive' }
  /**
   * A pool only the tank holding the casting entity may soak, and MUST.
   *
   * Stone Breaker's three slams. Not `beInside`: that judges the player's feet
   * and pays a flat raid chip whether or not any body covered it, so nineteen
   * raiders standing anywhere would satisfy it and the tank's job would not
   * exist. Not `faceAway` or `tankSwap` either — both are pinned to entity 0 by
   * the ownership sweep, and this one is Ithraz's.
   *
   * The rule is one-sided in both directions. The named tank has to be standing
   * in it when it lands, and nobody else may be scored on it at all: a dps
   * caught in a swirly is taking damage they should have walked out of, not
   * failing a soak they were never assigned.
   *
   * `missFires` is the mechanic id that goes off when the pool lands on nobody
   * — the untanked variant, which on the Twin Fangs pushes the whole raid into
   * the acid. Naming it in data rather than hard-coding the consequence keeps
   * the punishment visible in the boss file next to the thing that causes it.
   */
  | { type: 'tankSoak'; missFires: string }
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
   * How many bodies a `carryOut` lands on at once. One of them is always you.
   *
   * Not `count`, and the two must not be merged. `count` fans copies of a shape
   * around a rolled point on the floor; this deals a carried debuff out to
   * several DIFFERENT raiders, each of whom then walks their own one somewhere
   * else. The spec asks for the second thing — "the player and any ai bots that
   * get this needs to drop at the edge of the platform, without stacking on each
   * other" — and a fan of three circles on top of one body is not it.
   *
   * Left unset the mechanic lands on one body, which is what the other nine
   * `carryOut`s in the raid already do and must keep doing.
   */
  carriers?: number
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
   * An `origin: 'edge'` hazard rises from a NAMED stretch of rim and travels
   * inward across the floor, instead of appearing anywhere on it and wandering.
   *
   * Degrees, measured from the arena centre the way `arenaEdge` measures them:
   * +x is 0 and +y is 90, and on the Twin Fangs +y is the mouth end of the
   * wedge. `{ fromDeg: 10, toDeg: 170 }` is therefore "somewhere along the
   * southern rim", which is the whole of Stir the Depths' geometry — the waves
   * come out of the venom at the wide end and run up the room, so every raider's
   * escape is northward or sideways and never back toward the pocket.
   *
   * Four separate behaviours hang off this field being PRESENT, and all four
   * are gated on the field rather than on `origin === 'edge'` for one reason:
   * the raid's other edge mechanic is the Coiled Altar's Axegrinder, whose own
   * comment says it "comes off the wall and ricochets". A random facing and the
   * bounce at the rim ARE that mechanic. Making every edge spawn inward-facing,
   * or suppressing the bounce for every edge origin, would silently turn an axe
   * that criss-crosses the room into one that crosses it once and leaves.
   *
   *   • the spawn bearing is rolled inside the arc rather than round the circle
   *   • the hazard faces inward (see `radialDrift`, which then carries it there)
   *     with a spread, so six of them cross in six directions rather than all
   *     funnelling through the middle of the room
   *   • it does not bounce off the far rim: it has crossed the platform and gone
   *     back into the sea it came out of, so it is retired instead
   *   • it is judged on CONTACT rather than at the instant it resolves. The
   *     other way round, a hazard that is live for a four-second crossing would
   *     be scored on where one arbitrary frame of it found you — see the
   *     exemption in `case 'avoid'` and the branch that replaces it in the
   *     linger tick, which bills the body once per hazard rather than per frame.
   */
  edgeArc?: { fromDeg: number; toDeg: number }
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
   * Consuming this hazard throws the WHOLE raid, this fraction of the room's
   * DIAMETER.
   *
   * The cyst. It does not matter where you were standing — the burst reaches
   * everybody — which is what makes it usable as the answer to a gale rather
   * than as one more puddle.
   *
   * A fraction of the room rather than a distance in yards, and it has to be:
   * the throw is meant to carry you most of the way across the floor, so it is a
   * statement about the room and not about a number that happens to suit a
   * 56-yard one. Written as yards it was set to just under the gap between the
   * glob and the boss, which meant the knock always ENDED on him — a teleport
   * wearing a knockback's clothes, and it read as one.
   */
  raidKnockRoom?: number
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
   * The knock is NOT clamped back onto the rim, and every body it catches goes
   * — the raid as well as you.
   *
   * `survive` was written as a shove you get scolded for: the landing is pulled
   * back inside the floor, a failure is recorded, and you carry on. That is the
   * right model for Circling Prey and the wrong one for Stone Breaker, where the
   * raid leader's ruling is explicit — being thrown off the platform kills you.
   * Measured over the real wedge, a 10-yard push away from Ithraz makes 46% of
   * the floor a fatal place to stand and everything at y >= 14 certain death, so
   * this flag turns a knockback nobody had to think about into the fight's one
   * real positioning decision.
   *
   * Two things ride on it together and they must never be separated. Allies are
   * thrown and killed by the same code the player is, AND the ally AI gets a
   * knock-aware pre-position (`allyThink` step 6e). Without the second, 31 of the
   * 72 bearings the raid used to gather on are fatal and a single cast kills
   * roughly eight raiders — see the comment on that step.
   *
   * The precedent is `windPair`, which has done exactly this since the Sszorak
   * work: it does not kill anybody itself, it simply leaves the body outside the
   * polygon and lets the floor check in `step` do the rest. So this needs no
   * `lethal` — which matters, because lethality is derived from the ability's
   * category and Stone Breaker's is Important, not Deadly.
   */
  offPlatform?: boolean
  /**
   * On the CHILD of a `channel`: when the last of the run has been answered
   * cleanly, the two tanks trade entities.
   *
   * Stone Breaker's three slams are the Twin Fangs' swap driver — "once all
   * three are soaked, the tank tanking Vexhul starts tanking Ithraz". Envenomed
   * used to be, as a plain `tankSwap` on a timer, and the fight is better for
   * the trade being earned rather than announced: a tank who covers the run gets
   * the swap, a tank who drops one gets the raid pushed into the acid instead.
   *
   * On the child rather than on the parent `channel` deliberately. The child
   * already knows both of the other two facts — whether it is the last of its
   * run (`w.queue` has none of it left) and whether the run stayed clean
   * (`World.soakRunClean`) — so putting the third here means the resolve reads
   * three fields it holds. On the parent it would need a reverse lookup over
   * every mechanic on the boss on every child resolve, which returns `undefined`
   * the day somebody renames the child.
   */
  tradeTanksOnClean?: boolean
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
   *
   * `ringYards` and `arcDeg` place the run instead of leaving each beat to roll
   * its own spot: the children are fanned across an arc in front of the caster,
   * on the floor, in the order they fire. Stone Breaker is three slam pools laid
   * out around Ithraz, and a tank cannot be asked to walk a sequence that lands
   * somewhere different every time. Omit both and every beat rolls its own
   * origin exactly as Soulcoil Ignition always has.
   *
   * Different mechanism from the `count` fan in `fire`, and kept apart from it
   * on purpose — see `arcOnFloor`. The fan puts a ring AROUND a point all at
   * once; this lays a bounded arc, sequenced, with the endpoints included.
   */
  channel?: { defId: string; count: number; everyMs: number; ringYards?: number; arcDeg?: number }
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
  /**
   * This mechanic IS the fight's stack counter, and `lethalAt` of it kills.
   *
   * Eternal Venom. The Twin Fangs tactic file opens by calling the encounter "a
   * resource problem: Eternal Venom arrives from seven sources continuously ...
   * and is shed only one per player per Ravenous Feast", and a trainer that
   * models that as a raid-damage floor is teaching a different fight — one where
   * every source is interchangeable with every other and none of them is worth
   * dodging in particular.
   *
   * Declared in DATA rather than hard-coded in the engine so that everything
   * which needs the number finds the same one: the HUD, the briefing, the
   * debrief and the death all read `mechanics.find(m => m.counter)`. There is
   * exactly one counter per fight by construction — a second would give the HUD
   * two bars and the player no idea which one kills them.
   *
   * Only the PLAYER reaching `lethalAt` ends the pull. An ally who gets there
   * dies where they stand and the run carries on: their body is a real loss —
   * the raid bar drops and they leave the soak rota — but a pull that ended
   * because the AI misplayed its globules would be a wipe with nothing the
   * player could have done, which is the defect class this project keeps
   * having to re-fix.
   */
  counter?: { lethalAt: number }
  /**
   * How many stacks of the fight's `counter` this mechanic hands out, and to whom.
   *
   * Three different bodies, because Caustic Globule pays three different ones
   * out of a single def and no scalar could express it:
   *   • `hit`   — the body that stood in it. Never the body it was AIMED at:
   *               being chosen is not billed anywhere in this engine.
   *   • `raid`  — everybody, player and allies alike. Venomous Emergence, and a
   *               globule nobody swept.
   *   • `soak`  — the one body that ran over the pickup on purpose. Correct play
   *               that still costs a stack, which is the whole tension of the
   *               soak rota.
   *
   * `everyMs` is how long before the SAME body can be billed again by the same
   * instance. Omit it and one instance bills each body exactly once, which is
   * right for anything that resolves; a lingering beam you can walk back into
   * needs a period or it charges once and then becomes free floor.
   */
  applies?: { hit?: number; raid?: number; soak?: number; everyMs?: number }
  /**
   * How long this shape sits on the floor inert before it reads as dangerous.
   *
   * Caustic Deluge's splashes land as pale rings and only bite 1.5 seconds
   * later. That delay is the whole reason ten circles across a small wedge is a
   * room you can walk through rather than a carpet: the raid reads where the
   * pair went while it is still harmless, and moves once.
   *
   * RENDER-ONLY, and deliberately so. `avoid` is judged exactly once, at
   * resolve, so an armed-vs-unarmed circle scores identically and there is
   * nothing here for the engine to branch on — the telegraph IS the window.
   * That makes this a drawing instruction and not a rule, which is why it must
   * never reach `brief.ts`, a tooltip, `what:`, `good:` or `failText:`. Told
   * "it arms after a second and a half", a raider starts counting; shown a ring
   * that goes from pale to lit, they look at the floor. Pinned by a test.
   */
  armsAfterMs?: number
  /**
   * A beam that TURNS while it is live. Vile Flood, and nothing else in the raid.
   *
   * Every other shape in this engine is aimed once and then either sits there or
   * drifts in a straight line. This one is a cast that is still happening: the
   * cone switches on pointing somewhere and arcs round the platform for the
   * whole of its `lingerMs`, so what a raider has to read is not where it is but
   * which way it is going and how much floor it has left to cover.
   *
   *   • `startDeg` — the bearing it switches on at, degrees, +x is 0 and +y is
   *     90, measured from the CASTER. It is deliberately a bearing with no floor
   *     under it: the beam has to come on over water and arrive at the platform
   *     already moving, or the raiders standing where it starts are hit by
   *     something that was never telegraphed anywhere.
   *   • `degPerSec` — how fast it turns. The binding constraint is the TRAILING
   *     edge at the furthest floor point: turn faster than a player can run
   *     sideways and the beam is not dodgeable, it is a die roll. Measured on
   *     the Twin Fangs wedge, 15°/s is 9.49 yd/s at the furthest floor point,
   *     against `PLAYER_SPEED` of 14.
   *   • `mirror` — alternate the handedness cast by cast, reflecting the whole
   *     sweep about the room's x = 0 axis (bearing θ becomes 180 - θ and the
   *     turn reverses). Three Submerges in a pull, and a beam that always went
   *     the same way would have one memorised answer; mirrored, the half of the
   *     room that stays clear is the other half every time. Only sound in a room
   *     that is symmetric about that axis — this wedge is, exactly — because the
   *     guarantee that the sweep leaves a lane is proved against the polygon and
   *     a reflection only preserves it if the polygon is preserved.
   *
   * The cost is charged on CONTACT rather than at the resolve, for the same
   * reason a Stir the Depths wave is: there is no instant at which a ten-second
   * torrent "goes off". See the exemption in `case 'avoid'` and the branch that
   * replaces it in the linger tick.
   */
  sweep?: { startDeg: number; degPerSec: number; mirror?: boolean }
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
  /**
   * A SCRIPT rather than a metronome: each entry waits for the one before it.
   *
   * Every other rotation in this raid is a clock. `loopIntervalSec` elapses, the
   * next id in `loop` fires, and whether the previous mechanic has finished is
   * nobody's business — which is right for a fight whose mechanics are supposed
   * to pile on top of one another, and wrong for the Twin Fangs, where the raid
   * leader's description is a list of "once this completes". "The Stone Breaker
   * and soaks do not happen at the same time as the Caustic Deluge and the
   * Globules" is not a gap you can hand-tune into an interval; it is a
   * dependency, and the only honest way to express it is to make the next step
   * wait.
   *
   * So on a sequential stage `loopIntervalSec` stops being the period and
   * becomes the BEAT BETWEEN steps: the gap from the previous step closing to
   * the next one being cast. A stage with nothing pending counts that gap down
   * and fires; a stage waiting on a step does not count at all.
   *
   * Two consequences worth stating, because both look like bugs from outside:
   *
   *   • the whole loop is unlocked from the first tick. `unlockedCount`
   *     introduces mechanics a few at a time, which on a scripted stage would
   *     not slow the fight down, it would REORDER it — the first pass would run
   *     the first two steps twice over and the strict order the script exists to
   *     express would be a fiction.
   *   • the stage ends when the last step closes. That is its exit condition and
   *     it needs no field of its own, exactly as the pairing and the Maelstrom
   *     exits need none: the script running out IS the stage being over.
   *
   * What counts as "closed" is `stepClosure` in sim.ts, and it is the load-
   * bearing piece — see the comment there before changing anything about it.
   */
  sequential?: boolean
  /**
   * Entities that leave their station for the duration of the stage.
   *
   * "When submerge happens Vexhul will disappear and reappear in the pocket and
   * start channeling Vile Flood ... Ithraz also disappears and spawns out in the
   * acid." Both go somewhere OFF the walkable floor and come back to exactly
   * where they were when the stage ends, which is why this is a phase-scoped
   * position and emphatically not an edit to `entities[]`: their start positions
   * are the fight's furniture for the other ninety percent of the pull, and a
   * stage that permanently moved them would silently rewrite every measurement
   * taken against them.
   *
   * It is not only a visual. Three things read it and have to:
   *
   *   • a `holdMelee` leash is SUSPENDED for a relocated entity. The serpents
   *     are unreachable and immune for the intermission, so a range check
   *     judged during one is an instant wipe for doing what the stage asks.
   *   • the ally tanks stop being tanks for the duration and rejoin the raid,
   *     rather than walking to a station that is now in the acid.
   *   • anything anchored on the caster — a boss-origin cone, a channel's arc —
   *     is laid from wherever the entity has gone, which is the point: Vile
   *     Flood has to sweep out of the pocket and not off the ledge.
   */
  relocate?: { id: string; to: Vec }[]
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
  /**
   * What the debrief says when the energy bar fills and nothing spends it.
   *
   * The hard end of a pull is normally "the bar filled — enraged", and on the
   * six fights whose bar really is an enrage meter that is the truth. On the
   * Twin Fangs it is a lie: nothing feeds the bar per second, Vile Flood puts 34
   * on it, and 34/68/102 means the bar is a Submerge counter — the pull ends
   * because "if the boss isnt dead by the 3rd submerge, the raid wipes", which
   * is a mechanic with a name and a cause the player can do something about.
   * A death screen that blamed a timer would send them away practising nothing.
   *
   * Omit and the generic line stands.
   */
  enrageText?: string
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
  /**
   * The ADD that cast this, by `Add.uid`, when an add cast it.
   *
   * `fromId` cannot answer this. It is set from the owning ENTITY — the def's
   * `from` — so a Corrosive Spit fired out of the pocket by a Spawn of Vexhul
   * points at Vexhul, nineteen yards away on the other side of the room, and
   * nothing on the instance knew which of the three spawns actually cast it.
   *
   * Which mattered the moment one of them died mid-cast: dead adds are dropped
   * wholesale from `w.adds` and nothing swept the instances, so a five-second
   * beam outlived its caster and fired into the player from a corpse. Killing
   * the spawns fast is the entire lever on this fight's venom income, so a beam
   * that survives its caster quietly punishes the exact play being taught.
   *
   * Deliberately generic rather than a Corrosive Spit special case: every add in
   * the raid with a `casts` link has the same defect the day it is written.
   */
  castByAddUid?: number
  /**
   * Body id -> the ms at which this instance last charged them a counter stack.
   *
   * -1 is the player, anything else an `Ally.id`, matching `aimedAt`. Kept on the
   * INSTANCE rather than on the body because the question is "has this beam
   * already billed me", and a flag on the body would let one hazard's charge
   * pay for standing in another's.
   */
  touchMs?: Record<number, number>
  /**
   * `shedStack` only: how many bites of this cast are still to come, counting
   * the one currently in the air.
   *
   * Set on the first resolve and counted down by the re-arm at the bottom of
   * `resolveInstance`. `undefined` means "not started yet", which is why every
   * read of it falls back to the rule's own `bites` rather than to zero.
   */
  bitesLeft?: number
  /**
   * `shedStack` only: the bodies this cast has already fed.
   *
   * -1 is the player and anything else is an `Ally.id`, the same convention as
   * `aimedAt` and `touchMs`. On the INSTANCE rather than on the bodies because
   * the memory is "has THIS cast fed you", and it has to be forgotten when the
   * cast ends — a flag on the body would carry across to the next Ravenous
   * Feast and quietly make the second one lethal from its first bite.
   */
  fed?: number[]
  /**
   * `sweep` only: how fast and which way this beam is turning, radians a second.
   *
   * Signed, and the sign is the whole of what `sweep.mirror` decides — so the
   * handedness is settled once, at the cast, and every tick afterwards is
   * `angle += spin * dt` with nothing left to look up. Storing the rate rather
   * than the angle turned means the instance never has to remember where it
   * started, and `angle` stays the single source of truth for where the beam is
   * pointing, which is what the renderer and `isInside` both read.
   */
  spin?: number
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
  /**
   * Stacks of the fight's `counter` this raider is carrying.
   *
   * Beside `gash` because it is the same kind of thing — a per-body count the
   * fight applies and the body eventually dies of — and for the same reason it
   * has to exist at all: "the rest of the non-tank AI players soak the rest" is
   * fiction unless the raid can actually be charged for it. Nineteen bodies that
   * eat globules for free make the player's own soak a formality.
   *
   * An ally at the lethal count dies where they stand and the pull carries on.
   */
  venom: number
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
  /**
   * Stacks of the fight's `counter` you are carrying. Reaching `lethalAt` ends
   * the pull, and the debrief names the counter rather than chip damage.
   *
   * Never falls off on its own, and only one mechanic in the raid takes any of
   * it back off you — which is what makes it a currency rather than a debuff.
   */
  venom: number
  /** ms of Tempest slow left. The healer's dispel is what clears it. */
  slowMs: number
  /**
   * An impulse carrying the player somewhere they did not walk.
   *
   * Every other knockback in this engine is an instant change of position, which
   * is fine for a shove of fifteen or twenty yards. A Viscous Cyst throws you
   * most of the way across the room, and at that distance an instant reposition
   * does not read as being thrown — it reads as a teleport, which is exactly
   * what it was called. So this one travels: a velocity in yards/sec and the
   * time left to run, applied in the movement block ahead of your own input.
   *
   * `safe` clamps the flight to the floor instead of letting it carry you off.
   * The cyst burst is the ANSWER to the gale that is pushing you at the rim; a
   * version of it that could finish the job would make the stage unsurvivable by
   * design.
   */
  knock: { vx: number; vy: number; ms: number; safe: boolean } | null
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
  /**
   * The highest the player's `counter` reached, and the worst any single ally
   * carried. Only present on a fight that has a counter at all.
   *
   * Two numbers rather than one because they fail in opposite directions and
   * the fix is different for each. Your own peak is your footwork. The raid's
   * peak is the soak rota: if that climbs while yours does not, the pull was
   * lost to globules nobody swept, and telling the player to dodge better would
   * be pointing them at the wrong half of the fight.
   */
  venomPeak?: number
  venomRaidPeak?: number
  /**
   * How many stacks the PLAYER got back off, across the whole pull.
   *
   * The third number, and the one that says whether they played the economy or
   * merely survived it. A peak of six with nothing shed is a raider who never
   * found a Ravenous Feast bite; a peak of six with four shed is a raider who
   * took ten and worked. Yours only, not the raid's: the AI's bite rota is not
   * something the player can influence, and reporting it here would read as a
   * score for something they did.
   */
  venomShed?: number
}
