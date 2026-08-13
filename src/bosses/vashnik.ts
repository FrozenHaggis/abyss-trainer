import type { BossDef } from '../engine/types'

// Vashnik the Malformed — a parody of Vashnik the Malignant.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. Castle Pineapplia does the same thing, and it is the right
// call — the joke lands on the boss, but what you practise has to transfer to
// the actual raid, and it cannot if "Plague Wave" is called something else here.
//
// Authored from 12.1/VenomousAbyss/Vashnik/Vashnik.md and abilities.json. Every
// spellId below is real and appears in that abilities.json; the `good` strings
// are the file's own "Good:" lines with the parenthetical spell IDs trimmed.
//
// Heroic only, so the whole Malignant Tumor package is excluded — the .md
// heading reads "Malignant Tumor (Mythic Only)" and both Hardened Tumor
// (1304437) and Malignance (1304459) are tagged ["Mythic"] in abilities.json.
//
// Two things this boss is NOT:
//
//   * There is no kick. The .md is explicit — "Nothing here is kickable" and
//     "Render no missed-kicks section" — so nothing here uses `interrupt`.
//     Inventing one would teach a button that does nothing in the real pull.
//   * Exploding Infection is NOT a dispel. Wowhead lists a Magic type, but
//     abilities.json records dispellable:false and the log corpus has zero
//     dispel events on it: "it is a placed bomb, not a cleanse target". So it is
//     modelled as `carryOut`. The fight has exactly two genuine healer dispels,
//     Clotting Blood and Congealing Bolt, and they are the only `press` rules.
//
// The .md overview sets the design: "What wipes raids: a venom reaching the
// Cavity and firing Malignant Burst (45 killing blows in six Mythic pulls, more
// than everything else combined)". So the headline mechanic is a kill-squad soak
// out at the arena EDGE that drags you outward, fought against Plague Waves,
// infections and venom trails that push you back in.
//
// Cut for budget — both are plain avoid-circles whose lesson is already carried
// by Plague Wave and Deadly Venom: Stygian Burst (1302489) and Caustic
// Explosion (1295209). The Stygian and Fire infection variants are still
// represented through Exploding Infection and Siphon Blood.

export const vashnik: BossDef = {
  key: 'vashnik',
  name: 'Vashnik the Malformed',
  realName: 'Vashnik the Malignant',
  blurb: 'Nothing here is kickable. A living venom that reaches the Cavity is what actually wipes raids.',
  // Measured from PTR combat logs, not guessed: Circle (CV 12.1%). A corridor at 120-180 deg reaches ~105yd and is excluded.
  // 1 yard = 100 coordinate units.
  arenaRadius: 58,
  // Two different lessons. The Shrouded Venom's absorb is worth 100% of its max
  // health, so damage does literally nothing until it breaks. The Clotting Venom
  // is immune to Disarm, Disorient, Fear, Slow, Root and Stun — "cannot be kited
  // or CC'd, only killed" — and splits on death, each split still walking for
  // the Malignant Cavity.
  addEverySec: 28,
  adds: [
    {
      id: 'shrouded', name: 'Shrouded Venom', npcId: 0, spellId: 1312366,
      job: 'kill', count: 1, hp: 8, shieldHp: 8, fuseSec: 16, spawnRadius: 30,
      good: 'Break Miasmic Coating first — until it drops, the add takes no damage at all.',
      failText: 'A Shrouded Venom survived its window',
    },
    {
      id: 'clotting', name: 'Clotting Venom', npcId: 259408, spellId: 1286631,
      job: 'kill', count: 2, hp: 7, fuseSec: 14, spawnRadius: 32,
      good: 'Kill them before they reach the Cavity — they cannot be slowed, rooted or feared.',
      failText: 'A Clotting Venom reached the Malignant Cavity',
    },
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,          // Imbibe at 100 energy — roughly every 45s
  atFullEnergy: 'imbibe',
  ambient: ['vapor'],
  pullLengthSec: 150,

  // "No phases — one loop driven by Imbibe." Between drinks the raid alternates
  // between running OUT (venom kill squads at the edge, bile lanes, froth
  // spreads) and collapsing back IN through waves, drains and trails.
  loop: [
    'fangs', 'burst', 'clotting', 'froth', 'siphon', 'fangs',
    'bile', 'burst', 'exploding', 'congealing', 'froth', 'fangs',
    'siphon', 'bile', 'burst', 'froth', 'exploding', 'clotting',
  ],

  mechanics: [
    {
      id: 'burst',
      name: 'Malignant Burst',
      spellId: 1280189,
      lethal: true,
      roles: ['tank', 'dps', 'healer'],
      // The cast itself is 1.5s, but the cast is the failure, not the mechanic.
      // What you actually practise is the crawl window: the venom is dragged out
      // of a fountain and walks for the Cavity, and the kill squad has to be on
      // it. So the telegraph is the walk, not the burst.
      telegraphMs: 7000,
      shape: { kind: 'circle', radius: 10 },
      // Venoms are pulled from the fountains at the edge and crawl inward to the
      // Malignant Cavity at the centre — so the soak is always an outward run.
      origin: 'edge',
      rule: { type: 'beInside' },
      soakers: 4,
      spawns: { defId: 'trail' },
      good: 'Every venom dies en route. Clotting Venom is CC-immune and splits; Shrouded Venom carries a full-health absorb and fires Umbral Ejection within 3yd on death; Burning Venom erupts with Caustic Surge, so kill it away from the raid.',
      failText: 'Let a venom reach the Cavity — Malignant Burst',
    },
    {
      id: 'fangs',
      name: 'Dripping Fangs',
      spellId: 1280934,
      roles: ['tank'],
      telegraphMs: 1800,
      origin: 'boss',
      // "Bad: Two consecutive 1280934 applications on the same player with no
      // swap" — so the ceiling is two, not a comfortable stack count.
      rule: { type: 'tankSwap', maxStacks: 2 },
      good: 'Tanks swap on every application; the gap between casts is the repositioning window for the next Imbibe.',
      failText: 'Held Dripping Fangs through a second application',
    },
    {
      id: 'froth',
      name: 'Plague Froth',
      spellId: 1281925,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 6000,                 // "ticking ... for 6s"
      shape: { kind: 'circle', radius: 4.5 },   // "a 4.5yd radius"
      origin: 'targeted',
      // Carriers "break to assigned spots past 4.5yd of everyone" — the bubble
      // is small but the drop spot is not, because the waves come next.
      rule: { type: 'carryOut', minDistance: 20 },
      spawns: { defId: 'wave' },
      good: 'Carriers break to assigned spots past 4.5yd of everyone, oriented so all four waves sweep empty floor.',
      failText: 'Held Plague Froth inside the raid',
    },
    {
      id: 'wave',
      name: 'Plague Wave',
      spellId: 1295798,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1200,                 // erupts the instant the Froth expires
      // Four cardinal waves in the real fight; the engine spawns one line per
      // Froth, angled off the carrier, which is the same lesson at lower volume.
      shape: { kind: 'line', length: 84, width: 8 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.45,                      // "roughly ten times the damage" of Froth
      good: 'Carriers break to assigned spots past 4.5yd of everyone, oriented so all four waves sweep empty floor.',
      failText: 'Clipped by a Plague Wave',
    },
    {
      id: 'bile',
      name: 'Catalytic Bile',
      spellId: 1282602,
      lethal: true,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 5000,                 // "A 5s cast forms an orb"
      shape: { kind: 'circle', radius: 6 },     // "hits only that player in 6yd"
      // The biles fly outward from the Cavity, so the lanes are at the edge.
      origin: 'edge',
      // "1 target cap" — this is a one-body interception, not a stack soak. The
      // assigner fills soakers-1 slots with allies, so at 1 the lane is yours.
      rule: { type: 'beInside' },
      soakers: 1,
      good: 'Assigned soakers are in their lanes before the cast finishes, defensive up, and every projectile is eaten.',
      failText: 'Missed your bile lane — it reached the Cavity',
    },
    {
      id: 'exploding',
      name: 'Exploding Infection',
      spellId: 1295173,
      roles: ['tank', 'dps', 'healer'],
      // Duration is not stated in the tactic file; 8s is a playable window for
      // the walk out and back. NOT a dispel — see the header note.
      telegraphMs: 8000,
      shape: { kind: 'circle', radius: 10 },
      origin: 'targeted',
      rule: { type: 'carryOut', minDistance: 20 },
      good: 'Carriers move on the telegraph, not on the debuff; healers pre-shield the absorb rather than out-healing it.',
      failText: 'Detonated Exploding Infection on the raid',
    },
    {
      id: 'siphon',
      name: 'Siphon Blood',
      spellId: 1295229,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 3000,
      shape: { kind: 'circle', radius: 10 },    // "drains anyone within 10yd"
      // Anchored on a Siphoning Infection carrier out in the raid, not on you —
      // the failure the .md scores is "1295229 on a non-carrier of 1295224".
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.18,                      // per second while stood in the drain
      lingerMs: 8000,
      good: 'Carriers move on the telegraph, not on the debuff; healers pre-shield the absorb rather than out-healing it.',
      failText: 'Stood inside a Siphoning carrier',
    },
    {
      id: 'trail',
      name: 'Deadly Venom',
      spellId: 1297338,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,                    // spawned already active
      shape: { kind: 'circle', radius: 5 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.14,                      // "reapplied every 1.2s while you stand in the trail"
      lingerMs: 20000,
      good: 'Nobody parks in either.',
      failText: 'Parked in a venom trail',
    },
    {
      id: 'clotting',
      name: 'Clotting Blood',
      spellId: 1302517,
      roles: ['healer'],
      telegraphMs: 4000,
      shape: { kind: 'circle', radius: 3 },
      origin: 'random',
      // One of the fight's only two real dispels: Magic, and genuinely dispelled
      // 126 times across 332 applications in the log corpus.
      rule: { type: 'press', ability: 'dispel', withinMs: 5000 },
      damage: 0.16,                      // the healing absorb, left to be eaten
      // Clotting Blood comes off the Clotting Venom, so it inherits the venom
      // clause of the Malignant Burst block's Good line.
      good: 'Every venom dies en route. Clotting Venom is CC-immune and splits.',
      failText: 'Left Clotting Blood up — absorb never cleansed',
    },
    {
      id: 'congealing',
      name: 'Congealing Bolt',
      spellId: 1305833,
      roles: ['healer'],
      telegraphMs: 5000,                 // "5s Shadow hit plus a movement snare"
      shape: { kind: 'circle', radius: 3 },
      origin: 'random',
      // The second real dispel: Magic, 58 dispels across 300 applications. The
      // .md wants holds cross-referenced against Plague Wave damage on the same
      // player — the snare is what leaves them standing in a wave lane.
      rule: { type: 'press', ability: 'dispel', withinMs: 6000 },
      damage: 0.18,
      good: 'Every venom dies en route. Shrouded Venom carries a full-health absorb and fires Umbral Ejection within 3yd on death.',
      failText: 'Left the Congealing Bolt snare up through a wave',
    },
    {
      id: 'imbibe',
      name: 'Imbibe',
      spellId: 1284663,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,                 // "4s cast draining two of three fountains"
      origin: 'boss',
      // Each drink fires two Expulsions, and every one of them is flagged
      // unavoidable raid-wide healer damage in abilities.json — there is no
      // dodge, so this can never read as a per-player failure. What it leaves
      // behind is the venom it drags out, hence the trail.
      rule: { type: 'raidDamage', dps: 6 },
      spawns: { defId: 'trail' },
      good: 'The tank parks the boss on a mark so the planned pair drains every cycle.',
      failText: '',
    },
    {
      id: 'vapor',
      name: 'Toxic Vapor',
      spellId: 1284561,
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // The soft enrage: one permanent stack per Imbibe, ticking on the whole
      // raid at 300yd. The .md could not be blunter — "Deaths on 1284561 are
      // kill-speed, never player failure" — so it is ambient attrition only.
      rule: { type: 'raidDamage', dps: 2.4 },
      // Toxic Vapor is documented inside the Imbibe block, so it takes that
      // block's Good line: the answer to the stacks is a clean fountain loop.
      good: 'The tank parks the boss on a mark so the planned pair drains every cycle.',
      failText: '',
    },
  ],
}
