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
// A two-entity encounter: Breath of Ula'tek (258557, Nature) and Blood of
// Ula'tek (258558, Shadow). BOTH are tanked, and held apart — each has its own
// tank mechanic (Empowering Slam on Breath, Bloodvenom Injection on Blood), so
// the two tanks trade golems rather than passing one between them. Every
// mechanic below is tagged with the golem that casts it.
//
// Ula'tek's Dominance is now modelled. This file used to record it as
// "inexpressible: there is no second boss position for the engine to measure a
// separation against ... the single most important tank job on the real fight
// and the trainer cannot teach it." There are two boss positions now, a tanked
// golem walks to its tank, and `keepApart` scores the separation — so walking
// your golem into the other one costs you 99% of your damage, exactly as it
// does in the fight.
//
// ── what is deliberately NOT here ────────────────────────────────────────────
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
  // Measured from PTR combat logs, not guessed: Circle (CV 10.7%, corner/axis 0.89). 126,814 samples over 34 pulls.
  // 1 yard = 100 coordinate units.
  arenaRadius: 55,
  // No kick exists on this fight: no guide lists Contaminate as interruptible
  // and the log recorded zero interrupts. Cast count proxies add kill speed.
  addEverySec: 30,
  maxAdds: 4,
  adds: [
    {
      id: 'coagulation_add', name: 'Venom Coagulation', npcId: 260766, spellId: 1284257,
      job: 'kill', count: 2, hp: 11, fuseSec: 17, auraDps: 0.5, spawnRadius: 26,
      good: 'Kill it quickly — Contaminate cannot be interrupted, only outpaced.',
      failText: 'A Venom Coagulation contaminated the raid',
    },
  ],
  entities: [
    // Both golems are tanked, and held apart. "Tanks hold them 40+ yards apart
    // all pull" — Ula'tek's Dominance gives both 99% damage reduction within
    // ~25yd of each other. Each golem has its own tank mechanic (Empowering
    // Slam on Breath, Bloodvenom Injection on Blood), so the two tanks TRADE
    // golems rather than passing one between them.
    //
    // They sat 26 yards apart here — barely outside the Dominance threshold and
    // nowhere near the 40 the fight asks for. The trainer was parked in the
    // failure state all pull, with both tanks on Breath and Blood untanked.
    { id: 'breath', name: "Breath of Ula'tek", npcId: 258557, start: { x: -22, y: 0 }, tankedApart: true },
    { id: 'blood', name: "Blood of Ula'tek", npcId: 258558, start: { x: 22, y: 0 }, tankedApart: true },
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
    {
      id: 'dominance',
      name: "Ula'tek's Dominance",
      spellId: 1290189,
      what: "Both bosses gain 99% DR for 10s while within ~25yd of each other (1290189, 1290193).",
      from: 'breath',
      // The tank job, and for a long time the one this trainer could not teach:
      // "Both bosses gain 99% DR for 10s while within ~25yd of each other.
      // Good: Tanks hold them 40+ yards apart all pull."
      //
      // Judged continuously. Walk your golem into the other one and your shots
      // stop doing anything, which is the consequence the real fight applies.
      roles: ['tank'],
      telegraphMs: 0,
      origin: 'boss',
      rule: { type: 'keepApart', minYards: 25 },
      good: 'Tanks hold them 40+ yards apart all pull.',
      failText: "Let the golems close — Ula'tek's Dominance, 99% damage reduction",
    },
    // ───────────────────────────── shared ─────────────────────────────
    {
      id: 'marks',
      name: 'Mark of Acid / Mark of Blood',
      spellId: 1284500,
      what: "The soft enrage. 1284500 (Nature) and 1284506 (Shadow) hit everyone in 40yd, 40s, stacking, forever.",
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
      what: "At 100 energy both channel 30s (1284606 Breath, 1284588 Blood) at 99% DR while the weaker Sentinel heals up to match.",
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
      what: "Stasis applies a 28s Nature+Shadow debuff to everyone; colliding with another infected player combines applications, and exactly four neutralises it.",
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
      what: "Contaminates random players ; a contaminated player touching a clean one detonates 1296962 — damage in 10yd plus knockback.",
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
      what: "Physical tank hit stacking ~15% increased Physical damage per consecutive hit on the same target.",
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
      what: "1284434 scatters droplets; each erupts into Noxious Blast after 16s.",
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      // "1284434 scatters droplets; each erupts into Noxious Blast after 16s.
      // STEPPING ON A DROPLET DEFUSES IT."
      //
      // This was an `avoid` circle that scored you for standing in one — the
      // exact inverse of the mechanic, and the same defect Caustic Globule had.
      // Sweeping droplets is the assigned job; the failure is a droplet nobody
      // reached, and the tactic file is explicit that the eruption is 300yd
      // raid-wide so "a per-player hit leaderboard would name the whole raid".
      telegraphMs: 16000,            // "each erupts ... after 16s"
      shape: { kind: 'circle', radius: 3 },
      origin: 'random',
      rule: { type: 'collect', count: 4 },
      // The eruption itself is Noxious Blast (1284452 / 1284451), 300yd
      // raid-wide. It is not a separate mechanic here because the tactic file
      // attributes it precisely: "each 1284452 event is one uncleared droplet".
      good: 'Assigned clearers sweep every droplet inside 16s, so Noxious Blast never fires.',
      failText: 'A droplet went unswept — Noxious Blast erupted on the raid',
    },
    {
      id: 'livingvenom',
      name: 'Living Venom',
      spellId: 1284207,
      what: "Breath ejects a slime that returns to the golem after 4s, damaging anyone on the return path.",
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
      what: "1284251 summons a slime pulsing raid-wide Contaminate (1284257 cast → 1284258 damage) until killed.",
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
      what: "1284483 applies Blighted Blood , an 18s Shadow DoT, dispel type Magic. Left to expire it drops a pool.",
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
      what: "Infects players ; on expiry it drops a toxic pool at their feet, larger with stacked applications.",
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
      what: "1288232 marks a player with 1288260; after ~8s it erupts as 1288282 — Shadow damage in 7.5yd, split among everyone inside (300 base / 600 Mythic).",
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
