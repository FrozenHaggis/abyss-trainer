import type { BossDef } from '../engine/types'

// Tok'zali the Contextcoiler — a parody of Nek'zali the Soulcoiler.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. The joke lands on the boss, but what you practise has to
// transfer to the actual raid, and it cannot if "Hungering Pyre" is called
// something else here.
//
// Authored from 12.1/VenomousAbyss/Nekzali/Nekzali.md and abilities.json. Every
// spellId below is real and appears in that abilities.json; the `good` strings
// are the file's own "Good:" lines, verbatim.
//
// The room is a circle with the Soulcoil Well fixed in the middle, and the whole
// fight is things walking towards the water. Touching the well kills. Restless
// Amani spawn at the rim and march at it; every one that arrives casts a Soulcoil
// Rite and hands her five energy. She never has to be dodged so much as denied.
//
// WHAT THIS FILE CORRECTS, and it was not a small thing: Hungering Pyre,
// Slithering Flame and Cremation are all ECHO OF JAWAE spells in abilities.json,
// not boss spells. The previous version had the three of them on a Stage One
// rotation, which taught a fight that does not exist — those casts belong to the
// intermission, where two Echoes are up and the raid is split between soaking the
// Pyre and carrying the flame onto the corpse pile. They now live in the
// intermission phase and nowhere else.
//
// Invoke (1299722) used to be excluded here as Mythic-only. It is cast on Heroic
// in Stage Two; the difficulty tag in data/abilities/nekzali.json has been
// corrected, and Invoke is what sets the standing Latent Cultist puddles moving.
//
// EXCLUDED — Mythic-only, so they have no place in a Heroic trainer:
//   Soul Exhaustion (1300235), Swirling Spirit (1300239), Soulcoiler's Curse
//   (1300238), Grasping Depths (1293214), Immortal Coil (1308227).
// EXCLUDED — spellId 0 in the source, flagged "inert until resolved from WCL":
//   Anguished Echoes, Uncoiled Rage, Tether of Awakening, Entwined Step. The
//   .md's own ⚠ Unverified IDs section says not to detect on them, so the game
//   must not invent them either. Uncoiled Rage is the reason the energy bar
//   matters and it still cannot be a mechanic — the bar filling simply ends the
//   pull, which is what `enraged` on the result records.
// EXCLUDED — 1305421 and 1305993 are wowhead-confirmed dummy scripts with no
//   player-facing effect. The file says "never render them".
//
// The design comes straight from the file's overview: "Nothing here one-shots;
// raids wipe to Rite stacks that should never have existed, and to Slithering
// Flame on people who didn't soak." So the killer is attrition you caused
// yourself, and the bar on screen is the receipt.

export const nekzali: BossDef = {
  key: 'nekzali',
  name: "Tok'zali the Contextcoiler",
  realName: "Nek'zali the Soulcoiler",
  blurb: 'The well in the middle kills on contact, and everything on the floor is walking towards it.',
  // Measured from PTR combat logs, not guessed: Circle (CV 10.0%, corner/axis 0.93). 125,871 samples over 27 pulls.
  // 1 yard = 100 coordinate units.
  arenaRadius: 46,

  // Two adds, and they are two completely different jobs.
  //
  // The Amani are the pull-long one: they arrive at the rim and walk. The Echoes
  // exist only inside the intermission, are spawned by that phase rather than by
  // the wave scheduler, and hold their ground while two tanks pick them up.
  addEverySec: 24,
  maxAdds: 6,
  adds: [
    {
      id: 'amani', name: 'Restless Amani', npcId: 261509, spellId: 1287533,
      job: 'intercept', count: 2, hp: 12, shieldHp: 3, fuseSec: 26,
      // The rim, not a comfortable middle distance — they get the whole room to
      // cross, and the raid gets the whole crossing to kill them in.
      spawnRadius: 44, marchSpeed: 1.8,
      // Gravebound Advance is "an absorb worth 25% of their health making them
      // unkillable and unstoppable": 3 against a 12 health pool. Shooting one
      // before the shield breaks is wasted damage and the bar shows it.
      good: "Shields stripped on spawn, adds CC'd and killed well short of the water.",
      failText: 'A Restless Amani reached the Soulcoil Well',
      // Arriving is not a despawn — it is a Rite, five energy, and another
      // permanent Ritual Burn stack on everyone.
      onLeak: 'rite',
      leakEnergy: 5,
      // The corpse is the point. It lies where the add died until somebody
      // Cremates it, and the intermission stands up every one that nobody did.
      leavesCorpse: true,
    },
    {
      id: 'echo', name: 'Echo of Jawae', npcId: 263050, spellId: 1294742,
      // The intermission, and only the intermission. Without this the wave timer
      // deals Echoes out as ordinary trash in Stages One and Two as well.
      phaseOnly: true,
      job: 'kill', count: 2, hp: 30, fuseSec: 70, spawnRadius: 26,
      // No marchSpeed: an Echo holds its ground and is tanked where it stands.
      // They spawn on opposite sides, which is why the raid kills them one at a
      // time rather than trying to cleave both.
      good: 'Every Echo dies inside the window and the raid re-engages immediately.',
      failText: 'An Echo of Jawae was still up when the Ritual of Awakening ended',
    },
  ],
  maxHp: 1,

  // ── the energy bar ──
  // Zero per second, and that is the whole design. "Nek'zali's bar is fed by
  // events, never by the clock: every point on it is a Rite that happened — ten
  // per scripted Ignition, five more for every Amani that reached the water."
  // A bar that filled on its own would make the add control decorative, since
  // the enrage would arrive whether or not anything leaked.
  energyPerSec: 0,
  // No `atFullEnergy`. Uncoiled Rage — +500% damage, +150% speed, taunt immune —
  // is spellId 0 in the source and may not be invented as a mechanic. A full bar
  // ends the pull instead, which is the same outcome and claims nothing the data
  // does not say.

  // Stage One's loop and ambient, repeated at the top level so anything that
  // reads a BossDef without walking its phases still gets the opening stage
  // rather than an empty rotation.
  loopIntervalSec: 6.5,
  loop: [
    'hollowing', 'barrage', 'rend', 'ignition',
    'hollowing', 'rend', 'barrage', 'ignition',
  ],
  ambient: ['toll'],
  // Long, because roughly a third of it is spent on a boss who cannot be damaged.
  // 190 -> 220: the intermission locks the boss out entirely while two Echoes
  // are killed, so a third of the pull cannot be spent on her. A healer, who
  // contributes the least damage of the three roles, was finishing at 7%.
  pullLengthSec: 220,

  // ── phases ──
  // Two stages and an intermission, and the two triggers are different quantities
  // on purpose: PHASES.md records the intermission as a HEALTH threshold (50%,
  // stated) while the pull's hard end is the ENERGY bar. It is an energy race
  // with a health-gated interruption, not a health ladder.
  phases: [
    {
      id: 'p1',
      name: 'Stage One',
      banner: 'STAGE ONE — KEEP THEM OFF THE WELL',
      loop: [
        'hollowing', 'barrage', 'rend', 'ignition',
        'hollowing', 'rend', 'barrage', 'ignition',
      ],
      loopIntervalSec: 6.5,
      ambient: ['toll'],
      endsAtBossHp: 0.5,
    },
    {
      id: 'intermission',
      name: 'Intermission — Ritual of Awakening',
      banner: 'RITUAL OF AWAKENING — KILL BOTH ECHOES',
      // Only the Echo package fires here. Nek'zali is standing in her own well
      // doing nothing, so none of her casts belong in this list.
      loop: ['pyre', 'cremation', 'pyre'],
      loopIntervalSec: 7,
      ambient: ['toll'],
      onEnter: [{ addId: 'echo', count: 2 }],
      // She is immune, not merely tanky. Damage logged here is damage thrown
      // away, and a raid that keeps hitting her learns that the hard way.
      entitiesReduction: 1,
      // She stops being dragged around and runs to the middle, standing in her
      // own water until both Echoes are down. With one entity there is nothing to
      // converge WITH, so here converging means converging on the well: this is
      // the only stretch of the pull where her position is not the tank's choice.
      entitiesConverge: true,
      endsWhenAddsDead: 'echo',
      // The bill for every corpse the flame carriers did not burn. They stand
      // back up and start walking again, and they still have their shields.
      resurrectCorpsesAs: 'amani',
    },
    {
      id: 'p2',
      name: 'Stage Two — Uncoiling',
      banner: 'STAGE TWO — UNCOILING',
      // Stage One plus Invoke, and a faster beat. PhaseDef carries no add cadence
      // of its own, so the tightening lands on the loop interval — which is also
      // where the player feels it, since Ignition and Barrage now arrive on top
      // of each other.
      loop: [
        'hollowing', 'rend', 'barrage', 'invoke', 'ignition',
        'rend', 'hollowing', 'invoke', 'barrage', 'ignition',
      ],
      loopIntervalSec: 5,
      ambient: ['toll', 'uncoiling'],
    },
  ],

  mechanics: [
    {
      id: 'well',
      name: 'Soulcoil Well',
      spellId: 1290390,
      what: "Residual Toll ticks Shadow damage on random players while the well siphons; standing in the well ticks 1290390, and on Mythic the spirits inside tick Swirling Spirit .",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 0,
      shape: { kind: 'circle', radius: 13 },
      origin: 'random',
      // Not a mechanic — a hole in the floor. It belongs to NPC 266756, not to
      // Nek'zali, so it does not follow her when the tank drags her about; it is
      // bolted to the middle of the room from the pull to the kill.
      //
      // Modelled as damage you could heal through, this taught the opposite of
      // what the fight asks. The tactic file's target is "zero contact events all
      // pull", and contact kills.
      rule: { type: 'lethalGround' },
      fixture: true,
      atCentre: true,
      permanent: true,
      good: 'Zero contact events all pull; healers treat Residual Toll as the damage floor.',
      failText: 'Stepped into the Soulcoil Well',
    },
    {
      id: 'ignition',
      name: 'Soulcoil Ignition',
      spellId: 1293664,
      what: "Nek'zali stirs the well herself, invoking four Soulcoil Rites back to back — the scripted healing burst and the marker that separates scripted Rites from leaked ones.",
      roles: ['healer'],
      telegraphMs: 2500,
      origin: 'boss',
      // Cannot be avoided, cannot be interrupted, and is not supposed to be. It
      // is the fight's scheduled healing burst — the one place a raid cooldown
      // has an obvious home.
      //
      // dps is zero because the damage is in the four Rites this fires, not in
      // the Ignition itself. Charging for both would make the healing check read
      // twice as bad as the fight actually is.
      rule: { type: 'raidDamage', dps: 0 },
      // "four Rites back to back", one a second. Rolled into a single lump of
      // damage it stops being something a healer can plan a cooldown around.
      channel: { defId: 'rite', count: 4, everyMs: 1000 },
      // "every 2 seconds of Rite gives her 5 energy, so one Ignition is 10
      // energy". Charged here rather than on each Rite so a leaked Amani's Rite
      // and a scripted one cannot both be counted twice.
      energy: 10,
      good: 'Only the scripted Rites fire, a cooldown lands on each Ignition, and Ritual Burn is still in low double digits at the kill.',
      failText: '',
    },
    {
      id: 'rite',
      name: 'Soulcoil Rite',
      spellId: 1288772,
      what: "Raid-wide Shadow burst plus a never-expiring stacking DoT each time a soul enters the well, each stacking Ritual Burn , +15% mechanic damage taken for 60s. Soulcoil Ignition fires four Rites back to back while Anguished Echoes rain down as knockback circles.",
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // "Deaths within 3s of a 1288772 damage event read as raid pressure at N
      // stacks, never as an individual failure." Unavoidable, so raidDamage — it
      // drains the raid bar and can never blame the player.
      //
      // It is deliberately NOT in any ambient list. Every Rite has a cause: four
      // from each Ignition, one from each Amani that reached the water. A Rite
      // ticking away on its own would make "only the scripted Rites fire"
      // impossible to achieve and impossible to read.
      rule: { type: 'raidDamage', dps: 2.4 },
      // The permanent stack is the fight. Each one is +15% on everything that
      // comes after it, so a pull that leaked early is measurably harder later.
      stacks: { defId: 'burn', amountPct: 15 },
      good: 'Only the scripted Rites fire, a cooldown lands on each Ignition, and Ritual Burn is still in low double digits at the kill.',
      failText: '',
    },
    {
      id: 'burn',
      name: 'Ritual Burn',
      spellId: 1297624,
      what: "Pure aura, +15% mechanic damage taken per stack for 1 min — no damage events of its own, stack count is the add-leak scoreboard.",
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // Never fired by the loop and never in ambient: it exists only as the thing
      // Soulcoil Rite stacks. Zero dps because the source is explicit that it has
      // "no damage events of its own" — it is the multiplier on everybody else's,
      // and the running scoreboard of what this pull has already leaked.
      rule: { type: 'raidDamage', dps: 0 },
      permanent: true,
      good: 'Only the scripted Rites fire, a cooldown lands on each Ignition, and Ritual Burn is still in low double digits at the kill.',
      failText: '',
    },
    {
      id: 'rend',
      name: 'Essence Rend',
      spellId: 1287434,
      what: "Ensnares several players, drags then flings them, and leaves a 15s Shadow DoT that spawns a Latent Cultist where it ends — an explosion plus a persistent puddle ticking Shadow damage and snaring 40%.",
      // Never lands on a tank. The tank still sees rent players walking it to the
      // wall — that is the shape of the mechanic and worth watching — but it is
      // not a job they will ever be handed.
      roles: ['dps', 'healer'],
      telegraphMs: 15000,              // "leaves a 15s Shadow DoT"
      shape: { kind: 'circle', radius: 8 },
      origin: 'targeted',
      // Modelled as position, not as dispel timing. The tactic file is explicit
      // that the dispel is "never auto-failed"; what matters is where you were
      // standing, because that is where the puddle lands — and it lands forever.
      // The Amani lane and the well both have to stay clear, so the answer is the
      // outside of the room.
      rule: { type: 'carryOut', minDistance: 30 },
      spawns: { defId: 'cultist' },
      good: 'Rent players reach the dump zone before the dispel lands, so puddles sit off the Amani intercept lane.',
      failText: 'Dropped Essence Rend on the raid — Cultist in the lane',
    },
    {
      id: 'cultist',
      name: 'Latent Cultist',
      spellId: 1288554,
      what: "Spawn explosion plus a persistent puddle dealing Shadow damage per second and snaring 40% — any hit on any player is a failure.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,                  // spawned already active where the Rend ended
      shape: { kind: 'circle', radius: 8 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.14,                    // per second while stood in it
      // Never despawns, and no `lingerMs` to soften it. The room is consumed by
      // where people stood ten minutes ago, and an encounter that quietly cleaned
      // up after itself would delete the only reason dump-zone discipline
      // matters. By Stage Two the floor is a maze the raid built.
      permanent: true,
      good: 'Rent players reach the dump zone before the dispel lands, so puddles sit off the Amani intercept lane.',
      failText: 'Stood in a Latent Cultist puddle — 40% snare',
    },
    {
      id: 'invoke',
      name: 'Invoke',
      spellId: 1299722,
      what: "Interrupt Cast plus a Pacify and Silence aura on players; it also commands the Latent Cultists to reposition, dancing every puddle around the well.",
      roles: ['healer'],
      telegraphMs: 3000,
      origin: 'boss',
      // "Losing a cast to Invoke's silence is not reportable", so the silence is
      // not scored. What it does to the raid is drag the standing puddles across
      // the floor, which turns a memorised safe spot into a moving problem and
      // puts a steady pulse on the healers.
      rule: { type: 'raidDamage', dps: 1.8 },
      // Not this cast's own drift — Invoke has no shape. This is the speed it
      // hands to the Latent Cultist puddles already on the floor, which is why
      // they sit still all through Stage One and only start moving here.
      driftSpeed: 2.5,
      good: 'The raid re-reads the floor after every Invoke.',
      failText: '',
    },
    {
      id: 'barrage',
      name: 'Possession Barrage',
      spellId: 1284103,
      what: "Spectral echoes launched at the current tank burst for Shadow damage , hitting harder the less distance they travel. Boss melee applies Hollowing Strikes , a 15s stacking DoT cutting healing and absorbs received by 5% per stack (guides also call it Sever/Hollowed).",
      // The tank's mechanic and nobody else's. A dps or healer cannot influence
      // where the tank was standing when the echoes launched, so telling them
      // about it is noise in the one place a trainer must not add noise.
      roles: ['tank'],
      telegraphMs: 3500,
      // A range band, not a circle to sidestep: "hitting harder the less distance
      // they travel". Being close is the failure and there is no such thing as
      // too far, so the outer edge is the arena's own diameter — no point on the
      // floor is ever outside it.
      shape: { kind: 'annulus', inner: 20, outer: 92 },
      origin: 'boss',
      // Scored on the tank as well as everyone else. The barrage is aimed at
      // whoever is holding her, and she stands still while she casts it — that
      // stillness is the only reason running out is possible, and it is the one
      // window in the fight where the tank is not dragging her somewhere.
      //
      // The impact ID (1292034) is 300yd and lands on the whole raid every cast,
      // so a hit count there would name everybody. What is trainable is distance,
      // and the cost of getting it wrong lands on the raid bar rather than on one
      // player's corpse.
      rule: { type: 'beInside' },
      good: 'Tank out of the stack with a defensive up, raid spread wide, tanks swapping on an agreed stack count so the barrage tank is never the one at high stacks.',
      failText: 'Too close to the Barrage launch',
    },
    {
      id: 'hollowing',
      name: 'Hollowing Strikes',
      spellId: 1284109,
      what: "Spectral echoes launched at the current tank burst for Shadow damage , hitting harder the less distance they travel. Boss melee applies Hollowing Strikes , a 15s stacking DoT cutting healing and absorbs received by 5% per stack (guides also call it Sever/Hollowed).",
      roles: ['tank'],
      telegraphMs: 1500,
      origin: 'boss',
      // "a 15s stacking DoT cutting healing and absorbs received by 5% per stack"
      // — the fight's swap driver, and the reason the barrage tank must not be
      // the one sitting at high stacks. The two mechanics share a Good line
      // because they are one decision.
      // Swap on two, not five. Hollowing Strikes lands about every 26 seconds,
      // so a five-stack threshold was not reached until roughly two minutes in —
      // one swap in a whole pull, which reads as two tanks who never trade at
      // all. At two the co-tank taunts every fifty seconds or so and the
      // partnership is visible, which is the thing being taught.
      rule: { type: 'tankSwap', maxStacks: 2 },
      good: 'Tank out of the stack with a defensive up, raid spread wide, tanks swapping on an agreed stack count so the barrage tank is never the one at high stacks.',
      failText: 'Held Hollowing Strikes too long — taunt the swap sooner',
    },
    {
      id: 'pyre',
      name: 'Hungering Pyre',
      spellId: 1289855,
      what: "An Echo drops a 10yd Fire soak circle that splits among everyone inside; anyone who misses it gets Slithering Flame , an 8s Fire DoT detonating as Cremation in a 4yd blast that incinerates Vessels of Awakening and Amani corpses.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,
      shape: { kind: 'circle', radius: 10 },   // "a 10yd Fire soak circle"
      origin: 'random',
      // "splits among everyone inside; anyone who misses it gets Slithering
      // Flame" — taking this hit is correct play, so being OUT is the failure.
      rule: { type: 'beInside' },
      // Half the raid. The other half is not idle: they are carrying the flame.
      soakers: 10,
      // Which is what this does. On alternate casts you are handed Slithering
      // Flame instead of being scored on the soak, so one intermission trains
      // both halves of the split rather than whichever you were assigned.
      alternatesWith: { defId: 'flame' },
      good: 'Full assigned head count in every circle; a landed flame is walked onto the corpse pile to deny repossession.',
      failText: 'Missed the Hungering Pyre soak',
    },
    {
      id: 'flame',
      name: 'Slithering Flame',
      spellId: 1294933,
      what: "An Echo drops a 10yd Fire soak circle that splits among everyone inside; anyone who misses it gets Slithering Flame , an 8s Fire DoT detonating as Cremation in a 4yd blast that incinerates Vessels of Awakening and Amani corpses.",
      lethal: true,
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 8000,               // "an 8s Fire DoT detonating as Cremation"
      shape: { kind: 'circle', radius: 6 },
      origin: 'targeted',
      // The red circle is not something to run away from the raid with and then
      // forget — it is a tool. It has to expire on top of the Amani corpses,
      // because every corpse still lying there when the intermission ends gets
      // back up. The distance is measured from the well, which is where the
      // corpses are not.
      rule: { type: 'carryOut', minDistance: 24 },
      spawns: { defId: 'cremation' },
      good: 'Full assigned head count in every circle; a landed flame is walked onto the corpse pile to deny repossession.',
      failText: 'Let Slithering Flame detonate on the raid',
    },
    {
      id: 'cremation',
      name: 'Cremation',
      spellId: 1289875,
      what: "4yd Fire blast when Slithering Flame expires, burning Vessels of Awakening and Amani corpses in range — the flame carrier is expected in this data, everyone else is a failure.",
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1600,
      shape: { kind: 'circle', radius: 4 },   // "a 4yd blast"
      origin: 'random',
      // Fires both as the detonation of your own flame and, from the loop, as
      // somebody else's expiring on the floor near you. The file's failure is
      // "any damage on a player who is not the current flame carrier".
      //
      // Any Amani corpse inside the blast is burned for good. That is the only
      // way corpses leave the floor, and it is why the carriers walk their flames
      // to the pile instead of simply away from people.
      rule: { type: 'avoid' },
      damage: 0.36,
      good: 'Full assigned head count in every circle; a landed flame is walked onto the corpse pile to deny repossession.',
      failText: 'Caught by a Cremation blast',
    },
    {
      id: 'toll',
      name: 'Residual Toll',
      spellId: 1298696,
      what: "Real Shadow damage at 300yd while the well siphons souls, leaving Hollowed after 16s — the encounter's baseline damage floor, informational.",
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // "the encounter's baseline damage floor, informational" — the file calls
      // Residual Toll itself informational and never a failure. It belongs to the
      // well rather than to Nek'zali, which is why it runs in every phase,
      // including the one where she is standing in it doing nothing.
      rule: { type: 'raidDamage', dps: 1.2 },
      good: 'Zero contact events all pull; healers treat Residual Toll as the damage floor.',
      failText: '',
    },
    {
      id: 'uncoiling',
      name: 'Uncoiling',
      spellId: 1292315,
      what: "Stage Two soft enrage — ticking Shadow damage on the whole raid every second until she dies; unavoidable, informational plus deaths.",
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // Stage Two attrition, and the reason the intermission's corpses matter so
      // much: this never stops, so every second spent re-killing something the
      // raid already killed is paid for out of the healers' remaining margin.
      rule: { type: 'raidDamage', dps: 2 },
      good: 'Stage Two entered with low Ritual Burn stacks, a full raid, and lust or the last cooldown block in hand.',
      failText: '',
    },
  ],
}
