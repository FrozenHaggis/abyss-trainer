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
// The `what` strings are NOT the tactic file's lines verbatim. They were, and
// the panel they render into is read mid-pull with the fight paused on top of
// the player — analyst prose full of raw spell IDs and source caveats is the
// wrong register for that. Each one is rewritten to one or two plain sentences
// saying what the ability does and to whom, and the original line is kept
// verbatim in a "Tactic file:" comment above its mechanic so the rewrite can
// always be checked against its source.
//
// UNUSUAL FOR THIS TIER: nothing on this fight is tagged Mythic-only. Every entry
// in abilities.json carries `difficulties: ["Heroic","Mythic"]`, so there is no
// exclusion list — the whole fight is in scope for a Heroic trainer.
//
// ── the fight is a split, not a stack ────────────────────────────────────────
// Two golems: Breath of Ula'tek (258557, Nature, GREEN) and Blood of Ula'tek
// (258558, Shadow, RED). The raid halves and one group parks on each, so almost
// every mechanic below belongs to a side and only half the raid ever sees it.
// That is why `sided` is set and why the mechanics carry `side` — a droplet
// sweep barked at the red group teaches the wrong reflex.
//
// The separation is the fight. Within 40 yards of each other both golems gain
// 99% damage reduction, so the tanks hold them at opposite ends; and being
// within 40 yards of a golem is also what applies its Mark. Those two 40s are
// the same number doing two jobs, which is what makes the geometry teachable:
// stand where you can be marked by only one of them.
//
// This file used to record Ula'tek's Dominance as "inexpressible: there is no
// second boss position for the engine to measure a separation against ... the
// single most important tank job on the real fight and the trainer cannot teach
// it." There are two boss positions now, a tanked golem walks to its tank, and
// `keepApart` scores the separation — so walking your golem into the other one
// costs you 99% of your damage, exactly as it does in the fight.
//
// ── what is deliberately NOT here ────────────────────────────────────────────
// • Bloodvenom Injection (1284487 / 1284491 / 1310126) — the fight's SECOND tank
//   swap driver, on the red golem. The sim binds one tankSwap def per boss, and
//   a test requires the tank mechanic to belong to the PRIMARY entity, so a
//   second swap owned by Blood would be unplayable: you would be told to taunt
//   something you are not holding. Empowering Slam takes the slot.
// • Clinging Murk (1288297 / 1303097) — "Bad: No failure exists here" healer
//   pressure with nothing to execute. Its cost is rolled into the Mark drain
//   rather than spent as a separate no-op entry.
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
  blurb: 'Split the raid, keep the golems 40 apart, and pair to exactly four green. The Marks are the clock.',
  // The bounding circle, measured from PTR combat logs rather than guessed:
  // Circle (CV 10.7%, corner/axis 0.89), 126,814 position samples over 34 pulls.
  // 1 yard = 100 coordinate units. Everything the sim clamps against — spawn
  // jitter, ally stations, the out-of-bounds check — still uses this number, so
  // the polygon below is built to sit inside it.
  arenaRadius: 55,
  // The floor shape is load-bearing on this fight, which is why it is the only
  // boss in the tier that declares one.
  //
  // The room is an OCTAGON with an alcove at each end: green west, red east.
  // Two things have to be true at once — the tanks hold the golems more than 40
  // yards apart, and each group stands within 40 yards of its OWN golem and more
  // than 40 from the other. Whether that is even possible is a question about
  // the shape of the floor, so the floor is authored instead of assumed. At 68
  // yards of separation the two 40-yard bubbles overlap in a band twelve yards
  // wide at the midline, closing to nothing about twenty yards out from it.
  // That band is the double-Mark trap: small enough to walk out of, big enough
  // to blunder into while chasing a droplet.
  //
  // The polygon EXPLAINS the measurement rather than contradicting it. The
  // circle fit reported corner/axis 0.89 — players reach measurably less far on
  // the diagonals than on the axes, and a true circle would be 1.0. That is
  // exactly what an octagon looks like when you fit a circle to it: the flat
  // walls sit on the axes and the diagonals are cut away. This floor reaches 54
  // along x (through the alcove) and 44 along y against 42.3 on the diagonals,
  // a corner/axis ratio of 0.86 — the same shortfall the log measured, from a
  // room shape rather than from a fudge factor.
  //
  // Proportions are the tactic room's ~120 x 96 scaled to fit inside the
  // measured 55-yard bounding circle. The alcoves are the widest points, at
  // 54.7 yards — deliberately just inside it, because the sim treats anything
  // past arenaRadius as a fall.
  arena: {
    kind: 'polygon',
    points: [
      // East wall, with the RED alcove cut into it.
      { x: 50, y: -12 }, { x: 50, y: -9 }, { x: 54, y: -9 },
      { x: 54, y: 9 }, { x: 50, y: 9 }, { x: 50, y: 12 },
      // North-east diagonal, north wall, north-west diagonal.
      { x: 14, y: 44 }, { x: -14, y: 44 },
      // West wall, with the GREEN alcove cut into it.
      { x: -50, y: 12 }, { x: -50, y: 9 }, { x: -54, y: 9 },
      { x: -54, y: -9 }, { x: -50, y: -9 }, { x: -50, y: -12 },
      // South-west diagonal, south wall.
      { x: -14, y: -44 }, { x: 14, y: -44 },
    ],
  },
  // The raid halves before the pull and the player picks which half to run with.
  sided: true,
  // No kick exists on this fight: no guide lists Contaminate as interruptible
  // and the log recorded zero interrupts. Cast count proxies add kill speed.
  addEverySec: 30,
  maxAdds: 4,
  adds: [
    {
      id: 'coagulation_add', name: 'Venom Coagulation', npcId: 260766, spellId: 1284257,
      // Beside Breath, which summoned it, rather than on a ring around the room:
      // it belongs to the green group and must never appear in the red half.
      job: 'kill', count: 2, hp: 11, fuseSec: 17, auraDps: 0.5, spawnAtEntity: 'breath',
      good: 'Kill it quickly — Contaminate cannot be interrupted, only outpaced.',
      failText: 'A Venom Coagulation contaminated the raid',
    },
  ],
  entities: [
    // Both golems are tanked, and held apart. "Tanks hold them 40+ yards apart
    // all pull" — Ula'tek's Dominance gives both 99% damage reduction while they
    // are close. Each golem has its own tank mechanic (Empowering Slam on
    // Breath, Bloodvenom Injection on Blood), so the two tanks TRADE golems
    // rather than passing one between them.
    //
    // They sat 26 yards apart here, against a link this file then scored at 25 —
    // a yard outside the failure state, on a fight whose whole tank job is
    // holding them at 40+. Sixty-eight yards is far enough that both tanks can
    // take a full leash of drift toward each other and still be clear, and close
    // enough that the two 40-yard Mark radii overlap in the middle. If they did
    // not overlap at all there would be no way to make the split raid's
    // characteristic mistake, and no way to be taught out of it.
    { id: 'breath', name: "Breath of Ula'tek", npcId: 258557, start: { x: -34, y: 0 }, tankedApart: true, side: 'green' },
    { id: 'blood', name: "Blood of Ula'tek", npcId: 258558, start: { x: 34, y: 0 }, tankedApart: true, side: 'red' },
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  // "They share an energy bar; at 100 energy both channel Vitriolic Stasis."
  energyPerSec: 2.2,          // ~45s between Stasis windows
  atFullEnergy: 'stasis',
  ambient: ['markAcid', 'markBlood'],
  // Deliberately NOT extended. The Marks stack forever, so more time is more
  // stacks: lengthening the pull made every role die to Mark of Acid rather
  // than clear. On this fight the answer to "too tight" is damage, never clock.
  pullLengthSec: 160,

  // Alternating pressure from both golems, and deliberately balanced between
  // them: green sweeps droplets and dodges slime lines, red splits a soak and
  // dispels. A loop weighted to one side would leave whichever half the player
  // picked doing nothing for stretches of the pull.
  //
  // Also mixed so the raid is pushed OUT (droplets, Living Venom, Protovenom) as
  // often as it is pulled IN (the slime swap, the Miasma soak) — a loop that
  // only ever says "run out" trains one reflex and no decisions.
  loop: [
    'slam', 'droplets', 'blighted', 'livingvenom', 'miasma', 'slam',
    'droplets', 'blighted', 'coagulation', 'miasma', 'slam', 'protovenom',
    'droplets', 'livingvenom', 'miasma', 'blighted', 'slam', 'miasma',
  ],

  // PHASES.md files this fight as "Recurring cycle", and it is — but the cycle
  // has a hard interruption in the middle of it, and the interruption changes
  // who is holding what. Three entries rather than two because leaving Stasis is
  // not a return to the opening: the tanks have swapped golems and the floor is
  // dirtier than it was.
  phases: [
    {
      id: 'p1',
      name: 'Split',
      banner: 'SPLIT — GREEN WEST, RED EAST',
      loop: [
        'slam', 'droplets', 'blighted', 'livingvenom', 'miasma', 'slam',
        'droplets', 'blighted', 'coagulation', 'miasma', 'slam', 'protovenom',
        'droplets', 'livingvenom', 'miasma', 'blighted', 'slam', 'miasma',
      ],
      loopIntervalSec: 6,
      ambient: ['markAcid', 'markBlood'],
      endsAtFullEnergy: true,
    },
    {
      id: 'stasis',
      name: 'Vitriolic Stasis',
      banner: 'PAIR TO EXACTLY FOUR GREEN',
      // Nothing else fires. Both golems are at 99% reduction and walking toward
      // each other, so there is no damage to do and no separation left to hold —
      // the only thing in the room is finding your partner.
      loop: ['helical'],
      loopIntervalSec: 12,
      // The orb game and nothing else. Toxic Droplets and Venom Coagulation are
      // phase one's problems; a slime wandering in mid-puzzle is noise during the
      // one window where reading other people's orbs is the entire job.
      suppressAddWaves: true,
      entitiesReduction: 0.99,
      entitiesConverge: true,
      // "healing the weaker up to match the healthier — so uneven damage is a
      // reset, not a meter problem." The health delta at cast start is the
      // tactic file's "most actionable number on the fight", and this is why it
      // is actionable: every point of it is progress handed back.
      levelEntitiesOnExit: true,
      // The tanks trade golems on the way out and drag them back to opposite
      // ends. Group assignments do NOT change — a raider who follows their tank
      // here walks into the wrong golem's Mark radius.
      swapEntitiesOnExit: true,
      // The intermission's real end condition is everyone having paired, and no
      // field expresses that: a phase can be left on a health threshold, on the
      // energy bar, or on an add pack dying. The bar is the closest of the
      // three, and it is the fight's own clock — Stasis begins when it fills and
      // both golems channel until it has filled again. That makes the bar the
      // expiry timer on Helical Toxins, which is the right shape: not pairing
      // inside it is Cultivated Burst, so the window is a deadline rather than a
      // suggestion.
      endsAtFullEnergy: true,
    },
    {
      id: 'p2',
      name: 'Split, Swapped',
      banner: 'TANKS HAVE SWAPPED — YOUR GROUP HAS NOT',
      loop: [
        'slam', 'miasma', 'droplets', 'blighted', 'livingvenom', 'slam',
        'miasma', 'droplets', 'coagulation', 'blighted', 'slam', 'miasma',
        'droplets', 'protovenom', 'livingvenom', 'miasma', 'slam', 'blighted',
      ],
      // Tighter, because this is where the pull is decided: the Marks are deep,
      // the Blood Venom pools have eaten part of the red side's floor, and the
      // bar is filling toward another Stasis.
      loopIntervalSec: 5,
      ambient: ['markAcid', 'markBlood'],
      // The bar keeps filling, so Stasis comes round again. The fight is a cycle
      // with a swap in the middle of it, not a ladder.
      endsAtFullEnergy: true,
    },
  ],

  mechanics: [
    // Tactic file: "Both bosses gain 99% DR for 10s while close to each other
    // (1290189, 1290193)."
    {
      id: 'dominance',
      name: "Ula'tek's Dominance",
      spellId: 1290189,
      what: "While the two golems are close together they both gain 99% damage reduction, so almost nothing the raid does hurts them.",
      from: 'breath',
      // The tank job, and for a long time the one this trainer could not teach:
      // "Good: Tanks hold them 40+ yards apart all pull."
      //
      // The range is a source conflict the tactic file flags outright — wowhead
      // says 25 yards, warcraft.wiki says 40 — and it resolves it in three
      // words: "Play 40." The raid that reported it plays 40. Scoring 25 here
      // meant the trainer sat a yard outside its own failure state all pull and
      // never once asked for the separation the fight actually wants.
      //
      // Judged continuously. Walk your golem into the other one and your shots
      // stop doing anything, which is the consequence the real fight applies.
      roles: ['tank'],
      telegraphMs: 0,
      origin: 'boss',
      rule: { type: 'keepApart', minYards: 40 },
      good: 'Tanks hold them 40+ yards apart all pull.',
      failText: "Let the golems close — Ula'tek's Dominance, 99% damage reduction",
    },
    // ───────────────────────────── shared ─────────────────────────────
    //
    // The Marks are two mechanics, not one, and splitting them is the whole
    // point. Modelled as a single raid-wide drain they were a timer everyone
    // shared equally, which is the opposite of what they do: each golem marks
    // whoever is within 40 yards of IT, so a raider standing in both radii
    // collects both. That is the split raid's characteristic mistake, and it is
    // why the healers on a badly split raid suffer for a positioning error
    // nobody can see on a damage meter.
    // Tactic file: "Nature raid DoT, 40yd, 40s, stacks — half the soft enrage,
    // unavoidable, dispel type n/a on wowhead."
    {
      id: 'markAcid',
      name: 'Mark of Acid',
      spellId: 1284500,
      what: "Anyone within 40 yards of Breath takes stacking Nature damage. The stacks never fall off, so it hurts more all pull.",
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 0,
      origin: 'boss',
      // "Bad: No positional failure exists. Deaths mean a slow kill or badly
      // spent healer cooldowns — a pace signal, never a name-and-shame."
      // raidDamage never produces a per-player failure. This half also carries
      // the green side's Contaminate healer cost.
      rule: { type: 'raidDamage', dps: 1.6 },
      // 40 yards is the same 40 the tanks are holding: the radius that marks you
      // is the radius that links the golems.
      //
      // The application cadence is not in the source data — the 40s in the note
      // is the debuff's duration, not how often it lands — so `everySec` is set
      // to make the soft enrage arrive inside this trainer's 150-second pull
      // rather than a real pull's several minutes. The arithmetic it is
      // calibrated to: a raider carrying ONE Mark finishes the pull at roughly
      // the raid's healing throughput, and a raider carrying BOTH finishes past
      // it. Standing in the middle is not a small mistake; it is the mistake.
      proximityStack: { radius: 40, everySec: 11, damagePerStack: 0.03 },
      good: 'Nothing to execute — kill the bosses before the stacks kill you.',
      failText: '',
    },
    // Tactic file: "Shadow raid DoT, 40yd, 40s, stacks — the other half of the
    // soft enrage and the deadliest ID in the log."
    {
      id: 'markBlood',
      name: 'Mark of Blood',
      spellId: 1284506,
      what: "Anyone within 40 yards of Blood takes stacking Shadow damage. Standing in range of both golems means carrying both Marks.",
      from: 'blood',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 0,
      origin: 'boss',
      rule: { type: 'raidDamage', dps: 1.6 },
      // Identical radius and cadence to Mark of Acid on purpose. They are
      // symmetrical, and the only asymmetry that should exist on this fight is
      // where you are standing.
      proximityStack: { radius: 40, everySec: 11, damagePerStack: 0.03 },
      good: 'Nothing to execute — kill the bosses before the stacks kill you.',
      failText: '',
    },
    // Tactic file: "At 100 energy both channel 30s (1284606 Breath, 1284588
    // Blood) at 99% DR while the weaker Sentinel heals up to match."
    {
      id: 'stasis',
      name: 'Vitriolic Stasis',
      spellId: 1284606,
      what: "Both golems stop and channel at 99% damage reduction, and the weaker one is healed back up to match the healthier one.",
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
    // Tactic file: "Stasis applies a 28s Nature+Shadow debuff to everyone;
    // colliding with another infected player combines applications, and exactly
    // four neutralises it."
    {
      id: 'helical',
      name: 'Helical Toxins',
      spellId: 1284590,
      what: "Stasis marks everyone with four orbs, some green and some red. Running into another marked player merges both sets.",
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      // The real debuff runs 28s; compressed here to a 10s window because the
      // decision — read your orbs, find the player who completes you — is made
      // in the first seconds and a 28s telegraph would just be dead air.
      telegraphMs: 10000,
      // No shape. Everyone gets four orbs above their head, 1+3, 2+2 or 3+1
      // green to red, and the answer is another player rather than a patch of
      // floor. Drawing it as a circle to stand in taught "get to the group",
      // which is very nearly the opposite: the group is where you find the wrong
      // partner fastest.
      origin: 'player',
      rule: { type: 'pairUp', target: 4 },
      // Colliding with a partner whose green count does not complete yours to
      // four kills you outright, and so does letting the debuff expire — the
      // tactic file's Cultivated Burst (1284941, Deadly). `lethal` is not set
      // here because it is derived from 1284590's own category (Important) and
      // a test re-derives it from the data; the death belongs to a different ID
      // and is named in the failText instead of being smuggled into this one.
      good: 'Assigned groups pair to exactly four and neutralise before expiry.',
      failText: 'Finished Helical Toxins off exactly four — Cultivated Burst',
    },
    // Tactic file: "Contaminates random players ; a contaminated player touching
    // a clean one detonates 1296962 — damage in 10yd plus knockback."
    {
      id: 'protovenom',
      name: 'Protovenom Eruption',
      spellId: 1296962,
      what: "Random players are contaminated. A contaminated player touching a clean one detonates, damaging and knocking back everyone within 10 yards.",
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 3000,
      // "damage in 10yd plus knockback". Modelled as ground to avoid, because no
      // Rule scores player-to-player proximity — the real mechanic is a
      // contaminated player touching a clean one.
      //
      // This is the INVERSE of Helical Toxins: there, running into another
      // player is the answer; here it is the failure. The tactic file spells out
      // why both belong in a trainer — "This is the inverse of Helical Toxins —
      // do not confuse them during Stasis." A raider who has only ever drilled
      // one of them has learned a reflex that will kill them during the other.
      shape: { kind: 'circle', radius: 10 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.38,
      good: 'Contaminated players clear out and stay off clean bodies until it drops.',
      failText: 'Caught in a Protovenom Eruption',
    },

    // ──────────────────── Breath of Ula'tek — GREEN ────────────────────
    // Tactic file: "Physical tank hit stacking ~15% increased Physical damage
    // per consecutive hit on the same target."
    {
      id: 'slam',
      name: 'Empowering Slam',
      spellId: 1284458,
      what: "A heavy melee hit on whoever is tanking Breath. Each consecutive hit on the same tank lands about 15% harder.",
      from: 'breath',
      roles: ['tank'],
      telegraphMs: 1500,
      origin: 'boss',
      // "stacking ~15% increased Physical damage per consecutive hit on the same
      // target" — the Breath swap driver, and the one this trainer scores.
      //
      // Left UNSIDED on purpose even though Breath casts it. Red's swap driver
      // is Bloodvenom Injection, which cannot be authored here (see the header),
      // so tagging this green would leave a tank who picked red with no swap
      // reps at all for the whole pull.
      rule: { type: 'tankSwap', maxStacks: 4 },
      good: 'Breath tanks swap on the agreed stack count so the buff resets.',
      failText: 'Held Empowering Slam too long — taunt the swap sooner',
    },
    // Tactic file: "1284434 scatters droplets; each erupts into Noxious Blast
    // after 16s."
    {
      id: 'droplets',
      name: 'Toxic Droplets',
      spellId: 1284434,
      what: "Breath scatters droplets across your half of the room. Each one still there after 16 seconds erupts into Noxious Blast on the whole raid.",
      from: 'breath',
      side: 'green',
      roles: ['tank', 'dps', 'healer'],
      // "1284434 scatters droplets; each erupts into Noxious Blast after 16s.
      // STEPPING ON A DROPLET DEFUSES IT."
      //
      // This was an `avoid` circle that scored you for standing in one — the
      // exact inverse of the mechanic, and the same defect Caustic Globule had.
      // Sweeping droplets is the assigned job, and the tactic file closes with
      // "Clearers stepping on droplets is the job, not a failure."
      telegraphMs: 16000,            // "each erupts ... after 16s"
      shape: { kind: 'circle', radius: 3 },
      origin: 'random',
      rule: { type: 'collect', count: 4 },
      // Soaking one is not free: the droplet launches a Living Venom back into
      // Breath, and the return path has to be dodged. That is the shape of the
      // green side — every job you do correctly hands you the next one.
      spawns: { defId: 'livingvenom', delayMs: 600 },
      good: 'Assigned clearers sweep every droplet inside 16s, so Noxious Blast never fires.',
      failText: 'A droplet went unswept — Noxious Blast erupted on the raid',
    },
    // Tactic file: "Droplet eruption after 16s — 300yd raid-wide Nature damage,
    // top killer in the log."
    {
      id: 'noxious',
      name: 'Noxious Blast',
      spellId: 1284452,
      what: "The eruption of a droplet nobody cleared. Heavy Nature damage lands on the entire raid, wherever anyone is standing.",
      from: 'breath',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 0,
      origin: 'boss',
      // What an uncleared droplet does to the raid. NOT in any loop — an
      // eruption that fired on a schedule would punish a clean sweep, and the
      // tactic file attributes it precisely: "each 1284452 event is one
      // uncleared droplet". It is fired by the droplet miss path, by id.
      //
      // 300 yards, so it is raid damage and can never be a per-player failure:
      // "count eruptions per pull and attribute deaths. A per-player hit
      // leaderboard would name the whole raid." Deliberately UNSIDED as well —
      // the miss belongs to the green group but the blast reaches the red one
      // too, which is exactly why it is measured collectively.
      //
      // `dps` is the rate it drains the raid bar at while it lands. It is the
      // heaviest number on this boss because 1284452 was the top killer in the
      // log.
      rule: { type: 'raidDamage', dps: 6 },
      collective: true,
      good: 'Assigned clearers sweep every droplet inside 16s, so Noxious Blast never fires.',
      failText: '',
    },
    // Tactic file: "Breath ejects a slime that returns to the golem after 4s,
    // damaging anyone on the return path."
    {
      id: 'livingvenom',
      name: 'Living Venom',
      spellId: 1284207,
      what: "Breath spits out a slime that races back into the golem four seconds later, hurting anyone caught on the line it travels.",
      from: 'breath',
      side: 'green',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,             // "returns to the golem after 4s"
      // The return path, drawn as a beam from the defused droplet into the golem.
      //
      // Two sources feed this: Breath ejects them on its own, and every droplet
      // somebody soaks launches one back. Both paths are real and both are wired
      // — it appears in the loop AND as the droplets' `spawns`.
      shape: { kind: 'line', length: 46, width: 8 },
      // Fired from the defused droplet back INTO Breath, so the beam is drawn
      // between two real points and its reach is the gap between them. Length
      // above is only the fallback for a beam with no caster to aim at.
      aimsAtCaster: true,
      // NOT boss-origin: a boss-anchored line re-anchors to the golem every tick,
      // which would drag the beam off the droplet it is supposed to start at.
      // The parent droplet passes its own position in.
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.34,
      good: 'Everyone reads the return line and steps out of it.',
      failText: 'Clipped by the Living Venom return path',
    },
    // Tactic file: "1284251 summons a slime pulsing raid-wide Contaminate
    // (1284257 cast → 1284258 damage) until killed."
    {
      id: 'coagulation',
      name: 'Venom Coagulation',
      spellId: 1284251,
      what: "Breath summons a slime that pulses damage on the whole raid until it dies. It cannot be interrupted, only killed.",
      from: 'breath',
      side: 'green',
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

    // ───────────────────── Blood of Ula'tek — RED ─────────────────────
    // Tactic file: "1284483 applies Blighted Blood , an 18s Shadow DoT, dispel
    // type Magic. Left to expire it drops a pool."
    {
      id: 'blighted',
      name: 'Blighted Blood',
      spellId: 1284471,
      what: "A Magic Shadow DoT lands on someone in your group. If it expires instead of being removed it leaves a pool where they stand.",
      from: 'blood',
      side: 'red',
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
    // Tactic file: "1288232 marks a player with 1288260; after ~8s it erupts as
    // 1288282 — Shadow damage in 7.5yd, split among everyone inside (300 base /
    // 600 Mythic)."
    {
      id: 'miasma',
      name: 'Unstable Miasma',
      spellId: 1288282,
      what: "A player in your group is marked, and about eight seconds later it erupts. The Shadow damage is split between everyone within 7.5 yards.",
      lethal: true,
      from: 'blood',
      side: 'red',
      // The cast picks a random NON-TANK, and the tanks stay on their golems.
      // A red tank who ran to the stack would drag Blood toward Breath, which is
      // the one thing this fight forbids — so the soak is scored against the red
      // group's dps and healers and nobody else.
      roles: ['dps', 'healer'],
      telegraphMs: 8000,             // "after ~8s it erupts"
      shape: { kind: 'circle', radius: 7.5 },   // "7.5yd" per wowhead
      origin: 'random',
      // "damage split among everyone inside" — taking the hit is CORRECT for
      // soakers; the failure is too few distinct bodies in the split.
      rule: { type: 'beInside' },
      soakers: 5,
      // And the price of soaking correctly: a few seconds later EVERY body that
      // was in the split drops a Blood Venom pool where it stood. The red group
      // spends floor to survive the eruption, which is why the red side of the
      // room is unrecognisable by the second Stasis.
      spawnsAtSoakers: 'bloodvenom',
      good: 'The soak group stacks tight before the timer so the split is survivable.',
      failText: 'Missed the Unstable Miasma soak — the split was too thin',
    },
    // Tactic file: "A pool dropped where a Miasma soaker was standing, damaging
    // anyone who stands in it."
    {
      id: 'bloodvenom',
      name: 'Blood Venom',
      spellId: 1284208,
      what: "Every player who soaked Unstable Miasma drops a pool where they stood. The pools damage anyone in them and last the rest of the pull.",
      from: 'blood',
      side: 'red',
      roles: ['tank', 'dps', 'healer'],
      // Two seconds of bloom before it bites, which is the beat the soakers get
      // to walk clear of their own pool. Without it the reward for soaking is an
      // ambush rather than a mechanic.
      telegraphMs: 2000,
      shape: { kind: 'circle', radius: 8 },
      origin: 'player',
      rule: { type: 'avoid' },
      // It does not despawn. The red side's floor is consumed over the pull by
      // where its own soak group chose to stand, and by the end the group is
      // fighting in whatever is left — that accumulation IS the mechanic, and a
      // pool that quietly expired would delete it.
      permanent: true,
      damage: 0.22,
      // The pool's own damage ID is still 0 in abilities.json — "SPELL ID NEEDED
      // ... described by guides, no ID on wowhead and no log row" — so this is
      // keyed to the confirmed infection marker 1284208. The data says the real
      // ID is unresolved, which makes the marker the only honest handle.
      good: 'Soakers step off their own pool and the group drifts to clean floor. The middle stays clear.',
      failText: 'Stood in a Blood Venom pool',
    },
  ],
}
