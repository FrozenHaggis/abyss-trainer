import type { BossDef } from '../engine/types'

// Claude'Tek — a parody of Ula'tek, the title boss of "Curse of Claude'Tek" and
// the last fight in the raid.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. Castle Pineapplia does the same thing (Shriekfruit teaches
// Shriekwing's mechanics) and it is the right call — the joke lands on the boss,
// but what you practise has to transfer to the actual raid, and it cannot if
// "Spectral Coils" is called something else here.
//
// Authored from 12.1/VenomousAbyss/Ulatek/Ulatek.md and its abilities.json.
// Every spellId below is real and appears in that abilities.json; the `good`
// strings are the file's own "Good:" lines, verbatim.
//
// ⚠ NOTHING HERE IS OBSERVED ────────────────────────────────────────────────
// This encounter has NO COMBAT LOGS AT ALL. The raid had not opened when the
// source data was written (18-19 Aug 2026) and Ula'tek was never on the PTR, so
// abilities.json is sourced entirely from the live dungeon journal — categories
// are inferred from journal prose, and several of the IDs are known Dummy or
// "periodically trigger spell" driver auras whose real player damage lands on an
// unidentified child ID. Only 1292403, 1306119, 1305650 and 1287265 are
// confirmed to produce direct player damage on the listed ID.
//
// Consequences for this file, stated plainly:
//   • Every radius, cast time and count below is a journal number or a design
//     choice, NOT a measurement. Sszorak's tuning came off real PTR logs; this
//     boss's cannot. Do not read these as observed.
//   • Nothing is weighted by "top killer in the log", because there is no log.
//     The loop is built from what the tactic file says wipes raids, not from a
//     death report.
//   • Re-tune on raid week from a real kill. The two dispels, the four kickable
//     casts and the tank swap are DB2-verified and will survive; the numbers
//     will not.
//
// ── Heroic only ──────────────────────────────────────────────────────────────
// Everything tagged `difficulties: ["Mythic"]` is excluded: Toxic Womb, Toxic
// Incubation, Mother's Boon, Toxic Burn, Fester Burst, Noxious Shell, Noxious
// Splash, Rancid Yolk, Acidic Expulsion, Hardened, Boiling Venom (both IDs),
// Revenge and the Mythic Blight Vein variant. That removes the whole Blightscale
// Wretch soak game and the inverse-soak Fester Burst, which is a shame — it is
// the most interesting mechanic in the encounter — but it is Mythic and this is
// a Heroic trainer. Vicious Echoes' "Good:" line names Acidic Expulsion because
// the tactic file's wording is kept verbatim; the ability itself is not here.
//
// ── one fight, not three stages ─────────────────────────────────────────────
// The real encounter is three stages across ~28 mechanics: egg control, a
// Doomscale add-priority puzzle, then a shrinking-platform survival check. A
// staged trainer would mean two thirds of the pull spent not practising the
// thing you queued up to practise, so the ten best mechanics from all three run
// as ONE continuous loop. The Stage Two adds (Doomscale Warden, Ravenous
// Doomscale) and the Stage Three adds (Blightscale Shrieker) are simply always
// present.
//
// ── the kick rotation ────────────────────────────────────────────────────────
// This is the only fight in the raid with a real kick rotation. Four casts carry
// InterruptFlags 45 on Heroic: Malice (1290779), Anguished Cry (1305650),
// Vicious Echoes (1310764) and Acidic Burst (1301800). Two are wired as kicks —
// Malice, the file's "TOP KICK PRIORITY", and Vicious Echoes, the 6s raid stun —
// and they are spaced at least three loop slots apart so the 12s interrupt
// cooldown can always cover both. Acidic Burst is spent on its dispel instead
// (it is both), and Anguished Cry is cut: a third kick on a 5.5s loop is a
// cooldown puzzle rather than a reflex, and the two that remain are the two the
// file calls lethal.
//
// ── the dispels ──────────────────────────────────────────────────────────────
// Exactly two abilities on this boss have a real dispel type, both DB2-verified
// Poison (DispelType 4): Acidic Burst (1301800) and Poisonous Bite (1287036).
// Both are here. Anguished Cry is technically Magic-dispellable but the file is
// explicit that the stun is raid-wide so the dispellers are stunned too — "do
// not treat a missing dispel as a failure and do not assign one" — so it is not
// modelled as one. Nothing else is dispellable, however many third-party guides
// say otherwise; Acidic Expulsion in particular is DispelType 0.
//
// ── what is deliberately NOT here ───────────────────────────────────────────
// • Necrotic Vapors is the ambient drain and the whole point of the fight ("what
//   wipes raids is not one mechanic"), but Putrid Membrane, Blight Vein and the
//   permanent healing-floor tax are folded into its dps rather than spent as
//   separate no-op entries — none of them has anything to execute.
// • Falling Debris (1286885) and Call of the Serpent (1304012) — two more
//   "circle lands, move out" avoidables. Caustic Waves already teaches that verb
//   and a third copy of it is noise, not density.
// • Mephitic Thrash (1296301) — the fight's other knockback. Circling Prey is
//   the one that throws you into the void, so it takes the `survive` slot.
// • Dread Roar (1305775), Petrifying Sting (1303414), Grasping Fangs (1301117) —
//   stuns, petrifies and roots. The player has no stun state to be put into, so
//   they would resolve as invisible no-ops.
// • Doomscale Shell / Mass Gestation / the Cauldron — the egg-carrying order.
//   It is an assignment puzzle between named players, not a positional one, and
//   there is no rule that scores "picked the wrong egg".
// • Unchecked Rage and Rattler Slam — they fire only when melee uptime is lost,
//   which is a raid-composition failure with no per-player verb. The file says
//   outright: "count casts per pull; never a per-player leaderboard."
//
// Big arena (46yd) because Stage Three collapses it: Circling Prey has to be
// able to knock you 24 yards and still leave the edge in play as a real threat.

export const ulatek: BossDef = {
  key: 'ulatek',
  name: "Claude'Tek",
  realName: "Ula'tek",
  blurb: 'Four kickable casts and a healing floor that only ever rises. Missed kicks and un-leeched bites end pulls.',
  arenaRadius: 46,
  maxHp: 1,
  loopIntervalSec: 5.5,        // slightly faster than the others — it is the last boss
  energyPerSec: 2.2,           // ~45s between platform collapses
  atFullEnergy: 'circlingprey',
  ambient: ['vapors'],
  pullLengthSec: 165,

  // Kicks sit at least three slots (16.5s) apart so a 12s interrupt always
  // covers both; the two dispels sit six slots apart against an 8s cooldown.
  // Beyond that the loop deliberately alternates direction — Caustic Waves and
  // Volatile Purge push you OUT, Spectral Coils and Serpent's Bite pull you IN —
  // because a loop that only ever says "run out" trains one reflex and no
  // decisions.
  loop: [
    'waves', 'stonevenom', 'malice', 'coils', 'stonevenom', 'acidic',
    'serpentsbite', 'echoes', 'stonevenom', 'waves', 'thrash', 'poisonbite',
    'coils', 'malice', 'stonevenom', 'serpentsbite', 'thrash', 'echoes',
  ],

  mechanics: [
    // ───────────────────────── the clock ─────────────────────────
    {
      id: 'vapors',
      name: 'Necrotic Vapors',
      spellId: 1286834,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 0,
      origin: 'boss',
      // "Bad: Not an execution failure — the fight timer. Every Putrid Membrane
      // permanently raises the healing floor." raidDamage never produces a
      // per-player failure, which is exactly right for a stacking raid DoT that
      // never falls off. Carries the Putrid Membrane and Blight Vein cost too.
      // Pitched slightly above the other two bosses (3.2) — this is the last
      // fight and the file calls attrition the thing that actually wipes raids.
      rule: { type: 'raidDamage', dps: 3.4 },
      good: 'Adds die fast, eggs never hatch, cooldowns planned against stack milestones.',
      failText: '',
    },

    // ───────────────────────── stage one ─────────────────────────
    {
      id: 'waves',
      name: 'Caustic Waves',
      spellId: 1292403,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 3000,
      // A lane crossing the floor. Length 80 on a 92yd arena so it reads as a
      // wave passing all the way through rather than a stripe in the middle.
      shape: { kind: 'line', length: 80, width: 12 },
      // NOT `edge`, tempting as it is for a wave off the rim: an edge-origin
      // shape gets a random angle, so half of them would point off the platform
      // and cover nothing. A random interior anchor always sweeps real ground.
      origin: 'random',
      rule: { type: 'avoid' },
      // One of the four IDs confirmed to do direct player damage. No linger: the
      // journal describes waves that cross the floor, not pools that stay.
      damage: 0.32,
      good: 'Raid steps out of the lanes and keeps waves off the egg field.',
      failText: 'Stood in a Caustic Waves lane',
    },
    {
      id: 'stonevenom',
      name: "Mother's Wrath / Stone Venom",
      // 1298417 is the stacking debuff that drives the swap; 1298367 is the 5s
      // bite that applies it, and is a driver aura whose damage lands on an
      // unidentified child ID — so the stack is the honest thing to key on.
      spellId: 1298417,
      roles: ['tank'],
      telegraphMs: 5000,             // "5 sec cast"
      origin: 'boss',
      // The sim binds ONE tankSwap def per boss and this is the fight's swap.
      // A 1.7 minute DoT means stacks effectively never drop in a pull, so the
      // threshold is low.
      rule: { type: 'tankSwap', maxStacks: 4 },
      good: 'Marked tank walks back into reach and eats the channel solo; tanks swap on stacks.',
      failText: 'Held Stone Venom too long — taunt the swap sooner',
    },
    {
      id: 'acidic',
      name: 'Acidic Burst',
      spellId: 1301800,
      roles: ['healer', 'dps'],      // dispel is in both kits; tanks have none
      telegraphMs: 6000,
      shape: { kind: 'circle', radius: 5 },
      origin: 'random',              // the Viper's target, somewhere in the raid
      // VERIFIED BOTH WAYS in DB2: InterruptFlags 45 and DispelType 4 (Poison).
      // The kick slots are spent on Malice and Vicious Echoes, so this one
      // teaches the cleanse — which is what the file asks for anyway: "Acidic
      // Burst kicked and leftovers dispelled".
      rule: { type: 'press', ability: 'dispel', withinMs: 6000 },
      damage: 0.2,                   // the 18s DoT you keep if nobody cleanses it
      good: 'Acidic Burst kicked and leftovers dispelled, raid spread, Rawlings tanked.',
      failText: 'Acidic Burst poison left undispelled',
    },
    {
      id: 'poisonbite',
      name: 'Poisonous Bite',
      spellId: 1287036,
      roles: ['healer'],
      telegraphMs: 7000,
      shape: { kind: 'circle', radius: 5 },
      // Anchored on the boss because it stacks on whoever is tanking the
      // Rawling — the melee pile, not a random raider.
      origin: 'boss',
      // The second and last real dispel: DispelType 4 (Poison), stacking.
      rule: { type: 'press', ability: 'dispel', withinMs: 7000 },
      damage: 0.18,
      good: 'Acidic Burst kicked and leftovers dispelled, raid spread, Rawlings tanked.',
      failText: 'Poisonous Bite stacks left undispelled',
    },
    {
      id: 'coils',
      name: 'Spectral Coils',
      spellId: 1287265,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 5000,
      shape: { kind: 'circle', radius: 10 },   // "reduced by players within 10 yards"
      origin: 'random',
      // Raid-wide damage divided by how many bodies are inside, so being OUT is
      // the failure — the file is blunt that "everyone is hit by design, so
      // never name individuals". soakers is the whole group, not a subset.
      rule: { type: 'beInside' },
      soakers: 8,
      good: 'Raid stacks tight on the marker; carriers get an external.',
      failText: 'Out of the Spectral Coils stack — the hit was not shared',
    },

    // ───────────────────────── stage two ─────────────────────────
    {
      id: 'malice',
      name: 'Malice',
      spellId: 1290779,
      // Everyone. The file calls this "TOP KICK PRIORITY" and the assignment
      // note asks for "three players minimum, fixed order" — every role in this
      // game has an interrupt, so every role is in the rotation.
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1500,             // "1.5 sec cast" — the tightest window here
      // A press rule ignores shape for scoring, but a shapeless instance draws
      // nothing, so the Warden gets a marker you can actually see casting.
      shape: { kind: 'circle', radius: 6 },
      origin: 'random',
      rule: { type: 'press', ability: 'interrupt', withinMs: 1500 },
      // No `damage`: six seconds of raid-wide Nature damage belongs on the raid
      // bar, not on you. Miss it repeatedly and the healing floor eats the pull,
      // which is the lesson.
      good: 'Kicked every time by a fixed rotation.',
      failText: 'Malice went off unkicked — six seconds of raid damage',
    },
    {
      id: 'thrash',
      name: 'Desperate Thrash',
      spellId: 1305709,
      roles: ['tank'],
      telegraphMs: 1500,             // "1.5 sec frontal cone"
      shape: { kind: 'cone', radius: 26, arcDeg: 70 },
      // The caster is a Weakened Doomscale, not Ula'tek. The engine has one boss
      // actor, so the add's frontal is expressed off the boss position — the
      // same trick the Sentinels file uses for its two golems. The tank job is
      // identical: keep the cone off the middle.
      origin: 'boss',
      rule: { type: 'faceAway' },
      damage: 0.44,
      good: 'Every Doomscale weakened before it hatches, Anguished Cry kicked, add faced away, twins die together.',
      failText: 'Desperate Thrash swept the raid — the add was not faced away',
    },

    // ───────────────────────── stage three ─────────────────────────
    {
      id: 'echoes',
      name: 'Vicious Echoes',
      spellId: 1310764,
      roles: ['dps'],                // the Shrieker's own rotation, per the file
      telegraphMs: 2500,             // "2.5 sec cast, unlimited range"
      shape: { kind: 'circle', radius: 6 },
      origin: 'random',
      rule: { type: 'press', ability: 'interrupt', withinMs: 2500 },
      // Unlike Malice this one lands on you personally: "a 6 sec raid stun on a
      // collapsing platform is lethal". There is no stun state in the sim, so
      // the cost of standing there stunned is paid as damage.
      damage: 0.34,
      good: 'Vicious Echoes kicked every time; Acidic Expulsion healed through.',
      failText: 'Vicious Echoes went off unkicked — stunned on a collapsing floor',
    },
    {
      id: 'serpentsbite',
      name: "Serpent's Bite",
      // CAST MARKER ONLY. The real venom debuff is one of ten unresolved
      // siblings, so this is the selector ID — the honest one to point at until
      // a log resolves the child. Nothing is invented to fill the gap.
      spellId: 1295905,
      roles: ['tank', 'dps', 'healer'],
      // Really 15s. Compressed because the decision — spot the bite, get inside
      // 7 yards — is made in the first seconds and the rest is dead air.
      telegraphMs: 9000,
      shape: { kind: 'circle', radius: 7 },   // "someone within 7 yards can leech it"
      origin: 'random',
      // Being OUT is the failure: an un-leeched bite becomes a Calcified Corpse
      // (1306119), which stuns, pierces immunities and kills — the file's
      // headline failure. soakers 2 is the bitten player plus one leecher, which
      // leaves the second slot for you.
      rule: { type: 'beInside' },
      soakers: 2,
      spawns: { defId: 'purge' },
      good: 'Every bite leeched well inside 15s; leechers run clear and erupt on nobody.',
      failText: "Nobody leeched the Serpent's Bite — Calcified Corpse",
    },
    {
      id: 'purge',
      name: 'Volatile Purge',
      spellId: 1306086,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 5000,             // "erupts 5 sec later within 7 yards"
      shape: { kind: 'circle', radius: 7 },
      origin: 'player',              // placed on the bite by its parent's spawn
      rule: { type: 'carryOut', minDistance: 20 },
      // Chained off Serpent's Bite rather than scheduled, so it only ever lands
      // on someone who leeched — you cannot fail the run-out if you never went
      // in for the bite, which is exactly how the real mechanic gates it.
      good: 'Every bite leeched well inside 15s; leechers run clear and erupt on nobody.',
      failText: 'Erupted Volatile Purge on the raid',
    },
    {
      id: 'circlingprey',
      name: 'Circling Prey',
      spellId: 1301510,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,
      shape: { kind: 'circle', radius: 13 },   // "knockback within 13 yards"
      // Random rather than edge-anchored: the knockback pushes you directly away
      // from the impact, so a rim impact would shove you to safety. Landing it
      // anywhere means the dangerous case — impact between you and the edge —
      // happens on its own, which is the fight's actual killer.
      origin: 'random',
      // "Everyone is hit by design — the knockback into the void is the kill."
      // So the damage is not the mechanic; keeping your feet is.
      rule: { type: 'survive' },
      knockbackYards: 24,
      good: 'Raid pre-positions off the collapsing section; spit markers dodged.',
      failText: 'Knocked off the platform by Circling Prey',
    },
  ],
}
