import type { BossDef } from '../engine/types'

// The Lost Subagents — a parody of The Lost Explorers.
//
// House rule on naming: BOSSES get Claude-flavoured parody names, MECHANICS keep
// their real names. The joke lands on the boss, but what you practise has to
// transfer to the actual raid, and it cannot if "Blast Wave" is called something
// else here.
//
// Authored from 12.1/VenomousAbyss/Explorers/LostExplorers.md and abilities.json.
// Every spellId below is real and appears in that abilities.json, cast by the
// entity it is attributed to.
//
// Difficulty scope: the tactic file records NOTHING as Mythic-only — every ID in
// the file is tagged ["Heroic","Mythic"] — so unlike Sszorak nothing had to be
// excluded on difficulty grounds. What is missing here was cut for gameplay, and
// each cut is listed at the bottom of this comment.
//
// ── THE FIGHT ────────────────────────────────────────────────────────────────
//
// Three targetable explorers and a fourth body, Mor'zahi, who is nothing but an
// energy bar. The bar fills all pull and reaching the top is the wipe. Three
// Disgusting Fish exist in the whole encounter, each hidden in one junk box;
// feeding one to an explorer empties the bar AND permanently empowers whichever
// explorer ate it. After the third fish the bar cannot be emptied again, and
// that is the enrage.
//
// So the fight is three clocks running at once: the bar, the three health pools
// that must reach zero together, and the rotation getting worse every time you
// buy time with a fish. Nothing here is a DPS check dressed up as a mechanic,
// and NOTHING IN THIS FIGHT IS AN ADD. The crates are a collect, the mushrooms
// are launch pads, and there is nothing on the floor to shoot down.
//
// ── HOW THIS FIGHT IS SCHEDULED ──────────────────────────────────────────────
//
// This is the first boss in the raid with a `timeline`, and it is the reason the
// primitive exists. Three of its casts have real intervals:
//
//     Shell Spin   every 30s from t=5
//     Blink Nova   every 30s from t=10
//     Throw Junk   first at t=30, and every one after that is armed by the
//                  EMPOWERED ability the previous fish bought
//
// A round-robin can express none of that. `loop` gives a fight one beat and
// derives every recurrence from it — two mechanics sharing a 30s period at
// different offsets is a shape it has no way to make, and "fires when mechanic Y
// resolves" is not a clock at all. Those three are therefore OFF the loop and on
// the timeline; everything else stays on the loop and fills the gaps between
// them. Anything on the timeline must not also be in `loop`, or it double-fires.
//
// The consequence is that this fight's LENGTH is emergent rather than scripted:
// crates → fish → feed → empowered cast → crates. If the player never delivers a
// fish, Throw Junk #2 never arms and the bar simply fills. That is the fight.
//
// AND THE CHAIN IS ONLY AS FAST AS THE EMPOWERED ABILITY'S TURN. That link used
// to be the slowest thing in the fight and it is what the pacing pass fixed:
// every Throw Junk after the first waits for the previous fish's empowered
// ability to RESOLVE, and with two turns each in an eighteen-entry array that
// wait could run to fifty seconds. The engine now keeps an appointment for a
// gate the instant it opens and spends a beat that would have been silence on
// whichever open gate is overdue, and this file pays for both by giving each
// empowered entry three turns in a twenty-entry array — so the wait between
// buying an ability and seeing it is a single beat, and the fish economy runs at
// the speed the player is paying for rather than at the speed of a round-robin.
// See `loop`.
//
// ── ASSUMPTIONS, made because the directive is silent ────────────────────────
//
// These are the places the source does not say, so a decision had to be taken.
// Each one is marked so it is easy to overturn later without re-reading the
// whole file. A–G are the original set; H–N were added when the fight was
// reconciled against the second and third rounds of decisions, O–Q when the
// tank job, the wave and the volley were rebuilt after the first play session,
// and R when the pacing pass made the empowered half of the rotation actually
// arrive. J and Q were both REVERSED by that pass and say so in place.
//
//   ASSUMPTION A — Every Throw Junk hides exactly one Disgusting Fish until
//     three have been found; afterwards Throw Junk still fires and hides none.
//     The source says only "three fish exist in the whole encounter" and "at
//     most one fish is found per Throw Junk". Guaranteeing one per cast until
//     the pool is spent is the reading that makes the boxes worth opening every
//     time; a random chance would make the enrage arrive for reasons nobody in
//     the room could have played around.
//
//   ASSUMPTION B — Feeding a fish to an already-empowered explorer is REJECTED
//     and the fish is kept. Never a recorded failure. A misclick on a
//     three-body council must not be an unrecoverable wipe, and the renderer
//     draws the feed link only to explorers that have not eaten, so the decision
//     is visible before the mistake rather than after it.
//
//   ASSUMPTION C — energyPerSec, pullLengthSec, maxHp and chipLag are not in the
//     directive. The values below are a starting point and were settled with
//     `npm run playtest`, not by eye. The bar to hold is the repo's: all three
//     careless cells die, all three competent cells kill.
//
//     THE PACING TARGET, restated after the pacing pass, because it used to be
//     "the third empowered mechanic lands with roughly 10% left on each
//     explorer" and that was a target about the KILL rather than about practice.
//     What the user asked for is reps, so what the numbers are now aimed at is:
//     all three empowerments bought while there is still real pull left, and
//     every empowered ability cast several times rather than once. Measured
//     across six seeds and all three roles — eighteen pulls — every single one
//     buys all three empowerments, the third of them landing between 76.6s and
//     124.4s of pulls that run 123-180s. Seventeen of the eighteen then have
//     36-77s of pull left to spend on it and the eighteenth has 6.6s.
//     Fifty-one of the fifty-four abilities bought are cast between two and eight
//     times; Mighty Thud, the ability the report was about, is cast two to eight
//     times on every row in the sweep. The three cast once are the ability bought
//     LAST on a dps pull, which is the shortest pull there is — that is the
//     residual, and it is recorded rather than hidden.
//
//     `maxHp` is the kill-pacing lever and is bounded from ABOVE by the healer's
//     enrage. The lower bound it used to carry — "a shallower pool starves the
//     fish economy, because a body that dies before it eats can never be
//     empowered" — is gone, and it was never a property of this dial: the bodies
//     were dying because the playtest bot burned an unfed mouth to the bone. It
//     no longer does. See `maxHp`.
//
//   ASSUMPTION D — Relentless Escalation, Cataclysmic Invocation and Smashing
//     Shovel RAMP toward a wipe rather than ending the pull on the spot. They
//     are the price of an unsynchronised kill, not the punishment itself; the
//     punishment is the pull you then have to finish while they are running.
//
//   ASSUMPTION E — An empowered explorer ADDS its empowered ability to its
//     rotation. Mighty Thud does not replace Shell Spin, it arrives on top of
//     it. The engine gates the empowered entry and leaves the base loop alone,
//     so this holds by construction rather than by authoring discipline.
//
//   ASSUMPTION F — Gebbo's lap is the thing the tanks play around, and the room
//     has no parking space. He walks a circle CENTRED ON THE ARENA CENTRE at
//     radius 16, continuously, all pull.
//
//     THE ARITHMETIC, and it is the whole tank job. United Defense links when
//     the WIDEST pair of live explorers is under 30 yards, i.e. when all three
//     are inside 30 of one another. A body standing at radius R on the far side
//     of the room from Gebbo is R + 16 yards from him, so the link is broken
//     only from R >= 14 outward, on his far side, and the ARENA CENTRE — R = 0,
//     a flat 16 yards from him wherever he is on the lap — is permanently inside
//     it. There is therefore no station on this floor that is safe for more than
//     a few seconds, which is exactly why the two tanked explorers are stacked
//     and WALKED rather than parked. See "the tank job" below for the ring the
//     engine derives from these two numbers.
//
//     This is a REVERSAL of what this file used to assume. The old patrol sat
//     off in the north (centre (0,32), radius 13) and the two tanked bodies were
//     pinned at fixed southern stations 48 yards apart, which made a link
//     arithmetically impossible and the tank job nothing at all. It also read as
//     Gebbo wandering about in a corner rather than patrolling a room.
//
//   ASSUMPTION G — The Frostfire Volley element debuff lasts until the next
//     volley (the ability data calls both markers 1-minute debuffs). A second
//     volley landing on a carrier who has not cleansed kills them, and the death
//     is attributed to Elemental Explosion — the Deadly id — exactly the way a
//     Mutilate death belongs to the Gash rather than to the cone.
//
//   ASSUMPTION H — Shell Spin's SPREAD. The directive says "one directly forward
//     from the boss then another one shooting off either side" and gives no
//     angle. ±35 degrees (fanDeg 70) is chosen so the three lanes are separable
//     at run speed rather than measured from anything. THE ARITHMETIC: adjacent
//     lanes are 35 degrees apart, so at distance d from Nama the gap between
//     their centre-lines is 2*d*sin(17.5) = 0.60*d yards. Against an 8 yd lane
//     width that gap opens at d = 13.3 yd and is 22 yd wide at the rim — so
//     outside melee there is always somewhere to stand, and inside melee the
//     shells overlap, which is what a shell thrown at your feet should do.
//     Tune in playtest.
//
//   ASSUMPTION I — Shell Spin's travel. driftSpeed 9 yd/s is under the player's
//     14, so a shell can be outrun in a straight line as well as sidestepped;
//     lingerMs 6000 is roughly one crossing of the room. Neither number is in
//     the directive. The 4s stun the real ability applies (1291918) is NOT
//     modelled as a stun — the engine has no stun — so `damage` carries the cost
//     of being clipped, and `popsOnContact` carries "one shell, one hit".
//
//   ASSUMPTION J — REVERSED IN THE PACING PASS. The player finds the fish
//     ROUGHLY 75% of the time; the rest of the time an ally takes it and feeds it
//     to a mouth chosen from `feedPriority`, skipping any explorer that has
//     already eaten. The directive says "a strong chance the non-tank player
//     character finds the fish" without a number. What a missed fish costs you is
//     the CHOICE of which explorer gets empowered next — never the pull.
//
//     THE ORDER IS NOW SHUFFLED ONCE PER PULL and it used to be the fixed list
//     Iku > Gebbo > Nama. That fixed list is what the user's report was actually
//     describing: read strictly in order it makes Nama third on every pull ever
//     played, so Mighty Thud is always the empowerment the pull runs out of time
//     for, and no amount of loop tuning can rescue an ability whose lateness is
//     an INPUT to the schedule rather than an output of it. The engine now draws
//     a Fisher-Yates over the list from the world seed (`feedOrderFor`), so a
//     fixed seed still reproduces a pull exactly and a session practises all
//     three empowerments instead of two. The list itself no longer claims an
//     order and nothing may read it as though it did.
//
//     HOW IT IS ACTUALLY BUILT, because it is not the 75% dice roll the number
//     above implies. The fish is still planted uniformly across the six crates,
//     and the player gets SIX SECONDS of first refusal on whichever one it fell
//     out of before the raid will touch it (`FISH_FIRST_REFUSAL_MS`); after that
//     the nearest non-tank raider carries it to this pull's feed order. On a dps
//     or healer pull the player is standing among the crates and takes it nearly
//     every time, which is where the "roughly three in four" comes from — it is
//     emergent from where the player is standing rather than rolled. On a TANK
//     pull the player is walking the stacked pair away from Gebbo and never
//     stops, so the raid takes every one of them, which is exactly what the
//     directive describes.
//
//     A weighted plant — 75% into one of the three crates reserved for the
//     player — is the piece that is still not built, and it is the piece that
//     would make the number literal rather than emergent. It is not needed for
//     the fight to work and it is written down here so nobody assumes it is.
//
//   ASSUMPTION K — A player who finds the fish and never delivers it simply
//     watches the bar fill. No bot takes over, there is no carry timer, and the
//     fish does not expire. Holding it is a choice and the bar is the
//     consequence; a second clock on top of Mor'zahi's is pressure the directive
//     never asked for.
//
//   ASSUMPTION L — Mighty Thud's landing zones fall on the raid rather than on
//     one nominated body (`origin: 'random'`), so who has to move is read off the
//     floor every cast. Frostfire Volley always pairs the player with exactly one
//     cooperating ally carrying the opposite element, because a bot that ignored
//     the trade would make the player's half unplayable through no fault of
//     theirs. Neither pool ever hurts anybody: an element pool is the only
//     purely-good ground in this raid, it cures the opposite element and does
//     nothing whatsoever to anyone else, including the carrier standing in their
//     own — it simply goes out once it has done its one job. See assumption Q.
//
//   ASSUMPTION M — Throw Junk re-arms 6 SECONDS after the empowered cast that
//     armed it (`rearmOn.delaySec`). Two reasons, and the second is load-bearing:
//     it gives the raid a beat to clear the craters or the pools the empowered
//     ability just left, AND it is longer than the span over which one Mighty
//     Thud resolves. Thud leaps twice 2.2s apart on a 4s telegraph, so its
//     resolves land 4.0s and 6.2s after the cast; the engine only arms a DORMANT
//     entry, so a delay shorter than that span would let the second leap arm
//     another crate window and drop two of them inside six seconds. THE TWO
//     NUMBERS ARE COUPLED: raise `leaps.gapMs` or `leaps.count` and this has to
//     move with them, or the crate windows start doubling up.
//
//   ASSUMPTION N — Steady Strikes is DECLARED but never scheduled. It is the
//     other tank's job on a body the player does not hold (see "the tank job"
//     below), so it is marked `collective`, kept out of `loop` and out of
//     `timeline`, and can therefore never resolve against anybody. It was
//     equally inert before this pass — it was authored as a `tankSwap` and
//     `tankSwap` only accrues stacks when it is scheduled, and it never was — so
//     nothing is lost by saying so out loud.
//
//   ASSUMPTION O — Blast Wave's SPEED and WIDTH. The directive says the bomb
//     "sends a blast wave across the room from the bomb's location" and that the
//     only answer is to be airborne off a mushroom; it gives no numbers. 11 yd/s
//     is chosen against the player's 14 so the line can be backed away from — a
//     second bought to line a mushroom up, never an escape, because the room has
//     a rim and running inward puts you in the crater. A 6-yard band is chosen so
//     the danger is a readable stripe of floor rather than a mathematical line
//     nothing could be judged against at 60fps.
//
//   ASSUMPTION P — the mushrooms outlive the wave they answer. Nothing in the
//     source says how long a Bouncy Mushroom sits on the floor, and the honest
//     constraint is arithmetic rather than taste: the pads have to still be there
//     at the LAST moment the ring can reach anybody. See the note on `mushrooms`
//     for the sum.
//
//   ASSUMPTION Q — REVERSED IN THE PACING PASS. One pool per carrier, and A
//     POOL IS CONSUMED THE MOMENT IT CURES SOMEBODY. The directive says a hit
//     carrier "will leave either a fire pool or ice pool", singular, and says
//     nothing either way about the pool being used up. Exactly two patches of
//     ground exist per volley, one of each element, and each carrier walks into
//     the other's — a single decision with a single destination. A drip would
//     smear the answer across the floor and solve the trade by accident.
//
//     THIS FILE USED TO ARGUE THE OPPOSITE, on the grounds that a cure spent on
//     first use would make whoever arrived second the loser of a race. That fear
//     does not apply to this mechanic and the reason is structural rather than
//     lucky: `polarity` deals exactly one fire carrier and one frost carrier, so
//     each patch has exactly one customer and there is no second arrival to lose
//     a race. One pool, one cure, gone. The gain is that the floor stops lying —
//     a spent cure that keeps drawing for another twenty seconds is a circle that
//     looks like an answer and is not one, sitting next to the one that still is.
//
//     THE INVARIANT THIS RESTS ON, stated so it cannot be broken by accident: if
//     a `polarity` ever deals two carriers of one element it must lay two patches
//     of the opposite ground with them. The same sentence is in the engine's
//     `elementPool` doc and on both pool entries below.
//
//   ASSUMPTION R — Mighty Thud leaps TWICE, not three times. The directive says
//     three non-tank targets and this is a deliberate departure from it, forced
//     by arithmetic that is worth writing down because it constrains anyone who
//     tries to put the third leap back.
//
//     The engine charges the raid a flat 0.3 of its one-and-only bar for every
//     Deadly `beInside` instance the PLAYER is not standing in, whatever the raid
//     does about it — allies fill the soak's other slots but the last slot is
//     always the player's and the resolve is measured at the player's feet. A
//     player tank is anchored to a stack mark that walks a 22-yard ring and this
//     mechanic explicitly does not mark tanks, so on a tank pull every leap is a
//     guaranteed miss. Three leaps is therefore 0.9 of the raid bar per cast,
//     with nothing anybody in the room can do about it.
//
//     That was survivable only while the ability barely fired. Once the pacing
//     pass made it arrive promptly and repeatedly it stopped being survivable at
//     all: an opened gate takes the next beat WITHOUT advancing the loop index,
//     so the beat after an empowerment is an ordinary turn that can be the same
//     id, and two Mighty Thuds one interval apart is 1.8 of a bar that starts at
//     1.0. Measured: the tank cell wiped on two seeds in three, at 82 seconds,
//     with five recorded failures — a wipe with no mistake in it. Two leaps
//     halves the cast to 0.6 and the double to 1.2 spread over twelve seconds,
//     which the raid's own regeneration covers, and the tank cell clears 3/3.
//
//     The rota survives the cut: closest first, then the next, still read off the
//     floor and still sequential. What is lost is the third beat of it. If the
//     engine ever learns that allies can satisfy a soak on the player's behalf —
//     which is the same lesson `reservePickups` already learned for collects —
//     this becomes three again on the same day.
//
// ── THE TANK JOB ─────────────────────────────────────────────────────────────
//
// THE TWO TANKED EXPLORERS ARE STACKED AND KITED. They are held together and
// walked around the room as one moving mark, and the mark is always on the far
// side of the floor from Gebbo.
//
// This is the opposite of what the file did before, and the reversal is the
// whole point. United Defense links only when ALL THREE explorers are inside 30
// yards of one another, so Nama and Iku standing on top of each other is
// perfectly legal — the widest pair is still the pair-to-Gebbo distance, and
// that is the only number anybody has to hold. Holding the two apart, which is
// what `tankedApart` does, spends both tanks on a separation the mechanic never
// asked for and leaves neither of them watching the body that actually closes
// the link. The readout drawn between them was measuring the wrong gap.
//
// The player tanks IKU, so Iku is entities[0]: the engine gives the player's
// tank entity 0, and a swap owned by anybody else would tell you to taunt
// something you are not holding. Iku's Shredding Shards is "a swap after each
// channel", which is a one-stack swap — `tankSwap` with `maxStacks: 1` — and it
// is the sharper, more frequent decision of the two tank mechanics, which is why
// it is the one the player gets. Nama is held by the ally tank and Steady
// Strikes is that tank's problem; it is `collective` and never scheduled, for
// the reasons in assumption N.
//
// THE RING, which the engine derives rather than the file stating:
//
//     link radius   30   (from `united`'s keepApart rule)
//   + margin         8   (STACK_KITE_MARGIN, pinned by the AI tank's 6yd leash)
//   − Gebbo's reach 16   (his patrol's |centre| + radius)
//   ─────────────────────
//     ring          22   yards from the arena centre, opposite Gebbo
//
// which puts the pair 22 + 16 = 38 yards from him — eight clear of the link — on
// a 50-yard floor, so the walk stays well inside the room. At his 9 deg/s the
// pair covers a lap in 40 seconds at about 3.5 yd/s, which is a walk rather than
// a sprint, and it never stops. `BossDef.tankStackKite` can pin or re-derive the
// ring if a later room needs it; this fight takes the derivation.
//
// AND THE CENTRE OF THE ROOM IS NOT SAFE. It is the obvious place to drag two
// bosses to and it is a permanent link: the middle is a flat 16 yards from Gebbo
// wherever he is on his lap, and 16 is under 30. The safe floor is the far side
// only, and it moves. That is the fight's tank mechanic and there is no station
// that answers it.
//
// One consequence worth stating out loud, because it looks like a bug: the three
// explorers START far apart — Gebbo at the top of his lap, Nama and Iku at
// opposite ends of the south rim, every pair more than 50 yards. A pull must
// never open inside its own failure state, and the tanks bringing the two
// together over the first few seconds is the pull, not an error.
//
// ── DELIBERATE SIMPLIFICATION: three boxes, not one ──────────────────────────
//
// In the real encounter a player can open exactly ONE box, because clipping a
// crate applies Splinters — a stacking bleed — and a second crate is a second
// stack. NEITHER THAT LIMIT NOR SPLINTERS ITSELF IS MODELLED. The bleed comes
// off soaking a Throw Junk crate and exists nowhere else in the fight, so it is
// not a free-floating debuff you could practise on its own terms; showcasing it
// as one taught a mechanic the encounter does not have. Here the player searches
// three boxes and the lesson is "all boxes must be soaked and the fish must be
// found", not "budget your bleed". Three searchable boxes is a simplification
// made on purpose. Do not "fix" it back to one, and do not re-add the bleed.
//
// ── HONEST DEVIATIONS ────────────────────────────────────────────────────────
//
//   • Mighty Thud leaps TWICE where the directive says three targets. It is the
//     one place in this file where an engine constant overrode the source, and
//     the arithmetic that forced it is assumption R. Do not put the third leap
//     back without reading it.
//
//   • The mushrooms scatter across the FLOOR rather than around Gebbo. The
//     directive says he throws them around himself, and he now laps the middle
//     of the room, so pads that followed him would cluster on the one ring of
//     floor the tanks are steering everybody away from. Spread across the arena
//     they are an answer to a bomb dropped anywhere, which is what they are for.
//
//   • Blink Nova's distance falloff CONTRADICTS its ability note, which reads
//     "wowhead shows a 300 yd radius with no distance falloff". The directive is
//     explicit that the further the marked player stands the less the raid
//     takes, and a mechanic with no dial on it is not worth practising. It is
//     still raidDamage, so it can never name anybody — the target holds the
//     dial, they are not at fault for holding it. The distance is measured from
//     the RAID, not from Iku: she blinks onto the marked player and the impact
//     catches whoever is standing near them, so the job is to run OUT.
//
//   • Cataclysmic Invocation's escalation is a HARD FLAT DRAIN, not a ramp.
//     "Hitting harder and harder" needs a per-cast multiplier the engine has no
//     notion of. A raid bar falling faster than healing covers teaches the same
//     lesson — finish the other two, or die to this.
//
//   • Blast Wave is an EXPANDING RING, not a slab. It was drawn first as an
//     annulus you ran out of and then as a wall too wide to outrun; both were
//     wrong in the same way, because neither has a moment at which it ARRIVES.
//     The real thing comes off the bomb as a line that travels, and timing the
//     jump against it is the mechanic: you can see it coming, count it in, and
//     have to leave the floor exactly as it reaches you. The danger is the LINE
//     — not the disc inside it and not the floor outside it — and being airborne
//     as it passes is still the only exemption in the engine that reads `aloft`.
//
//   • Shell Spin is three travelling LINES, not the frontal cone the tactic file
//     calls it. The directive is specific — "essentially 3 projectiles that shoot
//     from the front of the boss, one directly forward then another off either
//     side, all three shoot off in a straight line" — and that is a different
//     lesson from a cone: get out of the LANES, not out of the frontal.
//
// ── DELIBERATELY NOT MODELLED, and why ───────────────────────────────────────
//
//   • THERE ARE NO ADDS. The Useless Junk kill-wave is gone, along with
//     `addEverySec` and `maxAdds`. Throw Junk crates are a `collect` — you walk
//     onto them and one of them has the fish in it — and Bouncy Mushrooms are
//     launch pads. Neither is an enemy, nothing in this encounter is shot down,
//     and a kill-wave taught a raid to cleave junk instead of finding a fish.
//     Relic Rupture (1310027) leaves with it: it is the add's ability and there
//     is no add.
//   • Splinters (1308853) is gone. It only ever happens as the price of soaking
//     a Throw Junk crate, so as a standalone debuff on the rotation it was a
//     mechanic the encounter does not have. See the simplification note above.
//   • Mor'zahi's Command is no longer authored as a `syncKill` rule. An
//     unsynchronised kill is ALREADY punished — the survivors gain Relentless
//     Escalation, Cataclysmic Invocation and Smashing Shovel — and scoring it as
//     well would punish one mistake twice. The kill-spread warning (one explorer
//     under 10%, another more than 10% above it) stays as a teaching cue that
//     CANNOT be failed: it tells you to even them out, and the fight getting
//     harder is what happens if you do not.
//   • The Creepy Statues and Evil Eyes (1292764 / 1292758) are gone. They were
//     the previous file's constant movement tax, and this fight now has three
//     rotations, a lapping third boss, a fish economy, a moving tank mark and a
//     polarity puzzle running at once. A seventh source of small floor damage
//     would be noise over the top of decisions, not another decision.
//   • Creepy Flames (1292796) still has no confirmed damage ID — inventing one
//     would be exactly the dishonesty the tests exist to catch.
//   • Frost Patch (1297648) and Spreading Flames (1297650) are the same rule as
//     Fire Patch on the same section of the tactic file, so they are one entry
//     rather than three identical ones.
//   • Shredding Shards has three ids (1310616 / 1295854 / 1295858); only the
//     primary channel is authored, because the swap it drives is one decision.
//   • Explosive Surprise's impact id (1296245) is not used. The mechanic here is
//     the 10s carrier marker (1297625), the crater it leaves and the ring it
//     sends out; a third circle at the drop point would only repeat Concussive
//     Blast.
//   • Every cast marker is left out on purpose: Shell Spin 1296062, Mighty Thud
//     1296095/1296135/1296094/1296133, Throw Junk 1291934/1291933/1306137/
//     1306145, Blink Nova 1296021, Relic Rupture 1310028, Mor'zahi's Command
//     1297022/1296975/1297024. The data calls them markers and a marker can
//     never be something a player fails.
//   • Final Ascension (1297075 / 1292779 / 1292780) is the bar filling. It is
//     named through enrageName rather than authored as a mechanic: routing it
//     through the engine's full-energy hook would make the bar self-emptying and
//     delete the enrage the whole fish economy exists to hold off.
//   • Dark Whispers (1301667), Dark Unity (1313126) and Haunting Spirits
//     (1310561) are journal- or Environment-sourced with unconfirmed triggers.
//     Surfaced in RaidLens, not drilled here.
//   • The Bouncy Mushroom NPC (268045) is authored as a mechanic rather than an
//     add, because it is a tool and this fight has no adds at all. Bounce
//     (1299854) is a SUCCESS signal in the logs, so it can never be an add you
//     might mistakenly kill.

export const explorers: BossDef = {
  key: 'explorers',
  name: 'The Lost Subagents',
  realName: 'The Lost Explorers',
  blurb: "Three bodies, one bar, and three fish. Feed them or Mor'zahi ascends.",
  // Measured from PTR combat logs, not guessed: Circle, high confidence (CV 6.9%, corner/axis 0.94). 138,505 samples over 46 pulls.
  // 1 yard = 100 coordinate units.
  arenaRadius: 50,
  // IKU FIRST, and it is load-bearing: the engine hands entities[0] to the
  // player's tank, and this fight's player-facing tank mechanic is Iku's
  // Shredding Shards. Nama is the ally tank's, and Gebbo is nobody's.
  //
  // Both tanked bodies are `tankedStacked`, not `tankedApart`. See "the tank
  // job" in the header: they are held TOGETHER and walked, and the distance that
  // is being judged is the pair's distance to Gebbo.
  entities: [
    // Iku WEST and Nama EAST, which is not arbitrary: the engine seats a stacked
    // body on the mark by its index in this array, offset perpendicular to the
    // walk — entities[0] takes the left shoulder. Started the other way round
    // the two of them walk through each other on the pull to reach their own
    // shoulders, which looks like a bug and is not one.
    { id: 'iku', name: "Scrollsage Iku", npcId: 261843, start: { x: -26, y: -34 }, tankedStacked: true },
    { id: 'nama', name: "First Mate Nama", npcId: 261835, start: { x: 26, y: -34 }, tankedStacked: true },
    // Gebbo is not tanked and cannot be moved by anybody. He laps the ARENA
    // CENTRE at radius 16, continuously, all pull — which sweeps the middle of
    // the room out of the safe set and is why the two stacked tanks have to keep
    // walking. Assumption F has the arithmetic. `start` is the point his lap is
    // at when the pull begins (startDeg 90 → (0, 16)), so he never snaps.
    { id: 'gebbo', name: "Trader Gebbo", npcId: 261848, start: { x: 0, y: 16 }, patrol: { centre: { x: 0, y: 0 }, radius: 16, degPerSec: 9, startDeg: 90 } },
    // Outside the health pool: 0 damage taken across 10,001 player damage events
    // in a Mythic PTR log, while casting Malevolent Presence 1,911 times. He is
    // the energy bar and nothing else.
    { id: 'morzahi', name: "Mor'zahi", npcId: 261584, start: { x: 0, y: -44 }, untargetable: true },
  ],
  // A MULTIPLE of the ordinary pool, and live — this is the kill-pacing lever
  // now that the engine reads it. See assumption C: the target is the third
  // empowered mechanic landing with roughly 10% left on each explorer, and the
  // only honest way to hit it is `npm run playtest`, because the pull's length
  // is emergent from the fish gates rather than set by a clock.
  //
  // 0.8 → 0.66 WHEN BLAST WAVE BECAME A RING. The wave now crosses the whole
  // floor instead of covering a six-yard disc, so the raid spends the back half
  // of every bomb cycle standing on mushrooms rather than shooting — measured,
  // the pull runs about twenty seconds longer for the same health — and the bar
  // does not slow down to match. 0.66 puts the third empowered mechanic back at
  // roughly a tenth of each pool, which is what this dial is for.
  //
  // It is not a smooth dial, because health and difficulty are coupled through
  // the council — kill one explorer early and the survivors are handed
  // Relentless Escalation and Cataclysmic Invocation, so a SHORTER fight is not
  // automatically an easier one. Move it against the sweep, one step at a time,
  // and never by eye.
  //
  // The pool it multiplies is derived from `pullLengthSec`, so the two are not
  // independent: raising the backstop from 160 to 200 raised the health pool by
  // a quarter until this came down to match. Change one, check the other.
  //
  // 0.66 → 0.76 IN THE PACING PASS, and it moved UP even though the fight got
  // busier. The reason was the fish economy rather than survivability: a body
  // that dies before it has eaten can never be empowered, its ability can never
  // fire again (a corpse casts nothing), and the encounter's third fish then has
  // no mouth left to go into — so Mor'zahi's bar becomes unresettable and the
  // pull ends on an enrage it did nothing to earn. The dps seeds showed exactly
  // that: Iku burned to 4% by seventy seconds and the Frostfire Volley the
  // player had paid for never happened at all. A deeper pool was a longer pull,
  // and a longer pull was what the third fish needed.
  //
  // 0.76 → 0.62 IN THE VERIFICATION PASS, and it is that argument being RETIRED
  // rather than reversed. The body dying unfed was never a health problem: it
  // was a target-discipline problem in the simulated raid, which opened on
  // whichever explorer sat first in the array and drove it to the bone before
  // the first crate window had closed. The bot now levels the council until
  // somebody has eaten and only ever burns a body that already has (see the
  // council-evening block in playtest.mjs), so no mouth is lost on any seed in
  // any role — which takes the floor out from under this dial and leaves it free
  // to do the only job it was ever for.
  //
  // WHICH IS KILL PACING, and the pacing fix made every pull longer: the raid is
  // now standing on mushrooms and running out of Mighty Thuds for the whole
  // second half instead of the last twenty seconds of it. At 0.76 the tank cell
  // dropped to 2/3 and the healer ran into the enrage in every seed; 0.62 puts
  // all three back. It is still bounded above rather than free — 0.66 already
  // costs the tank a seed — and the bound below is now only the health pool
  // being deep enough to be a fight at all.
  //
  // Measured at 0.62 with `energyPerSec: 1.30`: tank kills 3/3 at 132s, healer
  // 2/3 at 167s, dps 3/3 at 138s, every careless cell dies, and all three
  // empowerments land on every seed in every role with 36-77s of pull to spend
  // on them.
  maxHp: 0.62,
  // 5.5 → 6.0 WITH THE TWENTY-ENTRY LOOP. This is the fight's cast density and
  // nothing else, and the two numbers are chosen together: see `loop` for why
  // the array grew and why the beat had to slow to pay for it.
  loopIntervalSec: 6.0,
  introEverySec: 5,
  // 69s per bar. Feeding a fish is the only thing that empties it, so the pull
  // is one bar plus whatever three well-timed resets buy — and "well-timed" is
  // the whole of it: a fish spent at 20 energy throws four fifths of the reset
  // away, and the sweep showed that habit alone costing about eighty seconds of
  // pull. See assumption C; every number in this block was settled with
  // `npm run playtest`, not by eye.
  //
  // KNOWN CONSEQUENCE of one constant rate: the windows between feeds are not
  // equal. Pull → first feed is the bar climbing on its own, and every feed after
  // that is a hold the raid chooses to end. That is accepted rather than fixed;
  // a per-fish step-down is a decision nobody has asked for yet.
  //
  // THE "ROUGHLY 70% AT A FEED" TARGET THIS BLOCK USED TO CARRY IS RETIRED. It
  // was a proxy for "the bar is frightening by the time the reset lands", and as
  // a target it had one fatal property: it made the bar's rate the schedule for
  // the whole fight, because a raid holding for 70% of a 69-second bar is a raid
  // standing still for forty-eight seconds three times a pull. The bar level at
  // a feed is now an OUTPUT — roughly 40-70% depending on how long the walk to
  // the mouth took — and the thing being tuned here is the clock.
  //
  // 1.8 → 1.75 WHEN origin/main's ALLY AI ARRIVED, and it is the second half of
  // that retune rather than a number moved on its own — see the `loop` note
  // below for the first half, which is the load-bearing one.
  //
  // What changed underneath: origin/main measures the ally movement deadzone in
  // yards on the floor instead of against the eased step, so every raider in the
  // raid now actually arrives where it was sent instead of stopping two to seven
  // yards short. That is a straight improvement and this fight was tuned against
  // the old behaviour. Delivery of the first fish moved from a reliable ~2s walk
  // to 42.8-50.4s of wall clock depending on seed, and every downstream beat
  // moved with it.
  //
  // 1.75 → 1.5 WHEN BLAST WAVE BECAME A RING, for the same reason `maxHp` moved:
  // a wave that crosses the whole floor takes the raid off the boss for the back
  // half of every bomb cycle, so the pull is longer and the bar has to be
  // correspondingly slower or the fish economy simply cannot keep up with it.
  //
  // 1.5 → 1.45 IN THE PACING PASS, and it is a SMALL move on purpose. This dial
  // is a cliff rather than a plateau and the pacing pass re-measured the cliff
  // rather than assuming the old samples still held. The mechanism behind the
  // cliff was the one thing worth remembering — a competent raid does not spend
  // a fish the instant it finds one, it holds until the bar is nearly full, so
  // the bar's RATE set how long each fish was carried and therefore when the
  // next empowerment landed. A slower bar did not buy time; it postponed the
  // empowerment that arms the next crate window, and every beat downstream moved
  // with it.
  //
  // 1.45 → 1.30 IN THE VERIFICATION PASS, AND THE CLIFF IS GONE — that coupling
  // was the cliff, and it has been cut at the other end. The simulated raid now
  // holds a carried fish for at most `FISH_HOLD_CAP_MS` (playtest.mjs), a figure
  // in SECONDS, so the empowerment schedule no longer rides on this number and
  // this number is free to be what it always claimed to be: the enrage clock,
  // and nothing else. Sampled rather than interpolated, as ever, at
  // `maxHp: 0.62` and against the finished loop:
  //
  //     1.15  healer clears with 189s of pull, but the bar is so slow that a
  //           fish spent on the cap is spent at a third of a reset and one row
  //           in six never buys its third empowerment
  //     1.20  same, and the dps cell drops to 2/3
  //     1.26  every cell clears; one row in eighteen lands its third empowerment
  //           with under twenty seconds left
  //     1.30  every cell clears, every row lands all three, 36-77s to spend
  //     1.35  the healer runs into the enrage on two seeds in three
  //     1.45  the healer runs into the enrage, boss at 7%
  //
  // The two ends fail for opposite reasons and neither is survivability: below,
  // the resets are too small to be worth the hold; above, the clock is simply
  // shorter than the healer's kill. Re-run the sweep rather than reading between
  // those rows.
  //
  // The longest-window ceiling above is superseded by the hold cap, which now
  // bounds the gap between feeds directly instead of leaving it to be inferred
  // from a percentage of a bar.
  energyPerSec: 1.30,
  // atFullEnergy deliberately UNSET. The bar IS the enrage, and naming a
  // full-energy mechanic would make it empty itself.
  enrageName: "Final Ascension — Mor'zahi ascended",
  // The rest of the raid chips whatever you are NOT shooting, stopping chipLag
  // short of your focus. You steer the balance between three health pools purely
  // by where you point, and the kill-spread warning tells you when to move.
  alliesChipOffTarget: true,
  // Deliberately just ABOVE the 10% the kill-spread warning fires at, so the
  // warning is the normal late-pull state and evening the three out is a job
  // rather than a footnote. It cannot go much higher: the raid never drags a
  // body below `your focus + chipLag`, so this figure is also, exactly, the
  // health you personally have to burn off the last two once the leader falls.
  chipLag: 0.11,
  ambient: ['presence'],
  // Not an enrage — the bar is the enrage. This is the BACKSTOP, and with the
  // timeline in place the thing that ends a losing pull should always be
  // Mor'zahi rather than this number. If pulls start ending on it, the fish
  // gates have stalled and that is the bug to chase, not this figure.
  //
  // It was 160 and it was NOT a backstop: the healer's pull ended on it at 160s
  // with the council at 3% and Mor'zahi's bar at half, which is a clock ending a
  // fight the fight had not finished. 200 puts it back behind the bar in every
  // cell of the sweep. Note it also scales the health pool — see `maxHp`.
  pullLengthSec: 200,

  // Three explorers casting at once, so the loop never gives you a clean beat.
  //
  // Shell Spin, Blink Nova and Throw Junk are NOT here — they are on the
  // timeline below, and having them in both would double-fire them. What is left
  // is the fill: the kick, the tank channel, the pools, and the gated entries.
  //
  // The empowered and death-unlocked entries sit in the list all pull and are
  // gated by the engine: they simply do not fire until an explorer has eaten or
  // an explorer has died. Authoring them into a second loop would have hidden
  // half the fight behind a stage change this council does not have.
  //
  // ── THE ONE NUMBER THIS ARRAY IS NOW CHOSEN FOR ──────────────────────────
  //
  // THE COUNT OF EACH ID IS THE CADENCE OF THAT ID, and on this fight that is
  // the whole of the tuning. The engine reads an id appearing k times in a loop
  // of n at interval T as "due every n·T/k" (`designedGapMs`), and that figure
  // does two jobs at once:
  //
  //   • it is the ordinary round-robin spacing, as it always was; and
  //   • it is the CEILING on how often a beat that would otherwise have been
  //     silence may be converted into a cast of that id. A gated mechanic can
  //     never arrive faster than the array says it should — the promptness rules
  //     recover the gap between "late" and "not until next rotation", and
  //     nothing more.
  //
  // So an empowered ability's rep rate is set HERE and nowhere else. Twenty
  // entries at `loopIntervalSec: 6.0` is a two-minute rotation, and three turns
  // apiece buys forty seconds:
  //
  //     thud  x3   volley  x3   gebbospree  x3   → 40.0s each
  //     flames x4  shards  x4                    → 30.0s each
  //     escalation / cataclysm / shovel x1       → 120.0s each, and all three
  //                                                are shut on a clean pull
  //
  // TWO TURNS EACH IN AN EIGHTEEN-ENTRY ARRAY WAS THE BUG THE USER REPORTED.
  // At x2 in 18 x 5.5 the designed gap is 49.5 seconds, so even with the
  // empowerment bought at forty seconds Mighty Thud got two casts in a whole
  // pull and Mushroom Toss two — "it comes in right before the enrage so it's
  // not able to practise", exactly.
  //
  // FOUR TURNS EACH WAS TRIED AND IS WORSE, which is the counter-intuitive
  // result worth writing down before somebody reaches for it again. A
  // twenty-one entry array at x4 is a 31.5s cadence instead of 40s, and it made
  // every measurement in this file go backwards: more heavy casts means the raid
  // spends more of the pull on mushrooms and in craters rather than shooting, so
  // the pull runs longer, so every feed lands later, so the LAST empowerment is
  // squeezed harder than it was before. Measured, it took the count of empowered
  // abilities firing only once from thirteen in fifty-four to fifteen. The rep
  // rate of an empowered ability is bounded by the fight's total length far more
  // tightly than by its slot count, and this array is not the lever it looks
  // like.
  //
  // Measured at x3 in twenty, across six seeds and three roles: every one of the
  // eighteen pulls buys all three empowerments, seventeen of them with 36-77
  // seconds of pull left for the last one (the eighteenth has 6.6s), and
  // fifty-one of the fifty-four abilities bought fire two to eight times. The
  // three that fire once are all the ability bought LAST on a dps pull, which is
  // the shortest pull in the sweep — unavoidable when the fight sells them one
  // at a time, and the reason `feedPriority` had to stop making the same one
  // last every pull.
  //
  // WHAT THE EXTRA TWO SLOTS COST, and why the interval moved with them. Going
  // from x2 to x3 on three ids is six more heavy casts per rotation, and these
  // are not cheap entries: one Mighty Thud is two leaps plus two Aftershock
  // craters, and one Mushroom Toss is ten pads, a bomb, a travelling ring and a
  // Concussive Blast pool. Holding the array at eighteen and the interval at 5.5
  // put all of that on the floor at the old cast density and every cell of the
  // sweep died inside a hundred seconds — the crate window in particular is ten
  // seconds long and answered with your feet, and it cannot also be a Mighty
  // Thud soak. So the array is TWENTY entries at 6.0s rather than eighteen at
  // 5.5s: total density falls from one cast per 5.5s to one per 6.0s, `flames`
  // and `shards` keep four turns each (the kick is the one button this fight
  // asks a dps for, and the tank swap is the tank's only decision), and the
  // empowered half still arrives every forty seconds.
  //
  // EVERY GATED ID HAS A TURN IN THE FIRST THIRD (thud 1, volley 3,
  // gebbospree 5) and that placement is load-bearing rather than tidy. The
  // engine only keeps an appointment for a gate inside the INTRODUCED stretch of
  // the array, and `introEverySec: 5` means 2 + t/5 entries are live — so an
  // empowerment bought at t=30 can only be honoured promptly by a turn at index
  // 7 or below. A first turn parked in the back half would be an appointment the
  // staging quietly refused to keep.
  //
  // AND EACH ID'S THREE TURNS SIT SIX OR SEVEN APART, which is not tidiness
  // either. An appointment does NOT advance `loopIndex` — it is inserted, not
  // substituted — so the beat after an empowerment lands is an ordinary turn,
  // and if that turn is the same id you have just bought you get the same
  // mechanic twice in one interval. Spreading the turns is what keeps that to
  // one beat's worth of bad luck instead of a cluster of them; the reason it
  // matters is spelled out on `thud`'s `leaps`.
  loop: [
    'flames', 'thud', 'shards', 'volley', 'escalation',
    'gebbospree', 'flames', 'shards', 'thud', 'cataclysm',
    'volley', 'flames', 'gebbospree', 'shards', 'thud',
    'shovel', 'volley', 'flames', 'gebbospree', 'shards',
  ],

  // The three casts the encounter gives real intervals for. See the block at the
  // top of this file for why a round-robin cannot hold them.
  //
  // These run THROUGH the crate window on purpose. Shell Spin at 5/35/65 and
  // Blink Nova at 10/40/70 are not paused for Throw Junk at 30 — a Shell Spin
  // landing five seconds into a ten-second crate window, and a Blink Nova at the
  // end of it, is the intended difficulty of this fight.
  timeline: [
    { id: 'shellspin', startSec: 5, everySec: 30 },
    { id: 'blinknova', startSec: 10, everySec: 30 },
    // #1 is on the clock. #2 and #3 are armed by whichever empowered ability the
    // player bought with the previous fish actually happening: Mighty Thud
    // landing, Frostfire Volley going out, or Gebbo's bomb being planted. That
    // is the whole shape of the fight — crates, fish, feed, empowered cast,
    // crates — and a fixed period would either arrive before the player had
    // anything to do with it or leave the bar climbing against a fish that does
    // not exist yet. `delaySec` is assumption M and it is not decoration.
    { id: 'throwjunk', startSec: 30, rearmOn: { anyOf: ['thud', 'volley', 'bomb'], delaySec: 6 } },
  ],

  // WHICH MOUTHS EXIST, not which one comes first. The engine shuffles this
  // once per pull out of the world seed and feeds in THAT order, skipping any
  // explorer that has already eaten — see `World.feedOrder` and `feedOrderFor`.
  // Assumption J.
  //
  // IT USED TO BE A RANKING AND THE RANKING WAS THE BUG. Read strictly in order,
  // ['iku','gebbo','nama'] made Nama third on every pull anybody had ever
  // played, which made Mighty Thud the empowerment the pull always ran out of
  // time for — the user's report, in as many words: "First Mate Nama's empowered
  // ability comes in right before the enrage so it's not able to practise". No
  // amount of loop tuning fixes a body that is structurally last, because being
  // last is not a consequence of the schedule, it is an input to it. A trainer
  // that can only ever teach two of the three abilities it contains is not
  // teaching the fight.
  //
  // The old ranking's argument — Iku first because Frostfire Volley most changes
  // the pull, Nama last because the raid can cover Mighty Thud — was a real
  // argument about a single pull and the wrong one for a SESSION. Over three
  // pulls the shuffle gives every explorer the first fish about as often as the
  // others, so all three empowerments get practised and none of them is ever the
  // one you only read about. Measured over six seeds: every one of the three is
  // the last mouth on at least one of them, and the order differs again by role
  // because the roll happens on the same seeded stream the rest of the pull draws
  // from. A fixed seed still gives a fixed order, so the playtest remains an
  // instrument. That is exactly what `the feed order varies between pulls and is
  // fixed by the seed` in engine.test.js holds this to.
  //
  // The list ITSELF is therefore no longer ordered on purpose, and nothing
  // downstream may read it as though it were. Left in entity order.
  //
  // The playtest bot read this raw list as a ranking for a whole pass after it
  // stopped being one, which put the player and the raid on two different orders
  // in the same pull and quietly restored the structural last place the shuffle
  // exists to remove. It reads `World.feedOrder` now. If anything else ever
  // needs "which mouth first", that is the field it wants.
  //
  // The player gets six seconds of first refusal on every fish before the raid
  // touches it, so this is a backstop rather than the normal path — on a dps or
  // healer pull the player is standing among the crates and finds it themselves.
  // On a TANK pull it is the only path there is: the player is walking the
  // stacked pair away from Gebbo and never stops, so without this the fish lay
  // where it fell, Mor'zahi's bar could not be emptied at all, and the enrage was
  // scenery in a role that had no decision available to it.
  feedPriority: ['iku', 'nama', 'gebbo'],

  mechanics: [
    {
      id: 'united',
      name: 'United Defense',
      spellId: 1297646,
      what: "Heroic+. All three explorers take 99% reduced damage while within 30 yds of each other — so the tanks stack Nama and Iku and walk the pair away from Gebbo.",
      from: 'nama',
      roles: ['tank'],
      telegraphMs: 0,
      origin: 'boss',
      // Read as the WIDEST pair, not the closest: "all three within 30" is
      // literally "the widest pair is under 30". THIS RULE IS UNCHANGED and it
      // is the reason the tank job could be reversed without touching it — with
      // Nama and Iku stacked, the widest pair IS the pair-to-Gebbo distance, so
      // the number being scored is already the number that matters. What was
      // wrong before was the entity flags and the tank AI, not this.
      rule: { type: 'keepApart', minYards: 30 },
      good: 'The stacked pair walks the far side of the room from Gebbo all pull and never links.',
      failText: 'The explorers linked — United Defense, 99% damage reduction',
    },
    {
      id: 'strikes',
      name: 'Steady Strikes',
      spellId: 1291929,
      what: "Debuff on Nama's current target, +4% damage taken from Nama per melee for 30s — the ALLY tank's swap driver, and never yours.",
      from: 'nama',
      roles: ['tank'],
      telegraphMs: 1500,
      origin: 'boss',
      // Assumption N, and the reason it is not a `tankSwap`: the player holds
      // Iku, so a swap on Nama is a swap between two AI tanks — and with one ally
      // tank there is no third body to hand Nama to, so the engine's swap block
      // would eventually score the player for a taunt they cannot make and then
      // give them a second boss to hold.
      //
      // Expressed as the BUTTON the off-tank presses, which is the convention
      // this file already used for a swap the player does not own. Declared,
      // `collective`, and deliberately absent from `loop` and `timeline`, so it
      // never resolves and can never name anybody in any role. It is here
      // because the ally tank's job is part of the fight the player should be
      // able to read in the brief, not because it is playable.
      //
      // NOT a `stackingDot`, which the engine defines as "a debuff that kills
      // the body carrying it if reapplied" — the swap count is five melee hits,
      // not a death sentence, and a rule that kills owes the debrief a sentence
      // this one has no way to earn.
      rule: { type: 'press', ability: 'taunt', withinMs: 3000 },
      collective: true,
      good: 'The Nama tanks trade at the agreed stack count, every time.',
      failText: '',
    },
    {
      id: 'shellspin',
      name: 'Shell Spin',
      spellId: 1291918,
      what: "Nama throws three spinning shells — one straight ahead and one off each shoulder — that travel across the room in a straight line; contact stuns 4s.",
      from: 'nama',
      roles: ['tank', 'dps', 'healer'],
      // Short: the shells are the telegraph. They are on the floor and moving
      // for six seconds after it, which is where the reading actually happens.
      telegraphMs: 1500,
      // THREE LANES, not a cone. The lesson is to be out of a lane rather than
      // out of a frontal, and a lane is a `line` that travels. `fanDeg` centres
      // the fan on Nama's own facing — a full-circle fan would put a shell behind
      // him, which is the one patch of floor the mechanic says is safe.
      // Assumption H has the separability arithmetic; assumption I has the speed.
      shape: { kind: 'line', length: 12, width: 8 },
      origin: 'boss',
      count: 3,
      fanDeg: 70,
      radialDrift: true,
      driftSpeed: 9,
      // Everyone's problem, not the tank's: "any applydebuff of 1291918 on any
      // player, tanks included — a 4s stun in a Blast Wave window is a death."
      // So it is an avoid, not a faceAway, and the engine only re-aims boss
      // frontals for faceAway — these shells fly where they were thrown.
      rule: { type: 'avoid' },
      // One shell, one hit. The stun is not modelled — the engine has no stun —
      // so the damage carries the whole cost of being clipped, and the shell is
      // consumed rather than ploughing on through the raid.
      popsOnContact: true,
      lingerMs: 6000,
      damage: 0.36,
      good: 'Everybody steps out of the three lanes and nobody is clipped.',
      failText: 'Clipped by Shell Spin — stunned for 4s',
    },
    {
      id: 'thud',
      name: 'Mighty Thud',
      spellId: 1300237,
      what: "Nama marks non-tanks and leaps at each in turn, closest first; impact damage splits among everyone in the landing zone, and the crater then quakes.",
      lethal: true,
      from: 'nama',
      // DPS AND HEALER ONLY, for the same reason Throw Junk is, and the
      // directive already says so: "targets 3 NONE TANK players".
      // A tank on this fight is walking a stacked pair away from a patroller and
      // cannot stop — a soak scored against them is a failure with no action
      // available, which is the one defect this project keeps having to re-fix.
      // Measured before the change: six Mighty Thud failures on a competent tank
      // pull, none of them reachable, on a mechanic that marks somebody else.
      roles: ['dps', 'healer'],
      telegraphMs: 4000,
      shape: { kind: 'circle', radius: 8 },
      origin: 'random',
      // Deadly on a beInside means a RAID hit when too few bodies are in it,
      // never your death — the engine has no path from a missed soak to a dead
      // player, and blaming one person for a collective miss is the defect this
      // project keeps refixing.
      rule: { type: 'beInside' },
      // Closest, then the next one. Simultaneous soaks would be a choice of
      // which to stand in; sequential ones ordered by proximity are a rota you
      // have to read, and the rota is the mechanic.
      //
      // THREE LEAPS → TWO, AND IT IS ARITHMETIC RATHER THAN TASTE. Assumption R
      // has the sum; the short version is that the engine charges the RAID a
      // flat 0.3 of its one-and-only bar for every Deadly `beInside` the player
      // is not standing in, and a player tank — whom this mechanic explicitly
      // does not mark — cannot be standing in any of them. Three leaps is
      // therefore a guaranteed 0.9 of the raid bar per cast on a tank pull, and
      // two casts inside one rotation is 1.8, which is a wipe from full health
      // with no play available to anybody. The pacing pass made two casts inside
      // one rotation a routine event rather than a rare one — an opened gate
      // takes the next beat and does not advance the loop index, so the beat
      // after it is an ordinary turn that can be the same id — and the tank cell
      // died on two seeds in three to exactly that. At two leaps the same double
      // costs 1.2 spread over twelve seconds, which the raid's own regeneration
      // covers, and the tank cell clears 3/3.
      //
      // Also the reason Throw Junk's re-arm carries a delay: the leaps on a 4s
      // telegraph resolve 4.0s and 6.2s after the cast. See assumption M.
      leaps: { count: 2, gapMs: 2200 },
      // No source states a required count; the file only says deaths mean "too
      // few bodies in the marker", so 5 is a placeholder to confirm with the RL.
      soakers: 5,
      spawns: { defId: 'aftershock' },
      good: 'The soak group stacks into each marker in turn and clears the crater the instant it resolves.',
      failText: 'Missed the Mighty Thud soak — the hit was not split',
      empoweredOnly: 'nama',
    },
    {
      id: 'aftershock',
      name: 'Aftershock',
      spellId: 1310500,
      what: "Quaking ground left where Mighty Thud landed — any tick after the soak means the crater was not cleared.",
      from: 'nama',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,
      shape: { kind: 'circle', radius: 8 },
      origin: 'random',
      rule: { type: 'avoid' },
      damage: 0.12,
      lingerMs: 14000,
      good: 'The soak group stacks into each marker in turn and clears the crater the instant it resolves.',
      failText: 'Stood in the Aftershock crater',
    },
    {
      id: 'escalation',
      name: 'Relentless Escalation',
      spellId: 1296227,
      what: "Nama gains this when Gebbo or Iku dies: he walks up to the tank and the raid and starts killing them.",
      from: 'nama',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2200,
      shape: { kind: 'circle', radius: 15 },
      origin: 'boss',
      // Assumption D: he walks up to people and kills them, so a circle you must
      // not be in is exactly that shape — and it ramps toward a wipe rather than
      // ending the pull, because it is the PRICE of an unsynchronised kill.
      //
      // This, Cataclysmic Invocation and Smashing Shovel are the WHOLE
      // punishment for an unsynchronised kill. There is no `syncKill` rule in
      // this fight any more, precisely so that one mistake is not scored twice.
      rule: { type: 'avoid' },
      damage: 0.45,
      unlockedByDeathOf: ['gebbo', 'iku'],
      good: 'Nothing unlocks it, because the three die together.',
      failText: 'Caught by Relentless Escalation',
    },
    {
      id: 'flames',
      name: 'Icebound Flames',
      spellId: 1286922,
      what: "4s cast on one player — Frostfire hit plus a 12s DoT with a 50% snare. THE ONLY KICKABLE CAST IN THE FIGHT, and a landed kick visibly breaks the bar.",
      from: 'iku',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 4000,
      // A shape purely so the telegraph is visible — the renderer skips
      // shapeless instances, and a kick you cannot see is a kick you cannot
      // practise. It is also what the interrupt has to visibly break: a
      // successful kick sets `Instance.interrupted`, which snaps the cast to
      // zero and draws the telegraph fractured, and the PLAYER's kick also sets
      // `World.interruptFlash` so the callout fires. A raider must never have to
      // guess whether their kick went through, and before this pass there was
      // nothing on screen either way.
      //
      // Three turns in the loop rather than two — slot 2 was Splinters and this
      // is the cheapest thing to spend a freed slot on. The kick is the one
      // button this fight asks a dps or a healer to press, so reps are the point.
      shape: { kind: 'circle', radius: 7 },
      origin: 'boss',
      rule: { type: 'press', ability: 'interrupt', withinMs: 4000 },
      damage: 0.26,
      good: 'Kicked every time, and you can see it break — 46 kicks against 5 completions on Mythic PTR.',
      failText: 'Missed the kick — Icebound Flames landed the snare',
    },
    {
      id: 'shards',
      name: 'Shredding Shards',
      spellId: 1310616,
      what: "Tank channel — shards every 0.5s for 4s at the current target, and the tanks trade after every channel.",
      from: 'iku',
      roles: ['tank'],
      telegraphMs: 3000,
      shape: { kind: 'circle', radius: 6 },
      origin: 'boss',
      // THE player's tank mechanic, and the reason Iku is entities[0]. "A swap
      // after each channel" is a one-stack swap: one channel lands, the debuff
      // is up, and the trade is due. maxStacks 1 makes the decision sharp and
      // frequent, which is the whole reason this is the one the player holds
      // rather than Nama's slow melee climb — and it is now a trade made on the
      // move, because the pair never stops walking.
      rule: { type: 'tankSwap', maxStacks: 1 },
      damage: 0.3,
      good: 'The Iku tanks trade after every channel; only tanks appear in the damage rows.',
      failText: 'Held Shredding Shards past the swap',
    },
    {
      id: 'blinknova',
      name: 'Blink Nova',
      spellId: 1294334,
      what: "Iku marks a non-tank, charges for 4s and blinks on top of them; the raid eats the arrival, and the further the marked player is FROM THE RAID, the less it lands for.",
      from: 'iku',
      roles: ['dps', 'healer'],
      telegraphMs: 4000,
      shape: { kind: 'circle', radius: 6 },
      origin: 'targeted',
      // raidDamage, so it can NEVER name anybody — being chosen is not a
      // mistake, it is being handed the only dial anyone has on the size of it.
      //
      // The falloff is measured from the RAID, not from Iku. She blinks onto the
      // marked player wherever they are standing, so the distance that matters is
      // how far that is from everybody else; measured from the boss it would tell
      // a marked player to run away from a body that is about to teleport to
      // them, which is advice about nothing. The falloff contradicts the 300 yd
      // note on this id; see the header.
      //
      // 26 → 18 with `presence` and `feedback`. This is a lump on the raid bar
      // every thirty seconds off the timeline — the most frequent raid-damage
      // event in the fight — so it competes directly with the raid's ability to
      // pay for an unsoaked Mighty Thud. The falloff is untouched: the DIAL the
      // marked player holds is the point of this mechanic, and it is still worth
      // four times the damage between standing in the raid and running out.
      rule: { type: 'raidDamage', dps: 18, falloff: { nearYards: 8, farYards: 38, farMultiplier: 0.25 } },
      good: 'The marked player runs clear of the raid before it lands, and the raid barely feels it.',
      failText: '',
    },
    {
      id: 'volley',
      name: 'Frostfire Volley',
      spellId: 1295891,
      what: "Empowered Iku hands one non-tank Burning Flames and another Piercing Frost; each drops exactly ONE pool of their own element, and the only cure is walking into the other's.",
      from: 'iku',
      roles: ['dps', 'healer'],
      telegraphMs: 3500,
      shape: { kind: 'circle', radius: 40 },
      origin: 'boss',
      // Being handed an element is never a fault, the same convention as aimAway
      // and carryOut — which is why this is `collective` and why the death for
      // failing to trade is attributed to Elemental Explosion instead. 1295891
      // is a cast marker in the data, and a marker can never name a player.
      //
      // ONE POOL EACH, not a cluster — assumption Q. The engine lays a single
      // patch per carrier at the moment the element lands, offset a few yards
      // along the bearing AWAY from the other carrier so the two patches end up
      // further apart than the two bodies are. That makes the mechanic one
      // decision about one destination. It used to drip a fresh pool every nine
      // tenths of a second, which painted two converging stripes and solved the
      // trade by accident somewhere in the middle.
      //
      // ONE CARRIER OF EACH ELEMENT, AND EXACTLY ONE PATCH OF EACH, IS AN
      // INVARIANT AND NOT A DETAIL. The patches are now consumed when they cure
      // (assumption Q), which is only safe because each patch has exactly one
      // customer: a fire patch cures frost carriers and there is one, a frost
      // patch cures fire carriers and there is one. Deal two carriers of the same
      // element here and you owe them two patches of the opposite ground, or the
      // second one is racing the first for a cure that goes out on contact.
      rule: { type: 'polarity', firePoolId: 'firepool', frostPoolId: 'frostpool', deathId: 'explosion' },
      collective: true,
      good: 'Two pools on the floor, two carriers, and both walk into the other one before the next volley.',
      failText: '',
      empoweredOnly: 'iku',
    },
    {
      id: 'firepool',
      name: 'Fire Patch',
      spellId: 1297649,
      what: "Fire ground left by Frostfire Volley — the single patch a Burning Flames carrier drops. It cures Piercing Frost and is spent doing it.",
      from: 'iku',
      roles: ['dps', 'healer'],
      telegraphMs: 1,
      shape: { kind: 'circle', radius: 6 },
      origin: 'random',
      // Standing in it does nothing at all unless you carry the opposite
      // element. It is never damage and never a failure, which is why it is not
      // an avoid with the harm switched off — the verb palette would paint the
      // cure red.
      //
      // AND IT IS CONSUMED THE MOMENT IT CURES SOMEBODY. This file used to argue
      // the exact opposite — "the patch does not know how many people have walked
      // through it, and a cure that vanished on first use would make whoever
      // arrived second the loser of a race the fight never called" — and that
      // argument is now withdrawn, because the race it feared cannot happen here.
      // One pool, one cure, gone:
      //
      //   `polarity` deals exactly ONE fire carrier and ONE frost carrier and
      //   lays exactly one patch of each. A fire patch cures frost carriers and
      //   there is exactly one alive to want it; a frost patch cures fire
      //   carriers, likewise. Each pool has exactly one customer, so no two
      //   bodies are ever queuing for the same ground.
      //
      // That is a dependency, not a coincidence, and it points both ways: IF A
      // FUTURE POLARITY EVER DEALS TWO CARRIERS OF ONE ELEMENT IT MUST LAY TWO
      // PATCHES OF THE OPPOSITE GROUND WITH THEM, or the second carrier really
      // does lose a race. The same sentence is written into the engine's
      // `elementPool` doc for the same reason.
      //
      // What consuming it buys is that the floor tells the truth. A cure that
      // lingered for twenty-two seconds after it had already been used was a
      // patch of ground that looked like an answer and was not one, sitting next
      // to the one that still was — and on a fight whose whole polarity lesson is
      // "read the floor and pick the right circle", a spent cure that still draws
      // is the worst thing that can be on it.
      rule: { type: 'elementPool', element: 'fire' },
      // Still long, because the volley is on a forty-second cadence and the
      // trade has to survive a Blast Wave passing over the top of it. This is now
      // the pool's LONGEST possible life rather than its actual one: two carriers
      // who do their job retire both patches within a few seconds of each other.
      lingerMs: 22000,
      good: 'The Piercing Frost carrier walks through it, comes out clean, and the patch goes out with them.',
      failText: '',
    },
    {
      id: 'frostpool',
      name: 'Frost Patch',
      spellId: 1297648,
      what: "Frost ground left by Frostfire Volley — the single patch a Piercing Frost carrier drops. It cures Burning Flames and is spent doing it.",
      from: 'iku',
      roles: ['dps', 'healer'],
      telegraphMs: 1,
      shape: { kind: 'circle', radius: 6 },
      origin: 'random',
      // Every word of the Fire Patch note above applies here with the elements
      // swapped, including the consumed-on-use rule and the invariant it rests
      // on. The two entries are deliberately identical apart from the element.
      rule: { type: 'elementPool', element: 'frost' },
      lingerMs: 22000,
      good: 'The Burning Flames carrier walks through it, comes out clean, and the patch goes out with them.',
      failText: '',
    },
    {
      id: 'explosion',
      name: 'Elemental Explosion',
      spellId: 1295952,
      what: "Frostfire detonation on a carrier who never traded — a second volley landing on an uncleansed element kills them.",
      lethal: true,
      from: 'iku',
      roles: ['dps', 'healer'],
      telegraphMs: 1,
      origin: 'boss',
      // Never in the loop and never spawned: it is named by the volley's
      // deathId, which is where assumption G's death is attributed. Modelled as
      // a stackingDot because that rule IS "a debuff that kills the body if
      // reapplied before it falls off", and the markers are 1-minute debuffs.
      rule: { type: 'stackingDot', maxStacks: 1, durationMs: 60000 },
      good: 'Every carrier is cleansed in the opposite pool before the next volley.',
      failText: 'Carried an element into a second Frostfire Volley',
    },
    {
      id: 'cataclysm',
      name: 'Cataclysmic Invocation',
      spellId: 1291390,
      what: "Iku gains this when Nama or Gebbo dies: escalating raid explosions that do not stop until the raid does.",
      from: 'iku',
      roles: ['healer'],
      telegraphMs: 2500,
      origin: 'boss',
      // A flat, unstoppable raid-bar bleed rather than a ramp; see the header.
      // raidDamage on purpose — an unsynchronised kill is the raid's fault and
      // this must never be able to name one person for it.
      rule: { type: 'raidDamage', dps: 22 },
      unlockedByDeathOf: ['nama', 'gebbo'],
      good: 'Nothing unlocks it, because the three die together.',
      failText: '',
    },
    {
      id: 'throwjunk',
      name: 'Throw Junk',
      spellId: 1291935,
      what: "Gebbo hurls crates around his lap; every one of them must be off the floor inside 10s or the raid wipes, and one of them is hiding a Disgusting Fish.",
      from: 'gebbo',
      // DPS AND HEALER ONLY, and it is forced rather than chosen. A failed crate
      // window is a wipe (see `missCost`), and the player tank is walking
      // the stacked pair away from Gebbo and cannot stop — so a scored tank would
      // be handed a guaranteed failure at t=30 with no action available to them.
      // The allies claim every crate on a tank pull and the tank keeps walking
      // instead. The tank still sees the fish found, still sees a bot feed it on
      // this pull's shuffled feed order, and still plays every empowered mechanic
      // that follows.
      roles: ['dps', 'healer'],
      telegraphMs: 10000,
      shape: { kind: 'circle', radius: 3 },
      origin: 'boss',
      // "Find the fish". THREE boxes are yours and the raid sweeps the rest —
      // `soakers` is the existing "how many bodies, minus the ones that are
      // yours" convention and means the same thing here. Three because the
      // directive says three: "3 boxes for the player to search".
      //
      // See the header for the deliberate simplification this rests on — in the
      // real fight Splinters limits a player to ONE box, and neither the limit
      // nor the bleed is modelled.
      rule: { type: 'collect', count: 6 },
      soakers: 3,
      // THE FAILED WINDOW IS THE WIPE, NOT THE SINGLE CRATE — and that is a
      // reversal of what this file said last, so here is the whole argument.
      //
      // The directive says "all boxes must be picked up within 10 seconds
      // otherwise the raid wipes". This entry used to read that as `missCost: 1`
      // — a full raid bar per crate — on the grounds that anything softer was not
      // the fight the encounter describes. But the engine charges this PER
      // UNCOLLECTED CRATE, and there are six of them, so 1 does not model "the
      // window was failed": it models "the window was failed six times over". The
      // literal sentence is about the WINDOW, and this is the reading that makes
      // failing the WINDOW fatal rather than failing a crate.
      //
      // What forced the re-reading was the pacing pass rather than a wish for an
      // easier fight. The empowered half of the rotation now actually arrives, so
      // a ten-second crate window frequently opens on top of a Mighty Thud rota
      // or a bomb chain, and at `missCost: 1` a single crate slipping in that
      // overlap ended the pull outright. That is a cliff, not a difficulty: it is
      // unrecoverable, it is often unreachable, and it made every other number in
      // this file untunable because one unlucky collision dominated the result.
      // Measured at 1: competent healer and dps both wiped on a single missed
      // crate around 68-100 seconds on every seed.
      //
      // 0.34 → 0.20 IN THE VERIFICATION PASS, for the same reason once more and
      // one step further along. With every empowerment now landing rather than
      // most of them being squeezed out, the crate windows come faster (each one
      // is re-armed by an empowered ability resolving) and collide with the
      // rotation more often — so the tail of the distribution matters more than
      // the median does. This was the single largest lever in the whole pass and
      // it was not a difficulty lever: at 0.34 the sweep lost a third of its
      // pulls to a crate-window wipe somewhere between sixty and a hundred
      // seconds, and those pulls ended BEFORE the third fish, so eleven of
      // fifty-four measured empowered abilities never fired twice. At 0.20 the
      // same measurement is three of fifty-four and every row buys all three
      // empowerments. Nothing else moved by anything like as much.
      //
      // WHAT DOES NOT CHANGE, and it is the half the directive cares most about:
      // a careless player collects nothing, so a careless pull leaves all six and
      // takes 1.2 — the first crate window is still a guaranteed wipe in every
      // role, at forty seconds, exactly as before. Four crates left standing is
      // still 0.8 of the raid's bar and effectively the pull. Picking a crate up
      // is still never a failure; only leaving one is.
      missCost: 0.20,
      // Assumption A. One box in the set is hiding a fish until the encounter's
      // three have been found, and after that the crates keep coming and hide
      // nothing — which is the moment the bar stops being resettable.
      //
      // Assumption J wants that box to be one of YOURS about 75% of the time.
      // The engine still plants it uniformly across all six; what makes the
      // number come out roughly right anyway is that the player is standing
      // among the crates when the window opens and gets six seconds of first
      // refusal on the fish before the raid will touch it. Recorded rather than
      // faked, because the fudge it replaces — planting the fish in a player box
      // every time — is what made the earlier draft's fish economy a formality.
      hides: { defId: 'fish', maxTotal: 3 },
      // A CRATE IS NOT AN ADD, and this is the only place that was ever in
      // doubt. There is no `summons` here and there is no add on this boss to
      // summon: a crate is something you walk onto, which is what `collect` is,
      // and the fight's answer to junk on the floor is to pick it up rather than
      // to shoot it. An earlier draft ran a Useless Junk kill-wave off the trash
      // timer alongside this, which taught a raid to cleave crates while a fish
      // sat unfound, and it is gone along with `addEverySec` and `maxAdds`.
      good: 'Every crate is off the floor inside the window and the fish is found the moment it drops.',
      failText: 'Left a crate on the floor when Throw Junk expired',
    },
    {
      id: 'fish',
      name: 'Disgusting Fish',
      spellId: 0,
      what: "Dropped by the crate that was hiding it. Carry it into an explorer that has not eaten one: the bar empties and that explorer is empowered for the rest of the pull.",
      from: 'gebbo',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 20000,
      shape: { kind: 'circle', radius: 3 },
      origin: 'random',
      // The only mechanic in this raid whose answer is a DESTINATION rather than
      // a distance. Deliberately not a carryOut: a carryOut is a liability you
      // dump where it hurts nobody, and this is a tool with an address.
      //
      // What a missed fish costs you is the CHOICE, never the pull — if an ally
      // finds it, it still gets eaten, just not by the explorer you would have
      // picked. That is the teaching point, and it is why this can never be
      // scored: `failText` is empty on purpose.
      //
      // spellId 0 is the data's own gap — the entry reads "SPELL ID NEEDED", and
      // the fish's only confirmed consequence is Fishy Feedback (1313303). It
      // resolves to Trader Gebbo as its caster, which is why `from` is honest.
      //
      // 6 → 3 WHEN THE TANKS STARTED STACKING. This is the one number the
      // stacked tank job forced, and leaving it would have quietly deleted the
      // mechanic: the engine feeds the FIRST living explorer inside `feedRange`,
      // and two stacked bodies stand STACK_SPREAD = 4 yards apart, so a 6-yard
      // range covers both of them from anywhere near the mark and every fish
      // walked to the pair went to Iku because Iku is entities[0]. "Which one do
      // you empower" would have been answered by the array. At 3 the two
      // shoulders are separable — walk in on the OUTBOARD side of the one you
      // want and only that one is in range — which is the invariant sweep's own
      // requirement that a feed range must not touch two explorers at once.
      // It is still far wider than the 0.6yd the raid's own walk stops inside,
      // so an ally errand is unaffected.
      rule: { type: 'feed', feedRange: 3, costId: 'feedback' },
      good: 'Three fish found, three explorers empowered, and the bar never reaches the top.',
      failText: '',
    },
    {
      id: 'gebbospree',
      name: 'Mushroom Toss',
      spellId: 1292105,
      what: "Empowered Gebbo always pairs the mushrooms with a bomb: the mushrooms arrive first, and they are the only answer to the ring the bomb becomes.",
      from: 'gebbo',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1500,
      origin: 'boss',
      // A container that can never itself be failed, holding the pairing the
      // directive demands.
      //
      // `combo` deals its parts in a RANDOM order — that is the point of it on
      // Sszorak, where the flurry is meant to be unmemorisable — so this does
      // not guarantee the mushrooms land first, and it does not need to. Either
      // order works, and both are checked in the note on `mushrooms`: whichever
      // way round the two parts fall, the pads are still on the floor when the
      // ring reaches the far rim. What the pairing guarantees is that the answer
      // is out there when the question arrives, which is the part that matters.
      rule: { type: 'combo', parts: ['mushrooms', 'bomb'], gapMs: 800 },
      good: 'The raid reads the pairing and stands where a mushroom is reachable.',
      failText: '',
      empoweredOnly: 'gebbo',
    },
    {
      id: 'mushrooms',
      name: 'Mushroom Toss',
      spellId: 1292104,
      what: "Bouncy Mushrooms scattered across the floor. Running over one launches you into the air, which is the only thing the Blast Wave ring passes under.",
      from: 'gebbo',
      roles: ['tank', 'dps', 'healer'],
      // 28s on the floor, and the number is arithmetic rather than taste —
      // assumption P. Worst case is mushrooms-first: pads land at T, the bomb is
      // dealt at T+0.8, drops at T+10.8, the wave spawns at T+13.8 and the ring
      // is BORN at T+16.3. From there it travels at 11 yd/s and is retired once
      // it has passed 2*arenaRadius + 4 = 104 yards, which takes 10.0 seconds —
      // so the last instant anybody can be asked to jump is T+26.3, and a pad
      // that expired at 18s left the answer gone for eight seconds of the
      // question. 28s covers it with 1.7s to spare. Bomb-first is easier by 0.8s
      // either way.
      telegraphMs: 28000,
      shape: { kind: 'circle', radius: 4 },
      origin: 'random',
      // Touching one is ALWAYS correct play and can never be scored — the
      // ability data calls the airborne debuff "the SUCCESS signal, never a
      // failure" in as many words. Scattered across the floor rather than around
      // Gebbo; see the header for why that is a deliberate deviation, and it
      // matters more now that his lap runs through the middle of the room.
      //
      // 6 → 10 PADS, and the number comes off the ring rather than off taste. A
      // wave that covered a six-yard disc asked two or three bodies to leave the
      // floor; a ring that crosses the whole room asks all twenty, and a pad is
      // consumed by whoever touches it. At six, nineteen raiders died to every
      // single wave — measured — and the raid was gone before the third fish.
      // Ten leaves nine for the raid once the engine has held one back for the
      // player, and a pad throws the whole group that walks onto it together
      // (`PAD_LAUNCH_HOLD_MS`), so nine pads carry nineteen bodies with room to
      // spare. It is a floor of ten four-yard circles on a fifty-yard room,
      // which is scattered rather than paved.
      //
      // `launchMs` stays at three seconds. It is the whole timing problem: the
      // band takes 6/11 = 0.55s to cross you, so three seconds of air is a
      // window you have to place rather than a period you can sit out. 3.5 was
      // tried and made the default seed WORSE, not better — a longer launch lets
      // a body commit earlier and then land in the tail of the band.
      rule: { type: 'launchPad', count: 10, launchMs: 3000 },
      good: 'Somebody is airborne on a mushroom as the ring reaches them, every single time.',
      failText: '',
      empoweredOnly: 'gebbo',
    },
    {
      id: 'bomb',
      name: 'Explosive Surprise',
      spellId: 1297625,
      what: "10s bomb-carrier marker — when it expires it drops a bomb where the carrier stood, and seconds later that bomb sends a ring of fire outward across the room.",
      from: 'gebbo',
      roles: ['dps', 'healer'],
      telegraphMs: 10000,
      shape: { kind: 'circle', radius: 10 },
      origin: 'targeted',
      // The beat of Gebbo's empowerment that re-arms Throw Junk. His empowerment
      // is a PAIR, so one of its beats has to be named as the gate, and this is
      // the one with a fixed 10s fuse — the mushrooms have no resolve worth
      // waiting on, and the ring is three seconds further downstream again.
      //
      // Where this is dropped is where the ring is centred, because a spawned
      // child inherits the carrier's position on a carryOut. So the carrier is
      // choosing the geometry of the whole wave, not just where one pool lands.
      rule: { type: 'carryOut', minDistance: 22 },
      spawns: { defId: 'blastwave', delayMs: 3000 },
      good: 'The carrier drops it clear of the raid and everyone is on a mushroom when the ring passes.',
      failText: 'Dropped Explosive Surprise on the raid',
      empoweredOnly: 'gebbo',
    },
    {
      id: 'blastwave',
      name: 'Blast Wave',
      spellId: 1305844,
      what: "The deadliest ID in the fight — 18 killing blows on the Mythic PTR sample. A ring of fire that expands outward from the bomb, slowly; the LINE is the danger, and the only answer is to be airborne on a Bouncy Mushroom as it reaches you.",
      lethal: true,
      from: 'gebbo',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2500,
      // A RIPPLE: a travelling band of floor, not a slab and not a disc. The
      // `ripple` block below is the real geometry — the engine reads it and
      // ignores this shape's radii while the ring is live — and the annulus is
      // declared purely so the guards that skip shapeless instances still see
      // one. `inner: 0, outer: 6` mirrors the band width so anything that reads
      // the shape rather than the ripple is at least not lied to.
      shape: { kind: 'annulus', inner: 0, outer: 6 },
      origin: 'random',
      // Assumption O. 11 yd/s against a 14 yd/s run, so the line can be backed
      // away from to buy a second and line a mushroom up — and never escaped,
      // because outward is the rim and inward is the crater Concussive Blast
      // left. 6 yards of band so the danger is a stripe of floor you can time
      // rather than a mathematical line nothing could be judged against.
      //
      // The band is born with its OUTER edge on the bomb, covering no floor at
      // all, so the raid's rule that a contact hazard cannot kill on the frame it
      // spawns stays true for a hazard whose entire existence is contact.
      ripple: { speed: 11, thickness: 6 },
      // Long enough to cross the room from a bomb dropped on the rim: the ring
      // is retired at 2*arenaRadius + 4 = 104 yards, which at 11 yd/s from
      // -6 takes 10.0 seconds. 11s so the retirement is the ring running out of
      // room rather than the linger running out first and leaving a live band
      // sitting invisible in the middle of the floor.
      lingerMs: 11000,
      // Judged on CONTACT, in the linger tick, once per body per wave — not at
      // the resolve, because at the resolve the ring has not travelled a yard
      // and scoring it there would blame whoever was standing near the bomb.
      rule: { type: 'wave' },
      spawns: { defId: 'concussive' },
      good: 'Everyone times the line and is airborne on a mushroom as it passes them.',
      failText: 'Caught on the ground by Blast Wave',
    },
    {
      id: 'concussive',
      name: 'Concussive Blast',
      spellId: 1299947,
      what: "12s Fire DoT in a 10 yd radius left by the bomb detonation (wowhead: periodic damage, NOT a knockback) — any application means standing in the drop zone.",
      from: 'gebbo',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 1,
      shape: { kind: 'circle', radius: 12 },
      origin: 'random',
      // Also the reason the inside of the ring is not a hiding place: it is the
      // crater the ring came out of.
      rule: { type: 'avoid' },
      damage: 0.14,
      lingerMs: 14000,
      good: 'The drop zone is abandoned the moment the ring has left it.',
      failText: 'Stood in the Concussive Blast fire',
    },
    {
      id: 'shovel',
      name: 'Smashing Shovel',
      spellId: 1296252,
      what: "Gebbo gains this when Nama or Iku dies: contact knocks players back, and off the platform.",
      from: 'gebbo',
      roles: ['tank', 'dps', 'healer'],
      telegraphMs: 2500,
      shape: { kind: 'circle', radius: 12 },
      origin: 'boss',
      // `survive`'s failure is being knocked off the platform, which is exactly
      // what the directive says this does. Assumption D again: it ramps the pull
      // toward a wipe rather than ending it.
      rule: { type: 'survive' },
      knockbackYards: 30,
      damage: 0.3,
      unlockedByDeathOf: ['nama', 'iku'],
      good: 'Nothing unlocks it, because the three die together.',
      failText: 'Knocked off the platform by Smashing Shovel',
    },
    {
      id: 'presence',
      name: 'Malevolent Presence',
      spellId: 1295450,
      what: "Unavoidable raid-wide Shadow tick every 2s all fight — never a failure, but 8 killing blows means it is what finishes players left low by other mistakes.",
      from: 'morzahi',
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // 3.0 → 1.2 IN THE PACING PASS, and it is the number that paid for the
      // empowered half of the rotation arriving. This is a constant drain on the
      // same raid bar Mighty Thud takes 0.3 out of per unsoaked leap, and a
      // player TANK cannot soak — so the raid's ability to recover between two
      // Mighty Thuds is exactly `regen − this`, and `regen` is 0.046/s and not
      // ours to move. At 3.0 the tank's raid bar recovered 0.016/s, needed
      // fifty-six seconds to pay off one Mighty Thud, and got forty; the fight
      // could not deliver the ability the user asked to practise and stay
      // survivable at the same time. At 1.2 the recovery is 0.034/s and forty
      // seconds buys 1.35 against a cost of 0.6.
      //
      // Re-measured either side of it in the verification pass, against a fight
      // that now delivers the whole of its empowered half: 1.6 costs the tank
      // AND the dps a seed apiece and takes one row's third empowerment with
      // them, while 1.0 changes nothing at all. So this is still the binding
      // constraint on the fight's raid-damage budget rather than a knob with
      // slack in it, and it is binding from one side only. What the
      // healer loses in baseline they get back in lumps — see `feedback`, the
      // Blink Nova falloff, and Cataclysmic Invocation, all of which are still
      // theirs to cover.
      rule: { type: 'raidDamage', dps: 1.2 },
      good: 'Healers stay ahead of the baseline and hold cooldowns for each fish window.',
      failText: '',
    },
    {
      id: 'feedback',
      name: 'Fishy Feedback',
      spellId: 1313303,
      what: "Shadow burst plus a 12s raid DoT, no dispel type — the price of every successful fish, so plan healing cooldowns around it.",
      from: 'morzahi',
      roles: ['healer'],
      telegraphMs: 0,
      origin: 'boss',
      // Fired by the feed itself, never by the loop or the timeline. Emptying the
      // bar is not free, and this is the bill.
      //
      // 16 → 11 with `presence`, and for the same reason: a lump landing on the
      // raid bar at the exact moment an empowerment goes live is a lump landing
      // just before that empowerment's first cast. Three fish per pull, so this
      // is 0.33 of the raid bar over a pull rather than 0.48 — still the most
      // expensive single event a healer plans a cooldown around, and no longer
      // the thing that decides whether the first Mighty Thud is survivable.
      rule: { type: 'raidDamage', dps: 11 },
      good: 'A raid cooldown lands on every fish, because every fish is planned.',
      failText: '',
    },
  ],
}
