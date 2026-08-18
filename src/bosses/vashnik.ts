import type { BossDef } from '../engine/types'

// Vashnik the Malformed — a parody of Vashnik the Malignant.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. Castle Pineapplia does the same thing, and it is the right
// call — the joke lands on the boss, but what you practise has to transfer to
// the actual raid, and it cannot if "Plague Wave" is called something else here.
//
// Authored from 12.1/VenomousAbyss/Vashnik/Vashnik.md and abilities.json, and
// then corrected against a first-hand Heroic pull. Every spellId below is real
// and appears in that abilities.json; the `good` strings are the file's own
// "Good:" lines with the parenthetical spell IDs trimmed.
//
// ── the shape of the room ────────────────────────────────────────────────────
//
// Three lobes around a pool, with an altar out at each outer corner: RED north,
// ORANGE south-west, PURPLE south-east. The lobes are conceptual — the floor is
// open, nothing walls them off — but the COLOURS are not decoration. They are
// how the raid calls the fight ("red and orange next"), so the arena carries
// them as data and the renderer paints them.
//
// The pool in the middle is the MALIGNANT CAVITY and it kills on contact, which
// is why the room reads as three lobes at all: the walkable floor is a ring with
// a hole in it, and everything alive on the floor is crawling towards the hole.
//
// ── why the tank is the most important player here ───────────────────────────
//
// Vashnik is NOT static. He follows his tank, and at full energy he Imbibes from
// the two altars NEAREST HIM. So where the tank stands chooses which two adds
// spawn and which two infections land on the raid — the .md puts it exactly that
// way: "his position picks the fountains, so the tank picks the raid's next
// mechanics". Draining the same altar on consecutive Imbibes stacks its Infusion
// and empowers that altar's add AND its debuff, so the tank has to keep walking
// the boss to a fresh pair. Standing still is the failure, and it is the only
// mechanic in this raid where one player's footwork authors everybody else's.
//
// Both activated altars send their debuff out on every Imbibe, on different
// random players, so the raid is always juggling two of the three infection
// types at once. That is the fight.
//
// ── corrections this file carries ────────────────────────────────────────────
//
// SIPHONING INFECTION IS A SOAK. Three or four un-debuffed players stack into
// the red circle to clear it, so Siphon Blood damage on a non-carrier is CORRECT
// PLAY. The .md's Report Exposure lists 1295229 under "Avoidable damage
// (per-player failure count)" and that is WRONG — RaidLens currently blames the
// people doing it right. It is `collective` here with an empty failText, and the
// mechanic block below says so again where anybody editing it will see it.
//
// EXCLUDED — Malignant Catalyst / Catalytic Bile (1282516 / 1282509 / 1282525 /
// 1282602 / 1282616). abilities.json tags the package "Heroic+" and the .md
// gives it a section, but it has not appeared on this guild's Heroic pulls at
// all: no orb above the Cavity, no bile lanes, no raid slam. Drilling an
// interception assignment nobody is ever given would teach a habit the pull does
// not reward, so the whole package is out until a log shows it firing.
//
// EXCLUDED — Malignant Tumor. Mythic only: the .md heading reads "Malignant
// Tumor (Mythic Only)" and both Hardened Tumor (1304437) and Malignance
// (1304459) are tagged ["Mythic"] in abilities.json.
//
// Two things this boss is still NOT:
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
// What ends slow pulls is attrition nobody dodged: Toxic Vapor stacking once per
// Imbibe forever, plus a Malignant Burst for every venom that reached the pool.
// Neither is scored against a player. Both are the clock.

export const vashnik: BossDef = {
  key: 'vashnik',
  name: 'Vashnik the Malformed',
  realName: 'Vashnik the Malignant',
  blurb: 'Three altars round a pool that kills on contact. The boss follows his tank, and drinks from the two altars nearest him — so the tank picks what everyone else has to deal with.',
  // Measured from PTR combat logs, not guessed: Circle (CV 12.1%). A corridor at 120-180 deg reaches ~105yd and is excluded.
  // 1 yard = 100 coordinate units. Kept as the bounding radius of the polygon below.
  arenaRadius: 58,
  // The outside of the polygon below is masonry, not a ledge. Same shape as
  // Tok'zali's room in the only way that matters: what kills is the Cavity in
  // the middle, and the walkable floor is the ring around it. Walking into the
  // outer wall of a lobe stops you and does nothing else — which the tank in
  // particular needs, because walking Vashnik out to a fresh pair of fountains
  // is a walk towards the outer corners, and it is the one job in this raid
  // where a player is asked to keep moving outward under pressure.
  walled: true,

  // The three-lobed hall, roughly 115 yards tip to tip inside that 58yd bound.
  //
  // Nine corners: a pair of outer tips per lobe at 57.5yd, and a waist at 36yd
  // between each neighbouring pair. The waists are the thing worth having —
  // they are the pinch points a raider has to walk through to get from one
  // colour's altar to another's, and a plain circle would let people drift
  // between lobes as though the room had no opinion about it.
  arena: {
    kind: 'polygon',
    points: [
      // PURPLE lobe, south-east
      { x: 57.3, y: 5.0 },
      { x: 33.0, y: 47.1 },
      { x: 0, y: 36 },          // waist, due south
      // ORANGE lobe, south-west
      { x: -33.0, y: 47.1 },
      { x: -57.3, y: 5.0 },
      { x: -31.2, y: -18.0 },   // waist, north-west
      // RED lobe, north
      { x: -24.3, y: -52.1 },
      { x: 24.3, y: -52.1 },
      { x: 31.2, y: -18.0 },    // waist, north-east
    ],
  },

  // ── the three altars ──
  //
  // Imbibe drains the two nearest the boss. Each one owns a colour, an Infusion
  // that stacks when it is drained twice running, the venom it sends at the
  // Cavity, the unavoidable Expulsion it fires, and the Adaptive Infection
  // variant it puts on the raid. Nothing here is chosen: the Infusion and
  // Expulsion IDs are the ones abilities.json pairs with each fountain by name.
  //
  // Screen coordinates: +y is south, so north is negative y.
  altars: [
    {
      id: 'red', name: 'Bleeding Snake Fountain', pos: { x: 0, y: -44 }, colour: 'red',
      infusionSpellId: 1293969,   // Blood Infusion
      addId: 'clotting', debuffId: 'siphon', expulsionId: 'hemo',
    },
    {
      id: 'orange', name: 'Burning Snake Fountain', pos: { x: -38.1, y: 22.0 }, colour: 'orange',
      infusionSpellId: 1293971,   // Flame Infusion
      addId: 'burning', debuffId: 'exploding', expulsionId: 'conflagrating',
    },
    {
      id: 'purple', name: 'Shadow Snake Fountain', pos: { x: 38.1, y: 22.0 }, colour: 'purple',
      infusionSpellId: 1293968,   // Shadow Infusion
      addId: 'shrouded', debuffId: 'stygian', expulsionId: 'gloom',
    },
  ],

  // ── the venoms ──
  //
  // Three altars, three completely different add jobs, and the .md calls sorting
  // them out "the most important assignment on the fight". Every one of them
  // crawls at the Cavity, and every one that arrives fires Malignant Burst
  // through `onLeak` — 45 killing blows in six Mythic pulls, more than
  // everything else on this boss combined.
  addEverySec: 26,
  maxAdds: 8,
  adds: [
    {
      id: 'clotting', name: 'Clotting Venom', npcId: 259408, spellId: 1286631,
      // fuseSec is set clear of the crawl (38yd at 1.6yd/s is about 24s) so it
      // is ARRIVING that leaks, not a timer running out somewhere else.
      job: 'kill', count: 1, hp: 8, fuseSec: 30, spawnRadius: 42, marchSpeed: 1.6,
      // Sanguineous Fortitude makes it immune to Disarm, Disorient, Fear, Slow,
      // Root and Stun — "cannot be kited or CC'd, only killed" — so the only
      // lever the raid has is where it dies, and it dies twice.
      splits: { intoId: 'clot', count: 2 },
      onLeak: 'burst',
      good: 'Clotting Venom is CC-immune and splits — kill it early and far from the pool.',
      failText: 'A Clotting Venom reached the Malignant Cavity — Malignant Burst',
    },
    {
      id: 'clot', name: 'Clotting Venom', npcId: 259408, spellId: 1286631,
      job: 'kill', count: 2, hp: 4, fuseSec: 24, spawnRadius: 34, marchSpeed: 1.8,
      // What the parent becomes. Smaller and faster, and still walking for the
      // Cavity — which is why killing the parent ON the pool's edge trades one
      // leak for two.
      onLeak: 'burst',
      good: 'Each split still walks for the Cavity; finish both halves.',
      failText: 'A Clotting Venom split reached the Malignant Cavity — Malignant Burst',
    },
    {
      id: 'burning', name: 'Burning Venom', npcId: 260905, spellId: 1305901,
      job: 'kill', count: 2, hp: 7, fuseSec: 30, spawnRadius: 42, marchSpeed: 1.6,
      // Burning Presence: a 300yd Fire pulse every 3s while one is alive, and 18
      // of 20 players were hit on Mythic. The .md files it as "add-uptime
      // pressure, NOT a positioning failure", so it is aura drain on the raid
      // bar and never a shape anyone is asked to dodge.
      auraDps: 0.4,
      // The reflex-punisher. Both die to Caustic Surge, and two Surges landing
      // together is the wipe — so "kill it fast" is the WRONG answer here and
      // the raid has to deliberately hold one.
      noSimultaneousDeath: { withinSec: 3 },
      onLeak: 'burst',
      good: 'Burning Venom erupts with Caustic Surge, so kill it away from the raid — and never let the pair die within three seconds of each other.',
      failText: 'A Burning Venom reached the Malignant Cavity — Malignant Burst',
    },
    {
      id: 'shrouded', name: 'Shrouded Venom', npcId: 0, spellId: 1312366,
      // npcId 0 is the data's own gap, not an invention: "the Shadow fountain
      // was never drained in the six logged Mythic pulls, so this add never
      // appeared". abilities.json says NPC ID NEEDED and so does the .md.
      job: 'kill', count: 4, hp: 4, shieldHp: 4, fuseSec: 32, spawnRadius: 42, marchSpeed: 1.5,
      // Miasmic Coating is an absorb worth 100% of max health, so until it
      // breaks the add takes literally nothing. Four of them, each needing the
      // shield stripped first, is why purple feels like the busiest colour.
      //
      // And every one that dies drops a pool at EVERY player's position, not at
      // its own corpse — one add dying relocates the entire raid.
      deathSpawnsAtAllPlayers: 'ejection',
      onLeak: 'burst',
      good: 'Break Miasmic Coating first — until it drops, the add takes no damage at all.',
      failText: 'A Shrouded Venom reached the Malignant Cavity — Malignant Burst',
    },
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.5,          // Imbibe at 100 energy — roughly every 40s, so four drinks a pull
  atFullEnergy: 'imbibe',
  // Toxic Vapor only. Malignant Burst is deliberately NOT ambient: "one cast is
  // one venom leaked", so it must only ever fire from an add's `onLeak`. A burst
  // ticking away on the clock would make a clean pull indistinguishable from a
  // leaky one, which is the whole thing this fight measures.
  ambient: ['vapor'],
  pullLengthSec: 160,

  // "No phases — one loop driven by Imbibe." Between drinks the raid alternates
  // between running OUT (infection carriers, froth drop spots) and collapsing
  // back IN through waves, soaks and venom trails.
  //
  // The infections also arrive on every Imbibe through their altars. They are in
  // the loop as well so that a raider gets reps on all three within one pull
  // rather than only on whichever pair the tank happened to drain.
  loop: [
    'fangs', 'venom', 'froth', 'siphon', 'stygian', 'fangs',
    'clotblood', 'venom', 'exploding', 'froth', 'surge', 'fangs',
    'siphon', 'congealing', 'venom', 'froth', 'exploding', 'stygian',
  ],

  mechanics: [
    // Tactic file: "The pool at the centre of the hall. Every living venom
    // crawls at it, and one arriving casts Malignant Burst; the Virulent Fumes
    // haze standing over it is what burns anyone who walks in."
    {
      id: 'cavity',
      name: 'Malignant Cavity',
      spellId: 1291467,
      what: "The pool in the middle of the hall. Contact is lethal, and every venom on the floor is crawling towards it.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 0,
      shape: { kind: 'circle', radius: 14 },
      origin: 'random',
      // Not a mechanic — a hole in the floor. It is bolted to the middle of the
      // room from the pull to the kill and it does not follow the boss around
      // when the tank walks him between altars.
      //
      // On the spell ID: abilities.json has no entry for the Cavity itself. The
      // only spell that names it is Malignant Burst (1280189), and that one is
      // 300yd raid-wide — keying the floor to it would put the entire raid on a
      // failure leaderboard every time anything leaked. Virulent Fumes is the
      // fight's own floor-damage ID and the haze the venoms leave hanging over
      // the pool, so it is the honest handle for standing in it.
      rule: { type: 'lethalGround' },
      fixture: true,
      atCentre: true,
      permanent: true,
      good: 'Nobody parks in either.',
      failText: 'Stepped into the Malignant Cavity',
    },
    // Tactic file: "4s cast draining the two fountains nearest the boss — each
    // fires an unavoidable Expulsion, grants the matching Infusion (raising
    // Expulsion damage and venom health), spawns that fountain's venom, and adds
    // a Toxic Vapor stack. Prepare Blood / Fire / Shadow telegraph the pair."
    {
      id: 'imbibe',
      name: 'Imbibe',
      spellId: 1284663,
      what: "Vashnik drinks from the two fountains nearest him. Each one blasts the raid, spawns its venom, and adds a Toxic Vapor stack that never falls off.",
      roles: ['tank'],
      telegraphMs: 4000,                 // "4s cast draining two of three fountains"
      origin: 'boss',
      // THE mechanic of the fight, and the reason the tank is the one scored on
      // it: the boss follows his tank, so the two nearest altars are whichever
      // two the tank parked him beside. Drain the same pair twice running and
      // that altar's Infusion stacks, making both its add and its debuff worse —
      // so the answer is to keep walking him to a fresh pair, and standing still
      // is the failure. Scored on the tank alone because nobody else has a lever
      // on it; it still renders and announces for everyone.
      rule: { type: 'drainNearest', count: 2 },
      // Every drink is another permanent Toxic Vapor stack on the whole raid.
      // This is the soft enrage expressed as a number that only ever goes up.
      stacks: { defId: 'vapor', amountPct: 6 },
      // The venoms drag their trails out of the fountains with them.
      spawns: { defId: 'venom' },
      good: 'The tank parks the boss on a mark so the planned pair drains every cycle.',
      failText: 'Drained the same altar twice running — its Infusion stacked',
    },
    // Tactic file: "Unavoidable raid-wide Shadow damage when Imbibe drains the
    // Bleeding Snake Fountain; also spawns the Clotting Venoms."
    {
      id: 'hemo',
      name: 'Hemo Expulsion',
      spellId: 1298582,
      what: "Unavoidable raid-wide Shadow damage the instant the red fountain is drained. The Clotting Venoms come out with it.",
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // Fired by the RED altar when it drains, not by the loop. Unavoidable in
      // the data, so it can never read as a per-player failure — it is the
      // healing cost of the pair the tank chose.
      rule: { type: 'raidDamage', dps: 3 },
      good: 'The tank parks the boss on a mark so the planned pair drains every cycle.',
      failText: '',
    },
    // Tactic file: "Unavoidable raid-wide Fire damage when Imbibe drains the
    // Burning Snake Fountain; also spawns the Burning Venoms."
    {
      id: 'conflagrating',
      name: 'Conflagrating Expulsion',
      spellId: 1298587,
      what: "Unavoidable raid-wide Fire damage the instant the orange fountain is drained. The Burning Venoms come out with it.",
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // The ORANGE altar's Expulsion. Same story as Hemo: no dodge exists.
      rule: { type: 'raidDamage', dps: 3 },
      good: 'The tank parks the boss on a mark so the planned pair drains every cycle.',
      failText: '',
    },
    // Tactic file: "Unavoidable 400yd Shadow damage when Imbibe drains the
    // Shadow Snake Fountain; also spawns the Shrouded Venoms."
    {
      id: 'gloom',
      name: 'Gloom Expulsion',
      spellId: 1298583,
      what: "Unavoidable raid-wide Shadow damage the instant the purple fountain is drained. The Shrouded Venoms come out with it.",
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // The PURPLE altar's Expulsion, and the widest of the three at 400 yards.
      rule: { type: 'raidDamage', dps: 3 },
      good: 'The tank parks the boss on a mark so the planned pair drains every cycle.',
      failText: '',
    },
    // Tactic file: "A venom reaching the Cavity casts 1280189 — 300yd Nature
    // burst plus a DoT every 3s for 30s that stacks with every subsequent leak."
    {
      id: 'burst',
      name: 'Malignant Burst',
      spellId: 1280189,
      what: "What a venom does when it reaches the pool: a burst on the whole raid, plus a Nature DoT that stacks with every later leak.",
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // 300 YARD RAID-WIDE, and not a soak. It was a 10-yard `beInside` circle
      // with four soakers, which asked the raid to stand in a burst that hits
      // everyone on the map regardless.
      //
      // "Bad: a Malignant Burst CAST — one cast is one venom leaked. Count
      // casts, not just deaths." So the failure belongs to the venom nobody
      // killed, which is exactly where it sits: all four venom adds fire this
      // through `onLeak` when they reach the Cavity, and nothing else does.
      rule: { type: 'raidDamage', dps: 1.6 },
      good: 'Every venom dies en route — one Malignant Burst cast is one venom leaked.',
      failText: '',
    },
    // Tactic file: "10yd Physical drain around a Siphoning Infection carrier —
    // three or four un-debuffed players stack into it to clear it."
    {
      id: 'siphon',
      name: 'Siphon Blood',
      spellId: 1295229,
      what: "A drain that opens around whoever has Siphoning Infection. It saps everyone inside the circle, and only clears once enough bodies share it.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 3000,
      shape: { kind: 'circle', radius: 10 },    // "drains anyone within 10yd"
      origin: 'random',
      // THE RED ALTAR'S DEBUFF, AND IT IS A SOAK. This was an `avoid`, and that
      // was wrong: the raid clears Siphoning Infection by stacking three or four
      // un-debuffed bodies into the circle, so Siphon Blood damage on a
      // non-carrier is CORRECT PLAY and can never be one player's failure.
      //
      // The .md's Report Exposure has it under "Avoidable damage (per-player
      // failure count)" and that section is WRONG — RaidLens reads it straight
      // and names the very people doing the mechanic properly. `collective` with
      // an empty failText is the fix: the raid still eats an unsoaked drain, the
      // debrief never puts anybody's name against it.
      // The derived soak line does not fit this one. Siphon Blood is not damage
      // split between the bodies that turn up — it is the drain that clears the
      // carrier's Siphoning Infection, and only players WITHOUT an infection may
      // go in. Derivation cannot know either fact from the rule type.
      brief: 'If you are clean, stack into the circle — three or four bodies clear the carrier. If you are the one carrying it, hold still and let them reach you. Nobody is named for this one.',
      rule: { type: 'beInside' },
      soakers: 4,
      // Not `lethal`: abilities.json categorises 1295229 as Avoidable rather
      // than Deadly, and lethality here is derived from that data, never chosen.
      // An unsoaked drain takes a bite out of the raid bar, which is where a
      // soak nobody covered actually lands.
      collective: true,
      good: 'Carriers move on the telegraph, not on the debuff; healers pre-shield the absorb rather than out-healing it.',
      failText: '',
    },
    // Tactic file: "Fire variant — periodic Fire damage, then the carrier
    // detonates Caustic Explosion when it ends, falling off with distance;
    // wowhead lists a Magic dispel type but no raid dispels it, so it is a
    // placed bomb rather than a cleanse target."
    {
      id: 'exploding',
      name: 'Exploding Infection',
      spellId: 1295173,
      what: "The orange fountain bomb. It burns one player while it lasts, then detonates Caustic Explosion on everyone still near them.",
      roles: ['tank', 'dps', 'healer'],
      // Duration is not stated in the tactic file; 8s is a playable window for
      // the walk out. NOT a dispel — see the header note.
      telegraphMs: 8000,
      shape: { kind: 'circle', radius: 10 },
      origin: 'targeted',
      // THE ORANGE ALTAR'S DEBUFF. Caustic Explosion "falls off with distance",
      // so there is no such thing as far enough — every extra yard is less
      // damage on the raid, and detonating inside the stack ends the pull.
      rule: { type: 'carryOut', minDistance: 25 },
      spawns: { defId: 'caustic' },
      // Not `lethal`: abilities.json categorises 1295173 as Healer and 1295209
      // as Avoidable, neither Deadly, and lethality here is read from the data
      // rather than chosen. Dropping it in the raid takes a large bite out of
      // the raid bar instead — which is where a bomb in the stack really lands.
      good: 'Carriers move on the telegraph, not on the debuff; healers pre-shield the absorb rather than out-healing it.',
      failText: 'Detonated Exploding Infection on the raid',
    },
    // Tactic file: "Fire detonation when Exploding Infection ends, falling off
    // with distance — only 4 players were hit in the log sample, so a
    // non-carrier hit means they were too close."
    {
      id: 'caustic',
      name: 'Caustic Explosion',
      spellId: 1295209,
      what: "The blast an Exploding Infection leaves where it ended. Fire damage to anyone close to the spot, weaker the further out you are.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1400,
      shape: { kind: 'circle', radius: 8 },
      origin: 'random',
      // Where the bomb actually went off. Left on the floor for a moment so the
      // rest of the raid has to read where a carrier dropped theirs, which is
      // the half of the mechanic a carrier never sees.
      rule: { type: 'avoid' },
      damage: 0.3,
      lingerMs: 2500,
      good: 'Carriers move on the telegraph, not on the debuff; healers pre-shield the absorb rather than out-healing it.',
      failText: 'Stood in a Caustic Explosion',
    },
    // Tactic file: "Shadow variant — Shadow damage every 1.5s plus a 100-150%
    // healing absorb, dropping 6yd Stygian Burst eruptions underfoot until it
    // falls off; wowhead lists no dispel type, so healers cannot cleanse it."
    {
      id: 'stygian',
      name: 'Stygian Infection',
      spellId: 1294994,
      what: "The purple fountain rot. It damages one player, blocks healing on them, and drops a Stygian Burst under their feet until it falls off.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 12000,
      origin: 'targeted',
      // THE PURPLE ALTAR'S DEBUFF, and the only mechanic in the raid that is
      // about walking rather than about standing anywhere in particular: it
      // drops a pool under the carrier on a cadence until it expires, and a
      // healer spending a heal on them cuts it short. No absorb model is needed
      // for the lesson — keep moving and your trail misses everyone.
      rule: { type: 'trail', defId: 'stygianburst', everyMs: 2200, healShortensMs: 4000 },
      good: 'Carriers move on the telegraph, not on the debuff; healers pre-shield the absorb rather than out-healing it.',
      failText: 'Laid a Stygian trail through the raid',
    },
    // Tactic file: "6yd Shadow eruption dropped beneath a Stygian Infection
    // carrier — standing in one is the failure."
    {
      id: 'stygianburst',
      name: 'Stygian Burst',
      spellId: 1302489,
      what: "A small Shadow eruption left underfoot by a Stygian Infection carrier. It burns anyone standing in it, the carrier included.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1200,
      shape: { kind: 'circle', radius: 6 },     // "6yd Shadow eruption"
      origin: 'random',
      // "1302489 on anyone" is the .md's Bad line — including the carrier, which
      // is what makes the trail a moving problem rather than a personal tax.
      rule: { type: 'avoid' },
      damage: 0.22,
      lingerMs: 9000,
      good: 'Carriers move on the telegraph, not on the debuff; healers pre-shield the absorb rather than out-healing it.',
      failText: 'Stood in a Stygian Burst pool',
    },
    // Tactic file: "Fire eruption plus a stacking Fire DoT when a Burning Venom
    // dies — a large slice of the raid hit on one cast means it was killed
    // inside the stack."
    {
      id: 'surge',
      name: 'Caustic Surge',
      spellId: 1285979,
      what: "A Burning Venom erupts where it dies, hitting everyone near the corpse with Fire and a DoT that stacks.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2000,
      shape: { kind: 'circle', radius: 9 },
      origin: 'random',
      // AddDef has no on-death hook, so the eruption is played from the loop
      // rather than bolted to the Burning Venom's corpse. The lesson survives
      // the abstraction: it goes off where the add was killed, so the add gets
      // killed away from the raid. The pair-of-deaths wipe lives on the add
      // itself, as `noSimultaneousDeath`.
      rule: { type: 'avoid' },
      damage: 0.26,
      lingerMs: 3000,
      good: 'Burning Venom erupts with Caustic Surge, so kill it away from the raid.',
      failText: 'Caught by a Caustic Surge',
    },
    // Tactic file: "3yd Shadow missiles fired at nearby players when a Shrouded
    // Venom dies — clear out before it drops."
    {
      id: 'ejection',
      name: 'Umbral Ejection',
      spellId: 1286737,
      what: "A dying Shrouded Venom throws Shadow missiles out, dropping a patch of shadow at every player at once.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1600,
      shape: { kind: 'circle', radius: 5 },
      origin: 'random',
      // What `deathSpawnsAtAllPlayers` on the Shrouded Venom drops: one of these
      // at EVERY player's position, not at the corpse. Four venoms dying means
      // four rounds of the whole raid having to be somewhere else, which is why
      // purple is the colour that shreds a raid's positioning.
      rule: { type: 'avoid' },
      damage: 0.24,
      lingerMs: 6000,
      good: 'Shrouded Venom carries a full-health absorb and fires Umbral Ejection within 3yd on death.',
      failText: 'Stood in an Umbral Ejection pool',
    },
    // Tactic file: "3-5 players get frothed, ticking Nature+Shadow in a 4.5yd
    // radius for 6s, then erupting into four cardinal Plague Waves for roughly
    // ten times the damage."
    {
      id: 'froth',
      name: 'Plague Froth',
      spellId: 1281925,
      what: "Three to five players are frothed. Each ticks damage in a small bubble around them, then bursts into four Plague Waves.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 6000,                 // "ticking ... for 6s"
      shape: { kind: 'circle', radius: 4.5 },   // "a 4.5yd radius"
      origin: 'targeted',
      // Carriers "break to assigned spots past 4.5yd of everyone" — the bubble
      // is small but the drop spot is not, because the waves come next.
      //
      // "Carriers eating their own Froth ticks is expected and must not be
      // counted", so the carrier is never scored for the bubble they are
      // standing in the middle of. Only where they took it is judged.
      rule: { type: 'carryOut', minDistance: 20 },
      spawns: { defId: 'wave' },
      good: 'Carriers break to assigned spots past 4.5yd of everyone, oriented so all four waves sweep empty floor.',
      failText: 'Held Plague Froth inside the raid',
    },
    // Tactic file: "3-5 players get frothed, ticking Nature+Shadow in a 4.5yd
    // radius for 6s, then erupting into four cardinal Plague Waves for roughly
    // ten times the damage."
    {
      id: 'wave',
      name: 'Plague Wave',
      spellId: 1295798,
      what: "The lines that erupt out of a Plague Froth when it expires, sweeping the floor for about ten times the Froth damage.",
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
    // Tactic file: "1280935 on the active tank applies 1280934 for 32s — Nature
    // every 2s plus +100% Physical damage taken (200% on Mythic). Stacks, no
    // dispel type."
    {
      id: 'fangs',
      name: 'Dripping Fangs',
      spellId: 1280934,
      what: "A bite on the current tank: Nature damage over time, and it doubles the Physical damage they take. It stacks and it cannot be removed.",
      roles: ['tank'],
      telegraphMs: 1800,
      origin: 'boss',
      // "Tanks swap on EVERY application" — one stack is already too many, so
      // the ceiling is 1 rather than a comfortable count. The gap between casts
      // is also the window the tank uses to walk the boss to the next pair of
      // altars, which is why the swap and the fountain plan are one decision.
      rule: { type: 'tankSwap', maxStacks: 1 },
      good: 'Tanks swap on every application; the gap between casts is the repositioning window for the next Imbibe.',
      failText: 'Held Dripping Fangs through a second application',
    },
    // Tactic file: "Nature ground DoT reapplied every 1.2s while you stand in
    // the trail a living venom leaves — every application is a player standing
    // in it."
    {
      id: 'venom',
      name: 'Deadly Venom',
      spellId: 1297338,
      what: "The slime trail a crawling venom drags behind it. It reapplies a Nature DoT for as long as you are standing in it.",
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
    // Tactic file: "Healing-absorb debuff, Magic dispel type on wowhead and
    // genuinely dispelled 126 times across 332 applications in the log corpus."
    {
      id: 'clotblood',
      name: 'Clotting Blood',
      spellId: 1302517,
      what: "A Magic debuff that blocks healing on one player — every heal they take is swallowed by the absorb until it is gone.",
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
    // Tactic file: "5s Shadow hit plus a movement snare, Magic dispel type on
    // wowhead and genuinely dispelled 58 times across 300 applications in the
    // log corpus."
    {
      id: 'congealing',
      name: 'Congealing Bolt',
      spellId: 1305833,
      what: "A Magic bolt that lands Shadow damage on one player and snares them, leaving them too slow to walk out of whatever comes next.",
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
    // Tactic file: "300yd Nature tick every 2s, one stack per Imbibe — the soft
    // enrage; unavoidable and never a player failure."
    {
      id: 'vapor',
      name: 'Toxic Vapor',
      spellId: 1284561,
      what: "Nature damage ticking on the whole raid. Every drink adds a stack that never falls off, so it hurts more the longer the pull runs.",
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // The soft enrage: one permanent stack per Imbibe (applied by `stacks` on
      // the Imbibe block), ticking on the whole raid at 300yd. The .md could not
      // be blunter — "Deaths on 1284561 are kill-speed, never player failure" —
      // so it is ambient attrition only and is never scored, whatever it kills.
      rule: { type: 'raidDamage', dps: 2.4 },
      permanent: true,
      // Toxic Vapor is documented inside the Imbibe block, so it takes that
      // block's Good line: the answer to the stacks is a clean fountain loop.
      good: 'The tank parks the boss on a mark so the planned pair drains every cycle.',
      failText: '',
    },
  ],
}
