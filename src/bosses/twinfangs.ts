import type { BossDef } from '../engine/types'

// The Twin Prompts — a parody of The Twin Fangs.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. The joke lands on the boss, but what you practise has to
// transfer to the actual raid, and it cannot if "Coiling Ichor" is called
// something else here.
//
// Authored from 12.1/VenomousAbyss/TwinFangs/TwinFangs.md and abilities.json.
// Every spellId below is real and appears in that abilities.json; the `good`
// strings are the file's own "Good:" lines.
//
// HEROIC ONLY. Everything tagged `difficulties: ["Mythic"]` is excluded — Blood
// Torrent, Tainted Blood, Tainted Burst, Rouse the Brood, Visceral Burst and
// Barbed Bulwark. That has two consequences worth stating out loud, because both
// look like authoring mistakes and neither is:
//
//   • There is NO interrupt on this boss. Both of its kick targets (Barbed
//     Bulwark, Visceral Burst) are Mythic-only. Corrosive Spit has a cast bar
//     but PreventionType 0, Clotted Bolt is instant, Bloody Expulsion is a
//     channel on an add you kill, and Spew Venom is unattested. You dodge.
//   • There is NO dispel. DispelType 0 on every debuff in the fight and zero
//     dispel events across the logs. The tactic file says outright: "Render no
//     dispel section."
//
// The file's overview sets the design: "The real boss is a resource problem:
// Eternal Venom arrives from seven sources continuously ... and is shed only one
// per player per Ravenous Feast." So it is modelled as one: `venom` declares
// `counter`, every source that feeds it declares `applies`, and every body in
// the raid — yours and the nineteen AI ones — carries its own count. Reaching
// the cap kills. The two soaks, Caustic Globule and Ravenous Feast, carry the
// "run IN" half of the movement so the loop is not just five flavours of "run
// out", and they are now the two ends of the economy as well: one buys a stack,
// the other is the only thing in the fight that sells one back.

export const twinfangs: BossDef = {
  key: 'twinfangs',
  name: 'The Twin Prompts',
  realName: 'The Twin Fangs',
  blurb: 'Nothing to kick, nothing to dispel. Venom never washes off — the soaks are the only relief.',
  // Measured from PTR combat logs, not guessed: Rounded/octagonal, low confidence (corner/axis 1.19). Much the smallest floor in the raid.
  // 1 yard = 100 coordinate units.
  //
  // The measurement is a circle fitted to position samples, and it was fitted at
  // "low confidence" for a reason: this floor is not round. It is a wedge, wide
  // at the mouth and narrowing to the ledge the serpents are coiled on, with a
  // pocket of venom bitten out of the middle of its bottom edge.
  arenaRadius: 32,
  // The platform floats in it, and the pocket is a hole straight through to it.
  // Falling in either place is the same death.
  acid: true,
  arena: {
    kind: 'polygon',
    points: [
      // The ledge at the top, where both serpents sit with the venom sea behind
      // them. Narrow: there is barely room for the two tanks up here, which is
      // why the raid works down the wedge rather than stacking at the front.
      // Every corner stays inside arenaRadius, which the engine still treats as
      // the bounding radius everywhere else — the wedge is a shape for the same
      // 32-yard floor the logs measured, not a bigger room.
      //
      // The top edge was at y=-25 and the room played long: a raid at the mouth
      // and a serpent on the ledge were 45 yards apart, most of it empty floor
      // nothing ever used. Cut to y=-16, which takes 9 yards out of the middle
      // and none out of the mouth, where the pocket and the soaks live.
      { x: -10, y: -16 }, { x: 10, y: -16 },
      // The right leg, flaring out to the mouth.
      { x: 23, y: 21 },
      // The venom pocket — a bite out of the bottom edge, not a puddle on it.
      // The Spawn of Vexhul surface in here and nobody can stand on them, which
      // is what fixes one end of every Corrosive Spit line in place.
      //
      // Blunt, and never narrower than 8 yards. It was a triangle coming to a
      // point at (0,11), and a hole that tapers to nothing is a hole nobody can
      // read: at y=12 it was 1.2 yards wide, thinner than a single movement
      // tick, so players crossed the 4-yard band under the apex and simply died
      // on the far side of a gap they never saw. A pocket has to be wide enough
      // to be walked around on purpose, or it is not a pocket, it is a trap.
      { x: 6, y: 21 }, { x: 4, y: 15 }, { x: -4, y: 15 }, { x: -6, y: 21 },
      // The left leg.
      { x: -23, y: 21 },
    ],
  },
  // "A permanent channel pulsing the raid every 4s and gaining +15% of its own
  // damage per pulse — a soft enrage with no interrupt, so kill the add."
  // 12 killing blows on Heroic PTR. There is nothing to kick on this boss.
  addEverySec: 30,
  // Four: one Bloodcurdled Mass off the wave timer, plus a full Emergence of
  // three. The cap only gates the trash timer, so a scripted Emergence always
  // lands all three — but while they are up the Mass stops arriving, which is
  // the right pressure. Clearing the pocket is what buys the next wave.
  maxAdds: 4,
  adds: [
    {
      id: 'mass', name: 'Bloodcurdled Mass', npcId: 268668, spellId: 1302695,
      job: 'kill', count: 1, hp: 9, fuseSec: 26, auraDps: 0.5, lethal: true,
      spawnRadius: 28,
      good: 'Kill it fast — Bloody Expulsion cannot be interrupted and grows every pulse.',
      failText: 'Bloodcurdled Mass channelled Bloody Expulsion to the end',
    },
    {
      // Summoned by Venomous Emergence, never by the wave timer — the scheduler
      // reads `summons` and takes this out of the trash rotation itself.
      //
      // "Three spawn centre-room per Venomous Emergence. Killing them fast is
      // the single biggest lever on raid-wide Eternal Venom income." The note
      // says centre-room; the pocket at the mouth of the platform is where they
      // actually surface, and it matters more than the note does — a fixed
      // spawn point is the first half of reading the frontals, because the raid
      // knows where every line will start before any of them is cast.
      id: 'spawn', name: 'Spawn of Vexhul', npcId: 264023, spellId: 1291478,
      job: 'kill', count: 3, hp: 4, fuseSec: 30, auraDps: 0.35,
      // Deep enough that all three land in the venom rather than one of them on
      // the lip: the three are fanned 3.5 yards around this point, and from
      // (0,18) the northern one came to rest on the pocket's inner edge — on the
      // floor, where the raid could stand on top of it.
      spawnAt: { x: 0, y: 19 },
      fixates: true,
      // 5s of cast inside an 8s cycle: three seconds of quiet between one line
      // firing and the next marker going out. Tighter than that and a marked
      // player never finishes walking the first one clear.
      casts: { defId: 'spit', everySec: 8 },
      good: 'Kill all three fast. Each one that lives keeps spitting, and living spawns are where the raid\'s venom actually comes from.',
      failText: 'A Spawn of Vexhul lived out its full timer',
    },
  ],
  // Coiled in the acid off the top edge of the platform, three yards clear of
  // the floor, and they do not move: no tank drags them anywhere and they never
  // walk after anybody. The raid comes to them.
  //
  // Being OFF the floor is what makes this placement work where an earlier one
  // failed. A shot is eaten by the first entity it passes within 4.5 yards of,
  // so when the serpents stood ON the ledge the players who ran up to them
  // ended up behind them, and every round fired south at the Bloodcurdled Mass
  // stopped in a serpent's back — the add sat at full health for its whole fuse
  // at 100% recorded accuracy and then killed the raid. Now there is no floor
  // behind them to stand on: the raid is always south of them, shooting north,
  // and the adds are south again in the pocket.
  entities: [
    { id: 'vexhul', name: "Vexhul", npcId: 257361, start: { x: -8, y: -19 }, tankedApart: true, stationary: true },
    { id: 'ithraz', name: "Ithraz", npcId: 257368, start: { x: 8, y: -19 }, tankedApart: true, stationary: true },
  ],
  maxHp: 1,
  // 9.5, not the 6 this ran at, and the change is bookkeeping rather than a
  // pacing decision. Deleting Envenomed took eight of the loop's twenty-two
  // slots out, so at an unchanged interval the whole rotation shortened from
  // 132 seconds to 84 and every OTHER mechanic in the fight arrived 57% more
  // often. Measured, that alone moved a competent healer's death from 85
  // seconds to 53: not because anything got harder, but because Venomous
  // Emergence and Caustic Deluge were both being cast half again as fast.
  // 14 slots at 9.5s is 133 seconds, which is the rotation the rest of this
  // file was tuned against. Step 12 replaces the flat loop entirely; until it
  // does, removing a mechanic should not silently speed up the fight.
  loopIntervalSec: 9.5,
  energyPerSec: 2.2,            // ~45s to the Vile Flood window, so three per pull
  atFullEnergy: 'flood',
  ambient: ['venom'],
  pullLengthSec: 150,

  // Two symmetric halves. Stone Breaker lands once a half, matching the file's
  // "roughly once a minute". Each half forces movement inward (globule, feast,
  // the pre-knock huddle) and outward (Coiling Ichor) rather than only outward.
  // Venomous Emergence sits FIFTH, not twelfth.
  //
  // ENVENOMED IS GONE, and with it the fight's only `tankSwap`. It was a
  // metronome — a stack every third slot, taunt at four — and the swap it drove
  // was a timer wearing a mechanic's name. Stone Breaker is the swap now, which
  // is what the fight actually does: "once all three are soaked, the tank
  // tanking Vexhul starts tanking Ithraz". A trade you earn by covering a run of
  // soaks teaches the run; a trade that arrives on a clock teaches the clock,
  // and the real fight's other swap driver (1289092, +33% Stone Breaker damage
  // per soaked impact) is the same three pools counted a different way. Two
  // mechanics for one job, and only one of them had anything to practise.
  //
  // It was in the last slot of each half, which put the first one 75 seconds
  // into a pull that a clean kill ends at 80 and an enrage ends at 150. The
  // mechanic was correct and almost nobody ever saw it: one Emergence, five
  // seconds before the boss died, and none at all for anyone who died early.
  // A mechanic you meet once at the end of a good pull is not being taught.
  //
  // Fifth puts the first spawns down at about 30 seconds and gives a full pull
  // three or four Emergences, which is the cadence the rest of this loop was
  // already built on.
  //
  // `globule` is NOT in this list and must not be put back. It used to sit
  // behind each `deluge` as its own slot, which meant the pickups were fired by
  // the rotation rather than left by the splashes — a ring of globules round the
  // arena centre, arriving on their own timer, with nothing on the floor to
  // explain where they came from. Caustic Deluge now channels five pairs of
  // splashes and each splash drops its own globule, so the ten arrive as
  // consequences instead of as a scheduled event.
  //
  // `splash` is not in it either, for the same reason and more strongly: it is a
  // beat of a channel, and a single pair of circles with no channel behind them
  // is not a mechanic anyone can read.
  //
  // `slam` and `pushoff` are not in it either, and for the two halves of the
  // same reason `splash` is not. A slam is a beat of Stone Breaker's channel and
  // arrives with its place on the arc already decided; fired from the rotation
  // it is one pool with no run behind it and no swap in front of it. A pushoff
  // is what happens when a slam goes unsoaked — a punishment, not a cast — and
  // the rotation dealing one out would throw the raid into the acid for nothing
  // anybody did.
  loop: [
    'deluge',
    'emergence', 'ichor',
    'stonebreaker', 'depths',
    'feast', 'storm',
    'deluge',
    'emergence', 'storm',
    'stonebreaker', 'depths',
    'feast', 'ichor',
  ],

  mechanics: [
    {
      id: 'uncoiled',
      name: 'Uncoiled Wrath',
      spellId: 1308583,
      what: "1308583 — when either serpent dies the survivor gains stacking, uncapped +30% damage every 4s.",
      from: 'ithraz',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 0,
      origin: 'boss',
      // The entities do not share a health pool, so leaving one far behind is
      // the failure this rule scores. Judged continuously from the moment the
      // first one dies.
      rule: { type: 'syncKill', withinSec: 12 },
      good: 'Both serpents die within seconds of each other.',
      failText: 'Killed one serpent far ahead of the other — Uncoiled Wrath',
    },
    {
      id: 'venom',
      name: 'Eternal Venom',
      spellId: 1290480,
      what: "Permanent stacking Nature poison , no duration, persists through death, fed by splashes, globule ruptures, Venomous Emergence, Corrosive Spit, waves and every Vile Flood tick. At 10 stacks 1292348 executes the carrier.",
      from: 'vexhul',
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // 1290480 is the periodic tick — "scaling with stack count, 24% of all raid
      // damage taken and a direct proxy for how badly the venom economy is
      // losing". That stays as the raid-damage floor, and `counter` carries the
      // half it cannot: the stack count itself (1290336) and its execution
      // (1292348). raidDamage still never scores anyone, and neither does the
      // counter — nobody is blamed for carrying stacks, they simply die of them.
      //
      // TEN, not the nine in data/abilities. The raid leader ruled on this
      // directly and the number is theirs. The `what:` line above was rewritten
      // to match rather than left as the source has it, because a panel reading
      // "at 9 stacks it executes" above a counter that kills at 10 is a lie
      // printed on the teaching surface — and it is the one number on this
      // fight a raider is going to count.
      rule: { type: 'raidDamage', dps: 3.4 },
      counter: { lethalAt: 10 },
      good: 'Adds die fast, high-stack players take the earliest Feast bite, low-stack players soak globules.',
      failText: '',
    },
    {
      // THE PARENT. One def was three mechanics wearing one hat: the channel on
      // the tank, the splashes it throws, and the globules those leave. Fused,
      // the fight could only ever put THREE circles down (a `count` fan) or
      // three globules (a `collect`), never the ten-circle, ten-globule wave the
      // encounter actually is, and the two halves could not be timed apart.
      //
      // Split three ways, the chain reads the way it plays: deluge channels →
      // splash lands a pair a second → each splash leaves a globule. Nothing in
      // the engine is new; it is `channel` feeding a `count` fan feeding
      // `spawns`, all three of which already existed.
      id: 'deluge',
      name: 'Caustic Deluge',
      spellId: 1289192,
      // HOW MANY CIRCLES: ten, in five pairs, one pair a second.
      //
      // The spec contradicts itself here and the contradiction is recorded
      // rather than quietly resolved, because the arithmetic is the mechanic.
      // It says the channel runs 5 seconds and that "every 0.5 seconds it will
      // spawn 2 green circles" — which is twenty — and in the same breath that
      // there are "a total of 10 Globules", with one globule per circle. Twenty
      // and ten cannot both be right. The raid leader ruled TEN, so the beat is
      // one second rather than half a second: five beats of two.
      //
      // abilities.json is a third witness and loses to both. 1289994's note
      // says "the three acid splashes ejected during the channel" — that is the
      // Mythic log talking, and the raid leader's ten is what this trainer
      // teaches. The `what:` below says ten because the floor says ten.
      what: "1s cast into a 5s channel on Vexhul's tank. Every second of it throws a pair of 4-yard acid splashes onto the platform — ten in all, each leaving a Caustic Globule where it lands.",
      from: 'vexhul',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1000,             // "1s cast", and then the channel begins
      origin: 'boss',
      // The cast itself does nothing to anybody: it is a bar you read, and
      // everything it costs the raid it costs through the ten circles. dps: 0
      // rather than a token number for the same reason Soulcoil Ignition is
      // zero — charging for the parent AND the children makes the healing check
      // read twice as bad as the fight is.
      rule: { type: 'raidDamage', dps: 0 },
      channel: { defId: 'splash', count: 5, everyMs: 1000 },
      good: 'Tank holds the channel still; the raid reads each pair as it lands and walks between them.',
      failText: '',
    },
    {
      // THE CIRCLES. Two per beat, fanned around a rolled point on the floor —
      // `count: 2` off `floorAnchor`, not off Vexhul, who is coiled in the acid
      // three yards off the top edge and would drop every pair onto the tanks'
      // ledge.
      //
      // NEVER in the loop, and there is no honest way to put it there. This is a
      // beat of a channel: fired from the rotation it is one lone pair of
      // circles with nothing behind them and no wave of globules to follow, and
      // the ten-circle read the whole mechanic is built on never happens.
      id: 'splash',
      name: 'Caustic Deluge',
      spellId: 1289994,
      what: "Each beat of the channel throws two 4-yard splashes onto the floor. Standing in one costs a stack of Eternal Venom, and every one of them leaves a Caustic Globule behind.",
      from: 'vexhul',
      roles: ['tank', 'dps', 'healer'],
      // 1.5s of it inert and 1s of it live. Long enough that three pairs are on
      // the floor at once in the middle of the channel, which is the picture the
      // mechanic is: circles arriving faster than they leave, so the raid walks
      // a route rather than sidestepping one thing at a time. Shorter and the
      // pairs never overlap and the channel is five separate dodges; longer and
      // all ten are up together and there is nowhere left to stand.
      telegraphMs: 2500,
      shape: { kind: 'circle', radius: 4 },   // "4-yard radius each"
      origin: 'random',
      count: 2,
      // Inert for the first 1.5 seconds, then live. Render-only: `avoid` is
      // judged once at resolve, so this changes no score — it is what makes ten
      // circles on a 1158-square-yard wedge readable instead of a carpet. Do
      // not put it in the tooltip; see MechanicDef.armsAfterMs.
      armsAfterMs: 1500,
      rule: { type: 'avoid' },
      damage: 0.34,
      // "soaking them gives a stack of Eternal Venom" — and so does being
      // caught by one, which is the same stack bought for nothing.
      applies: { hit: 1 },
      // "once they have activated, they spawn Caustic Globules at the location".
      // One globule per splash, exactly where the splash was: five pairs in and
      // ten pickups out, which is the whole reason the pair placement matters.
      spawns: { defId: 'globule' },
      good: 'Everyone stays 4+ yards off each pair as it lands, and nobody eats a circle to save walking.',
      failText: 'Stood in a Caustic Deluge splash',
    },
    {
      id: 'globule',
      name: 'Caustic Globule',
      spellId: 1290338,
      what: "Every splash leaves a globule. Ten of them, and each ruptures after 10s onto the whole raid unless one player walks over it first and takes the stack alone.",
      lethal: true,
      from: 'vexhul',
      // Tanks are welded to their serpent; the file names "low-stack players" as
      // the soakers, and the engine's ally AI never sends a tank to a soak.
      roles: ['dps', 'healer'],
      telegraphMs: 10000,            // "ruptures after 10s"
      shape: { kind: 'circle', radius: 2.6 },
      origin: 'random',
      // "Each splash leaves a globule that ruptures after 10s onto the whole
      // raid, unless one player walks in first and eats it alone." That is a
      // pickup, not a stand-in-it soak: several small globs scattered on the
      // floor, each cleared by one player running over it.
      //
      // It was modelled as a single 6-yard `beInside` circle, which drew as one
      // big shape and read as ground to avoid — teaching the exact opposite of
      // the mechanic. Eating one is correct play and can never be a failure;
      // the tactic file's own reporting line is "un-soaked ruptures only,
      // never soakers".
      // TEN, one per splash, and never fired from the loop any more.
      //
      // A bare `fire('globule')` takes the `collect` branch, which scatters
      // pickups on a ring drawn round the ARENA CENTRE with no circles behind
      // them — globules that appeared out of nothing, mostly on top of the raid's
      // own formation, and swept on the tick they landed by whoever happened to
      // be standing there. The ten now arrive where the ten splashes were, which
      // is what makes reading the pairs worth anything.
      //
      // The count survives because a drill still fires this on its own, and
      // because it is the honest number: one Caustic Deluge puts ten of these on
      // the floor and the raid has ten seconds to clear all ten.
      rule: { type: 'collect', count: 10 },
      // The soak rota's two prices, from one def. Running over one costs the
      // sweeper a single stack; letting one rupture costs EVERY body a stack,
      // which is why ten unswept globules is an instant five rotations' worth of
      // venom on a raid that can only shed one per Ravenous Feast.
      applies: { soak: 1, raid: 1 },
      good: 'Named low-stack players intercept every globule; soaking is correct play, not a failure.',
      failText: 'Missed the globule soak — it ruptured on the whole raid',
    },
    {
      id: 'emergence',
      name: 'Venomous Emergence',
      spellId: 1291404,
      what: "3s cast summoning three Spawn of Vexhul into the pocket and applying one Eternal Venom stack to all players — an add-spawn marker, not a failure.",
      from: 'vexhul',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 3000,             // "3s cast"
      origin: 'boss',
      // No shape and nothing to dodge: the abilities.json calls it "an add-spawn
      // marker, not a failure", so the only thing it costs directly is the venom
      // stack every raid member takes. Everything else this cast does to the
      // raid, it does through the three bodies it leaves in the pocket.
      rule: { type: 'raidDamage', dps: 2.5 },
      // "applying one Eternal Venom stack to all players". The one thing on this
      // fight nobody can dodge, play around or soak for anybody else — which is
      // why it is the floor the whole economy is measured against: three or four
      // of these a pull is three or four stacks everyone is carrying before a
      // single mistake has been made.
      applies: { raid: 1 },
      summons: { addId: 'spawn', count: 3 },
      good: 'All three die fast. Every spawn still breathing is another Corrosive Spit every eight seconds.',
      failText: '',
    },
    {
      id: 'spit',
      name: 'Corrosive Spit',
      spellId: 1291478,
      what: "A 5s marker lands on a player, then the spawn fires a frontal line from the pocket straight through them. Not kickable.",
      from: 'vexhul',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 5000,             // "A 5s marker lands on a player"
      shape: { kind: 'line', length: 46, width: 7 },
      // NEVER fired from the loop, and never anchored on a serpent. A Spawn of
      // Vexhul casts this through its `casts` link, out of the pocket it
      // surfaced in, aimed through whichever non-tank raider it fixated — which
      // is what the fight actually does and what the old boss-anchored version
      // could only imitate by pointing a frontal at the tank.
      //
      // `origin` still has to be honest even though nothing fires this through
      // the ordinary path: it stays 'boss' because a spawn of Vexhul's is what
      // casts it, and the engine exempts a fixated line from the boss
      // re-anchoring that would otherwise drag it out of the pocket and onto
      // the serpent a tick after it was cast.
      //
      // Explicitly NOT interruptible: the Journal tags it Frontal/Avoidable
      // only, DB2 PreventionType is 0, and no log shows an interrupt.
      origin: 'boss',
      rule: { type: 'aimAway' },
      damage: 0.32,
      // Clipped by somebody else's line costs a stack as well as the damage. The
      // MARKED player is not charged: `aimAway` only pays this in its bystander
      // branch, matching the standing rule that being chosen is never billed.
      // An unavoidable +1 every eight seconds per living spawn, on a ten-stack
      // death, would be a wipe nobody could play out of — and it would punish
      // the marked player for the one thing they cannot decline.
      applies: { hit: 1 },
      good: 'The marked player points the line away; everyone else clears it.',
      failText: 'A Corrosive Spit line crossed the raid',
    },
    {
      id: 'depths',
      name: 'Stir the Depths',
      spellId: 1292807,
      what: "6s channel pulsing the raid every 2s while waves run down five lanes .",
      from: 'vexhul',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 6000,             // "6s channel ... while waves run down five lanes"
      shape: { kind: 'line', length: 70, width: 11 },
      // A lane rather than an edge spawn on purpose: the engine gives non-boss
      // origins a random facing, so half of an 'edge' wave would point straight
      // off the platform and never threaten anyone. A drifting interior lane is
      // the same read — watch which lane clears, step into it.
      origin: 'random',
      driftSpeed: 6,
      rule: { type: 'avoid' },
      damage: 0.28,
      good: 'Heal the pulse; step into a lane a wave just cleared, safe from every later lane.',
      failText: 'Caught by a Stir the Depths wave',
    },
    {
      id: 'feast',
      name: 'Ravenous Feast',
      spellId: 1290662,
      what: "4.25s cast bites three times; each splits damage among players within 14 yards , sheds one stack, and applies Feasted — blocking further removal for 8s and multiplying Feast damage by nine.",
      lethal: true,
      from: 'ithraz',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4250,             // "4.25s cast"
      shape: { kind: 'circle', radius: 14 },   // "splits damage among players within 14 yards"
      // A stack point you run to, not something that lands on you — being out of
      // it is the failure. 12 deaths across 14 pulls and "the most common first
      // blood", always from too few bodies in a bite.
      origin: 'random',
      rule: { type: 'beInside' },
      soakers: 5,
      good: 'Three distinct groups, one per bite, enough bodies to divide the damage; highest-venom players first; nobody takes two.',
      failText: 'Out of the bite — Ravenous Feast was not split',
    },
    {
      id: 'ichor',
      name: 'Coiling Ichor',
      spellId: 1290814,
      what: "3s cast infuses carriers for 12s; the radius shrinks as the damage rises, then drops a two-minute slowing pool .",
      from: 'ithraz',
      // "Carriers are chosen, never at fault" — but a tank running 26 yards out
      // drops their serpent, so carriers come from the rest of the raid.
      roles: ['dps', 'healer'],
      telegraphMs: 12000,            // "infuses carriers for 12s"
      shape: { kind: 'circle', radius: 8 },
      origin: 'player',
      // 377 hits across 21 raiders and 8 deaths — "by far the most-failed
      // mechanic on the fight". The damage ID non-carriers eat is 1290878; the
      // thing the player DOES is carry 1290814 clear, which is what carryOut is.
      rule: { type: 'carryOut', minDistance: 26 },
      spawns: { defId: 'gore' },
      good: 'Carriers spread, close together as it tightens, and dump pools at the room edges.',
      failText: 'Kept Coiling Ichor on the raid',
    },
    {
      id: 'gore',
      name: 'Congealed Gore',
      spellId: 1292552,
      what: "3s cast infuses carriers for 12s; the radius shrinks as the damage rises, then drops a two-minute slowing pool .",
      from: 'ithraz',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,                // spawned already active
      shape: { kind: 'circle', radius: 6 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.14,                  // per second while stood in it
      // The source says two minutes, and "permanently shrinks the arena". Held
      // to 30s here: at 44 yards of platform and a 150s pull, honest two-minute
      // pools stack until there is nowhere left to stand and the fight stops
      // teaching anything. The Sanguine Storm variant (1306925) is the same
      // hazard on a 6s timer and is folded into the glob dodge rather than
      // duplicated as its own def.
      lingerMs: 120000,
      good: 'Carriers spread, close together as it tightens, and dump pools at the room edges.',
      failText: 'Stood in Congealed Gore',
    },
    {
      id: 'storm',
      name: 'Sanguine Storm',
      spellId: 1306876,
      what: "18s channel raining gore globs , each leaving a 6s slowing pool .",
      from: 'ithraz',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2200,
      shape: { kind: 'circle', radius: 4 },    // "Glob impacts within 4 yards, dodgeable"
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.3,
      good: "Globs dodged while reading Vile Flood's rotation.",
      failText: 'Hit by a Sanguine Storm glob',
    },
    {
      id: 'stonebreaker',
      name: 'Stone Breaker',
      spellId: 1288538,
      // THE KNOCK, and the fight's second three-way split.
      //
      // One def used to be the whole mechanic: a push and a promise of "three
      // slam swirlies" that never existed, so the swirlies could not be soaked,
      // the soak could not be missed, and the tank swap they earn was being done
      // somewhere else by a timer called Envenomed. Split the way it plays —
      // stonebreaker knocks, slam is the run of three pools it lays, pushoff is
      // what a missed pool does to the raid — and every clause of the spec has a
      // home: "initially this pushes every player/ai raider back 10 yards ... he
      // then spawns 3 3.5 yard sized pools in sequence ... once all three are
      // soaked the tanks swap ... if the Ithraz tank fails to soak any pool it
      // pushes all players off the platform into the venom and wipes the raid."
      //
      // The comment sits BELOW the id rather than above it, here and in the two
      // defs that follow, because the sweeps parse a boss file by splitting on
      // `{` immediately followed by `id:`. A block that opens with prose is
      // silently glued onto the previous one and stops being checked — which is
      // how a lethality flag three mechanics away was read as belonging to
      // Sanguine Storm. Those parsers are regexes over text, so prose that looks
      // like a field is a field.
      what: "1.5s cast throws every raider 10 yards straight away from Ithraz — off the platform if that is where the push points — then lays three slam pools around him for his tank to walk.",
      from: 'ithraz',
      roles: ['tank', 'dps', 'healer'],
      // "1.5s cast ... knocks players away, then three slam swirlies." The cast
      // is 1.5s; the telegraph is stretched to cover the knock windup, because a
      // 1.5s window is not enough to reposition for a platform-wide push — and
      // now that the push can kill, repositioning is the entire mechanic.
      telegraphMs: 3000,
      // Arena-wide on purpose, and it has to actually be arena-wide. The knock
      // is not a puddle you sidestep — everyone goes, and the only decision is
      // whether you were standing somewhere the push carries you across the
      // platform or over the edge. It was 44, measured from Ithraz at (8,-19),
      // which fell 6 yards short of the far corner of the mouth: the raiders
      // standing in the most dangerous part of the room were the ones the knock
      // could not reach, so the fatal band was quietly the only safe place to be.
      // 52 covers the furthest floor point (50.6 yards) with margin.
      shape: { kind: 'circle', radius: 52 },
      origin: 'boss',
      rule: { type: 'survive' },
      // TEN, not the 18 this shipped with, and the rim no longer catches you.
      //
      // Both halves are the raid leader's ruling and the second one is the one
      // that matters: being thrown off is death, not a scrape and a failure row.
      // It was put to them with the measurement — a 10-yard push away from
      // Ithraz makes 46.2% of this floor a fatal stand, and the whole mouth from
      // y=14 outward is 100% fatal — and they chose lethal knowing that. 18
      // yards would have made it 72%, which is a room with a right answer and
      // nineteen wrong ones rather than a decision.
      knockbackYards: 10,
      offPlatform: true,
      // The one instruction the derived `survive` line cannot give, because it
      // is a fact about this polygon and the rule is also Ula'tek's. The numbers
      // are measured, not felt: 84% of the row at y=0 survives, 67% at y=-12,
      // 27% at y=12, 5% at y=13 and nothing at all past y=14.
      brief: 'Ithraz throws the whole raid 10 yards straight away from himself and the edge does not stop you. He is coiled off the top of the platform, so the push always points down the wedge toward the mouth — and the mouth is where the floor runs out. Stay south of the tanks\' ledge and well north of the mouth: below about y = 12 the push lands you on floor, past it you go into the venom, and the last stretch before the pocket is fatal from every angle. Move before the cast finishes, because there is nothing to do once it lands.',
      good: 'Everyone is inside the danger band before the cast ends; the Ithraz tank then soaks all three slams in appearance order and the tanks trade.',
      failText: 'Knocked off the platform by Stone Breaker',
      // Three pools, 2.2s apart, on an 8-yard arc in front of Ithraz.
      //
      // RING 8, NOT 6, and it is the difference between a mechanic and a place
      // to stand. The three points are clamped onto the floor, and the clamp is
      // not shape-preserving — the right-hand one always runs into the leg of
      // the wedge and is dragged inward — so what decides whether the tank has
      // to walk is the smallest circle that contains all three POST-clamp. At
      // ring 6 that circle has a radius of 4.02 yards against a soak radius of
      // 3.5: half a yard of margin, and the tank covers the whole run from one
      // spot by standing in the right half-yard. At ring 8 it is 5.40, which is
      // a walk. The arc still fits comfortably inside everything else the tank
      // is bound by — furthest pool 6.9 yards from their station and 9.4 from
      // Ithraz himself.
      channel: { defId: 'slam', count: 3, everyMs: 2200, ringYards: 8, arcDeg: 90 },
    },
    {
      id: 'slam',
      name: 'Stone Breaker',
      spellId: 1310371,
      // THE POOLS. One tank, all three, or the raid goes in the venom.
      what: "Each slam lands a 3.5-yard impact. The tank holding Ithraz has to be standing in every one of them — a slam that strikes nobody knocks the whole raid off the platform instead.",
      from: 'ithraz',
      // TANK ONLY, and this is a scoring claim rather than a damage one. "A tank
      // eating this is correct play; a non-tank in the swirly is the positioning
      // failure" — but the positioning that put them there is Stone Breaker's
      // knock, which already has their name on it. Charging a dps for a soak
      // they were never assigned would be the trainer inventing a second failure
      // out of the first one.
      roles: ['tank'],
      // 2s of telegraph against a 2.2s beat, so the run is genuinely a sequence:
      // one pool lands and is gone before the next arrives, and the tank walks a
      // line rather than standing in an overlap. It also has to clear the
      // reachability sweep — 2s reaches 23 yards on a 32-yard floor.
      telegraphMs: 2000,
      shape: { kind: 'circle', radius: 3.5 },   // "3 3.5 yard sized pools"
      // Only ever consulted when something fires this WITHOUT a place, which is
      // a drill and nothing else: from the channel every beat arrives with its
      // point on the arc already chosen. 'random' rather than the honest 'boss'
      // because Ithraz is coiled in the acid, and a boss-origin fire would drop
      // the pool three yards off the top edge where no tank can reach it.
      origin: 'random',
      rule: { type: 'tankSoak', missFires: 'pushoff' },
      damage: 0.2,
      // "Once all three are soaked, the tank tanking Vexhul starts tanking
      // Ithraz, and the tank tanking Ithraz tanks Vexhul." On the CHILD, because
      // the child is what knows whether it is the last of the run and whether the
      // run stayed clean — see MechanicDef.tradeTanksOnClean.
      tradeTanksOnClean: true,
      good: 'The Ithraz tank walks all three in appearance order and the tanks trade; nobody else is anywhere near them.',
      failText: 'A Stone Breaker slam landed on nobody — the raid was thrown into the venom',
    },
    {
      id: 'pushoff',
      name: 'Stone Breaker',
      spellId: 1289153,
      // THE PUNISHMENT. Never in the loop, never dodgeable, never anybody's
      // individual fault — the slam that went unsoaked already named the tank.
      what: "The untanked slam. Armour-ignoring damage to the whole raid and a push that takes everyone off the platform — a collective consequence, never a per-player failure.",
      // 1289153 is category Deadly, so this carries `lethal` to satisfy the
      // sweep that derives lethality from the data. Note it is not what kills
      // anybody here: `offPlatform` leaves every body outside the polygon and
      // the floor does the rest, which is how `windPair` has always worked.
      lethal: true,
      from: 'ithraz',
      roles: ['tank', 'dps', 'healer'],
      // Almost no window, because there is nothing to answer. The failure
      // happened 2 seconds ago when a pool landed on empty floor; this is the
      // consequence arriving, and a long cast bar would read as a mechanic the
      // raid was supposed to play around.
      telegraphMs: 800,
      shape: { kind: 'circle', radius: 52 },
      origin: 'boss',
      rule: { type: 'survive' },
      // Far enough that no point on the floor survives it. The widest survivable
      // stand under the 10-yard knock is about 14 yards of floor left in front
      // of you; 70 clears the whole wedge from anywhere on it, which is what
      // "pushes all players away off the platform into the venom and wipes the
      // raid" means.
      knockbackYards: 70,
      offPlatform: true,
      // Measured per cast, never per player. The tank who dropped the soak is
      // named by `slam`; naming everyone again here would put nineteen rows in
      // the debrief for one mistake.
      collective: true,
      good: 'Never happens — it only fires when a slam struck nobody.',
      failText: '',
    },
    {
      id: 'flood',
      name: 'Vile Flood',
      spellId: 1294605,
      what: "4s cast into a 14s rotating torrent applying a venom stack per 0.5s tick; the orbs around Vexhul telegraph the direction.",
      from: 'vexhul',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,             // "4s cast into a 14s rotating torrent"
      // A cone anchored on the boss: the engine keeps a boss-origin cone locked
      // to the boss's facing until it goes off, which is exactly the rotation
      // the orbs telegraph. 46 hits and 12 deaths — "the deadliest avoidable".
      shape: { kind: 'cone', radius: 50, arcDeg: 34 },
      origin: 'boss',
      rule: { type: 'avoid' },
      damage: 0.46,
      good: 'Raid reads the spin and stays out of the beam.',
      failText: 'Clipped by the Vile Flood beam',
    },
  ],
}
