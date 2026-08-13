import type { BossDef } from '../engine/types'

// Tok'zali the Contextcoiler — a parody of Nek'zali the Soulcoiler.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. The joke lands on the boss, but what you practise has to
// transfer to the actual raid, and it cannot if "Hungering Pyre" is called
// something else here.
//
// Authored from 12.1/VenomousAbyss/Nekzali/Nekzali.md and abilities.json.
// Every spellId below is real and appears in that abilities.json; the `good`
// strings are the file's own "Good:" lines, verbatim.
//
// EXCLUDED — Mythic-only, so they have no place in a Heroic trainer:
//   Invoke (1299722), Soul Exhaustion (1300235), Swirling Spirit (1300239),
//   Soulcoiler's Curse (1300238), Grasping Depths (1293214), Immortal Coil
//   (1308227).
// EXCLUDED — spellId 0 in the source, flagged "inert until resolved from WCL":
//   Anguished Echoes, Uncoiled Rage, Tether of Awakening, Entwined Step. The
//   .md's own ⚠ Unverified IDs section says not to detect on them, so the game
//   must not invent them either.
// EXCLUDED — 1305421 and 1305993 are wowhead-confirmed dummy scripts with no
//   player-facing effect. The file says "never render them".
//
// The design comes straight from the file's overview: "Nothing here one-shots;
// raids wipe to Rite stacks that should never have existed, and to Slithering
// Flame on people who didn't soak." So the killer is attrition, not a one-shot:
// two ambient drains bleed the raid bar all pull, and the biggest single failure
// you can commit is standing outside the Hungering Pyre circle.
//
// Notable absences that are the fight, not an oversight: there is nothing to
// kick on Heroic (Soulcoiler's Curse is the only interruptible and it is Mythic),
// and the fight's one dispel — Essence Rend — is modelled as `carryOut` rather
// than `press`. The tactic file is explicit that the dispel is "never
// auto-failed"; what actually matters is where the player is standing when it
// lands, because that is where the Latent Cultist puddle spawns. carryOut is the
// rule that trains that, and it does not blame a healer for dispel timing the
// log cannot judge.

export const nekzali: BossDef = {
  key: 'nekzali',
  name: "Tok'zali the Contextcoiler",
  realName: "Nek'zali the Soulcoiler",
  blurb: 'Nothing one-shots. The raid bar bleeds to Rite stacks, and everyone who misses a Pyre soak burns.',
  arenaRadius: 44,
  // Every spirit that reaches the Soulcoil Well fires a Soulcoil Rite: raid-wide
  // Shadow, a permanent stacking DoT, and 5 energy to Nek'zali. The shield is
  // the lesson — while Gravebound Advance holds, the add cannot die at all.
  addEverySec: 26,
  adds: [
    {
      id: 'amani', name: 'Restless Amani', npcId: 261509, spellId: 1287533,
      job: 'kill', count: 2, hp: 9, shieldHp: 5, fuseSec: 15, spawnRadius: 30,
      good: 'Break the Gravebound Advance absorb, then kill it before it reaches the Well.',
      failText: 'A Restless Amani reached the Soulcoil Well',
    },
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,          // ~45s of bar per Soulcoil Well surge
  atFullEnergy: 'well',
  ambient: ['rite', 'toll'],
  pullLengthSec: 150,

  // Six real Heroic mechanics on rotation. Movement pulls both ways on purpose:
  // Pyre drags the raid INTO a circle, Possession Barrage and the Well push it
  // OUT, and the two carry debuffs send you to the wall and back.
  loop: [
    'hollowing', 'pyre', 'rend', 'barrage', 'flame', 'cremation',
    'hollowing', 'pyre', 'cremation', 'rend', 'barrage', 'flame',
    'hollowing', 'pyre', 'rend', 'cremation', 'barrage', 'flame',
  ],

  mechanics: [
    {
      id: 'pyre',
      name: 'Hungering Pyre',
      spellId: 1289855,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,
      shape: { kind: 'circle', radius: 10 },   // "a 10yd Fire soak circle"
      origin: 'random',
      // "splits among everyone inside; anyone who misses it gets Slithering
      // Flame" — taking this hit is correct play, so being OUT is the failure.
      rule: { type: 'beInside' },
      // The file names no head count, only "full assigned head count", so 5 is
      // a placeholder to confirm with the raid leader.
      soakers: 5,
      good: 'Full assigned head count in every circle; a landed flame is walked onto the corpse pile to deny repossession.',
      failText: 'Missed the Hungering Pyre soak',
    },
    {
      id: 'flame',
      name: 'Slithering Flame',
      spellId: 1294933,
      lethal: true,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 8000,               // "an 8s Fire DoT detonating as Cremation"
      shape: { kind: 'circle', radius: 6 },
      origin: 'targeted',
      // "a landed flame is walked onto the corpse pile" — away from the raid.
      rule: { type: 'carryOut', minDistance: 22 },
      spawns: { defId: 'cremation' },
      good: 'Full assigned head count in every circle; a landed flame is walked onto the corpse pile to deny repossession.',
      failText: 'Let Slithering Flame detonate on the raid',
    },
    {
      id: 'cremation',
      name: 'Cremation',
      spellId: 1289875,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1600,
      shape: { kind: 'circle', radius: 4 },   // "a 4yd blast"
      origin: 'random',
      // Fires both as the detonation of your own flame and, from the loop, as
      // somebody else's expiring on the floor near you. The file's failure is
      // "any damage on a player who is not the current flame carrier".
      rule: { type: 'avoid' },
      damage: 0.36,
      good: 'Full assigned head count in every circle; a landed flame is walked onto the corpse pile to deny repossession.',
      failText: 'Caught by a Cremation blast',
    },
    {
      id: 'rend',
      name: 'Essence Rend',
      spellId: 1287434,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 15000,              // "leaves a 15s Shadow DoT"
      shape: { kind: 'circle', radius: 8 },
      origin: 'targeted',
      // Modelled as position, not dispel timing — see the header note. "Rent
      // players reach the dump zone before the dispel lands."
      rule: { type: 'carryOut', minDistance: 24 },
      spawns: { defId: 'cultist' },
      good: 'Rent players reach the dump zone before the dispel lands, so puddles sit off the Amani intercept lane.',
      failText: 'Dropped Essence Rend on the raid — Cultist in the lane',
    },
    {
      id: 'cultist',
      name: 'Latent Cultist',
      spellId: 1288554,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,                  // spawned already active where the Rend ended
      shape: { kind: 'circle', radius: 8 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.14,                    // per second while stood in it
      lingerMs: 26000,                 // "a persistent puddle"
      good: 'Rent players reach the dump zone before the dispel lands, so puddles sit off the Amani intercept lane.',
      failText: 'Stood in a Latent Cultist puddle — 40% snare',
    },
    {
      id: 'barrage',
      name: 'Possession Barrage',
      spellId: 1284103,
      // The tank is expected in this data — "tank out of the stack with a
      // defensive up" — so the tank is not scored on it. Everyone else spreads.
      roles: ['dps', 'healer'],
      telegraphMs: 2500,
      shape: { kind: 'circle', radius: 10 },
      origin: 'boss',
      // The impact ID (1292034) is 300yd and lands on everyone every cast, so a
      // hit count there is meaningless. What IS trainable is the file's own
      // "hitting harder the less distance they travel" — stand off the launch.
      rule: { type: 'avoid' },
      damage: 0.33,
      good: 'Tank out of the stack with a defensive up, raid spread wide, tanks swapping on an agreed stack count so the barrage tank is never the one at high stacks.',
      failText: 'Stacked on the tank when the Barrage launched',
    },
    {
      id: 'hollowing',
      name: 'Hollowing Strikes',
      spellId: 1284109,
      roles: ['tank'],
      telegraphMs: 1500,
      origin: 'boss',
      // "a 15s stacking DoT cutting healing and absorbs received by 5% per
      // stack" — the fight's swap driver, and the reason the barrage tank must
      // not be the one sitting at high stacks.
      rule: { type: 'tankSwap', maxStacks: 5 },
      good: 'Tank out of the stack with a defensive up, raid spread wide, tanks swapping on an agreed stack count so the barrage tank is never the one at high stacks.',
      failText: 'Held Hollowing Strikes too long — taunt the swap sooner',
    },
    {
      id: 'well',
      name: 'Soulcoil Well',
      spellId: 1290390,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 3000,
      shape: { kind: 'circle', radius: 13 },
      // The well is fixed at the centre of the room and Nek'zali holds it, so
      // anchoring to the boss is the closest the engine gets — there is no
      // arena-centre origin. The full-energy surge is the window where the water
      // is widest and the whole raid has to be off it.
      origin: 'boss',
      rule: { type: 'avoid' },
      damage: 0.17,                    // per second while stood in the water
      lingerMs: 15000,
      good: 'Zero contact events all pull; healers treat Residual Toll as the damage floor.',
      failText: 'Stepped into the Soulcoil Well',
    },
    {
      id: 'rite',
      name: 'Soulcoil Rite',
      spellId: 1288772,
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // "Deaths within 3s of a 1288772 damage event read as raid pressure at N
      // stacks, never as an individual failure." Unavoidable, so raidDamage —
      // it drains the raid bar and can never blame the player.
      rule: { type: 'raidDamage', dps: 2.1 },
      good: 'Only the scripted Rites fire, a cooldown lands on each Ignition, and Ritual Burn is still in low double digits at the kill.',
      failText: '',
    },
    {
      id: 'toll',
      name: 'Residual Toll',
      spellId: 1298696,
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // "the encounter's baseline damage floor, informational" — the file calls
      // Residual Toll itself informational and never a failure.
      rule: { type: 'raidDamage', dps: 1.2 },
      good: 'Zero contact events all pull; healers treat Residual Toll as the damage floor.',
      failText: '',
    },
  ],
}
