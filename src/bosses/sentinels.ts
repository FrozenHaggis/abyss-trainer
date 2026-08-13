import type { BossDef } from '../engine/types'

// The Entombed Guardrails — a parody of the Entombed Sentinels.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. Castle Pineapplia does the same thing (Shriekfruit teaches
// Shriekwing's mechanics) and it is the right call — the joke lands on the boss,
// but what you practise has to transfer to the actual raid, and it cannot if
// "Helical Toxins" is called something else here.
//
// Authored from 12.1/VenomousAbyss/Sentinels/EntombedSentinels.md and its
// abilities.json. Every spellId below is real and appears in that abilities.json;
// the `good` strings are the file's own "Good:" lines, with inline spell IDs
// swapped for the ability's name.
//
// UNUSUAL FOR THIS TIER: nothing on this fight is tagged Mythic-only. Every entry
// in abilities.json carries `difficulties: ["Heroic","Mythic"]`, so there is no
// exclusion list — the whole fight is in scope for a Heroic trainer.
//
// ── the two Sentinels ────────────────────────────────────────────────────────
// This is a two-entity encounter: Breath of Ula'tek (258557, Nature) and Blood of
// Ula'tek (258558, Shadow). The engine has exactly one bossPos, so the split is
// expressed by where each mechanic comes FROM rather than by two boss actors:
//
//   Breath  — anchored on the boss / the floor around it: Empowering Slam,
//             Living Venom, Toxic Droplets → Noxious Blast, Venom Coagulation,
//             and the Vitriolic Stasis channel that seeds Helical Toxins.
//   Blood   — lands out in the raid: Blighted Blood, Blood Venom, Unstable
//             Miasma, Shifting Protovenom.
//
// Every mechanic below is commented with which golem owns it.
//
// ── what is deliberately NOT here ────────────────────────────────────────────
// • Ula'tek's Dominance (1290189 / 1290193) — the 99% DR the pair gains within
//   ~25yd of each other. Inexpressible: there is no second boss position for the
//   engine to measure a separation against, and no Rule that scores boss-to-boss
//   distance. It is the single most important tank job on the real fight and the
//   trainer cannot teach it.
// • Bloodvenom Injection (1284487 / 1284491 / 1310126) — the fight's SECOND tank
//   swap driver. The sim binds one tankSwap def per boss, so Empowering Slam
//   takes the slot; it has the cleaner "Good:" line and is the purer swap.
// • Clinging Murk (1288297 / 1303097) and Contaminate (1284257 / 1284258) — both
//   are "Bad: no failure exists" healer pressure with nothing to execute. Their
//   cost is rolled into the Mark of Acid / Mark of Blood ambient drain rather
//   than spent as separate no-op entries.
// • Cultivated Burst (1284941) — the punishment for finishing Helical Toxins off
//   the wrong count, folded into that mechanic's failText.
//
// NO INTERRUPTS. The file is explicit: "None — no kickable casts on this boss."
// Zero interrupts in the log, and Contaminate is not kickable. There is no
// `press: interrupt` here and there must never be one.
//
// The one real dispel is Blighted Blood (1284471, Magic, 14 real dispels).

export const sentinels: BossDef = {
  key: 'sentinels',
  name: 'The Entombed Guardrails',
  realName: 'Entombed Sentinels',
  blurb: 'Nothing to kick and one dispel. Mis-stacked Helical Toxins ends pulls; the Marks are the clock.',
  // Big room on purpose — the tanks have to hold the two golems 40+ yards apart
  // all pull, and the floor needs to be able to hold that split.
  arenaRadius: 44,
  entities: [
    { id: 'breath', name: "Breath of Ula'tek", npcId: 258557, start: { x: -13, y: 0 } },
    { id: 'blood', name: "Blood of Ula'tek", npcId: 258558, start: { x: 13, y: 0 } },
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  // "They share an energy bar; at 100 energy both channel Vitriolic Stasis."
  energyPerSec: 2.2,          // ~45s between Stasis windows
  atFullEnergy: 'stasis',
  ambient: ['marks'],
  pullLengthSec: 150,

  // Alternating pressure from both golems: Breath's floor clutter and melee
  // stacks, Blood's outgoing debuffs. Deliberately mixed so the raid is pushed
  // OUT (droplets, Living Venom, Blood Venom, Protovenom) as often as it is
  // pulled IN (the slime swap, the Miasma soak, the Helical stack-up) — a loop
  // that only ever says "run out" trains one reflex and no decisions.
  loop: [
    'slam', 'droplets', 'blighted', 'livingvenom', 'slam', 'miasma',
    'droplets', 'bloodvenom', 'slam', 'protovenom', 'livingvenom', 'coagulation',
    'slam', 'droplets', 'blighted', 'miasma', 'slam', 'bloodvenom',
  ],

  mechanics: [
    // ───────────────────────────── shared ─────────────────────────────
    {
      id: 'marks',
      name: 'Mark of Acid / Mark of Blood',
      spellId: 1284500,
      from: 'breath',              // Nature half; 1284506 is Blood's Shadow half
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 0,
      origin: 'boss',
      // "Bad: No positional failure exists. Deaths mean a slow kill or badly
      // spent healer cooldowns — a pace signal, never a name-and-shame."
      // raidDamage never produces a per-player failure. This is the soft enrage,
      // and it also carries the Clinging Murk / Contaminate healer cost.
      rule: { type: 'raidDamage', dps: 3.2 },
      good: 'Nothing to execute — kill the bosses before the stacks kill you.',
      failText: '',
    },
    {
      id: 'stasis',
      name: 'Vitriolic Stasis',
      spellId: 1284606,
      from: 'breath',              // Breath's channel; 1284588 is Blood's
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2500,
      origin: 'boss',
      // "Bad: Not a player failure — a phase marker. The finding is the health
      // delta between bosses at cast start." Nothing to dodge, so raidDamage —
      // but it is the trigger for the mechanic that actually ends pulls.
      rule: { type: 'raidDamage', dps: 2.4 },
      spawns: { defId: 'helical' },
      good: 'Both enter at near-identical health, so the heal-up is negligible.',
      failText: '',
    },
    {
      id: 'helical',
      name: 'Helical Toxins',
      spellId: 1284590,
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      // The real debuff runs 28s; compressed here to a 10s window because the
      // decision — find your group and combine — is made in the first seconds
      // and a 28s telegraph would just be dead air.
      telegraphMs: 10000,
      shape: { kind: 'circle', radius: 9 },
      origin: 'random',              // seeded at the Stasis channel by `spawns`
      // "colliding with another infected player combines applications, and
      // exactly four neutralises it" — so being OUT of the group is the failure.
      rule: { type: 'beInside' },
      soakers: 4,                    // exactly four, per the file
      good: 'Assigned groups pair to exactly four and neutralise before expiry.',
      failText: 'Never reached four Helical Toxins — Cultivated Burst',
    },
    {
      id: 'protovenom',
      name: 'Protovenom Eruption',
      spellId: 1296962,
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 3000,
      // "damage in 10yd plus knockback". Modelled as ground to avoid, because no
      // Rule scores player-to-player proximity — the real mechanic is a
      // contaminated player touching a clean one, the inverse of Helical Toxins.
      shape: { kind: 'circle', radius: 10 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.38,
      good: 'Contaminated players clear out and stay off clean bodies until it drops.',
      failText: 'Caught in a Protovenom Eruption',
    },

    // ──────────────────────── Breath of Ula'tek ────────────────────────
    {
      id: 'slam',
      name: 'Empowering Slam',
      spellId: 1284458,
      from: 'breath',
      roles: ['tank'],
      telegraphMs: 1500,
      origin: 'boss',
      // "stacking ~15% increased Physical damage per consecutive hit on the same
      // target" — the Breath swap driver, and the one this trainer scores.
      rule: { type: 'tankSwap', maxStacks: 4 },
      good: 'Breath tanks swap on the agreed stack count so the buff resets.',
      failText: 'Held Empowering Slam too long — taunt the swap sooner',
    },
    {
      id: 'droplets',
      name: 'Toxic Droplets',
      spellId: 1284434,
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1800,
      shape: { kind: 'circle', radius: 5 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.12,                  // the scatter is a scratch; the fuse is not
      spawns: { defId: 'noxious' },
      good: 'Assigned clearers sweep every droplet inside 16s, so Noxious Blast never fires.',
      failText: 'Stood in the Toxic Droplets scatter',
    },
    {
      id: 'noxious',
      name: 'Noxious Blast',
      spellId: 1284452,
      lethal: true,
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 16000,            // "each erupts into Noxious Blast after 16s"
      shape: { kind: 'circle', radius: 10 },
      origin: 'random',              // always placed on its parent droplet
      rule: { type: 'avoid' },
      // "top killer in the log". A long fuse sitting on the floor is the point:
      // it makes the arena progressively smaller and rewards reading the ground.
      damage: 0.44,
      good: 'Assigned clearers sweep every droplet inside 16s, so Noxious Blast never fires.',
      failText: 'Caught by a Noxious Blast eruption',
    },
    {
      id: 'livingvenom',
      name: 'Living Venom',
      spellId: 1284207,
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,             // "returns to the golem after 4s"
      // The return path, drawn as a line out of the golem. Boss-origin lines
      // track the boss's facing until they fire, so where the tank stands
      // decides which slice of the room the slime sweeps.
      shape: { kind: 'line', length: 46, width: 8 },
      origin: 'boss',
      rule: { type: 'avoid' },
      damage: 0.34,
      good: 'Everyone reads the return line and steps out of it.',
      failText: 'Clipped by the Living Venom return path',
    },
    {
      id: 'coagulation',
      name: 'Venom Coagulation',
      spellId: 1284251,
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 5000,
      shape: { kind: 'circle', radius: 10 },
      origin: 'random',
      // "The raid hard-swaps on spawn" — the slime pulses raid-wide Contaminate
      // until it dies and it CANNOT be kicked, so kill speed is the only lever.
      // Being off the add when the swap window closes is the failure.
      rule: { type: 'beInside' },
      soakers: 8,
      good: 'The raid hard-swaps on spawn; casts per spawn stay low.',
      failText: 'Never swapped to the Venom Coagulation slime',
    },

    // ───────────────────────── Blood of Ula'tek ─────────────────────────
    {
      id: 'blighted',
      name: 'Blighted Blood',
      spellId: 1284471,
      from: 'blood',
      roles: ['healer'],
      telegraphMs: 6000,
      shape: { kind: 'circle', radius: 5 },
      origin: 'random',
      // The fight's ONLY dispel — Shadow DoT, 18s, dispel type Magic, 14 real
      // removals in the log. Left to run full duration it drops a pool.
      rule: { type: 'press', ability: 'dispel', withinMs: 6000 },
      damage: 0.18,
      good: 'Assigned dispellers clear it fast; the infected player drifts to a dump spot while waiting.',
      failText: 'Blighted Blood expired undispelled',
    },
    {
      id: 'bloodvenom',
      name: 'Blood Venom',
      spellId: 1284208,
      from: 'blood',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 10000,
      shape: { kind: 'circle', radius: 8 },
      origin: 'targeted',
      // "on expiry it drops a toxic pool at their feet, larger with stacked
      // applications" — and it is NOT dispellable (wowhead: n/a), so nobody is
      // assigned to it. Walking it out is the whole job.
      rule: { type: 'carryOut', minDistance: 24 },
      // No `spawns` for the pool: its damage ID is still 0 in abilities.json and
      // this file invents nothing.
      good: 'Infected players walk pools to the dump area before expiry. The middle stays clean.',
      failText: 'Dropped Blood Venom on the raid',
    },
    {
      id: 'miasma',
      name: 'Unstable Miasma',
      spellId: 1288282,
      lethal: true,
      from: 'blood',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 8000,             // "after ~8s it erupts"
      shape: { kind: 'circle', radius: 7.5 },   // "7.5yd" per wowhead
      origin: 'random',
      // "damage split among everyone inside" — taking the hit is CORRECT for
      // soakers; the failure is too few distinct bodies in the split.
      rule: { type: 'beInside' },
      soakers: 5,
      good: 'The soak group stacks tight before the timer so the split is survivable.',
      failText: 'Missed the Unstable Miasma soak — the split was too thin',
    },
  ],
}
