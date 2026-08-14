import type { BossDef } from '../engine/types'

// The Recursive Altar — a parody of The Coiled Altar.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. Castle Pineapplia does the same thing (Shriekfruit teaches
// Shriekwing's mechanics) and it is the right call — the joke lands on the boss,
// but what you practise has to transfer to the actual raid, and it cannot if
// "Coalesced Venom" is called something else here.
//
// Authored from 12.1/VenomousAbyss/CoiledAltar/CoiledAltar.md and abilities.json.
// Every spellId below is real and appears in that abilities.json; the `good`
// strings are the file's own "Good:" lines.
//
// HEROIC ONLY. Everything tagged `difficulties: ["Mythic"]` is excluded:
// Tainted Blood, the Mythic Guillotined variants (1309944 / 1309940), Virulent
// Cyst / Caustic Secretion, Virulent Mutation / Mutagenic Venom, Spirit Shield,
// Spiritveil and Malevolent Resonance. None of them appear below.
//
// ── Why these twelve, out of roughly twenty-eight ──
// The tactic file's own verdict sets the design: "The thing that wipes raids is
// Venom Rupture — 58 Mythic killing blows, more than everything else combined —
// and it is arena management, not reflexes: every orb left where an axe or a
// tank cone will destroy it is a Rupture waiting to happen." So the fight's
// spine here is the venom economy, modelled as a spawn chain you can actually
// see going wrong:
//
//   Toxic Deluge ──▶ Noxious Ground   (a chunk lands, the floor stays poisoned)
//   Volatile Venom ──▶ Coalesced Venom (you touched venom, an orb is born)
//   Coalesced Venom ──▶ pops on contact (that pop IS Venom Rupture)
//
// Cut deliberately: Dreadmarch and the Manifestations of Dread (fixate-while-
// looking is a facing puzzle the engine has no vocabulary for), Gravebound and
// Soul Fragments (a pickup mechanic — there are no pickups), Soulbinding, the
// Fragments intermission and Deathguard (all DPS-race checks with nothing to
// dodge), Gloombomb (the tactic file says outright it has no identified damage
// ID), Wail of Terror (a second kick teaches nothing the first one doesn't),
// and Dreadful Presence (a second unavoidable raid tick, no decision in it).
//
// ── Two bosses, one loop ──
// This is not three stages, it is one continuous encounter, so Zul'jan owns the
// loop and Malacrass owns the energy bar. Zul'jan's venom, axe and cone cycle
// endlessly; every time the bar fills, Malacrass channels Eternal Nightfall and
// somebody has to kick it. That is the Stage Three truth — both up at once,
// soulbound — expressed as scheduling rather than as a phase transition.

export const coiledaltar: BossDef = {
  key: 'coiledaltar',
  name: 'The Recursive Altar',
  realName: 'The Coiled Altar',
  blurb: 'Venom Rupture is more killing blows than everything else combined. Arena management, not reflexes.',
  // Measured from PTR combat logs, not guessed: Rounded/octagonal, low confidence (corner/axis 1.27 — between circle 1.00 and square 1.41).
  // 1 yard = 100 coordinate units.
  arenaRadius: 43,
  // Three different jobs on one boss, which is why this fight is the hardest to
  // learn. The orbs must NOT be destroyed — Venom Rupture took 58 Mythic killing
  // blows, more than everything else in the fight combined — while the Soulcoiler
  // must be kicked and the Fragments must be body-blocked.
  addEverySec: 22,
  maxAdds: 8,
  adds: [
    {
      id: 'orbadd', name: 'Coalesced Venom', npcId: 268042, spellId: 1282408,
      job: 'leave', count: 2, hp: 1, fuseSec: 30, auraDps: 0.35, lethal: true,
      spawnRadius: 22,
      good: 'Never shoot an orb. Keep them clear of the axe path and let them sit.',
      failText: 'Destroyed a Coalesced Venom orb — Venom Rupture',
    },
    {
      id: 'soulcoiler', name: 'Spiteful Soulcoiler', npcId: 0, spellId: 1286399,
      job: 'kick', count: 1, hp: 10, fuseSec: 26, castEverySec: 12, spawnRadius: 27,
      good: 'Kick Wail of Terror — a 7s cast that fears the whole raid for 5s.',
      failText: 'Wail of Terror went off — raid feared',
    },
    {
      id: 'fragment', name: 'Fragment of Malacrass', npcId: 0, spellId: 1287718,
      job: 'intercept', count: 2, hp: 3, fuseSec: 22, marchSpeed: 3.2, spawnRadius: 34,
      good: "Step on every fragment before it reaches Zul'jan and casts Reclaim Essence.",
      failText: "A Fragment reached Zul'jan — Reclaim Essence",
    },
  ],
  entities: [
    { id: 'zuljan', name: "Zul'jan", npcId: 257911, start: { x: -10, y: 0 } },
    { id: 'malacrass', name: "Hex Lord Malacrass", npcId: 259854, start: { x: 13, y: -7 } },
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,          // ~45s per Eternal Nightfall — three kicks a pull
  atFullEnergy: 'nightfall',
  ambient: ['fangs'],
  pullLengthSec: 150,

  // The loop pushes you outward (deluge chunks, carrying venom clear, the axe
  // off the wall) and then hauls you back in (the Guillotine soak, the called
  // band, re-stacking on clean floor) so movement never settles in one gear.
  loop: [
    'twinfang', 'deluge', 'venomfang', 'sever', 'guillotine',
    'twinfang', 'volatile', 'axegrinder', 'widowskiss', 'deluge',
    'twinfang', 'venomfang', 'guillotine', 'sever', 'volatile',
    'twinfang', 'deluge', 'axegrinder', 'widowskiss', 'guillotine',
  ],

  mechanics: [
    {
      id: 'soulbound',
      name: 'Deathguard & Soulbound',
      spellId: 1309987,
      what: "Malacrass absorbs stunned Manifestations at 99% reduced damage , and Stage Three links both bosses so killing one berserks the other.",
      from: 'malacrass',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 0,
      origin: 'boss',
      // The entities do not share a health pool, so leaving one far behind is
      // the failure this rule scores. Judged continuously from the moment the
      // first one dies.
      rule: { type: 'syncKill', withinSec: 12 },
      good: 'Health pools stay level and both bosses die together.',
      failText: 'Health pools drifted apart — killing one berserks the other',
    },
    {
      id: 'fangs',
      name: 'Fangs of the Coiled Altar',
      spellId: 1282512,
      what: "Self-infusion pulsing the raid (1282487/1282512; Stage Three 1298381/1298594 adds healing absorption) and building stacks his autoattacks dump on the tank as Twinfang Toxin or Corrupted Toxin .",
      from: 'zuljan',
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // abilities.json: "Unavoidable raid-wide Nature pulse every 1s for 8s —
      // healing pressure, not positioning." There is nothing to dodge, so it
      // must never produce a per-player failure.
      rule: { type: 'raidDamage', dps: 3.4 },
      good: 'A cooldown covers every channel and only the active tank appears on the toxin IDs.',
      failText: '',
    },
    {
      id: 'twinfang',
      name: 'Twinfang Toxin',
      spellId: 1300322,
      what: "Nature DoT applied to the primary target by autoattacks that consume Fangs stacks.",
      from: 'zuljan',
      roles: ['tank'],
      telegraphMs: 1500,
      origin: 'boss',
      // The autoattack DoT that dumps the Fangs stacks on whoever is holding
      // him — the fight's swap driver. Its "Bad:" line is "a toxin applydebuff
      // on a non-tank", i.e. the off-tank was late. Shares the Fangs heading in
      // the tactic file, hence the shared "Good:" line.
      rule: { type: 'tankSwap', maxStacks: 4 },
      good: 'A cooldown covers every channel and only the active tank appears on the toxin IDs.',
      failText: 'Held Twinfang Toxin too long — taunt the swap sooner',
    },
    {
      id: 'sever',
      name: 'Sever',
      spellId: 1299684,
      what: "Frontal cone cleave (1299684 + 1301690 stack; Stage Three 1307292 + 1307403) that also destroys Coalesced Venom and, in Stage Three, applies Gravebound.",
      from: 'zuljan',
      roles: ['tank'],
      telegraphMs: 3000,
      shape: { kind: 'cone', radius: 32, arcDeg: 75 },
      origin: 'boss',
      // "Frontal cone cleave that also destroys Coalesced Venom" — so pointing
      // it at the raid is two failures at once: seven players cleaved, and every
      // orb in the path opened up as a Rupture.
      rule: { type: 'faceAway' },
      damage: 0.5,
      good: 'Cone faces away from the raid and tanks swap before a second cast lands.',
      failText: 'Swept the raid with Sever — and cut the venom open',
    },
    {
      id: 'deluge',
      name: 'Toxic Deluge',
      spellId: 1300137,
      what: "Venom chunks rain down , hitting within 4 yards and seeding a Coalesced Venom orb plus floor venom.",
      from: 'zuljan',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2500,
      shape: { kind: 'circle', radius: 4 },   // "hitting within 4 yards"
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.36,
      // "seeding a Coalesced Venom orb plus floor venom" — here the chunk leaves
      // the floor poisoned and the orbs arrive by the Volatile Venom route, so
      // the arena only fills up when somebody actually steps in something.
      spawns: { defId: 'noxious' },
      good: 'Nobody under a landing chunk; orbs land in called dump zones.',
      failText: 'Stood under a Toxic Deluge chunk',
    },
    {
      id: 'noxious',
      name: 'Noxious Ground',
      spellId: 1283290,
      what: "Persistent hazards — 1283290 ticks Nature damage, Stage Three 1298591 applies healing absorption.",
      from: 'zuljan',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,                  // spawned already active under the chunk
      shape: { kind: 'circle', radius: 7 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.15,                    // per second while stood in it
      lingerMs: 45000,
      // "189 applications and 12 killing blows on Heroic" — the quiet killer,
      // and the tactic file's target is the shortest "Good:" line in the raid.
      good: 'Zero uptime.',
      failText: 'Stood in Noxious Ground',
    },
    {
      id: 'volatile',
      name: 'Volatile Venom',
      spellId: 1282419,
      what: "Touching floor venom applies 1282419, pulsing damage within 5 yards for 5s and spawning a fresh orb when it expires.",
      from: 'zuljan',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 5000,               // "pulsing damage within 5 yards for 5s"
      shape: { kind: 'circle', radius: 5 },
      origin: 'player',
      // The whole economy of the fight in one rule: you touched venom, so you
      // run it clear and eat it alone — and when it expires it hands the arena
      // a fresh orb wherever you were standing. Drop it on the raid and you have
      // seeded a Rupture in the middle of everyone.
      rule: { type: 'carryOut', minDistance: 20 },
      spawns: { defId: 'orb' },
      good: 'Nobody touches venom; anyone who does runs clear and eats it alone.',
      failText: 'Carried Volatile Venom into the raid',
    },
    {
      id: 'orb',
      name: 'Coalesced Venom',
      spellId: 1282408,
      what: "Orbs pulse raid-wide damage every 2s (1282403 aura, 1282408 damage), and destroying one — by Guillotine axe or Sever cone — detonates Venom Rupture , a raid hit plus a stacking 10s DoT.",
      lethal: true,
      from: 'zuljan',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,
      shape: { kind: 'circle', radius: 5 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.34,
      lingerMs: 26000,
      // "destroying one — by Guillotine axe or Sever cone — detonates Venom
      // Rupture". popsOnContact is exactly that: the orb sits there harmlessly
      // until something touches it, and then it is gone and the raid is hurt.
      // Leaving them alone and leaving them somewhere safe is the entire fight.
      popsOnContact: true,
      good: 'Orb count stays flat, orbs sit clear of the axe path, ruptures come one at a time.',
      failText: 'Set off a Coalesced Venom orb — Venom Rupture',
    },
    {
      id: 'guillotine',
      name: 'Guillotine',
      spellId: 1283594,
      what: "An axe lands on a random player (1283489 cast, 1283485 marker) splitting damage within 9 yards and applying Guillotined (1307425, permanent on Mythic); under 5 soakers fires Execution (1283606, Stage Three 1299267/1299301).",
      from: 'zuljan',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,
      shape: { kind: 'circle', radius: 9 },   // "splitting damage within 9 yards"
      origin: 'random',
      // "Being hit by 1283594 is the job" — so this is a soak, and being OUT of
      // it is the failure. Under five heads it fires Execution instead: 16
      // Mythic killing blows, "each tracing to one cast under 5 heads".
      rule: { type: 'beInside' },
      soakers: 5,                             // the published threshold, not a guess
      damage: 0.42,
      good: '5+ bodies in range every cast, groups rotated so nobody eats a second axe while Guillotined.',
      failText: 'Missed the Guillotine soak — Execution fired',
    },
    {
      id: 'widowskiss',
      name: "Widow's Kiss",
      spellId: 1283623,
      what: "The axe splits the arena into range bands — 1283623 inside 40 yards, 1283631 outside (Stage Three 1299396/1299401).",
      lethal: true,
      from: 'zuljan',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 3500,
      // The axe splits the arena into two punished bands — Widow's Kiss inside
      // 40 yards, Widow's Touch outside it — so the only survivable ground is
      // the ring between them, which is what an annulus + beInside is. The real
      // threshold is 40 yards from the axe; scaled here to a band inside a 44yd
      // arena so it is a place you can actually run to. Failure is being in
      // either punished band, which is what "hold the called band" means.
      shape: { kind: 'annulus', inner: 20, outer: 34 },
      origin: 'boss',
      rule: { type: 'beInside' },
      // Not a soak — the whole raid holds the band, so every ally is assigned to
      // it and the demonstration on screen is twenty people running to a ring.
      soakers: 20,
      damage: 0.48,                    // "few get hit and most of them die"
      good: 'The raid holds the called band and hit counts stay at zero.',
      failText: "Out of the called band — Widow's Kiss",
    },
    {
      id: 'axegrinder',
      name: 'Axegrinder',
      spellId: 1285017,
      what: "Spinning axes ricochet around the arena dealing armour-ignoring Physical damage , and on Mythic never despawn.",
      from: 'zuljan',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 5200,               // long enough for the axe to cross the floor
      shape: { kind: 'circle', radius: 5 },
      origin: 'edge',                  // it comes off the wall and ricochets
      driftSpeed: 9,
      rule: { type: 'avoid' },
      damage: 0.32,                    // armour-ignoring Physical, 6 Mythic KBs
      good: 'Nobody is clipped; axes are kited into the venom dump zones.',
      failText: 'Clipped by an Axegrinder axe',
    },
    {
      id: 'venomfang',
      name: 'Venomfang',
      spellId: 1306906,
      what: "A poison axe bounces between players , leaving a Nature DoT (1306906, secondary 1306635) that wowhead confirms as dispel type Poison and logs show being dispelled 58 times.",
      from: 'zuljan',
      roles: ['healer'],
      telegraphMs: 6000,
      shape: { kind: 'circle', radius: 4 },
      origin: 'player',
      // The fight's only genuine dispel — wowhead confirms dispel type Poison
      // and the logs show 58 healer removals. Note the tactic file's "Bad:" line
      // refuses to auto-fail a slow dispel in the REPORT and leaves the hold
      // time to the raid leader; in the trainer there is no raid leader to ask,
      // so a Venomfang left ticking through the window is scored.
      rule: { type: 'press', ability: 'dispel', withinMs: 6000 },
      damage: 0.15,
      lingerMs: 14000,                 // the 14s Nature DoT if it is never cleared
      good: 'Assigned dispellers clear it promptly, especially while Rupture DoTs tick.',
      failText: 'Venomfang left ticking — dispel it',
    },
    {
      id: 'nightfall',
      name: 'Eternal Nightfall',
      spellId: 1286918,
      what: "He shields himself then channels a lethal raid-wide cast that is kickable only once the veil is destroyed, while the veil stacks Suffocating Darkness .",
      from: 'malacrass',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 6000,
      // Raid-wide and lethal, so the shape is not a place to stand — it is the
      // whole floor lighting up to tell you a kick is due. `press` never scores
      // position, only whether somebody answered.
      shape: { kind: 'circle', radius: 38 },
      origin: 'boss',
      // "13 interrupts against 18 applications, so a third got through." The
      // Veil of Twilight gating is not modelled: there is no shield to burn
      // here, so the kick window is simply the cast.
      rule: { type: 'press', ability: 'interrupt', withinMs: 6000 },
      damage: 0.32,
      good: 'Veil melts, a kick lands, Nightfall never completes.',
      failText: 'Eternal Nightfall completed — nobody kicked',
    },
  ],
}
