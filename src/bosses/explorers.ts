import type { BossDef } from '../engine/types'

// The Lost Subagents — a parody of The Lost Explorers.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. The joke lands on the boss, but what you practise has to
// transfer to the actual raid, and it cannot if "Blast Wave" is called something
// else here.
//
// Authored from 12.1/VenomousAbyss/Explorers/LostExplorers.md and abilities.json.
// Every spellId below is real and appears in that abilities.json; the `good`
// strings are the file's own "Good:" lines, with parenthetical spell IDs trimmed.
//
// Difficulty scope: the tactic file records NOTHING as Mythic-only — every ID in
// the file is tagged ["Heroic","Mythic"] — so unlike Sszorak nothing had to be
// excluded on difficulty grounds. What is missing here was cut for gameplay, and
// each cut is noted below.
//
// The file's overview sets the design: "What actually wipes raids is Blast Wave —
// 18 killing blows on the Mythic PTR sample, more than any other ID — and the
// only answer is being airborne on a Bouncy Mushroom when it passes." So Blast
// Wave is the full-energy event and everything else feeds it: the missed kick
// snares you, Shell Spin stuns you, and either one puts you on the ground when
// the wave arrives.
//
// One honest limitation: the rule set has no way to express "be airborne on a
// mushroom", and Bounce (1299854) is a SUCCESS signal in the logs, not a
// mechanic that can fail. Blast Wave is therefore modelled as the ground-level
// ring it is — an annulus you escape by getting off the open floor. The lesson
// that transfers is "have your answer ready before the wave, not after it".
//
// Deliberately NOT modelled, and why:
//   • Blink Nova (1294334), Final Ascension (1292780), Relic Rupture (1310027 /
//     1311587) and Fishy Feedback (1313303) are all unavoidable raid damage the
//     file refuses to pin on individuals. One raidDamage row (Malevolent
//     Presence) carries that attrition; three more would only repeat it.
//   • Elemental Explosion (1295952) and its element markers — rare, and the real
//     failure is two carriers meeting, which needs an ally-to-ally collision the
//     engine has no notion of.
//   • Throw Junk impact (1291935) — Splinters already teaches "do not touch the
//     crates", and a seventh floor-AoE would not add a decision.
//   • Steady Strikes (1291929) is Nama's swap driver and behaves identically to
//     Shredding Shards; folded into the one tankSwap entry rather than shipping
//     two identical rows.
//   • Creepy Flames (1292796) and Fungal Burst have no confirmed damage ID —
//     inventing one would be exactly the dishonesty the tests exist to catch.
//   • United Defense (1297646) is a boss buff on a three-body council, invisible
//     to player events and unmodellable in a single-target trainer.

export const explorers: BossDef = {
  key: 'explorers',
  name: 'The Lost Subagents',
  realName: 'The Lost Explorers',
  blurb: 'A three-body council with one real kick. Blast Wave took more killing blows than any other ability in the fight.',
  arenaRadius: 44,
  // Relic Rupture took 6 killing blows and hit 20 players on the Mythic PTR
  // sample. Deaths here are a crate-cleave failure, not a positioning one — the
  // junk piles up and has to be cleared.
  addEverySec: 24,
  adds: [
    {
      id: 'junk', name: 'Useless Junk', npcId: 272110, spellId: 1310027,
      job: 'kill', count: 2, hp: 5, fuseSec: 19, spawnRadius: 24,
      good: 'Cleave the crates down before they rupture.',
      failText: 'Relic Rupture — a crate was left standing',
    },
  ],
  entities: [
    { id: 'iku', name: "Scrollsage Iku", npcId: 261843, start: { x: 0, y: -12 } },
    { id: 'nama', name: "First Mate Nama", npcId: 261835, start: { x: -17, y: 4 } },
    { id: 'gebbo', name: "Trader Gebbo", npcId: 261848, start: { x: 17, y: 4 } },
    // Outside the health pool: 0 damage taken across 10,001 player damage events
    // in a Mythic PTR log, while casting Malevolent Presence 1,911 times.
    { id: 'morzahi', name: "Mor'zahi", npcId: 261584, start: { x: 0, y: 17 }, untargetable: true },
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,          // ~45s between Blast Waves
  atFullEnergy: 'blastwave',
  ambient: ['presence'],
  pullLengthSec: 150,

  // Three bosses casting at once, so the loop never gives you a clean beat.
  // It pulls in both directions on purpose: Mighty Thud drags you into a
  // stack, Explosive Surprise and Splinters push you out of it, and Blast Wave
  // then demands you be somewhere else again.
  loop: [
    'eyes', 'flames', 'patches', 'shards', 'eyes', 'thud',
    'shellspin', 'flames', 'eyes', 'bomb', 'shards', 'patches',
    'eyes', 'splinters', 'flames', 'shellspin', 'eyes', 'thud',
  ],

  mechanics: [
    {
      id: 'flames',
      name: 'Icebound Flames',
      spellId: 1286922,
      from: 'iku',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,             // "4s cast on one player"
      // The only kickable cast in the fight, so it gets a shape purely so the
      // telegraph is visible — the renderer skips shapeless instances, and a
      // kick you cannot see is a kick you cannot practise.
      shape: { kind: 'circle', radius: 7 },
      origin: 'boss',
      rule: { type: 'press', ability: 'interrupt', withinMs: 4000 },
      damage: 0.26,                  // Frostfire hit plus a 12s DoT
      good: 'Kicked every time — 46 kicks against 5 completions on Mythic PTR.',
      failText: 'Missed the kick — Icebound Flames landed the snare',
    },
    {
      id: 'patches',
      name: 'Fire Patch',
      spellId: 1297649,
      from: 'iku',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2500,
      shape: { kind: 'circle', radius: 7 },
      // Left where the Frostfire Volley missiles landed. Frost Patch (1297648)
      // and Spreading Flames (1297650) are the same rule on the same section of
      // the tactic file, so they are one entry rather than three identical ones.
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.15,                  // per second while stood in it
      lingerMs: 25000,
      good: 'Dropped at the arena edge and never re-entered.',
      failText: 'Stood in a Frostfire patch',
    },
    {
      id: 'eyes',
      name: 'Evil Eyes',
      spellId: 1292764,
      from: 'iku',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2000,
      // "hitting within 3 yds" — small, but the most-cast ability in the fight
      // (x700 Mythic), and the statues project it at player locations. It is the
      // constant movement tax that stops you parking anywhere.
      shape: { kind: 'circle', radius: 3 },
      origin: 'player',
      rule: { type: 'avoid' },
      damage: 0.3,
      good: 'Constant small repositioning as the floor shrinks.',
      failText: 'Stood in an Evil Eyes impact',
    },
    {
      id: 'shellspin',
      name: 'Shell Spin',
      spellId: 1291918,
      from: 'nama',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 3000,
      shape: { kind: 'cone', radius: 30, arcDeg: 70 },
      origin: 'boss',
      // The file is explicit that this is everyone's problem, not the tank's:
      // "Any applydebuff of 1291918 on any player, tanks included — a 4s stun in
      // a Blast Wave window is a death." So it is an avoid, not a faceAway.
      rule: { type: 'avoid' },
      damage: 0.36,
      good: 'Nobody but the Nama tank is in the frontal, and the tank sidesteps the shells.',
      failText: 'Clipped by Shell Spin — stunned for 4s',
    },
    {
      id: 'shards',
      name: 'Shredding Shards',
      spellId: 1295858,
      from: 'iku',
      roles: ['tank'],
      telegraphMs: 1500,
      origin: 'boss',
      // "shards every 0.5s for 4s, each stack adding +50% damage taken from it"
      // — 1295858 is named in the file as the ID that drives the Iku tank swap.
      rule: { type: 'tankSwap', maxStacks: 5 },
      good: 'Only tanks in the damage rows; the Iku tank taunts off at the agreed count.',
      failText: 'Held Shredding Shards past the swap count',
    },
    {
      id: 'thud',
      name: 'Mighty Thud',
      spellId: 1300237,
      lethal: true,
      from: 'nama',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,
      shape: { kind: 'circle', radius: 8 },
      origin: 'random',
      // "impact damage splits among everyone in the landing zone" — a soak, so
      // being OUT of the marker is the failure.
      rule: { type: 'beInside' },
      // No source states a required count; the file only says deaths mean "too
      // few bodies in the marker", so 5 is a placeholder to confirm with the RL.
      soakers: 5,
      spawns: { defId: 'aftershock' },
      good: 'The soak group stacks into each marker and clears the crater the instant it resolves.',
      failText: 'Missed the Mighty Thud soak — the hit was not split',
    },
    {
      id: 'aftershock',
      name: 'Aftershock',
      spellId: 1310500,
      from: 'nama',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,                 // the crater is there the moment the leap lands
      shape: { kind: 'circle', radius: 8 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.12,                   // per second — "10 dps Heroic"
      lingerMs: 14000,
      // Same section of the tactic file as Mighty Thud, so it shares its Good
      // line: the soak and the clear-out are one habit, not two.
      good: 'The soak group stacks into each marker and clears the crater the instant it resolves.',
      failText: 'Stood in the Aftershock crater',
    },
    {
      id: 'splinters',
      name: 'Splinters',
      spellId: 1308853,
      lethal: true,
      from: 'gebbo',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 8000,              // "stacking Physical bleed, 8s"
      shape: { kind: 'circle', radius: 6 },
      origin: 'targeted',
      // NO DISPEL ON THIS BOSS. The tactic file is emphatic: Splinters is a
      // bleed with no dispel type, the log removals were Cauterizing Flame, and
      // "there is no dispel assignment on this boss". RaidLens shipped a phantom
      // dispel section for exactly this debuff once; it does not come back here.
      rule: { type: 'carryOut', minDistance: 18 },
      good: 'Nobody under a crate, nobody clips one, and cleave kills every crate before it ruptures.',
      failText: 'Kept Splinters in the raid',
    },
    {
      id: 'bomb',
      name: 'Explosive Surprise',
      spellId: 1296245,
      lethal: true,
      from: 'gebbo',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 10000,             // "10s bomb-carrier marker"
      shape: { kind: 'circle', radius: 10 },   // "10 yd Physical hit"
      origin: 'targeted',
      rule: { type: 'carryOut', minDistance: 22 },
      spawns: { defId: 'concussive' },
      good: "The carrier runs it clear and everyone in the wave's path is airborne on a mushroom when it passes.",
      failText: 'Dropped Explosive Surprise on the raid',
    },
    {
      id: 'concussive',
      name: 'Concussive Blast',
      spellId: 1299947,
      from: 'gebbo',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,
      shape: { kind: 'circle', radius: 10 },
      origin: 'random',               // spawned at the bomb's drop point
      rule: { type: 'avoid' },
      damage: 0.14,                   // per second — "12s Fire DoT", not a knockback
      lingerMs: 12000,
      good: "The carrier runs it clear and everyone in the wave's path is airborne on a mushroom when it passes.",
      failText: 'Stood in the Concussive Blast fire',
    },
    {
      id: 'blastwave',
      name: 'Blast Wave',
      spellId: 1305844,
      lethal: true,
      from: 'gebbo',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4500,
      // The deadliest ID in the fight. A ground-level fire wave rolling out from
      // the council: the open floor is the danger and the shape says so. See the
      // header note on why the mushroom answer is not expressible.
      shape: { kind: 'annulus', inner: 16, outer: 60 },
      origin: 'boss',
      rule: { type: 'avoid' },
      damage: 0.5,
      good: "The carrier runs it clear and everyone in the wave's path is airborne on a mushroom when it passes.",
      failText: 'Caught on the ground by Blast Wave',
    },
    {
      id: 'presence',
      name: 'Malevolent Presence',
      spellId: 1295450,
      from: 'morzahi',
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // "Neither is ever a player failure — Malevolent Presence took 8 killing
      // blows, so read it as the finisher on other mistakes." Unavoidable
      // raid-wide Shadow every 2s all fight: raidDamage, never a failure row.
      rule: { type: 'raidDamage', dps: 3.0 },
      good: 'Healers stay ahead of the baseline and hold cooldowns for each fish window.',
      failText: '',
    },
  ],
}
