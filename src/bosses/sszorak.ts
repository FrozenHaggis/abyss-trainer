import type { BossDef } from '../engine/types'

// Ssztream, Herald of the Six Winds — a parody of Sszorak.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. Castle Pineapplia does the same thing (Shriekfruit teaches
// Shriekwing's mechanics) and it is the right call — the joke lands on the boss,
// but what you practise has to transfer to the actual raid, and it cannot if
// "Caustic Claws" is called something else here.
//
// Authored from 12.1/VenomousAbyss/Sszorak/Sszorak.md and abilities.json. Every
// spellId below is real and appears in that abilities.json; nothing tagged
// Mythic-only is here — Serpent's Fury, To the Slaughter, Virulence and Unbound
// Ferocity are excluded, and so are the third and fourth Raging Crosswinds
// bearings (1297096 / 1297111), which the data records as Mythic-only.
//
// The file's own summary sets the design: "What wipes raids here is falling off
// the platform. Falling took 31 killing blows in 6 Mythic PTR pulls, more than
// every boss ability combined. Wind positioning is the fight." So the arena is
// small, the edge is lethal, and the wind is the headline mechanic.
//
// ─── THE SHAPE OF THE FIGHT ────────────────────────────────────────────────
//
// PHASES.md files this boss as a "three-beat loop", and the tactic file spells
// the beats out: "venom and cone pressure, a Raging Crosswinds spread, then a
// Howling Maelstrom where he plants himself with Dig In and takes +30% damage —
// the only burn window." That is one combat stage and one intermission, on
// repeat, which is exactly how it is authored here.
//
// Apex Predator (1277025) is the flurry that opens each rotation. The ability
// data calls it a "window marker for the Ravage/Mutilate flurry — server-side
// dummy with no events, so it never produces a failure", so it is a CONTAINER:
// it deals out two Ravages, two Mutilates and a Tempest in a random order, and
// it can never itself be scored. The five children each can.
//
// Howling Maelstrom (1285732) is deliberately NOT a mechanic in this file. Its
// note reads "phase marker for the succession of directional gales; no cast
// events on PTR, so detect the phase via Dig In", and this project already
// deleted it once for being a marker you could fail (commit 12ae426). It is a
// STAGE here, and the thing you can fail inside it is Falling.
//
// ─── TWO DELIBERATE DEPARTURES FROM THE TACTIC FILE ────────────────────────
//
// Both are stated out loud rather than left to be discovered, because this
// repo's whole claim is that its mechanics are derived from the source.
//
// 1. COLLIDING IS THE ANSWER, NOT THE FAILURE. The tactic file's Good line for
//    Raging Crosswinds is "drift back to solid floor without touching anyone",
//    and its Bad line is a mid-air collision followed by a Falling death. Here,
//    two raiders thrown into each other CANCEL — which is the behaviour the
//    ability note for Turbulent Gusts describes ("dissipates if two carriers
//    collide") turned into the mechanic's solution rather than its accident. It
//    is a better thing to practise: a spread you survive by luck teaches less
//    than a line-up you get right or wrong on purpose.
//
// 2. THE CYSTS ARE THE ANSWER TO THE GALES. The tactic file says to "drop the
//    cyst clear of the raid path and the next wind direction; cysts are left to
//    expire". Here the Maelstrom's gales blow the raid INTO them and the burst
//    is what throws everybody back to the middle. That inverts the source. It is
//    kept because it turns two mechanics that never met into one chain a raid
//    has to plan a minute ahead, and because the alternative — a wind with
//    nothing at the end of it — is not a mechanic at all.
//
// Everything else is the file's own words.

export const sszorak: BossDef = {
  key: 'sszorak',
  name: 'Ssztream, Herald of the Six Winds',
  realName: 'Sszorak',
  blurb: 'No adds, nothing to kick. Falling off the platform is what actually kills raids here.',
  // Measured from PTR combat logs, not guessed: Circle (CV 10.4%). Side spurs at 70/160/170 deg reach ~90yd and are excluded.
  // 1 yard = 100 coordinate units.
  arenaRadius: 56,
  maxHp: 1,

  // Long, and for one reason: every mechanic has to be reachable.
  //
  // A clean pull kills in roughly 0.46 x pullLengthSec, and one full rotation of
  // Apex Predator into Venomous Surge into Raging Crosswinds is 55 seconds. Two
  // of those bring the Maelstrom on at about 110s. At the old 150 a competent
  // dps killed him at 69 seconds, which is before the SECOND mechanic of the
  // second rotation — the intermission the whole fight is built around never
  // happened, and neither did the burn window inside it.
  //
  // This is also the enrage, because the two are the same number in this engine.
  // It makes Sszorak the longest pull in the raid by some distance. That is the
  // price of the fight having a cycle rather than a rotation.
  pullLengthSec: 360,
  // Two rotations, and a rotation is longer than it looks. Apex Predator is a
  // set piece the ordinary loop stands down for: five casts delivered one at a
  // time is about 18 seconds on its own, and the other four beats are 11 apart,
  // so a rotation is roughly 63 seconds and the Maelstrom arrives at about 126.
  // The bar is the countdown to it rather than a clock nobody can read.
  energyPerSec: 0.79,
  loopIntervalSec: 11,

  // Kept for a boss with no phases to fall back on; the stages below own the
  // real rotation. Both lists have to name mechanics that exist, and a test
  // checks it.
  loop: ['apex', 'claws', 'corroding', 'surge', 'crosswinds'],
  ambient: ['presence'],

  phases: [
    {
      id: 'flurry',
      name: 'Apex Predator',
      banner: 'APEX PREDATOR — read the flurry, then hold the line',
      loop: ['apex', 'claws', 'corroding', 'surge', 'crosswinds'],
      loopIntervalSec: 11,
      ambient: ['presence'],
      // Two rotations. The bar is tuned to fill in about 110 seconds, which is
      // what two passes of the loop above take — a rotation counter would say
      // the same thing less legibly, and the player can watch a bar.
      endsAtFullEnergy: true,
    },
    {
      id: 'maelstrom',
      name: 'Howling Maelstrom',
      banner: 'HOWLING MAELSTROM — alone in the wind. Ride it into the cysts.',
      // He plants himself the instant the stage begins, so the burn window opens
      // with it rather than half a minute into it.
      opensWith: 'digin',
      loop: ['digin'],
      loopIntervalSec: 40,
      ambient: ['presence'],
      // "Sszorak burrows in" — he walks to the middle of the room and stops
      // following anybody. Nothing a tank does changes it.
      entitiesConverge: true,
      suppressAddWaves: true,
      // The gales, and the stage's own exit.
      //
      // The raid leaves the floor and the sequence is yours: blown into a glob,
      // thrown back at him, five seconds planted at his feet with the wind still
      // screaming past and unable to move you, then it reverses and sends you at
      // the other one. It ends on the second brace, which is what the fight says
      // ends it — both cysts have knocked you back into him.
      windToCysts: true,
    },
  ],

  mechanics: [
    {
      id: 'apex',
      name: 'Apex Predator',
      spellId: 1277025,
      what: "Five attacks in quick succession — two Ravages, two Mutilates and a Tempest — dealt out in an order that changes every time.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1800,
      origin: 'boss',
      // A window marker. The ability data says outright it "never produces a
      // failure", so the container is never scored — only the five real
      // abilities it deals out, each of which keeps its own spell id, its own
      // briefing and its own line in the debrief.
      //
      // `gapMs` is the BREATHER AFTER a cast lands, not the period between them
      // starting — so each cone completes before the next begins, whatever their
      // cast times are. Dealt out on a 1.9s period with 3s cones, the Ravage and
      // the Mutilate were in the air together and there was no instant at which
      // the answer to one was not the wrong answer to the other. A second is
      // enough to read what is winding up and get where it wants you.
      rule: {
        type: 'combo',
        parts: ['ravage', 'mutilate', 'ravage', 'mutilate', 'tempest'],
        gapMs: 1000,
      },
      good: 'The flurry read one cast at a time — tanks trading on the Ravages, the groups alternating on the Mutilates, everyone off the vortices.',
      failText: '',
    },
    {
      id: 'ravage',
      name: 'Ravage',
      spellId: 1277002,
      what: "3s Physical frontal cone that also stacks +300% Ravage damage taken for 25s on everyone struck — the second tank-swap driver.",
      roles: ['tank'],
      telegraphMs: 3000,             // "3s Physical frontal cone"
      shape: { kind: 'cone', radius: 30, arcDeg: 80 },
      origin: 'boss',
      rule: { type: 'faceAway' },
      // He keeps walking. A frontal that re-anchors to its caster every tick
      // cannot be walked out from under, and rooting him through all five casts
      // would cancel the one thing the fight opens with — that he follows the
      // tanks.
      mobileCaster: true,
      damage: 0.34,
      // The amp, which is what makes the SECOND one lethal and why this is a
      // swap driver at all.
      spawns: { defId: 'ravaged' },
      good: 'Boss faced away, only the active tank in the cone, tanks swapping before the stack turns lethal.',
      failText: 'Ravage swept the raid — facing failure',
    },
    {
      id: 'ravaged',
      name: 'Ravage',
      spellId: 1277101,
      what: "+300% Ravage damage taken for 25s on everyone struck, so the second cone kills anyone the first one caught.",
      roles: ['tank'],
      telegraphMs: 1,                 // applied by the cone, never cast alone
      origin: 'boss',
      // One is already too many: the flurry brings two Ravages, and the tank who
      // ate the first cannot be holding him for the second. The briefing says so
      // in as many words — this is the maxStacks <= 1 wording in brief.ts.
      rule: { type: 'tankSwap', maxStacks: 1 },
      good: 'The off-tank takes him the moment the first Ravage lands, so the second finds a clean tank.',
      failText: 'Held Ravage into the second cone — trade on every application',
    },
    {
      id: 'mutilate',
      name: 'Mutilate',
      spellId: 1277031,
      what: "Nature frontal whose damage is split evenly among everyone struck, applying a 22s DoT that also raises damage taken — a shared soak, not a tank-only cone.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 3000,
      shape: { kind: 'cone', radius: 26, arcDeg: 60 },
      origin: 'boss',
      mobileCaster: true,
      // Two demands at once, which is the mechanic. Enough bodies to divide the
      // hit, and never the same bodies twice — because everyone struck takes a
      // Mutilated Gash and a second Gash on a live one kills.
      //
      // Five is not in any source. Sszorak.md says outright "No source states a
      // required soak count; confirm it with the raid leader", so this is a
      // chosen number like the 4 it replaces — chosen because half of a
      // twenty-body raid is ten, and five is a count a group can visibly fail.
      rule: { type: 'groupSoak', bodies: 5, dotId: 'gash' },
      // The tactic file's Bad line is explicit that it is measured per cast
      // rather than per player: "Not a per-player failure — track soak count per
      // cast". So missing it costs the raid and is never put against your name.
      // This is the same mechanic the analyser once blamed the raid for soaking
      // correctly, and it is not going to happen twice.
      collective: true,
      good: 'Enough bodies in the cone to divide the hit, aimed at the group that is not already carrying a Gash.',
      failText: 'Mutilate went unsplit — not enough bodies in the cone',
    },
    {
      id: 'gash',
      name: 'Mutilated Gash',
      spellId: 1285998,
      what: "The DoT every Mutilate soaker takes. It lasts long enough that a second Mutilate on the same group lands on top of it, and two kills.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,                 // applied by the soak, never cast alone
      origin: 'boss',
      rule: { type: 'stackingDot', maxStacks: 2, durationMs: 22000 },
      // Category Deadly in abilities.json — "8 killing blows on Mythic PTR, so
      // attribute deaths but never count ticks as failures". Lethality is read
      // from the data, never chosen, and this is the id the tactic file says to
      // attribute a Mutilate death to.
      lethal: true,
      damage: 0.12,
      good: 'One stack at a time — the second cone finds the other group, and the first group\'s Gash falls off before their turn comes round again.',
      failText: 'Took a second Mutilated Gash — the group ate two cones running',
    },
    {
      id: 'tempest',
      name: 'Tempest',
      spellId: 1287083,
      what: "Nine poisonous vortices spiral out of him and roam the arena; touching one deals Nature damage, DoTs you and slows you 30% for 6s — the slow is the lethal part, because it strands you in the wind.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2000,
      shape: { kind: 'circle', radius: 5 },
      origin: 'boss',
      // Nine spokes leaving the boss, each on its own bearing. One drifting
      // circle was a sidestep; nine is a room you have to pick a way through,
      // which is what "vortices spiral the arena" describes.
      count: 9,
      radialDrift: true,
      driftSpeed: 4.5,
      rule: { type: 'avoid' },
      damage: 0.16,
      lingerMs: 13000,
      // The fight's one real dispel. 1287083 is the single dispellable entry in
      // the whole file and the logs show 76 removals by genuine healer dispels,
      // so the slow is modelled as a real movement penalty a healer can clear
      // rather than as damage — which is what makes it the healer's job here.
      slowMs: 6000,
      good: 'Nobody touches a vortex, and anyone who does is dispelled before the next knock.',
      failText: 'Clipped a Tempest vortex — slowed, in a room full of wind',
    },
    {
      id: 'claws',
      name: 'Caustic Claws',
      spellId: 1305998,
      what: "Six globs of toxin flung around where he is standing, each dealing Nature damage in a 6yd radius and leaving an acid pool that ticks damage and adds +30% damage taken from every school.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2200,
      shape: { kind: 'circle', radius: 6 },   // "6yd radius"
      // Around the BOSS, and he follows his tank — so this is the mechanic that
      // steadily eats the floor the melee and both tanks are standing on, and
      // the reason he has to keep being walked. Centring it on a player instead
      // left no direction to run and killed even a good player instantly, and
      // Venomous Surge already covers "the thing that lands on you".
      origin: 'boss',
      count: 6,
      rule: { type: 'avoid' },
      damage: 0.28,
      spawns: { defId: 'residue' },
      good: 'Move out of the impacts, note where the pools land, walk him off them.',
      failText: 'Stood in Caustic Claws',
    },
    {
      id: 'residue',
      name: 'Caustic Residue',
      spellId: 1296667,
      what: "The acid left where a glob landed: it ticks damage and adds +30% damage taken from every school.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,                 // spawned already active
      shape: { kind: 'circle', radius: 6 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.16,                   // per second while stood in it
      lingerMs: 30000,
      // "the most-applied debuff on PTR (838x), and its amp is the upstream
      // cause of most of the death report."
      good: 'Leave the acid pools alone and re-stack on clean floor.',
      failText: 'Stood in Caustic Residue — +30% damage taken from everything',
    },
    {
      id: 'surge',
      name: 'Venomous Surge',
      spellId: 1306120,
      what: "A non-tank is drenched for 10s, then bursts for damage that falls off with distance and drops a cyst on the floor where they were standing.",
      roles: ['dps', 'healer'],
      telegraphMs: 10000,             // "Players are drenched for 10s"
      shape: { kind: 'circle', radius: 8 },
      origin: 'targeted',
      rule: { type: 'carryOut', minDistance: 26 },
      spawns: { defId: 'cyst' },
      // The drop is snapped to 12, 3, 6 or 9 o'clock. A gale only ever comes
      // from one of the four quarters, so a cyst dropped between two of them is
      // a Maelstrom with nothing at the end of it — an unplayable wipe caused a
      // minute earlier. The carrier's job is the QUARTER, not the pixel.
      clockDrop: true,
      carryTarget: 'the 12, 3, 6 or 9 o\'clock mark, well clear of the raid',
      good: 'Carriers run out to a clock mark, drop the cyst there, and come back before the wind.',
      failText: 'Dropped the Surge on the raid',
    },
    {
      id: 'cyst',
      name: 'Viscous Cyst',
      spellId: 1287205,
      what: "The glob a Surge leaves behind. Anything that sets it off bursts it, and the burst throws the entire raid clear of it wherever they are standing.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,
      shape: { kind: 'circle', radius: 4 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.2,
      // It stays until something bursts it. During the Maelstrom that is the
      // point of it; before then, walking into one throws the whole raid across
      // the room for nothing and costs the gales a glob.
      permanent: true,
      // Far enough to put you back at his feet rather than merely off the rim.
      // During the Maelstrom the burst throws you AT him, and landing halfway
      // there would spend the braced seconds walking instead of hitting him.
      raidKnockYards: 40,
      good: 'Cysts are left alone until the gales need them.',
      failText: 'Burst a Viscous Cyst — the whole raid was thrown for nothing',
    },
    {
      id: 'crosswinds',
      name: 'Raging Crosswinds',
      spellId: 1285616,
      what: "An 8s wind debuff on every raider that explodes on expiry and throws them in its own direction. Two raiders thrown into each other cancel out; anyone left unpaired goes over the edge.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 8000,              // "An 8s wind debuff that explodes on expiry"
      shape: { kind: 'circle', radius: 10 },
      origin: 'player',
      // Keyed to 1285616 — the Heroic expiry explosion that "damages and knocks
      // back everyone in the strike area" — rather than to the per-direction
      // marker debuffs. Two of those are Heroic (1285425, 1285453) and two are
      // Mythic-only (1297096, 1297111), and this trainer ships no Mythic
      // content. Which of the four bearings you are given is a runtime detail of
      // one knockback rather than a claim about four spells.
      // 120 yards on a 56-yard floor: unpaired is off the platform from
      // anywhere. That is the directive's own reading — "failing this the player
      // is blown off the platform and dies" — and it is the only version that
      // holds up, because a knock the room can absorb is a knock you answer by
      // standing in the middle and ignoring the mechanic. A stationary player
      // cleared the pull doing exactly that.
      //
      // The death still lands under Falling, which is where the tactic file puts
      // it: "deaths land under Falling", 31 killing blows in six pulls.
      rule: { type: 'windPair', pushYards: 120 },
      damage: 0.18,
      good: 'Everyone lined up nose-to-nose with their opposite arrow, so the two knocks cancel and nobody moves.',
      failText: 'Blown across the platform by Crosswinds — nobody was on your line',
    },
    {
      id: 'digin',
      name: 'Dig In',
      spellId: 1286033,
      what: "A succession of gales sweeps the arena, each pushing its own direction, while Sszorak burrows in and takes +30% damage from all schools for 25s.",
      roles: ['tank', 'dps'],
      telegraphMs: 1500,
      origin: 'boss',
      // "The fight's only burn window — Sszorak is immovable and takes +30%
      // damage for 25s during Howling Maelstrom." It was missing entirely once,
      // so the one moment the fight asks you to commit cooldowns passed unmarked.
      rule: { type: 'burnWindow', multiplier: 1.3, durationMs: 25000 },
      good: 'Every cooldown goes in while he is planted and taking +30%.',
      failText: 'Dig In came and went without a cooldown',
    },
    {
      id: 'corroding',
      name: 'Corroding Venom',
      spellId: 1282873,
      what: "Each melee landing stacks a 12s debuff adding +3% Physical damage taken.",
      roles: ['tank'],
      telegraphMs: 1500,
      origin: 'boss',
      // The fight's OTHER swap driver — the ability data names the two of them
      // as a pair, and the engine now runs every tankSwap mechanic rather than
      // whichever one happened to be written first.
      rule: { type: 'tankSwap', maxStacks: 2 },
      good: 'Tanks swap on an agreed stack count and stacks drop off the off-tank between swaps.',
      failText: 'Held Corroding Venom too long — taunt the swap sooner',
    },
    {
      id: 'presence',
      name: "Ula'tek's Presence",
      spellId: 1285965,
      what: "The altar's haze deals constant, unavoidable Nature damage to the whole raid for the entire fight.",
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // The file is explicit: "Bad: Nothing — a healing check, not a mechanic."
      // raidDamage never produces a per-player failure.
      rule: { type: 'raidDamage', dps: 3.2 },
      good: 'Healing cooldowns staggered so raid HP never dips into tick-kill range.',
      failText: '',
    },
  ],
}
