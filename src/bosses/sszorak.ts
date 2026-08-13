import type { BossDef } from '../engine/types'

// Ssztream, Herald of the Six Winds — a parody of Sszorak.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. Castle Pineapplia does the same thing (Shriekfruit teaches
// Shriekwing's mechanics) and it is the right call — the joke lands on the boss,
// but what you practise has to transfer to the actual raid, and it cannot if
// "Caustic Claws" is called something else here.
//
// Authored from 12.1/VenomousAbyss/Sszorak/Sszorak.md and abilities.json.
// Every spellId below is real and appears in that abilities.json; the `good`
// strings are the file's own "Good:" lines. Nothing tagged Mythic-only is here:
// Serpent's Fury, To the Slaughter, Virulence and Unbound Ferocity are excluded.
//
// The file's own summary sets the design: "What wipes raids here is falling off
// the platform. Falling took 31 killing blows in 6 Mythic PTR pulls, more than
// every boss ability combined. Wind positioning is the fight." So the arena is
// small, the edge is lethal, and the wind is the headline mechanic.

export const sszorak: BossDef = {
  key: 'sszorak',
  name: 'Ssztream, Herald of the Six Winds',
  realName: 'Sszorak',
  blurb: 'No adds, nothing to kick. Falling off the platform is what actually kills raids here.',
  arenaRadius: 42,
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,          // ~45s to the Maelstrom window
  atFullEnergy: 'maelstrom',
  ambient: ['presence'],
  pullLengthSec: 150,

  // Loop taken from the file's overview: "venom and cone pressure, a Raging
  // Crosswinds spread, then a Howling Maelstrom."
  loop: [
    'corroding', 'claws', 'ravage', 'corroding', 'tempest', 'mutilate',
    'corroding', 'surge', 'claws', 'corroding', 'crosswinds', 'ravage',
    'corroding', 'tempest', 'claws', 'corroding', 'mutilate', 'crosswinds',
  ],

  mechanics: [
    {
      id: 'ravage',
      name: 'Ravage',
      spellId: 1277101,
      roles: ['tank'],
      telegraphMs: 3000,             // "3s Physical frontal cone"
      shape: { kind: 'cone', radius: 30, arcDeg: 80 },
      origin: 'boss',
      rule: { type: 'faceAway' },
      damage: 0.52,
      good: 'Boss faced away, only the active tank in the cone, tanks swapping before the stack turns lethal.',
      failText: 'Ravage swept the raid — facing failure',
    },
    {
      id: 'mutilate',
      name: 'Mutilate',
      spellId: 1277031,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2600,
      shape: { kind: 'cone', radius: 26, arcDeg: 60 },
      origin: 'boss',
      // "damage is split evenly among everyone struck ... a shared soak, not a
      // tank-only cone" — so being OUT of it is the failure.
      rule: { type: 'beInside' },
      // No source states a required soak count — Sszorak.md says outright
      // "confirm it with the raid leader" — so 4 is a placeholder.
      soakers: 4,
      good: 'Enough bodies in the cone to divide the hit, with healers covering the DoTs.',
      failText: 'Missed the Mutilate soak — the hit was not split',
    },
    {
      id: 'tempest',
      name: 'Tempest',
      spellId: 1287083,
      roles: ['healer'],
      telegraphMs: 5000,
      shape: { kind: 'circle', radius: 5 },
      origin: 'random',
      driftSpeed: 4,                 // "vortices spiral the arena"
      // "the fight's one real dispel — Poison, 76 removals by genuine healer
      // dispels". The slow is the lethal part because it strands you in wind.
      rule: { type: 'press', ability: 'dispel', withinMs: 6000 },
      damage: 0.18,
      lingerMs: 6000,
      good: 'Nobody touches a vortex, and anyone who does is dispelled before the next knock.',
      failText: 'Tempest slow never dispelled — stranded in the wind',
    },
    {
      id: 'claws',
      name: 'Caustic Claws',
      spellId: 1305998,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2200,
      shape: { kind: 'circle', radius: 6 },   // "6yd radius"
      // Stays a floor AoE rather than a player-targeted drop. Centring it on the
      // player left no direction to run and killed even a good player instantly,
      // and Venomous Surge already covers "the thing that lands on you".
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.34,
      spawns: { defId: 'residue' },
      good: 'Move out of the impact, note where pools land, re-stack on clean floor.',
      failText: 'Stood in Caustic Claws',
    },
    {
      id: 'residue',
      name: 'Caustic Residue',
      spellId: 1296667,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,                 // spawned already active
      shape: { kind: 'circle', radius: 6 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.16,                   // per second while stood in it
      lingerMs: 22000,
      // "the most-applied debuff on PTR (838x), and its amp is the upstream
      // cause of most of the death report."
      good: 'Leave the acid pools alone and re-stack on clean floor.',
      failText: 'Stood in Caustic Residue — +30% damage taken from everything',
    },
    {
      id: 'surge',
      name: 'Venomous Surge',
      spellId: 1306120,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 10000,             // "Players are drenched for 10s"
      shape: { kind: 'circle', radius: 8 },
      origin: 'targeted',
      rule: { type: 'carryOut', minDistance: 22 },
      spawns: { defId: 'cyst' },
      good: 'Carriers run out, drop the cyst clear of the raid path and the next wind, then return.',
      failText: 'Dropped the Surge on the raid',
    },
    {
      id: 'cyst',
      name: 'Viscous Cyst',
      spellId: 1287205,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,
      shape: { kind: 'circle', radius: 4 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.32,
      lingerMs: 30000,
      popsOnContact: true,          // "pops on contact" — one hit, then gone
      good: 'Cysts are left alone to expire.',
      failText: 'Popped a Viscous Cyst — 30% slow in the wind',
    },
    {
      id: 'crosswinds',
      name: 'Raging Crosswinds',
      spellId: 1285616,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 8000,              // "An 8s wind debuff that explodes on expiry"
      shape: { kind: 'circle', radius: 10 },
      origin: 'player',
      rule: { type: 'survive' },
      knockbackYards: 16,
      good: 'Carriers spread clear and stand so the knock throws them across the platform.',
      failText: 'Blown into the abyss by Crosswinds',
    },
    {
      id: 'maelstrom',
      name: 'Howling Maelstrom',
      spellId: 1285732,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,
      // A gale sweeping the whole arena: the safe ground is the inner ring.
      shape: { kind: 'annulus', inner: 20, outer: 60 },
      origin: 'boss',
      rule: { type: 'avoid' },
      damage: 0.46,
      knockbackYards: 20,
      good: 'Raid moves with the wind, stays off the edge, and dumps every cooldown into the window.',
      failText: 'Caught by the Maelstrom gale near the edge',
    },
    {
      id: 'corroding',
      name: 'Corroding Venom',
      spellId: 1282873,
      roles: ['tank'],
      telegraphMs: 1500,
      origin: 'boss',
      // "Each melee landing stacks a 12s debuff adding +3% Physical damage
      // taken." One of the fight's two swap drivers.
      rule: { type: 'tankSwap', maxStacks: 5 },
      good: 'Tanks swap on an agreed stack count and stacks drop off the off-tank between swaps.',
      failText: 'Held Corroding Venom too long — taunt the swap sooner',
    },
    {
      id: 'presence',
      name: "Ula'tek's Presence",
      spellId: 1285965,
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
