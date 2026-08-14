// src/bosses/nekzali.ts
var nekzali = {
  key: "nekzali",
  name: "Tok'zali the Contextcoiler",
  realName: "Nek'zali the Soulcoiler",
  blurb: "Nothing one-shots. The raid bar bleeds to Rite stacks, and everyone who misses a Pyre soak burns.",
  // Measured from PTR combat logs, not guessed: Circle (CV 10.0%, corner/axis 0.93). 125,871 samples over 27 pulls.
  // 1 yard = 100 coordinate units.
  arenaRadius: 46,
  // Every spirit that reaches the Soulcoil Well fires a Soulcoil Rite: raid-wide
  // Shadow, a permanent stacking DoT, and 5 energy to Nek'zali. The shield is
  // the lesson — while Gravebound Advance holds, the add cannot die at all.
  addEverySec: 26,
  maxAdds: 6,
  adds: [
    {
      id: "amani",
      name: "Restless Amani",
      npcId: 261509,
      spellId: 1287533,
      job: "kill",
      count: 2,
      hp: 9,
      shieldHp: 5,
      fuseSec: 15,
      spawnRadius: 30,
      good: "Break the Gravebound Advance absorb, then kill it before it reaches the Well.",
      failText: "A Restless Amani reached the Soulcoil Well"
    }
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,
  // ~45s of bar per Soulcoil Well surge
  atFullEnergy: "well",
  ambient: ["rite", "toll"],
  pullLengthSec: 150,
  // Six real Heroic mechanics on rotation. Movement pulls both ways on purpose:
  // Pyre drags the raid INTO a circle, Possession Barrage and the Well push it
  // OUT, and the two carry debuffs send you to the wall and back.
  loop: [
    "hollowing",
    "pyre",
    "rend",
    "barrage",
    "flame",
    "cremation",
    "hollowing",
    "pyre",
    "cremation",
    "rend",
    "barrage",
    "flame",
    "hollowing",
    "pyre",
    "rend",
    "cremation",
    "barrage",
    "flame"
  ],
  mechanics: [
    {
      id: "pyre",
      name: "Hungering Pyre",
      spellId: 1289855,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 4e3,
      shape: { kind: "circle", radius: 10 },
      // "a 10yd Fire soak circle"
      origin: "random",
      // "splits among everyone inside; anyone who misses it gets Slithering
      // Flame" — taking this hit is correct play, so being OUT is the failure.
      rule: { type: "beInside" },
      // The file names no head count, only "full assigned head count", so 5 is
      // a placeholder to confirm with the raid leader.
      soakers: 5,
      good: "Full assigned head count in every circle; a landed flame is walked onto the corpse pile to deny repossession.",
      failText: "Missed the Hungering Pyre soak"
    },
    {
      id: "flame",
      name: "Slithering Flame",
      spellId: 1294933,
      lethal: true,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 8e3,
      // "an 8s Fire DoT detonating as Cremation"
      shape: { kind: "circle", radius: 6 },
      origin: "targeted",
      // "a landed flame is walked onto the corpse pile" — away from the raid.
      rule: { type: "carryOut", minDistance: 22 },
      spawns: { defId: "cremation" },
      good: "Full assigned head count in every circle; a landed flame is walked onto the corpse pile to deny repossession.",
      failText: "Let Slithering Flame detonate on the raid"
    },
    {
      id: "cremation",
      name: "Cremation",
      spellId: 1289875,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1600,
      shape: { kind: "circle", radius: 4 },
      // "a 4yd blast"
      origin: "random",
      // Fires both as the detonation of your own flame and, from the loop, as
      // somebody else's expiring on the floor near you. The file's failure is
      // "any damage on a player who is not the current flame carrier".
      rule: { type: "avoid" },
      damage: 0.36,
      good: "Full assigned head count in every circle; a landed flame is walked onto the corpse pile to deny repossession.",
      failText: "Caught by a Cremation blast"
    },
    {
      id: "rend",
      name: "Essence Rend",
      spellId: 1287434,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 15e3,
      // "leaves a 15s Shadow DoT"
      shape: { kind: "circle", radius: 8 },
      origin: "targeted",
      // Modelled as position, not dispel timing — see the header note. "Rent
      // players reach the dump zone before the dispel lands."
      rule: { type: "carryOut", minDistance: 24 },
      spawns: { defId: "cultist" },
      good: "Rent players reach the dump zone before the dispel lands, so puddles sit off the Amani intercept lane.",
      failText: "Dropped Essence Rend on the raid \u2014 Cultist in the lane"
    },
    {
      id: "cultist",
      name: "Latent Cultist",
      spellId: 1288554,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1,
      // spawned already active where the Rend ended
      shape: { kind: "circle", radius: 8 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.14,
      // per second while stood in it
      lingerMs: 26e3,
      // "a persistent puddle"
      good: "Rent players reach the dump zone before the dispel lands, so puddles sit off the Amani intercept lane.",
      failText: "Stood in a Latent Cultist puddle \u2014 40% snare"
    },
    {
      id: "barrage",
      name: "Possession Barrage",
      spellId: 1284103,
      // The tank is expected in this data — "tank out of the stack with a
      // defensive up" — so the tank is not scored on it. Everyone else spreads.
      roles: ["dps", "healer"],
      telegraphMs: 2500,
      shape: { kind: "circle", radius: 10 },
      origin: "boss",
      // The impact ID (1292034) is 300yd and lands on everyone every cast, so a
      // hit count there is meaningless. What IS trainable is the file's own
      // "hitting harder the less distance they travel" — stand off the launch.
      rule: { type: "avoid" },
      damage: 0.33,
      good: "Tank out of the stack with a defensive up, raid spread wide, tanks swapping on an agreed stack count so the barrage tank is never the one at high stacks.",
      failText: "Stacked on the tank when the Barrage launched"
    },
    {
      id: "hollowing",
      name: "Hollowing Strikes",
      spellId: 1284109,
      roles: ["tank"],
      telegraphMs: 1500,
      origin: "boss",
      // "a 15s stacking DoT cutting healing and absorbs received by 5% per
      // stack" — the fight's swap driver, and the reason the barrage tank must
      // not be the one sitting at high stacks.
      rule: { type: "tankSwap", maxStacks: 5 },
      good: "Tank out of the stack with a defensive up, raid spread wide, tanks swapping on an agreed stack count so the barrage tank is never the one at high stacks.",
      failText: "Held Hollowing Strikes too long \u2014 taunt the swap sooner"
    },
    {
      id: "well",
      name: "Soulcoil Well",
      spellId: 1290390,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 3e3,
      shape: { kind: "circle", radius: 13 },
      // The well is fixed at the centre of the room and Nek'zali holds it, so
      // anchoring to the boss is the closest the engine gets — there is no
      // arena-centre origin. The full-energy surge is the window where the water
      // is widest and the whole raid has to be off it.
      origin: "boss",
      rule: { type: "avoid" },
      damage: 0.17,
      // per second while stood in the water
      lingerMs: 15e3,
      good: "Zero contact events all pull; healers treat Residual Toll as the damage floor.",
      failText: "Stepped into the Soulcoil Well"
    },
    {
      id: "rite",
      name: "Soulcoil Rite",
      spellId: 1288772,
      roles: ["healer"],
      telegraphMs: 0,
      origin: "boss",
      // "Deaths within 3s of a 1288772 damage event read as raid pressure at N
      // stacks, never as an individual failure." Unavoidable, so raidDamage —
      // it drains the raid bar and can never blame the player.
      rule: { type: "raidDamage", dps: 2.1 },
      good: "Only the scripted Rites fire, a cooldown lands on each Ignition, and Ritual Burn is still in low double digits at the kill.",
      failText: ""
    },
    {
      id: "toll",
      name: "Residual Toll",
      spellId: 1298696,
      roles: ["healer"],
      telegraphMs: 0,
      origin: "boss",
      // "the encounter's baseline damage floor, informational" — the file calls
      // Residual Toll itself informational and never a failure.
      rule: { type: "raidDamage", dps: 1.2 },
      good: "Zero contact events all pull; healers treat Residual Toll as the damage floor.",
      failText: ""
    }
  ]
};

// src/bosses/sentinels.ts
var sentinels = {
  key: "sentinels",
  name: "The Entombed Guardrails",
  realName: "Entombed Sentinels",
  blurb: "Nothing to kick and one dispel. Mis-stacked Helical Toxins ends pulls; the Marks are the clock.",
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
      id: "coagulation_add",
      name: "Venom Coagulation",
      npcId: 260766,
      spellId: 1284257,
      job: "kill",
      count: 2,
      hp: 11,
      fuseSec: 17,
      auraDps: 0.5,
      spawnRadius: 26,
      good: "Kill it quickly \u2014 Contaminate cannot be interrupted, only outpaced.",
      failText: "A Venom Coagulation contaminated the raid"
    }
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
    { id: "breath", name: "Breath of Ula'tek", npcId: 258557, start: { x: -22, y: 0 }, tankedApart: true },
    { id: "blood", name: "Blood of Ula'tek", npcId: 258558, start: { x: 22, y: 0 }, tankedApart: true }
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  // "They share an energy bar; at 100 energy both channel Vitriolic Stasis."
  energyPerSec: 2.2,
  // ~45s between Stasis windows
  atFullEnergy: "stasis",
  ambient: ["marks"],
  pullLengthSec: 150,
  // Alternating pressure from both golems: Breath's floor clutter and melee
  // stacks, Blood's outgoing debuffs. Deliberately mixed so the raid is pushed
  // OUT (droplets, Living Venom, Blood Venom, Protovenom) as often as it is
  // pulled IN (the slime swap, the Miasma soak, the Helical stack-up) — a loop
  // that only ever says "run out" trains one reflex and no decisions.
  loop: [
    "slam",
    "droplets",
    "blighted",
    "livingvenom",
    "slam",
    "miasma",
    "droplets",
    "bloodvenom",
    "slam",
    "protovenom",
    "livingvenom",
    "coagulation",
    "slam",
    "droplets",
    "blighted",
    "miasma",
    "slam",
    "bloodvenom"
  ],
  mechanics: [
    {
      id: "dominance",
      name: "Ula'tek's Dominance",
      spellId: 1290189,
      from: "breath",
      // The tank job, and for a long time the one this trainer could not teach:
      // "Both bosses gain 99% DR for 10s while within ~25yd of each other.
      // Good: Tanks hold them 40+ yards apart all pull."
      //
      // Judged continuously. Walk your golem into the other one and your shots
      // stop doing anything, which is the consequence the real fight applies.
      roles: ["tank"],
      telegraphMs: 0,
      origin: "boss",
      rule: { type: "keepApart", minYards: 25 },
      good: "Tanks hold them 40+ yards apart all pull.",
      failText: "Let the golems close \u2014 Ula'tek's Dominance, 99% damage reduction"
    },
    // ───────────────────────────── shared ─────────────────────────────
    {
      id: "marks",
      name: "Mark of Acid / Mark of Blood",
      spellId: 1284500,
      from: "breath",
      // Nature half; 1284506 is Blood's Shadow half
      roles: ["tank", "dps", "healer"],
      telegraphMs: 0,
      origin: "boss",
      // "Bad: No positional failure exists. Deaths mean a slow kill or badly
      // spent healer cooldowns — a pace signal, never a name-and-shame."
      // raidDamage never produces a per-player failure. This is the soft enrage,
      // and it also carries the Clinging Murk / Contaminate healer cost.
      rule: { type: "raidDamage", dps: 3.2 },
      good: "Nothing to execute \u2014 kill the bosses before the stacks kill you.",
      failText: ""
    },
    {
      id: "stasis",
      name: "Vitriolic Stasis",
      spellId: 1284606,
      from: "breath",
      // Breath's channel; 1284588 is Blood's
      roles: ["tank", "dps", "healer"],
      telegraphMs: 2500,
      origin: "boss",
      // "Bad: Not a player failure — a phase marker. The finding is the health
      // delta between bosses at cast start." Nothing to dodge, so raidDamage —
      // but it is the trigger for the mechanic that actually ends pulls.
      rule: { type: "raidDamage", dps: 2.4 },
      spawns: { defId: "helical" },
      good: "Both enter at near-identical health, so the heal-up is negligible.",
      failText: ""
    },
    {
      id: "helical",
      name: "Helical Toxins",
      spellId: 1284590,
      from: "breath",
      roles: ["tank", "dps", "healer"],
      // The real debuff runs 28s; compressed here to a 10s window because the
      // decision — find your group and combine — is made in the first seconds
      // and a 28s telegraph would just be dead air.
      telegraphMs: 1e4,
      shape: { kind: "circle", radius: 9 },
      origin: "random",
      // seeded at the Stasis channel by `spawns`
      // "colliding with another infected player combines applications, and
      // exactly four neutralises it" — so being OUT of the group is the failure.
      rule: { type: "beInside" },
      soakers: 4,
      // exactly four, per the file
      good: "Assigned groups pair to exactly four and neutralise before expiry.",
      failText: "Never reached four Helical Toxins \u2014 Cultivated Burst"
    },
    {
      id: "protovenom",
      name: "Protovenom Eruption",
      spellId: 1296962,
      from: "breath",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 3e3,
      // "damage in 10yd plus knockback". Modelled as ground to avoid, because no
      // Rule scores player-to-player proximity — the real mechanic is a
      // contaminated player touching a clean one, the inverse of Helical Toxins.
      shape: { kind: "circle", radius: 10 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.38,
      good: "Contaminated players clear out and stay off clean bodies until it drops.",
      failText: "Caught in a Protovenom Eruption"
    },
    // ──────────────────────── Breath of Ula'tek ────────────────────────
    {
      id: "slam",
      name: "Empowering Slam",
      spellId: 1284458,
      from: "breath",
      roles: ["tank"],
      telegraphMs: 1500,
      origin: "boss",
      // "stacking ~15% increased Physical damage per consecutive hit on the same
      // target" — the Breath swap driver, and the one this trainer scores.
      rule: { type: "tankSwap", maxStacks: 4 },
      good: "Breath tanks swap on the agreed stack count so the buff resets.",
      failText: "Held Empowering Slam too long \u2014 taunt the swap sooner"
    },
    {
      id: "droplets",
      name: "Toxic Droplets",
      spellId: 1284434,
      from: "breath",
      roles: ["tank", "dps", "healer"],
      // "1284434 scatters droplets; each erupts into Noxious Blast after 16s.
      // STEPPING ON A DROPLET DEFUSES IT."
      //
      // This was an `avoid` circle that scored you for standing in one — the
      // exact inverse of the mechanic, and the same defect Caustic Globule had.
      // Sweeping droplets is the assigned job; the failure is a droplet nobody
      // reached, and the tactic file is explicit that the eruption is 300yd
      // raid-wide so "a per-player hit leaderboard would name the whole raid".
      telegraphMs: 16e3,
      // "each erupts ... after 16s"
      shape: { kind: "circle", radius: 3 },
      origin: "random",
      rule: { type: "collect", count: 4 },
      // The eruption itself is Noxious Blast (1284452 / 1284451), 300yd
      // raid-wide. It is not a separate mechanic here because the tactic file
      // attributes it precisely: "each 1284452 event is one uncleared droplet".
      good: "Assigned clearers sweep every droplet inside 16s, so Noxious Blast never fires.",
      failText: "A droplet went unswept \u2014 Noxious Blast erupted on the raid"
    },
    {
      id: "livingvenom",
      name: "Living Venom",
      spellId: 1284207,
      from: "breath",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 4e3,
      // "returns to the golem after 4s"
      // The return path, drawn as a line out of the golem. Boss-origin lines
      // track the boss's facing until they fire, so where the tank stands
      // decides which slice of the room the slime sweeps.
      shape: { kind: "line", length: 46, width: 8 },
      origin: "boss",
      rule: { type: "avoid" },
      damage: 0.34,
      good: "Everyone reads the return line and steps out of it.",
      failText: "Clipped by the Living Venom return path"
    },
    {
      id: "coagulation",
      name: "Venom Coagulation",
      spellId: 1284251,
      from: "breath",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 5e3,
      shape: { kind: "circle", radius: 10 },
      origin: "random",
      // "The raid hard-swaps on spawn" — the slime pulses raid-wide Contaminate
      // until it dies and it CANNOT be kicked, so kill speed is the only lever.
      // Being off the add when the swap window closes is the failure.
      rule: { type: "beInside" },
      soakers: 8,
      good: "The raid hard-swaps on spawn; casts per spawn stay low.",
      failText: "Never swapped to the Venom Coagulation slime"
    },
    // ───────────────────────── Blood of Ula'tek ─────────────────────────
    {
      id: "blighted",
      name: "Blighted Blood",
      spellId: 1284471,
      from: "blood",
      roles: ["healer"],
      telegraphMs: 6e3,
      shape: { kind: "circle", radius: 5 },
      origin: "random",
      // The fight's ONLY dispel — Shadow DoT, 18s, dispel type Magic, 14 real
      // removals in the log. Left to run full duration it drops a pool.
      rule: { type: "press", ability: "dispel", withinMs: 6e3 },
      damage: 0.18,
      good: "Assigned dispellers clear it fast; the infected player drifts to a dump spot while waiting.",
      failText: "Blighted Blood expired undispelled"
    },
    {
      id: "bloodvenom",
      name: "Blood Venom",
      spellId: 1284208,
      from: "blood",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1e4,
      shape: { kind: "circle", radius: 8 },
      origin: "targeted",
      // "on expiry it drops a toxic pool at their feet, larger with stacked
      // applications" — and it is NOT dispellable (wowhead: n/a), so nobody is
      // assigned to it. Walking it out is the whole job.
      rule: { type: "carryOut", minDistance: 24 },
      // No `spawns` for the pool: its damage ID is still 0 in abilities.json and
      // this file invents nothing.
      good: "Infected players walk pools to the dump area before expiry. The middle stays clean.",
      failText: "Dropped Blood Venom on the raid"
    },
    {
      id: "miasma",
      name: "Unstable Miasma",
      spellId: 1288282,
      lethal: true,
      from: "blood",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 8e3,
      // "after ~8s it erupts"
      shape: { kind: "circle", radius: 7.5 },
      // "7.5yd" per wowhead
      origin: "random",
      // "damage split among everyone inside" — taking the hit is CORRECT for
      // soakers; the failure is too few distinct bodies in the split.
      rule: { type: "beInside" },
      soakers: 5,
      good: "The soak group stacks tight before the timer so the split is survivable.",
      failText: "Missed the Unstable Miasma soak \u2014 the split was too thin"
    }
  ]
};

// src/bosses/vashnik.ts
var vashnik = {
  key: "vashnik",
  name: "Vashnik the Malformed",
  realName: "Vashnik the Malignant",
  blurb: "Nothing here is kickable. A living venom that reaches the Cavity is what actually wipes raids.",
  // Measured from PTR combat logs, not guessed: Circle (CV 12.1%). A corridor at 120-180 deg reaches ~105yd and is excluded.
  // 1 yard = 100 coordinate units.
  arenaRadius: 58,
  // Two different lessons. The Shrouded Venom's absorb is worth 100% of its max
  // health, so damage does literally nothing until it breaks. The Clotting Venom
  // is immune to Disarm, Disorient, Fear, Slow, Root and Stun — "cannot be kited
  // or CC'd, only killed" — and splits on death, each split still walking for
  // the Malignant Cavity.
  addEverySec: 28,
  maxAdds: 6,
  adds: [
    {
      id: "shrouded",
      name: "Shrouded Venom",
      npcId: 0,
      spellId: 1312366,
      job: "kill",
      count: 1,
      hp: 8,
      shieldHp: 8,
      fuseSec: 16,
      spawnRadius: 30,
      good: "Break Miasmic Coating first \u2014 until it drops, the add takes no damage at all.",
      onLeak: "burst",
      failText: "A Shrouded Venom reached the Malignant Cavity \u2014 Malignant Burst"
    },
    {
      id: "clotting",
      name: "Clotting Venom",
      npcId: 259408,
      spellId: 1286631,
      job: "kill",
      count: 2,
      hp: 7,
      fuseSec: 14,
      spawnRadius: 32,
      good: "Kill them before they reach the Cavity \u2014 they cannot be slowed, rooted or feared.",
      onLeak: "burst",
      failText: "A Clotting Venom reached the Malignant Cavity \u2014 Malignant Burst"
    }
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,
  // Imbibe at 100 energy — roughly every 45s
  atFullEnergy: "imbibe",
  ambient: ["vapor", "burst"],
  pullLengthSec: 150,
  // "No phases — one loop driven by Imbibe." Between drinks the raid alternates
  // between running OUT (venom kill squads at the edge, bile lanes, froth
  // spreads) and collapsing back IN through waves, drains and trails.
  loop: [
    "fangs",
    "trail",
    "clotting",
    "froth",
    "siphon",
    "fangs",
    "bile",
    "trail",
    "exploding",
    "congealing",
    "froth",
    "fangs",
    "siphon",
    "bile",
    "trail",
    "froth",
    "exploding",
    "clotting"
  ],
  mechanics: [
    {
      id: "burst",
      name: "Malignant Burst",
      spellId: 1280189,
      roles: ["healer"],
      telegraphMs: 0,
      origin: "boss",
      // 300 YARD RAID-WIDE, and not a soak. It was a 10-yard `beInside` circle
      // with four soakers, which asked the raid to stand in a burst that hits
      // everyone on the map regardless.
      //
      // "A venom reaching the Cavity casts 1280189 ... Bad: a Malignant Burst
      // CAST — one cast is one venom leaked. Count casts, not just deaths."
      // So the failure belongs to the venom nobody killed, which is exactly
      // where it now sits: the Clotting and Shrouded Venom adds fire this
      // through `onLeak` when they reach the Cavity.
      rule: { type: "raidDamage", dps: 1.6 },
      good: "Every venom dies en route \u2014 one Malignant Burst cast is one venom leaked.",
      failText: ""
    },
    {
      id: "fangs",
      name: "Dripping Fangs",
      spellId: 1280934,
      roles: ["tank"],
      telegraphMs: 1800,
      origin: "boss",
      // "Bad: Two consecutive 1280934 applications on the same player with no
      // swap" — so the ceiling is two, not a comfortable stack count.
      rule: { type: "tankSwap", maxStacks: 2 },
      good: "Tanks swap on every application; the gap between casts is the repositioning window for the next Imbibe.",
      failText: "Held Dripping Fangs through a second application"
    },
    {
      id: "froth",
      name: "Plague Froth",
      spellId: 1281925,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 6e3,
      // "ticking ... for 6s"
      shape: { kind: "circle", radius: 4.5 },
      // "a 4.5yd radius"
      origin: "targeted",
      // Carriers "break to assigned spots past 4.5yd of everyone" — the bubble
      // is small but the drop spot is not, because the waves come next.
      rule: { type: "carryOut", minDistance: 20 },
      spawns: { defId: "wave" },
      good: "Carriers break to assigned spots past 4.5yd of everyone, oriented so all four waves sweep empty floor.",
      failText: "Held Plague Froth inside the raid"
    },
    {
      id: "wave",
      name: "Plague Wave",
      spellId: 1295798,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1200,
      // erupts the instant the Froth expires
      // Four cardinal waves in the real fight; the engine spawns one line per
      // Froth, angled off the carrier, which is the same lesson at lower volume.
      shape: { kind: "line", length: 84, width: 8 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.45,
      // "roughly ten times the damage" of Froth
      good: "Carriers break to assigned spots past 4.5yd of everyone, oriented so all four waves sweep empty floor.",
      failText: "Clipped by a Plague Wave"
    },
    {
      id: "bile",
      name: "Catalytic Bile",
      spellId: 1282602,
      lethal: true,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 5e3,
      // "A 5s cast forms an orb"
      shape: { kind: "circle", radius: 6 },
      // "hits only that player in 6yd"
      // The biles fly outward from the Cavity, so the lanes are at the edge.
      origin: "edge",
      // "1 target cap" — this is a one-body interception, not a stack soak. The
      // assigner fills soakers-1 slots with allies, so at 1 the lane is yours.
      rule: { type: "beInside" },
      soakers: 1,
      good: "Assigned soakers are in their lanes before the cast finishes, defensive up, and every projectile is eaten.",
      failText: "Missed your bile lane \u2014 it reached the Cavity"
    },
    {
      id: "exploding",
      name: "Exploding Infection",
      spellId: 1295173,
      roles: ["tank", "dps", "healer"],
      // Duration is not stated in the tactic file; 8s is a playable window for
      // the walk out and back. NOT a dispel — see the header note.
      telegraphMs: 8e3,
      shape: { kind: "circle", radius: 10 },
      origin: "targeted",
      rule: { type: "carryOut", minDistance: 20 },
      good: "Carriers move on the telegraph, not on the debuff; healers pre-shield the absorb rather than out-healing it.",
      failText: "Detonated Exploding Infection on the raid"
    },
    {
      id: "siphon",
      name: "Siphon Blood",
      spellId: 1295229,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 3e3,
      shape: { kind: "circle", radius: 10 },
      // "drains anyone within 10yd"
      // Anchored on a Siphoning Infection carrier out in the raid, not on you —
      // the failure the .md scores is "1295229 on a non-carrier of 1295224".
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.18,
      // per second while stood in the drain
      lingerMs: 8e3,
      good: "Carriers move on the telegraph, not on the debuff; healers pre-shield the absorb rather than out-healing it.",
      failText: "Stood inside a Siphoning carrier"
    },
    {
      id: "trail",
      name: "Deadly Venom",
      spellId: 1297338,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1,
      // spawned already active
      shape: { kind: "circle", radius: 5 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.14,
      // "reapplied every 1.2s while you stand in the trail"
      lingerMs: 2e4,
      good: "Nobody parks in either.",
      failText: "Parked in a venom trail"
    },
    {
      id: "clotting",
      name: "Clotting Blood",
      spellId: 1302517,
      roles: ["healer"],
      telegraphMs: 4e3,
      shape: { kind: "circle", radius: 3 },
      origin: "random",
      // One of the fight's only two real dispels: Magic, and genuinely dispelled
      // 126 times across 332 applications in the log corpus.
      rule: { type: "press", ability: "dispel", withinMs: 5e3 },
      damage: 0.16,
      // the healing absorb, left to be eaten
      // Clotting Blood comes off the Clotting Venom, so it inherits the venom
      // clause of the Malignant Burst block's Good line.
      good: "Every venom dies en route. Clotting Venom is CC-immune and splits.",
      failText: "Left Clotting Blood up \u2014 absorb never cleansed"
    },
    {
      id: "congealing",
      name: "Congealing Bolt",
      spellId: 1305833,
      roles: ["healer"],
      telegraphMs: 5e3,
      // "5s Shadow hit plus a movement snare"
      shape: { kind: "circle", radius: 3 },
      origin: "random",
      // The second real dispel: Magic, 58 dispels across 300 applications. The
      // .md wants holds cross-referenced against Plague Wave damage on the same
      // player — the snare is what leaves them standing in a wave lane.
      rule: { type: "press", ability: "dispel", withinMs: 6e3 },
      damage: 0.18,
      good: "Every venom dies en route. Shrouded Venom carries a full-health absorb and fires Umbral Ejection within 3yd on death.",
      failText: "Left the Congealing Bolt snare up through a wave"
    },
    {
      id: "imbibe",
      name: "Imbibe",
      spellId: 1284663,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 4e3,
      // "4s cast draining two of three fountains"
      origin: "boss",
      // Each drink fires two Expulsions, and every one of them is flagged
      // unavoidable raid-wide healer damage in abilities.json — there is no
      // dodge, so this can never read as a per-player failure. What it leaves
      // behind is the venom it drags out, hence the trail.
      rule: { type: "raidDamage", dps: 6 },
      spawns: { defId: "trail" },
      good: "The tank parks the boss on a mark so the planned pair drains every cycle.",
      failText: ""
    },
    {
      id: "vapor",
      name: "Toxic Vapor",
      spellId: 1284561,
      roles: ["healer"],
      telegraphMs: 0,
      origin: "boss",
      // The soft enrage: one permanent stack per Imbibe, ticking on the whole
      // raid at 300yd. The .md could not be blunter — "Deaths on 1284561 are
      // kill-speed, never player failure" — so it is ambient attrition only.
      rule: { type: "raidDamage", dps: 2.4 },
      // Toxic Vapor is documented inside the Imbibe block, so it takes that
      // block's Good line: the answer to the stacks is a clean fountain loop.
      good: "The tank parks the boss on a mark so the planned pair drains every cycle.",
      failText: ""
    }
  ]
};

// src/bosses/explorers.ts
var explorers = {
  key: "explorers",
  name: "The Lost Subagents",
  realName: "The Lost Explorers",
  blurb: "A three-body council with one real kick. Blast Wave took more killing blows than any other ability in the fight.",
  // Measured from PTR combat logs, not guessed: Circle, high confidence (CV 6.9%, corner/axis 0.94). 138,505 samples over 46 pulls.
  // 1 yard = 100 coordinate units.
  arenaRadius: 50,
  // Relic Rupture took 6 killing blows and hit 20 players on the Mythic PTR
  // sample. Deaths here are a crate-cleave failure, not a positioning one — the
  // junk piles up and has to be cleared.
  addEverySec: 24,
  maxAdds: 7,
  adds: [
    {
      id: "junk",
      name: "Useless Junk",
      npcId: 272110,
      spellId: 1310027,
      job: "kill",
      count: 2,
      hp: 5,
      fuseSec: 19,
      spawnRadius: 24,
      good: "Cleave the crates down before they rupture.",
      failText: "Relic Rupture \u2014 a crate was left standing"
    }
  ],
  entities: [
    { id: "iku", name: "Scrollsage Iku", npcId: 261843, start: { x: 0, y: -26 }, tankedApart: true },
    { id: "nama", name: "First Mate Nama", npcId: 261835, start: { x: -22.5, y: 13 }, tankedApart: true },
    { id: "gebbo", name: "Trader Gebbo", npcId: 261848, start: { x: 22.5, y: 13 } },
    // Outside the health pool: 0 damage taken across 10,001 player damage events
    // in a Mythic PTR log, while casting Malevolent Presence 1,911 times.
    { id: "morzahi", name: "Mor'zahi", npcId: 261584, start: { x: 0, y: 34 }, untargetable: true }
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,
  // ~45s between Blast Waves
  atFullEnergy: "blastwave",
  ambient: ["presence"],
  pullLengthSec: 150,
  // Three bosses casting at once, so the loop never gives you a clean beat.
  // It pulls in both directions on purpose: Mighty Thud drags you into a
  // stack, Explosive Surprise and Splinters push you out of it, and Blast Wave
  // then demands you be somewhere else again.
  loop: [
    "eyes",
    "flames",
    "patches",
    "shards",
    "eyes",
    "thud",
    "shellspin",
    "flames",
    "eyes",
    "bomb",
    "shards",
    "patches",
    "eyes",
    "splinters",
    "flames",
    "shellspin",
    "eyes",
    "thud"
  ],
  mechanics: [
    {
      id: "united",
      name: "United Defense",
      spellId: 1297646,
      from: "nama",
      roles: ["tank"],
      telegraphMs: 0,
      origin: "boss",
      // "United Defense gives all three 99% damage reduction while they are
      // within 30 yds of each other, so they stay parked apart all night."
      //
      // This file used to record it as "a boss buff on a three-body council,
      // invisible to player events and unmodellable in a single-target
      // trainer". The trainer has four entities on this fight now, and
      // keepApart measures every pair — so parking two explorers together
      // costs 99% of your damage, which is what the buff does.
      rule: { type: "keepApart", minYards: 30 },
      good: "The three stay parked apart all pull and never link.",
      failText: "Two explorers linked \u2014 United Defense, 99% damage reduction"
    },
    {
      id: "flames",
      name: "Icebound Flames",
      spellId: 1286922,
      from: "iku",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 4e3,
      // "4s cast on one player"
      // The only kickable cast in the fight, so it gets a shape purely so the
      // telegraph is visible — the renderer skips shapeless instances, and a
      // kick you cannot see is a kick you cannot practise.
      shape: { kind: "circle", radius: 7 },
      origin: "boss",
      rule: { type: "press", ability: "interrupt", withinMs: 4e3 },
      damage: 0.26,
      // Frostfire hit plus a 12s DoT
      good: "Kicked every time \u2014 46 kicks against 5 completions on Mythic PTR.",
      failText: "Missed the kick \u2014 Icebound Flames landed the snare"
    },
    {
      id: "patches",
      name: "Fire Patch",
      spellId: 1297649,
      from: "iku",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 2500,
      shape: { kind: "circle", radius: 7 },
      // Left where the Frostfire Volley missiles landed. Frost Patch (1297648)
      // and Spreading Flames (1297650) are the same rule on the same section of
      // the tactic file, so they are one entry rather than three identical ones.
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.15,
      // per second while stood in it
      lingerMs: 25e3,
      good: "Dropped at the arena edge and never re-entered.",
      failText: "Stood in a Frostfire patch"
    },
    {
      id: "eyes",
      name: "Evil Eyes",
      spellId: 1292764,
      from: "iku",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 2e3,
      // "hitting within 3 yds" — small, but the most-cast ability in the fight
      // (x700 Mythic), and the statues project it at player locations. It is the
      // constant movement tax that stops you parking anywhere.
      shape: { kind: "circle", radius: 3 },
      origin: "player",
      rule: { type: "avoid" },
      damage: 0.3,
      good: "Constant small repositioning as the floor shrinks.",
      failText: "Stood in an Evil Eyes impact"
    },
    {
      id: "shellspin",
      name: "Shell Spin",
      spellId: 1291918,
      from: "nama",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 3e3,
      shape: { kind: "cone", radius: 30, arcDeg: 70 },
      origin: "boss",
      // The file is explicit that this is everyone's problem, not the tank's:
      // "Any applydebuff of 1291918 on any player, tanks included — a 4s stun in
      // a Blast Wave window is a death." So it is an avoid, not a faceAway.
      rule: { type: "avoid" },
      damage: 0.36,
      good: "Nobody but the Nama tank is in the frontal, and the tank sidesteps the shells.",
      failText: "Clipped by Shell Spin \u2014 stunned for 4s"
    },
    {
      id: "shards",
      name: "Shredding Shards",
      spellId: 1295858,
      from: "iku",
      roles: ["tank"],
      telegraphMs: 1500,
      origin: "boss",
      // "shards every 0.5s for 4s, each stack adding +50% damage taken from it"
      // — 1295858 is named in the file as the ID that drives the Iku tank swap.
      rule: { type: "tankSwap", maxStacks: 5 },
      good: "Only tanks in the damage rows; the Iku tank taunts off at the agreed count.",
      failText: "Held Shredding Shards past the swap count"
    },
    {
      id: "thud",
      name: "Mighty Thud",
      spellId: 1300237,
      lethal: true,
      from: "nama",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 4e3,
      shape: { kind: "circle", radius: 8 },
      origin: "random",
      // "impact damage splits among everyone in the landing zone" — a soak, so
      // being OUT of the marker is the failure.
      rule: { type: "beInside" },
      // No source states a required count; the file only says deaths mean "too
      // few bodies in the marker", so 5 is a placeholder to confirm with the RL.
      soakers: 5,
      spawns: { defId: "aftershock" },
      good: "The soak group stacks into each marker and clears the crater the instant it resolves.",
      failText: "Missed the Mighty Thud soak \u2014 the hit was not split"
    },
    {
      id: "aftershock",
      name: "Aftershock",
      spellId: 1310500,
      from: "nama",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1,
      // the crater is there the moment the leap lands
      shape: { kind: "circle", radius: 8 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.12,
      // per second — "10 dps Heroic"
      lingerMs: 14e3,
      // Same section of the tactic file as Mighty Thud, so it shares its Good
      // line: the soak and the clear-out are one habit, not two.
      good: "The soak group stacks into each marker and clears the crater the instant it resolves.",
      failText: "Stood in the Aftershock crater"
    },
    {
      id: "splinters",
      name: "Splinters",
      spellId: 1308853,
      lethal: true,
      from: "gebbo",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 8e3,
      // "stacking Physical bleed, 8s"
      shape: { kind: "circle", radius: 6 },
      origin: "targeted",
      // NO DISPEL ON THIS BOSS. The tactic file is emphatic: Splinters is a
      // bleed with no dispel type, the log removals were Cauterizing Flame, and
      // "there is no dispel assignment on this boss". RaidLens shipped a phantom
      // dispel section for exactly this debuff once; it does not come back here.
      rule: { type: "carryOut", minDistance: 18 },
      good: "Nobody under a crate, nobody clips one, and cleave kills every crate before it ruptures.",
      failText: "Kept Splinters in the raid"
    },
    {
      id: "bomb",
      name: "Explosive Surprise",
      spellId: 1296245,
      lethal: true,
      from: "gebbo",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1e4,
      // "10s bomb-carrier marker"
      shape: { kind: "circle", radius: 10 },
      // "10 yd Physical hit"
      origin: "targeted",
      rule: { type: "carryOut", minDistance: 22 },
      spawns: { defId: "concussive" },
      good: "The carrier runs it clear and everyone in the wave's path is airborne on a mushroom when it passes.",
      failText: "Dropped Explosive Surprise on the raid"
    },
    {
      id: "concussive",
      name: "Concussive Blast",
      spellId: 1299947,
      from: "gebbo",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1,
      shape: { kind: "circle", radius: 10 },
      origin: "random",
      // spawned at the bomb's drop point
      rule: { type: "avoid" },
      damage: 0.14,
      // per second — "12s Fire DoT", not a knockback
      lingerMs: 12e3,
      good: "The carrier runs it clear and everyone in the wave's path is airborne on a mushroom when it passes.",
      failText: "Stood in the Concussive Blast fire"
    },
    {
      id: "blastwave",
      name: "Blast Wave",
      spellId: 1305844,
      lethal: true,
      from: "gebbo",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 4500,
      // The deadliest ID in the fight. A ground-level fire wave rolling out from
      // the council: the open floor is the danger and the shape says so. See the
      // header note on why the mushroom answer is not expressible.
      shape: { kind: "annulus", inner: 16, outer: 60 },
      origin: "boss",
      rule: { type: "avoid" },
      damage: 0.5,
      good: "The carrier runs it clear and everyone in the wave's path is airborne on a mushroom when it passes.",
      failText: "Caught on the ground by Blast Wave"
    },
    {
      id: "presence",
      name: "Malevolent Presence",
      spellId: 1295450,
      from: "morzahi",
      roles: ["healer"],
      telegraphMs: 0,
      origin: "boss",
      // "Neither is ever a player failure — Malevolent Presence took 8 killing
      // blows, so read it as the finisher on other mistakes." Unavoidable
      // raid-wide Shadow every 2s all fight: raidDamage, never a failure row.
      rule: { type: "raidDamage", dps: 3 },
      good: "Healers stay ahead of the baseline and hold cooldowns for each fish window.",
      failText: ""
    }
  ]
};

// src/bosses/sszorak.ts
var sszorak = {
  key: "sszorak",
  name: "Ssztream, Herald of the Six Winds",
  realName: "Sszorak",
  blurb: "No adds, nothing to kick. Falling off the platform is what actually kills raids here.",
  // Measured from PTR combat logs, not guessed: Circle (CV 10.4%). Side spurs at 70/160/170 deg reach ~90yd and are excluded.
  // 1 yard = 100 coordinate units.
  arenaRadius: 56,
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,
  // ~45s to the Maelstrom window
  atFullEnergy: "digin",
  ambient: ["presence"],
  pullLengthSec: 150,
  // Loop taken from the file's overview: "venom and cone pressure, a Raging
  // Crosswinds spread, then a Howling Maelstrom."
  loop: [
    "corroding",
    "claws",
    "ravage",
    "corroding",
    "tempest",
    "mutilate",
    "corroding",
    "surge",
    "claws",
    "corroding",
    "crosswinds",
    "ravage",
    "corroding",
    "tempest",
    "claws",
    "corroding",
    "mutilate",
    "crosswinds"
  ],
  mechanics: [
    {
      id: "ravage",
      name: "Ravage",
      spellId: 1277101,
      roles: ["tank"],
      telegraphMs: 3e3,
      // "3s Physical frontal cone"
      shape: { kind: "cone", radius: 30, arcDeg: 80 },
      origin: "boss",
      rule: { type: "faceAway" },
      damage: 0.52,
      good: "Boss faced away, only the active tank in the cone, tanks swapping before the stack turns lethal.",
      failText: "Ravage swept the raid \u2014 facing failure"
    },
    {
      id: "mutilate",
      name: "Mutilate",
      spellId: 1277031,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 2600,
      shape: { kind: "cone", radius: 26, arcDeg: 60 },
      origin: "boss",
      // "damage is split evenly among everyone struck ... a shared soak, not a
      // tank-only cone" — so the player is told to get INTO it.
      //
      // But the tactic file's Bad line is explicit that it is measured per cast
      // rather than per player: "Not a per-player failure — track soak count
      // per cast". So missing it costs the raid and is never put against your
      // name. This is the same mechanic the analyser once blamed the raid for
      // soaking correctly, and it is not going to happen twice.
      rule: { type: "beInside" },
      collective: true,
      // No source states a required soak count — Sszorak.md says outright
      // "confirm it with the raid leader" — so 4 is a placeholder.
      soakers: 4,
      good: "Enough bodies in the cone to divide the hit, with healers covering the DoTs.",
      failText: "Missed the Mutilate soak \u2014 the hit was not split"
    },
    {
      id: "tempest",
      name: "Tempest",
      spellId: 1287083,
      roles: ["healer"],
      telegraphMs: 5e3,
      shape: { kind: "circle", radius: 5 },
      origin: "random",
      driftSpeed: 4,
      // "vortices spiral the arena"
      // "the fight's one real dispel — Poison, 76 removals by genuine healer
      // dispels". The slow is the lethal part because it strands you in wind.
      rule: { type: "press", ability: "dispel", withinMs: 6e3 },
      damage: 0.18,
      lingerMs: 6e3,
      good: "Nobody touches a vortex, and anyone who does is dispelled before the next knock.",
      failText: "Tempest slow never dispelled \u2014 stranded in the wind"
    },
    {
      id: "claws",
      name: "Caustic Claws",
      spellId: 1305998,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 2200,
      shape: { kind: "circle", radius: 6 },
      // "6yd radius"
      // Stays a floor AoE rather than a player-targeted drop. Centring it on the
      // player left no direction to run and killed even a good player instantly,
      // and Venomous Surge already covers "the thing that lands on you".
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.34,
      spawns: { defId: "residue" },
      good: "Move out of the impact, note where pools land, re-stack on clean floor.",
      failText: "Stood in Caustic Claws"
    },
    {
      id: "residue",
      name: "Caustic Residue",
      spellId: 1296667,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1,
      // spawned already active
      shape: { kind: "circle", radius: 6 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.16,
      // per second while stood in it
      lingerMs: 34e3,
      // "the most-applied debuff on PTR (838x), and its amp is the upstream
      // cause of most of the death report."
      good: "Leave the acid pools alone and re-stack on clean floor.",
      failText: "Stood in Caustic Residue \u2014 +30% damage taken from everything"
    },
    {
      id: "surge",
      name: "Venomous Surge",
      spellId: 1306120,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1e4,
      // "Players are drenched for 10s"
      shape: { kind: "circle", radius: 8 },
      origin: "targeted",
      rule: { type: "carryOut", minDistance: 22 },
      spawns: { defId: "cyst" },
      good: "Carriers run out, drop the cyst clear of the raid path and the next wind, then return.",
      failText: "Dropped the Surge on the raid"
    },
    {
      id: "cyst",
      name: "Viscous Cyst",
      spellId: 1287205,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1,
      shape: { kind: "circle", radius: 4 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.32,
      lingerMs: 4e4,
      popsOnContact: true,
      // "pops on contact" — one hit, then gone
      good: "Cysts are left alone to expire.",
      failText: "Popped a Viscous Cyst \u2014 30% slow in the wind"
    },
    {
      id: "crosswinds",
      name: "Raging Crosswinds",
      spellId: 1285616,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 8e3,
      // "An 8s wind debuff that explodes on expiry"
      shape: { kind: "circle", radius: 10 },
      origin: "player",
      rule: { type: "survive" },
      knockbackYards: 16,
      good: "Carriers spread clear and stand so the knock throws them across the platform.",
      failText: "Blown into the abyss by Crosswinds"
    },
    {
      id: "digin",
      name: "Dig In",
      spellId: 1286033,
      roles: ["tank", "dps"],
      telegraphMs: 1500,
      origin: "boss",
      // "The fight's only burn window — Sszorak is immovable and takes +30%
      // damage for 25s during Howling Maelstrom." It was missing entirely, so
      // the one moment the fight asks you to commit cooldowns passed unmarked.
      rule: { type: "burnWindow", multiplier: 1.3, durationMs: 25e3 },
      good: "Every cooldown goes in while he is planted and taking +30%.",
      failText: "Dig In came and went without a cooldown"
    },
    {
      id: "corroding",
      name: "Corroding Venom",
      spellId: 1282873,
      roles: ["tank"],
      telegraphMs: 1500,
      origin: "boss",
      // "Each melee landing stacks a 12s debuff adding +3% Physical damage
      // taken." One of the fight's two swap drivers.
      rule: { type: "tankSwap", maxStacks: 5 },
      good: "Tanks swap on an agreed stack count and stacks drop off the off-tank between swaps.",
      failText: "Held Corroding Venom too long \u2014 taunt the swap sooner"
    },
    {
      id: "presence",
      name: "Ula'tek's Presence",
      spellId: 1285965,
      roles: ["healer"],
      telegraphMs: 0,
      origin: "boss",
      // The file is explicit: "Bad: Nothing — a healing check, not a mechanic."
      // raidDamage never produces a per-player failure.
      rule: { type: "raidDamage", dps: 3.2 },
      good: "Healing cooldowns staggered so raid HP never dips into tick-kill range.",
      failText: ""
    }
  ]
};

// src/bosses/twinfangs.ts
var twinfangs = {
  key: "twinfangs",
  name: "The Twin Prompts",
  realName: "The Twin Fangs",
  blurb: "Nothing to kick, nothing to dispel. Venom never washes off \u2014 the soaks are the only relief.",
  // Measured from PTR combat logs, not guessed: Rounded/octagonal, low confidence (corner/axis 1.19). Much the smallest floor in the raid.
  // 1 yard = 100 coordinate units.
  arenaRadius: 32,
  // "A permanent channel pulsing the raid every 4s and gaining +15% of its own
  // damage per pulse — a soft enrage with no interrupt, so kill the add."
  // 12 killing blows on Heroic PTR. There is nothing to kick on this boss.
  addEverySec: 30,
  maxAdds: 3,
  adds: [
    {
      id: "mass",
      name: "Bloodcurdled Mass",
      npcId: 268668,
      spellId: 1302695,
      job: "kill",
      count: 1,
      hp: 9,
      fuseSec: 26,
      auraDps: 0.5,
      lethal: true,
      spawnRadius: 28,
      good: "Kill it fast \u2014 Bloody Expulsion cannot be interrupted and grows every pulse.",
      failText: "Bloodcurdled Mass channelled Bloody Expulsion to the end"
    }
  ],
  entities: [
    { id: "vexhul", name: "Vexhul", npcId: 257361, start: { x: -19, y: 0 }, tankedApart: true },
    { id: "ithraz", name: "Ithraz", npcId: 257368, start: { x: 19, y: 0 }, tankedApart: true }
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,
  // ~45s to the Vile Flood window, so three per pull
  atFullEnergy: "flood",
  ambient: ["venom"],
  pullLengthSec: 150,
  // Two symmetric halves of 72s. Envenomed on every third slot is the swap
  // metronome; Stone Breaker lands once a half, matching the file's "roughly
  // once a minute". Each half forces movement inward (globule, feast, the
  // pre-knock huddle) and outward (Coiling Ichor) rather than only outward.
  loop: [
    "envenomed",
    "deluge",
    "globule",
    "envenomed",
    "ichor",
    "storm",
    "envenomed",
    "stonebreaker",
    "depths",
    "envenomed",
    "feast",
    "spit",
    "envenomed",
    "deluge",
    "globule",
    "envenomed",
    "storm",
    "ichor",
    "envenomed",
    "stonebreaker",
    "depths",
    "envenomed",
    "feast",
    "spit"
  ],
  mechanics: [
    {
      id: "uncoiled",
      name: "Uncoiled Wrath",
      spellId: 1308583,
      from: "ithraz",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 0,
      origin: "boss",
      // The entities do not share a health pool, so leaving one far behind is
      // the failure this rule scores. Judged continuously from the moment the
      // first one dies.
      rule: { type: "syncKill", withinSec: 12 },
      good: "Both serpents die within seconds of each other.",
      failText: "Killed one serpent far ahead of the other \u2014 Uncoiled Wrath"
    },
    {
      id: "venom",
      name: "Eternal Venom",
      spellId: 1290480,
      from: "vexhul",
      roles: ["healer"],
      telegraphMs: 0,
      origin: "boss",
      // 1290480 is the periodic tick — "scaling with stack count, 24% of all raid
      // damage taken and a direct proxy for how badly the venom economy is
      // losing". The stack counter itself (1290336) and its 9-stack execution
      // (1292348) are not modellable here, and trying would invent per-player
      // failures out of a raid-wide resource. raidDamage never scores anyone.
      rule: { type: "raidDamage", dps: 3.4 },
      good: "Adds die fast, high-stack players take the earliest Feast bite, low-stack players soak globules.",
      failText: ""
    },
    {
      id: "deluge",
      name: "Caustic Deluge",
      spellId: 1289994,
      from: "vexhul",
      roles: ["tank", "dps", "healer"],
      // "1s cast into a 5s tank channel, ejecting three 4-yard splashes" — the
      // splash is the avoidable half, so the telegraph is the eject, not the cast.
      telegraphMs: 2500,
      shape: { kind: "circle", radius: 5 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.34,
      // "every splash applies Eternal Venom and leaves a Caustic Globule" — the
      // globule soak chain starts here, which is why deluge always precedes it
      // in the loop.
      spawns: { defId: "globule" },
      good: "Tank aims away; everyone stays 4+ yards off the splash landings.",
      failText: "Stood in a Caustic Deluge splash"
    },
    {
      id: "globule",
      name: "Caustic Globule",
      spellId: 1290338,
      lethal: true,
      from: "vexhul",
      // Tanks are welded to their serpent; the file names "low-stack players" as
      // the soakers, and the engine's ally AI never sends a tank to a soak.
      roles: ["dps", "healer"],
      telegraphMs: 1e4,
      // "ruptures after 10s"
      shape: { kind: "circle", radius: 2.6 },
      origin: "random",
      // "Each splash leaves a globule that ruptures after 10s onto the whole
      // raid, unless one player walks in first and eats it alone." That is a
      // pickup, not a stand-in-it soak: several small globs scattered on the
      // floor, each cleared by one player running over it.
      //
      // It was modelled as a single 6-yard `beInside` circle, which drew as one
      // big shape and read as ground to avoid — teaching the exact opposite of
      // the mechanic. Eating one is correct play and can never be a failure;
      // the tactic file's own reporting line is "un-soaked ruptures only,
      // never soakers".
      rule: { type: "collect", count: 3 },
      good: "Named low-stack players intercept every globule; soaking is correct play, not a failure.",
      failText: "Missed the globule soak \u2014 it ruptured on the whole raid"
    },
    {
      id: "envenomed",
      name: "Envenomed",
      spellId: 1310360,
      from: "vexhul",
      roles: ["tank"],
      telegraphMs: 1500,
      origin: "boss",
      // The fight's swap driver: "+10% Caustic Deluge damage taken, stacking,
      // ten stacks per channel", and "Bad: A tank sitting on high stacks through
      // another channel". The engine applies one stack per cast rather than ten
      // per channel, so maxStacks is tuned to firings — 4 casts at 18s apart is
      // ~72s, giving two swaps inside the pull. Ithraz's Stone Breaker stack
      // (1289092) is the other swap driver in the real fight; only one tankSwap
      // is read by the sim, and Envenomed is the cleaner teach because Stone
      // Breaker is already carrying the knockback.
      rule: { type: "tankSwap", maxStacks: 4 },
      good: "Vexhul's tanks swap so stacks decay.",
      failText: "Held Envenomed through another channel \u2014 taunt the swap sooner"
    },
    {
      id: "spit",
      name: "Corrosive Spit",
      spellId: 1291478,
      from: "vexhul",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 5e3,
      // "A 5s marker lands on a player"
      shape: { kind: "line", length: 46, width: 7 },
      // Fired by a Spawn of Vexhul, which the engine cannot render as a separate
      // body — so it comes off the boss and tracks its facing, which puts the
      // line on the tank. Dodging the frontal aimed at someone else is the same
      // skill and the same answer. Explicitly NOT interruptible: the Journal
      // tags it Frontal/Avoidable only and DB2 PreventionType is 0.
      origin: "boss",
      rule: { type: "avoid" },
      damage: 0.32,
      good: "The marked player points the line away; everyone else clears it.",
      failText: "Clipped by the Corrosive Spit frontal"
    },
    {
      id: "depths",
      name: "Stir the Depths",
      spellId: 1292807,
      from: "vexhul",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 6e3,
      // "6s channel ... while waves run down five lanes"
      shape: { kind: "line", length: 70, width: 11 },
      // A lane rather than an edge spawn on purpose: the engine gives non-boss
      // origins a random facing, so half of an 'edge' wave would point straight
      // off the platform and never threaten anyone. A drifting interior lane is
      // the same read — watch which lane clears, step into it.
      origin: "random",
      driftSpeed: 6,
      rule: { type: "avoid" },
      damage: 0.28,
      good: "Heal the pulse; step into a lane a wave just cleared, safe from every later lane.",
      failText: "Caught by a Stir the Depths wave"
    },
    {
      id: "feast",
      name: "Ravenous Feast",
      spellId: 1290662,
      lethal: true,
      from: "ithraz",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 4250,
      // "4.25s cast"
      shape: { kind: "circle", radius: 14 },
      // "splits damage among players within 14 yards"
      // A stack point you run to, not something that lands on you — being out of
      // it is the failure. 12 deaths across 14 pulls and "the most common first
      // blood", always from too few bodies in a bite.
      origin: "random",
      rule: { type: "beInside" },
      soakers: 5,
      good: "Three distinct groups, one per bite, enough bodies to divide the damage; highest-venom players first; nobody takes two.",
      failText: "Out of the bite \u2014 Ravenous Feast was not split"
    },
    {
      id: "ichor",
      name: "Coiling Ichor",
      spellId: 1290814,
      from: "ithraz",
      // "Carriers are chosen, never at fault" — but a tank running 26 yards out
      // drops their serpent, so carriers come from the rest of the raid.
      roles: ["dps", "healer"],
      telegraphMs: 12e3,
      // "infuses carriers for 12s"
      shape: { kind: "circle", radius: 8 },
      origin: "player",
      // 377 hits across 21 raiders and 8 deaths — "by far the most-failed
      // mechanic on the fight". The damage ID non-carriers eat is 1290878; the
      // thing the player DOES is carry 1290814 clear, which is what carryOut is.
      rule: { type: "carryOut", minDistance: 26 },
      spawns: { defId: "gore" },
      good: "Carriers spread, close together as it tightens, and dump pools at the room edges.",
      failText: "Kept Coiling Ichor on the raid"
    },
    {
      id: "gore",
      name: "Congealed Gore",
      spellId: 1292552,
      from: "ithraz",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1,
      // spawned already active
      shape: { kind: "circle", radius: 6 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.14,
      // per second while stood in it
      // The source says two minutes, and "permanently shrinks the arena". Held
      // to 30s here: at 44 yards of platform and a 150s pull, honest two-minute
      // pools stack until there is nowhere left to stand and the fight stops
      // teaching anything. The Sanguine Storm variant (1306925) is the same
      // hazard on a 6s timer and is folded into the glob dodge rather than
      // duplicated as its own def.
      lingerMs: 12e4,
      good: "Carriers spread, close together as it tightens, and dump pools at the room edges.",
      failText: "Stood in Congealed Gore"
    },
    {
      id: "storm",
      name: "Sanguine Storm",
      spellId: 1306876,
      from: "ithraz",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 2200,
      shape: { kind: "circle", radius: 4 },
      // "Glob impacts within 4 yards, dodgeable"
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.3,
      good: "Globs dodged while reading Vile Flood's rotation.",
      failText: "Hit by a Sanguine Storm glob"
    },
    {
      id: "stonebreaker",
      name: "Stone Breaker",
      spellId: 1288538,
      from: "ithraz",
      roles: ["tank", "dps", "healer"],
      // "1.5s cast ... knocks players away, then three slam swirlies." The cast
      // is 1.5s; the telegraph is stretched to cover the knock windup, because a
      // 1.5s window is not enough to reposition for a platform-wide push.
      telegraphMs: 3e3,
      // Arena-wide on purpose. The knock is not a puddle you sidestep — everyone
      // goes, and the only decision is whether you were standing somewhere the
      // push carries you across the platform or over the edge.
      shape: { kind: "circle", radius: 44 },
      origin: "boss",
      rule: { type: "survive" },
      knockbackYards: 18,
      good: "One tank soaks all three in appearance order (1x / 1.33x / 1.66x), then tanks swap; someone is always in range.",
      failText: "Knocked off the platform by Stone Breaker"
    },
    {
      id: "flood",
      name: "Vile Flood",
      spellId: 1294605,
      from: "vexhul",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 4e3,
      // "4s cast into a 14s rotating torrent"
      // A cone anchored on the boss: the engine keeps a boss-origin cone locked
      // to the boss's facing until it goes off, which is exactly the rotation
      // the orbs telegraph. 46 hits and 12 deaths — "the deadliest avoidable".
      shape: { kind: "cone", radius: 50, arcDeg: 34 },
      origin: "boss",
      rule: { type: "avoid" },
      damage: 0.46,
      good: "Raid reads the spin and stays out of the beam.",
      failText: "Clipped by the Vile Flood beam"
    }
  ]
};

// src/bosses/coiledaltar.ts
var coiledaltar = {
  key: "coiledaltar",
  name: "The Recursive Altar",
  realName: "The Coiled Altar",
  blurb: "Venom Rupture is more killing blows than everything else combined. Arena management, not reflexes.",
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
      id: "orbadd",
      name: "Coalesced Venom",
      npcId: 268042,
      spellId: 1282408,
      job: "leave",
      count: 2,
      hp: 1,
      fuseSec: 30,
      auraDps: 0.35,
      lethal: true,
      spawnRadius: 22,
      good: "Never shoot an orb. Keep them clear of the axe path and let them sit.",
      failText: "Destroyed a Coalesced Venom orb \u2014 Venom Rupture"
    },
    {
      id: "soulcoiler",
      name: "Spiteful Soulcoiler",
      npcId: 0,
      spellId: 1286399,
      job: "kick",
      count: 1,
      hp: 10,
      fuseSec: 26,
      castEverySec: 12,
      spawnRadius: 27,
      good: "Kick Wail of Terror \u2014 a 7s cast that fears the whole raid for 5s.",
      failText: "Wail of Terror went off \u2014 raid feared"
    },
    {
      id: "fragment",
      name: "Fragment of Malacrass",
      npcId: 0,
      spellId: 1287718,
      job: "intercept",
      count: 2,
      hp: 3,
      fuseSec: 22,
      marchSpeed: 3.2,
      spawnRadius: 34,
      good: "Step on every fragment before it reaches Zul'jan and casts Reclaim Essence.",
      failText: "A Fragment reached Zul'jan \u2014 Reclaim Essence"
    }
  ],
  entities: [
    { id: "zuljan", name: "Zul'jan", npcId: 257911, start: { x: -10, y: 0 } },
    { id: "malacrass", name: "Hex Lord Malacrass", npcId: 259854, start: { x: 13, y: -7 } }
  ],
  maxHp: 1,
  loopIntervalSec: 6,
  energyPerSec: 2.2,
  // ~45s per Eternal Nightfall — three kicks a pull
  atFullEnergy: "nightfall",
  ambient: ["fangs"],
  pullLengthSec: 150,
  // The loop pushes you outward (deluge chunks, carrying venom clear, the axe
  // off the wall) and then hauls you back in (the Guillotine soak, the called
  // band, re-stacking on clean floor) so movement never settles in one gear.
  loop: [
    "twinfang",
    "deluge",
    "venomfang",
    "sever",
    "guillotine",
    "twinfang",
    "volatile",
    "axegrinder",
    "widowskiss",
    "deluge",
    "twinfang",
    "venomfang",
    "guillotine",
    "sever",
    "volatile",
    "twinfang",
    "deluge",
    "axegrinder",
    "widowskiss",
    "guillotine"
  ],
  mechanics: [
    {
      id: "soulbound",
      name: "Deathguard & Soulbound",
      spellId: 1309987,
      from: "malacrass",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 0,
      origin: "boss",
      // The entities do not share a health pool, so leaving one far behind is
      // the failure this rule scores. Judged continuously from the moment the
      // first one dies.
      rule: { type: "syncKill", withinSec: 12 },
      good: "Health pools stay level and both bosses die together.",
      failText: "Health pools drifted apart \u2014 killing one berserks the other"
    },
    {
      id: "fangs",
      name: "Fangs of the Coiled Altar",
      spellId: 1282512,
      from: "zuljan",
      roles: ["healer"],
      telegraphMs: 0,
      origin: "boss",
      // abilities.json: "Unavoidable raid-wide Nature pulse every 1s for 8s —
      // healing pressure, not positioning." There is nothing to dodge, so it
      // must never produce a per-player failure.
      rule: { type: "raidDamage", dps: 3.4 },
      good: "A cooldown covers every channel and only the active tank appears on the toxin IDs.",
      failText: ""
    },
    {
      id: "twinfang",
      name: "Twinfang Toxin",
      spellId: 1300322,
      from: "zuljan",
      roles: ["tank"],
      telegraphMs: 1500,
      origin: "boss",
      // The autoattack DoT that dumps the Fangs stacks on whoever is holding
      // him — the fight's swap driver. Its "Bad:" line is "a toxin applydebuff
      // on a non-tank", i.e. the off-tank was late. Shares the Fangs heading in
      // the tactic file, hence the shared "Good:" line.
      rule: { type: "tankSwap", maxStacks: 4 },
      good: "A cooldown covers every channel and only the active tank appears on the toxin IDs.",
      failText: "Held Twinfang Toxin too long \u2014 taunt the swap sooner"
    },
    {
      id: "sever",
      name: "Sever",
      spellId: 1299684,
      from: "zuljan",
      roles: ["tank"],
      telegraphMs: 3e3,
      shape: { kind: "cone", radius: 32, arcDeg: 75 },
      origin: "boss",
      // "Frontal cone cleave that also destroys Coalesced Venom" — so pointing
      // it at the raid is two failures at once: seven players cleaved, and every
      // orb in the path opened up as a Rupture.
      rule: { type: "faceAway" },
      damage: 0.5,
      good: "Cone faces away from the raid and tanks swap before a second cast lands.",
      failText: "Swept the raid with Sever \u2014 and cut the venom open"
    },
    {
      id: "deluge",
      name: "Toxic Deluge",
      spellId: 1300137,
      from: "zuljan",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 2500,
      shape: { kind: "circle", radius: 4 },
      // "hitting within 4 yards"
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.36,
      // "seeding a Coalesced Venom orb plus floor venom" — here the chunk leaves
      // the floor poisoned and the orbs arrive by the Volatile Venom route, so
      // the arena only fills up when somebody actually steps in something.
      spawns: { defId: "noxious" },
      good: "Nobody under a landing chunk; orbs land in called dump zones.",
      failText: "Stood under a Toxic Deluge chunk"
    },
    {
      id: "noxious",
      name: "Noxious Ground",
      spellId: 1283290,
      from: "zuljan",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1,
      // spawned already active under the chunk
      shape: { kind: "circle", radius: 7 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.15,
      // per second while stood in it
      lingerMs: 45e3,
      // "189 applications and 12 killing blows on Heroic" — the quiet killer,
      // and the tactic file's target is the shortest "Good:" line in the raid.
      good: "Zero uptime.",
      failText: "Stood in Noxious Ground"
    },
    {
      id: "volatile",
      name: "Volatile Venom",
      spellId: 1282419,
      from: "zuljan",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 5e3,
      // "pulsing damage within 5 yards for 5s"
      shape: { kind: "circle", radius: 5 },
      origin: "player",
      // The whole economy of the fight in one rule: you touched venom, so you
      // run it clear and eat it alone — and when it expires it hands the arena
      // a fresh orb wherever you were standing. Drop it on the raid and you have
      // seeded a Rupture in the middle of everyone.
      rule: { type: "carryOut", minDistance: 20 },
      spawns: { defId: "orb" },
      good: "Nobody touches venom; anyone who does runs clear and eats it alone.",
      failText: "Carried Volatile Venom into the raid"
    },
    {
      id: "orb",
      name: "Coalesced Venom",
      spellId: 1282408,
      lethal: true,
      from: "zuljan",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1,
      shape: { kind: "circle", radius: 5 },
      origin: "random",
      rule: { type: "avoid" },
      damage: 0.34,
      lingerMs: 26e3,
      // "destroying one — by Guillotine axe or Sever cone — detonates Venom
      // Rupture". popsOnContact is exactly that: the orb sits there harmlessly
      // until something touches it, and then it is gone and the raid is hurt.
      // Leaving them alone and leaving them somewhere safe is the entire fight.
      popsOnContact: true,
      good: "Orb count stays flat, orbs sit clear of the axe path, ruptures come one at a time.",
      failText: "Set off a Coalesced Venom orb \u2014 Venom Rupture"
    },
    {
      id: "guillotine",
      name: "Guillotine",
      spellId: 1283594,
      from: "zuljan",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 4e3,
      shape: { kind: "circle", radius: 9 },
      // "splitting damage within 9 yards"
      origin: "random",
      // "Being hit by 1283594 is the job" — so this is a soak, and being OUT of
      // it is the failure. Under five heads it fires Execution instead: 16
      // Mythic killing blows, "each tracing to one cast under 5 heads".
      rule: { type: "beInside" },
      soakers: 5,
      // the published threshold, not a guess
      damage: 0.42,
      good: "5+ bodies in range every cast, groups rotated so nobody eats a second axe while Guillotined.",
      failText: "Missed the Guillotine soak \u2014 Execution fired"
    },
    {
      id: "widowskiss",
      name: "Widow's Kiss",
      spellId: 1283623,
      lethal: true,
      from: "zuljan",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 3500,
      // The axe splits the arena into two punished bands — Widow's Kiss inside
      // 40 yards, Widow's Touch outside it — so the only survivable ground is
      // the ring between them, which is what an annulus + beInside is. The real
      // threshold is 40 yards from the axe; scaled here to a band inside a 44yd
      // arena so it is a place you can actually run to. Failure is being in
      // either punished band, which is what "hold the called band" means.
      shape: { kind: "annulus", inner: 20, outer: 34 },
      origin: "boss",
      rule: { type: "beInside" },
      // Not a soak — the whole raid holds the band, so every ally is assigned to
      // it and the demonstration on screen is twenty people running to a ring.
      soakers: 20,
      damage: 0.48,
      // "few get hit and most of them die"
      good: "The raid holds the called band and hit counts stay at zero.",
      failText: "Out of the called band \u2014 Widow's Kiss"
    },
    {
      id: "axegrinder",
      name: "Axegrinder",
      spellId: 1285017,
      from: "zuljan",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 5200,
      // long enough for the axe to cross the floor
      shape: { kind: "circle", radius: 5 },
      origin: "edge",
      // it comes off the wall and ricochets
      driftSpeed: 9,
      rule: { type: "avoid" },
      damage: 0.32,
      // armour-ignoring Physical, 6 Mythic KBs
      good: "Nobody is clipped; axes are kited into the venom dump zones.",
      failText: "Clipped by an Axegrinder axe"
    },
    {
      id: "venomfang",
      name: "Venomfang",
      spellId: 1306906,
      from: "zuljan",
      roles: ["healer"],
      telegraphMs: 6e3,
      shape: { kind: "circle", radius: 4 },
      origin: "player",
      // The fight's only genuine dispel — wowhead confirms dispel type Poison
      // and the logs show 58 healer removals. Note the tactic file's "Bad:" line
      // refuses to auto-fail a slow dispel in the REPORT and leaves the hold
      // time to the raid leader; in the trainer there is no raid leader to ask,
      // so a Venomfang left ticking through the window is scored.
      rule: { type: "press", ability: "dispel", withinMs: 6e3 },
      damage: 0.15,
      lingerMs: 14e3,
      // the 14s Nature DoT if it is never cleared
      good: "Assigned dispellers clear it promptly, especially while Rupture DoTs tick.",
      failText: "Venomfang left ticking \u2014 dispel it"
    },
    {
      id: "nightfall",
      name: "Eternal Nightfall",
      spellId: 1286918,
      from: "malacrass",
      roles: ["tank", "dps", "healer"],
      telegraphMs: 6e3,
      // Raid-wide and lethal, so the shape is not a place to stand — it is the
      // whole floor lighting up to tell you a kick is due. `press` never scores
      // position, only whether somebody answered.
      shape: { kind: "circle", radius: 38 },
      origin: "boss",
      // "13 interrupts against 18 applications, so a third got through." The
      // Veil of Twilight gating is not modelled: there is no shield to burn
      // here, so the kick window is simply the cast.
      rule: { type: "press", ability: "interrupt", withinMs: 6e3 },
      damage: 0.32,
      good: "Veil melts, a kick lands, Nightfall never completes.",
      failText: "Eternal Nightfall completed \u2014 nobody kicked"
    }
  ]
};

// src/bosses/ulatek.ts
var ulatek = {
  key: "ulatek",
  name: "Claude'Tek",
  realName: "Ula'tek",
  blurb: "Four kickable casts and a healing floor that only ever rises. Missed kicks and un-leeched bites end pulls.",
  arenaRadius: 46,
  // The kick fight. Three of the raid's four Heroic add-kicks live here, and
  // "the adds set the clock". Malice is the highest-value kick in the fight.
  addEverySec: 20,
  maxAdds: 8,
  adds: [
    {
      id: "warden",
      name: "Doomscale Warden",
      npcId: 0,
      spellId: 1290779,
      job: "kick",
      count: 1,
      hp: 12,
      fuseSec: 26,
      castEverySec: 13,
      spawnRadius: 26,
      good: "Kick Malice \u2014 1.5s cast for 6s of raid-wide Nature, the highest-value kick here.",
      failText: "Malice went uninterrupted"
    },
    {
      id: "viper",
      name: "Blightscale Viper",
      npcId: 0,
      spellId: 1301800,
      job: "kick",
      count: 2,
      hp: 6,
      fuseSec: 24,
      castEverySec: 15,
      spawnRadius: 30,
      good: "Kick Acidic Burst. It is Poison-dispellable too, but the kick is the answer.",
      failText: "Acidic Burst went uninterrupted"
    },
    {
      id: "shrieker",
      name: "Blightscale Shrieker",
      npcId: 0,
      spellId: 1310764,
      job: "kick",
      count: 1,
      hp: 8,
      fuseSec: 24,
      castEverySec: 14,
      spawnRadius: 33,
      good: "Kick Vicious Echoes \u2014 unlimited range, so distance is no excuse.",
      failText: "Vicious Echoes stunned the raid"
    },
    {
      // The fourth Heroic add-kick in the raid. It was catalogued in ADDS.md
      // and then never authored. "VERIFIED InterruptFlags 45 (kickable) AND
      // DispelType 1 (Magic) ... KICK FIRST — the stun is raid-wide, so
      // dispellers are usually stunned too."
      //
      // Its other cast, Dread Roar, is a 20 second raid stun and "a wipe if it
      // lands" — InterruptFlags 41, NOT kickable, "prevented only by weakening
      // the Doomscale first". Anguished Cry is what the weakened form casts, so
      // getting it to the kickable state is itself the job.
      id: "doomscale",
      name: "Ravenous Doomscale",
      npcId: 0,
      spellId: 1305650,
      job: "kick",
      count: 1,
      hp: 11,
      fuseSec: 25,
      castEverySec: 11,
      spawnRadius: 28,
      good: "Weaken it before it hatches, then kick Anguished Cry \u2014 the stun is raid-wide.",
      failText: "Anguished Cry went uninterrupted \u2014 raid stunned"
    },
    {
      id: "clutch",
      name: "Blightscale Clutch",
      npcId: 0,
      spellId: 1289962,
      job: "kill",
      count: 1,
      hp: 10,
      fuseSec: 16,
      spawnRadius: 24,
      good: "Break the clutch before gestation completes \u2014 the channel is not kickable.",
      failText: "A Blightscale Clutch completed its gestation"
    }
  ],
  maxHp: 1,
  loopIntervalSec: 5.5,
  // slightly faster than the others — it is the last boss
  energyPerSec: 2.2,
  // ~45s between platform collapses
  atFullEnergy: "heart",
  ambient: ["vapors"],
  pullLengthSec: 165,
  // Kicks sit at least three slots (16.5s) apart so a 12s interrupt always
  // covers both; the two dispels sit six slots apart against an 8s cooldown.
  // Beyond that the loop deliberately alternates direction — Caustic Waves and
  // Volatile Purge push you OUT, Spectral Coils and Serpent's Bite pull you IN —
  // because a loop that only ever says "run out" trains one reflex and no
  // decisions.
  loop: [
    "eggs",
    "waves",
    "stonevenom",
    "malice",
    "coils",
    "stonevenom",
    "acidic",
    "serpentsbite",
    "echoes",
    "stonevenom",
    "waves",
    "thrash",
    "poisonbite",
    "coils",
    "malice",
    "stonevenom",
    "serpentsbite",
    "thrash",
    "echoes"
  ],
  mechanics: [
    {
      id: "eggs",
      name: "Doomscale Eggs",
      spellId: 1300312,
      roles: ["tank", "dps", "healer"],
      // "Shells stick to whoever touches an egg and hatch 20s later ... left
      // alone it pops after 1.5 minutes." PICKUP IS DELIBERATE — "assigned
      // carriers pick up in order and deliver to the Doomscale Cauldron" — so
      // touching an egg is the job, not a mistake, and an egg nobody collects
      // is what hatches a Ravenous Doomscale.
      //
      // Egg control is Stage One's whole job and it was absent entirely, which
      // left "the adds set the clock" with no clock a player could influence.
      telegraphMs: 14e3,
      shape: { kind: "circle", radius: 3 },
      origin: "random",
      rule: { type: "collect", count: 3 },
      good: "Assigned carriers pick up in order and deliver to the Doomscale Cauldron, one side at a time.",
      failText: "An egg was left to hatch \u2014 a Doomscale clawed out"
    },
    {
      id: "heart",
      name: "Venomous Heart",
      spellId: 1299526,
      roles: ["tank", "dps"],
      telegraphMs: 2e3,
      origin: "boss",
      // "20 sec window where the Heart takes +100% damage — the raid's burn
      // phase", opened by Rage of the Shackled. The stage's only burn, and it
      // was absent: "cooldowns missing the Heart wastes the only burn in the
      // stage" was a failure the trainer had no way to show you.
      rule: { type: "burnWindow", multiplier: 2, durationMs: 2e4 },
      good: "Healing cooldowns cover the channel, debris dodged, every damage cooldown into the Heart.",
      failText: "The Venomous Heart window closed with cooldowns still up"
    },
    // ───────────────────────── the clock ─────────────────────────
    {
      id: "vapors",
      name: "Necrotic Vapors",
      spellId: 1286834,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 0,
      origin: "boss",
      // "Bad: Not an execution failure — the fight timer. Every Putrid Membrane
      // permanently raises the healing floor." raidDamage never produces a
      // per-player failure, which is exactly right for a stacking raid DoT that
      // never falls off. Carries the Putrid Membrane and Blight Vein cost too.
      // Pitched slightly above the other two bosses (3.2) — this is the last
      // fight and the file calls attrition the thing that actually wipes raids.
      rule: { type: "raidDamage", dps: 3.4 },
      good: "Adds die fast, eggs never hatch, cooldowns planned against stack milestones.",
      failText: ""
    },
    // ───────────────────────── stage one ─────────────────────────
    {
      id: "waves",
      name: "Caustic Waves",
      spellId: 1292403,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 3e3,
      // A lane crossing the floor. Length 80 on a 92yd arena so it reads as a
      // wave passing all the way through rather than a stripe in the middle.
      shape: { kind: "line", length: 80, width: 12 },
      // NOT `edge`, tempting as it is for a wave off the rim: an edge-origin
      // shape gets a random angle, so half of them would point off the platform
      // and cover nothing. A random interior anchor always sweeps real ground.
      origin: "random",
      rule: { type: "avoid" },
      // One of the four IDs confirmed to do direct player damage. No linger: the
      // journal describes waves that cross the floor, not pools that stay.
      damage: 0.32,
      good: "Raid steps out of the lanes and keeps waves off the egg field.",
      failText: "Stood in a Caustic Waves lane"
    },
    {
      id: "stonevenom",
      name: "Mother's Wrath / Stone Venom",
      // 1298417 is the stacking debuff that drives the swap; 1298367 is the 5s
      // bite that applies it, and is a driver aura whose damage lands on an
      // unidentified child ID — so the stack is the honest thing to key on.
      spellId: 1298417,
      roles: ["tank"],
      telegraphMs: 5e3,
      // "5 sec cast"
      origin: "boss",
      // The sim binds ONE tankSwap def per boss and this is the fight's swap.
      // A 1.7 minute DoT means stacks effectively never drop in a pull, so the
      // threshold is low.
      rule: { type: "tankSwap", maxStacks: 4 },
      good: "Marked tank walks back into reach and eats the channel solo; tanks swap on stacks.",
      failText: "Held Stone Venom too long \u2014 taunt the swap sooner"
    },
    {
      id: "acidic",
      name: "Acidic Burst",
      spellId: 1301800,
      roles: ["healer", "dps"],
      // dispel is in both kits; tanks have none
      telegraphMs: 6e3,
      shape: { kind: "circle", radius: 5 },
      origin: "random",
      // the Viper's target, somewhere in the raid
      // VERIFIED BOTH WAYS in DB2: InterruptFlags 45 and DispelType 4 (Poison).
      // The kick slots are spent on Malice and Vicious Echoes, so this one
      // teaches the cleanse — which is what the file asks for anyway: "Acidic
      // Burst kicked and leftovers dispelled".
      rule: { type: "press", ability: "dispel", withinMs: 6e3 },
      damage: 0.2,
      // the 18s DoT you keep if nobody cleanses it
      good: "Acidic Burst kicked and leftovers dispelled, raid spread, Rawlings tanked.",
      failText: "Acidic Burst poison left undispelled"
    },
    {
      id: "poisonbite",
      name: "Poisonous Bite",
      spellId: 1287036,
      roles: ["healer"],
      telegraphMs: 7e3,
      shape: { kind: "circle", radius: 5 },
      // Anchored on the boss because it stacks on whoever is tanking the
      // Rawling — the melee pile, not a random raider.
      origin: "boss",
      // The second and last real dispel: DispelType 4 (Poison), stacking.
      rule: { type: "press", ability: "dispel", withinMs: 7e3 },
      damage: 0.18,
      good: "Acidic Burst kicked and leftovers dispelled, raid spread, Rawlings tanked.",
      failText: "Poisonous Bite stacks left undispelled"
    },
    {
      id: "coils",
      name: "Spectral Coils",
      spellId: 1287265,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 5e3,
      shape: { kind: "circle", radius: 10 },
      // "reduced by players within 10 yards"
      origin: "random",
      // Raid-wide damage divided by how many bodies are inside, so being OUT is
      // the failure — the file is blunt that "everyone is hit by design, so
      // never name individuals". soakers is the whole group, not a subset.
      rule: { type: "beInside" },
      soakers: 8,
      good: "Raid stacks tight on the marker; carriers get an external.",
      failText: "Out of the Spectral Coils stack \u2014 the hit was not shared"
    },
    // ───────────────────────── stage two ─────────────────────────
    {
      id: "malice",
      name: "Malice",
      spellId: 1290779,
      // Everyone. The file calls this "TOP KICK PRIORITY" and the assignment
      // note asks for "three players minimum, fixed order" — every role in this
      // game has an interrupt, so every role is in the rotation.
      roles: ["tank", "dps", "healer"],
      telegraphMs: 1500,
      // "1.5 sec cast" — the tightest window here
      // A press rule ignores shape for scoring, but a shapeless instance draws
      // nothing, so the Warden gets a marker you can actually see casting.
      shape: { kind: "circle", radius: 6 },
      origin: "random",
      rule: { type: "press", ability: "interrupt", withinMs: 1500 },
      // No `damage`: six seconds of raid-wide Nature damage belongs on the raid
      // bar, not on you. Miss it repeatedly and the healing floor eats the pull,
      // which is the lesson.
      good: "Kicked every time by a fixed rotation.",
      failText: "Malice went off unkicked \u2014 six seconds of raid damage"
    },
    {
      id: "thrash",
      name: "Desperate Thrash",
      spellId: 1305709,
      roles: ["tank"],
      telegraphMs: 1500,
      // "1.5 sec frontal cone"
      shape: { kind: "cone", radius: 26, arcDeg: 70 },
      // The caster is a Weakened Doomscale, not Ula'tek. The engine has one boss
      // actor, so the add's frontal is expressed off the boss position — the
      // same trick the Sentinels file uses for its two golems. The tank job is
      // identical: keep the cone off the middle.
      origin: "boss",
      rule: { type: "faceAway" },
      damage: 0.44,
      good: "Every Doomscale weakened before it hatches, Anguished Cry kicked, add faced away, twins die together.",
      failText: "Desperate Thrash swept the raid \u2014 the add was not faced away"
    },
    // ───────────────────────── stage three ─────────────────────────
    {
      id: "echoes",
      name: "Vicious Echoes",
      spellId: 1310764,
      roles: ["dps"],
      // the Shrieker's own rotation, per the file
      telegraphMs: 2500,
      // "2.5 sec cast, unlimited range"
      shape: { kind: "circle", radius: 6 },
      origin: "random",
      rule: { type: "press", ability: "interrupt", withinMs: 2500 },
      // Unlike Malice this one lands on you personally: "a 6 sec raid stun on a
      // collapsing platform is lethal". There is no stun state in the sim, so
      // the cost of standing there stunned is paid as damage.
      damage: 0.34,
      good: "Vicious Echoes kicked every time; Acidic Expulsion healed through.",
      failText: "Vicious Echoes went off unkicked \u2014 stunned on a collapsing floor"
    },
    {
      id: "serpentsbite",
      name: "Serpent's Bite",
      // Points at Calcified Corpse, the terminal state of an un-leeched bite:
      // "Bad: Any applydebuff of 1306119 — a bite was never leeched, and that
      // is a death."
      //
      // It used to point at 1295905, which the ability data flags as "CAST
      // MARKER ONLY ... a Dummy effect and 300 yd radius ... the selector, not
      // the player debuff". A 300-yard selector keyed to a 7-yard leech meant
      // the mechanic was hung on an ID that can never describe its failure.
      spellId: 1306119,
      lethal: true,
      roles: ["tank", "dps", "healer"],
      // Really 15s. Compressed because the decision — spot the bite, get inside
      // 7 yards — is made in the first seconds and the rest is dead air.
      telegraphMs: 9e3,
      shape: { kind: "circle", radius: 7 },
      // "someone within 7 yards can leech it"
      origin: "random",
      // Being OUT is the failure: an un-leeched bite becomes a Calcified Corpse
      // (1306119), which stuns, pierces immunities and kills — the file's
      // headline failure. soakers 2 is the bitten player plus one leecher, which
      // leaves the second slot for you.
      rule: { type: "beInside" },
      soakers: 2,
      spawns: { defId: "purge" },
      good: "Every bite leeched well inside 15s; leechers run clear and erupt on nobody.",
      failText: "Nobody leeched the Serpent's Bite \u2014 Calcified Corpse"
    },
    {
      id: "purge",
      name: "Volatile Purge",
      spellId: 1306086,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 5e3,
      // "erupts 5 sec later within 7 yards"
      shape: { kind: "circle", radius: 7 },
      origin: "player",
      // placed on the bite by its parent's spawn
      rule: { type: "carryOut", minDistance: 20 },
      // Chained off Serpent's Bite rather than scheduled, so it only ever lands
      // on someone who leeched — you cannot fail the run-out if you never went
      // in for the bite, which is exactly how the real mechanic gates it.
      good: "Every bite leeched well inside 15s; leechers run clear and erupt on nobody.",
      failText: "Erupted Volatile Purge on the raid"
    },
    {
      id: "circlingprey",
      name: "Circling Prey",
      spellId: 1301510,
      roles: ["tank", "dps", "healer"],
      telegraphMs: 4e3,
      shape: { kind: "circle", radius: 13 },
      // "knockback within 13 yards"
      // Random rather than edge-anchored: the knockback pushes you directly away
      // from the impact, so a rim impact would shove you to safety. Landing it
      // anywhere means the dangerous case — impact between you and the edge —
      // happens on its own, which is the fight's actual killer.
      origin: "random",
      // "Everyone is hit by design — the knockback into the void is the kill."
      // So the damage is not the mechanic; keeping your feet is.
      rule: { type: "survive" },
      knockbackYards: 24,
      good: "Raid pre-positions off the collapsing section; spit markers dodged.",
      failText: "Knocked off the platform by Circling Prey"
    }
  ]
};

// src/bosses/registry.ts
var BOSSES = [
  nekzali,
  sentinels,
  vashnik,
  explorers,
  sszorak,
  twinfangs,
  coiledaltar,
  ulatek
];
function bossByKey(key) {
  return BOSSES.find((b) => b.key === key);
}
export {
  BOSSES,
  bossByKey
};
