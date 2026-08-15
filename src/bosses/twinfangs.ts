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
// per player per Ravenous Feast." The engine has no stack economy, so Eternal
// Venom is modelled as the ambient raid-damage floor it actually behaves like,
// and the two soaks — Caustic Globule and Ravenous Feast — carry the "run IN"
// half of the movement so the loop is not just five flavours of "run out".

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
  loopIntervalSec: 6,
  energyPerSec: 2.2,            // ~45s to the Vile Flood window, so three per pull
  atFullEnergy: 'flood',
  ambient: ['venom'],
  pullLengthSec: 150,

  // Two symmetric halves of 72s. Envenomed on every third slot is the swap
  // metronome; Stone Breaker lands once a half, matching the file's "roughly
  // once a minute". Each half forces movement inward (globule, feast, the
  // pre-knock huddle) and outward (Coiling Ichor) rather than only outward.
  // Venomous Emergence sits FIFTH, not twelfth.
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
  loop: [
    'envenomed', 'deluge', 'globule',
    'envenomed', 'emergence', 'ichor',
    'envenomed', 'stonebreaker', 'depths',
    'envenomed', 'feast', 'storm',
    'envenomed', 'deluge', 'globule',
    'envenomed', 'emergence', 'storm',
    'envenomed', 'stonebreaker', 'depths',
    'envenomed', 'feast', 'ichor',
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
      what: "Permanent stacking Nature poison , no duration, persists through death, fed by splashes, globule ruptures, Venomous Emergence, Corrosive Spit, waves and every Vile Flood tick. At 9 stacks 1292348 executes the carrier.",
      from: 'vexhul',
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // 1290480 is the periodic tick — "scaling with stack count, 24% of all raid
      // damage taken and a direct proxy for how badly the venom economy is
      // losing". The stack counter itself (1290336) and its 9-stack execution
      // (1292348) are not modellable here, and trying would invent per-player
      // failures out of a raid-wide resource. raidDamage never scores anyone.
      rule: { type: 'raidDamage', dps: 3.4 },
      good: 'Adds die fast, high-stack players take the earliest Feast bite, low-stack players soak globules.',
      failText: '',
    },
    {
      id: 'deluge',
      name: 'Caustic Deluge',
      spellId: 1289994,
      what: "1s cast into a 5s tank channel, ejecting three 4-yard splashes that apply venom and leave globules.",
      from: 'vexhul',
      roles: ['tank', 'dps', 'healer'],
      // "1s cast into a 5s tank channel, ejecting three 4-yard splashes" — the
      // splash is the avoidable half, so the telegraph is the eject, not the cast.
      telegraphMs: 2500,
      shape: { kind: 'circle', radius: 5 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.34,
      // "every splash applies Eternal Venom and leaves a Caustic Globule" — the
      // globule soak chain starts here, which is why deluge always precedes it
      // in the loop.
      spawns: { defId: 'globule' },
      good: 'Tank aims away; everyone stays 4+ yards off the splash landings.',
      failText: 'Stood in a Caustic Deluge splash',
    },
    {
      id: 'globule',
      name: 'Caustic Globule',
      spellId: 1290338,
      what: "Each splash leaves a globule that ruptures after 10s onto the whole raid, unless one player walks in first and eats it alone .",
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
      rule: { type: 'collect', count: 3 },
      good: 'Named low-stack players intercept every globule; soaking is correct play, not a failure.',
      failText: 'Missed the globule soak — it ruptured on the whole raid',
    },
    {
      id: 'envenomed',
      name: 'Envenomed',
      spellId: 1310360,
      what: "1310360 — +10% Caustic Deluge damage taken, stacking, ten stacks per channel.",
      from: 'vexhul',
      roles: ['tank'],
      telegraphMs: 1500,
      origin: 'boss',
      // The fight's swap driver: "+10% Caustic Deluge damage taken, stacking,
      // ten stacks per channel", and "Bad: A tank sitting on high stacks through
      // another channel". The engine applies one stack per cast rather than ten
      // per channel, so maxStacks is tuned to firings — 4 casts at 18s apart is
      // ~72s, giving two swaps inside the pull. Ithraz's Stone Breaker stack
      // (1289092) is the other swap driver in the real fight; only one tankSwap
      // is read by the sim, and Envenomed is the cleaner teach because Stone
      // Breaker is already carrying the knockback.
      rule: { type: 'tankSwap', maxStacks: 4 },
      good: "Vexhul's tanks swap so stacks decay.",
      failText: 'Held Envenomed through another channel — taunt the swap sooner',
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
      what: "1.5s cast knocks players away, then three slam swirlies; each soaked impact hits within 3.5 yards and stacks +33% .",
      from: 'ithraz',
      roles: ['tank', 'dps', 'healer'],
      // "1.5s cast ... knocks players away, then three slam swirlies." The cast
      // is 1.5s; the telegraph is stretched to cover the knock windup, because a
      // 1.5s window is not enough to reposition for a platform-wide push.
      telegraphMs: 3000,
      // Arena-wide on purpose. The knock is not a puddle you sidestep — everyone
      // goes, and the only decision is whether you were standing somewhere the
      // push carries you across the platform or over the edge.
      shape: { kind: 'circle', radius: 44 },
      origin: 'boss',
      rule: { type: 'survive' },
      knockbackYards: 18,
      good: 'One tank soaks all three in appearance order (1x / 1.33x / 1.66x), then tanks swap; someone is always in range.',
      failText: 'Knocked off the platform by Stone Breaker',
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
