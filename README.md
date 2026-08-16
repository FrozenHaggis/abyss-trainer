# World of Claudcraft — Curse of Claude'Tek

A top-down trainer for the **Heroic** mechanics of The Venomous Abyss, in the
spirit of [Castle Pineapplia](https://tacticalairhorse.itch.io/castle-pineapplia):
silly boss names over real, transferable mechanics.

Pick tank, healer or DPS. **WASD** to move, **mouse to aim, hold to shoot**
(**Space** fires at the nearest boss), **1–4** for abilities, **Esc** to leave
the pull. The boss only dies from shots you land, so every second spent dodging
is a second off the kill — which is the whole tension. Spoken callouts name each
mechanic and tell you what to do; the arena slows and the music ducks while one
is being explained. The 🔊 button turns the voice off.

Mechanics arrive **one at a time**. You meet one, get a few reps on it, and only
then does the next join the rotation — the whole loop firing from the first
second is how a trainer becomes noise.

Most fights run on one shared rotation, because their source data has no
recurrence intervals in it. Where real intervals *are* known a boss can put a
mechanic on its **own clock** instead, and one cast can be armed by another
resolving rather than by a timer — the Lost Explorers' crates wait for the
empowered ability the last fish bought.

## The raid

| Boss | Teaches |
|---|---|
| Tok'zali the Contextcoiler | Nek'zali the Soulcoiler |
| The Entombed Guardrails | Entombed Sentinels |
| Vashnik the Malformed | Vashnik the Malignant |
| The Lost Subagents | The Lost Explorers |
| Ssztream, Herald of the Six Winds | Sszorak |
| The Twin Prompts | The Twin Fangs |
| The Recursive Altar | The Coiled Altar |
| Claude'Tek | Ula'tek |

**Boss names are parodies. Mechanic names and spell IDs are real**, so what you
practise transfers to raid night.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
npm test           # the honesty tests
npm run playtest   # headless balance check, 8 bosses x 3 roles
```

## Music

**One fixed track.** `public/music/boss-music.mp3` plays on every pull, ducks
under the voice callouts, and fades at the end. There is no picker and no
runtime upload — the track is part of the fight, not a preference.

The track ships with the repo, so a clone and the deployed site both have it —
credit and the licence position are in [ATTRIBUTION.md](ATTRIBUTION.md). Any
*other* mp3 dropped into `public/music/` is still gitignored, so a personal copy
cannot be published by accident. If the track is missing the game runs silently:
no errors, no missing-asset warnings.

## Why the mechanics are trustworthy

Every boss is authored from verified tactic files built from real WarcraftLogs
data. Tests run on every build and every deploy:

- every `spellId` must exist in that boss's real `abilities.json`
- nothing tagged Mythic-only may appear — this is a Heroic trainer
- unavoidable raid damage can never be scored as a personal failure, and the
  engine has no code path from `raidDamage` to a recorded failure
- every `avoid` mechanic is genuinely escapable at run speed
- `avoid` frontals must not track the player
- every id referenced by `loop`, `timeline`, `rearmOn`, `spawns`, `ambient`,
  `atFullEnergy` resolves, and nothing is scheduled twice by sitting in both the
  `loop` and the `timeline`
- **which mechanics kill outright** is read from `category: "Deadly"` in the
  ability data, not chosen for balance — the same categorisation RaidLens uses
  to attribute a death to a mechanic
- a **window marker** — an ability the data says produces no events — can never
  be something you fail. Apex Predator deals out five real abilities and is
  scored on none of them
- a **spread must be survivable only by answering it**: an unpaired Raging
  Crosswinds knock has to leave the platform from anywhere, or standing in the
  middle ignoring the fight's headline mechanic is a valid strategy. It was
- one **group-soak cone cannot cover both stack groups**, or the alternating
  rota is something no tank could play correctly
- a missed soak never kills you personally; an unsoaked hit lands on the raid
- a contact hazard cannot kill on the frame it spawns
- on multi-boss fights, **every entity and its npcId** must match
  `abilities.json`, and each mechanic must be cast by the entity that really
  owns it — re-derived from the data on every run
- **no 300-yard raid-wide ability may be scored as a player failure.** Every
  tactic file with one says the same thing: "a per-player hit leaderboard would
  name the whole raid"
- **entities that must be kept apart must start apart** — further than their own
  link radius, so a fight never opens inside its own failure state
- eating a pickup, and holding the boss while your own stacks are up, can never
  be scored against you — those are the co-tank's job and the soaker's job
- **a mechanic answered with a tool must have that tool on the floor in time.**
  Frostfire Volley hands out Fire and Frost, and the only cure for either is the
  other one's pool, so a polarity mechanic has to name two real element pools
  that outlive the volley. Blast Wave is survived only by being airborne, so a
  wave has to have a Bouncy Mushroom whose lifetime covers the whole chain from
  bomb to blast. Authored either way round without the answer, both are
  unwinnable and neither would have failed anything
- **the fish economy is finite and cannot be double-spent.** Three Disgusting
  Fish exist in the whole Explorers encounter, each explorer can eat exactly one,
  and feeding one that has already eaten is rejected rather than consumed — a
  misclick on a three-body council must not be an unrecoverable wipe

## Adding a boss

Author `src/bosses/<key>.ts` against `MechanicDef` in `src/engine/types.ts`, then
import it in `registry.ts`. A test fails if a boss file exists but is unwired.

## Balance

`npm run playtest` runs a headless bot through every boss in every role, on three
fixed seeds each. The bar: a careless player dies, a competent one kills it, DPS
fastest and healer slowest. A boss counts as cleared only if it clears on a
majority of seeds.

The seeds matter. With bare `Math.random()` the clear count swung 21-24 between
identical runs — wider than most of the changes being measured, so a real
regression could hide in the noise and a lucky run could pass a broken build.
`seedRng()` fixes the sequence for the harness; the game itself still seeds from
the clock.

Check balance changes against this rather than by eye. It has caught an annulus
being fled outward off the platform, pools detonating on the carrier who dropped
them, a tank dying to a dispel they cannot cast, shots expiring before they could
reach the boss, adds accumulating faster than any player could clear them, and a
tank and the boss chasing each other to the wall because the tank's mark was
measured from a boss that walks after its tank.

`BOSS=`, `ROLE=` and `SEED=` narrow it to one cell, which matters once a fight is
long enough that a full sweep is a coffee break. `FAILS=1` breaks the count down
by mechanic and `TRACE=1` prints a pull second by second — a single large number
tells you a fight is going wrong, and only the breakdown tells you whether that
is difficulty or a defect.

The bot is a measuring instrument, so what it cannot do is a blind spot in the
measurement rather than a fact about the fight. It could not press taunt, a
defensive or a raid cooldown at all until Sszorak needed all three, and until
then every number this harness produced was a careless player wearing a careful
label. It still cannot pre-position for a cast that has not happened, commit to
one of two identical targets, or hold damage to delay a phase — so a red cell
is a question, not a verdict.

Because that keeps happening, the bot now carries a **manifest**: every `Rule`
variant in the engine, with one line on what a competent player does about it.
A test asserts the manifest and the union match, so a new rule fails the build
until somebody has decided — and "nothing, and here is why" is a perfectly good
decision. The last two entries earned it. A `line` is anchored at its caster and
measured forward, so the bot's radial "run away from the shape" pointed straight
*down* a Shell Spin lane and it was clipped by shells it was obediently fleeing;
it leaves a lane sideways now, using the same projection the engine's own hit
test uses. And a Blast Wave's front telegraphs for 2.5 seconds while the bomb
that produces it is planted ten seconds earlier, so the bot waited for the front
and then started a thirty-yard sprint it lost by a stride. It reads the chain
now — and *waits beside* a mushroom rather than standing on one, because a
mushroom is consumed on contact and eating it early was worse than being late.

That mattered more than it sounds. Nine cells were failing; investigating them
one at a time took the score from 18/27 to 24/27 **without tuning a single
fight's difficulty down**. Four of the six recovered were bot defects — it read
adds' fuses on the one boss that leaks by arrival instead, hard-coded another
fight's carry distance, and computed a body-block force a hundred lines after
the heading had already been read. Every one printed as a fight being too hard.

### The golden file

`test/playtest.golden.json` records all 54 cells — both passes, every boss, side
and role — as outcome, seed count and failure histogram. The sweep compares
against it and **exits non-zero if any cell changes in either direction**;
`GOLDEN=write npm run playtest` re-records it deliberately.

The aggregate cannot do this job. A bot change once moved two cells in opposite
directions and left the headline at exactly 18/27, which is a regression no
number would ever have shown. And no total can detect a fight getting *easier* —
the failure mode a trainer should fear most.

### The careless half of the bar

"A careless player dies" was not being measured at all. The whole bot lived
inside `if (smart)`, so the careless pass never set a key and never pulled a
trigger — which is why every careless row read `acc 0%`. It was attrition
killing a mannequin, and it would have printed the same 27 deaths with every
mechanic in the raid deleted.

It is a real careless player now: shoots constantly, wanders, dodges nothing,
presses nothing, and avoids only the two things that are suicide rather than
carelessness — the platform edge and a hole in the floor. It clears **8 of 27**.
All three Ula'tek roles, and all three Vashnik roles, hand a player who dodged
nothing a KILL screen with five to thirteen recorded failures against them.

Vashnik joined that list the moment its adds were fixed to spawn only from their
own fountain, which halved the add load — the fight had been leaning on a
scheduler bug for its difficulty, and correcting the mechanic exposed that it
has no teeth without it. That is a tuning conversation, and a good example of
why the two halves of this bar have to be watched together: the change was
unambiguously correct and it made the trainer worse at teaching.

That is a worse number than the competent one, and it is the half that carries
the teaching. It is recorded rather than asserted, because what the target
should be is a product decision — and because the two halves are coupled, every
point of difficulty removed to lift the competent score is also handed to the
careless player.

## Known gaps

Recorded honestly rather than quietly left out.

- **Most arena shapes are still circles.** The sizes are measured; the shapes
  mostly are not. Coiled Altar's corner/axis of 1.27 sits between a circle (1.00)
  and a square (1.41) and is probably octagonal — drawn as a circle until live
  logs settle it. Twin Fangs is now the exception: its 1.19 is a wedge, authored
  from the encounter's own room, with a pocket of venom bitten out of the bottom
  edge that the Spawn of Vexhul surface in. That floor is concave — the first in
  the tier — and two things broke on it that had been correct everywhere else:
  the playtest bot's lookahead sampled only the far end of a step and walked
  straight over the hole, and the hard-coded start position was inside it. Both
  are fixed, and both now have tests.
- **Ula'tek's arena is unknown.** Zero logs across 625 PTR reports; it was never
  publicly tested. Its radius is a placeholder.
- **The Lost Explorers reads its own tactic file back at it in four places.**
  All four are stated in the boss file rather than left to be found. Blink Nova
  is authored with a distance falloff, and its ability note says the opposite —
  "a 300 yd radius with no distance falloff". The directive is explicit that the
  further the marked player stands the less the raid takes, and a mechanic with
  no dial on it is not worth practising; it stays `raidDamage`, so it still
  cannot name anybody. That distance is now measured **from the raid**, not from
  Iku: she blinks onto the marked player, so telling them to run away from a body
  that is about to teleport to them is advice about nothing. Shell Spin is three
  travelling lanes rather than the frontal cone the tactic file calls it, because
  the directive describes three projectiles fired in straight lines — a different
  lesson, and a sharper one. Cataclysmic Invocation "hits harder and harder" and
  is modelled as a hard flat drain, because a per-cast multiplier is not
  something this engine has. And the Bouncy Mushrooms scatter around the arena
  centre rather than around Gebbo, who patrols the north rim — mushrooms only he
  can reach are not an answer to a bomb dropped on the melee stack.
- **Shell Spin's spread and speed are chosen, not measured.** The directive gives
  the shape — one shell forward and one off each shoulder — and no angles. ±35°
  and an 8 yd lane are picked so the three lanes separate 13 yards out from Nama
  and are 22 yards apart at the rim, which is the arithmetic written into the
  boss file; the shells travel at 9 yd/s against a 14 yd/s run, so a lane can be
  outrun as well as sidestepped. The real ability's 4-second stun is **not**
  modelled — the engine has no stun — so the damage on contact carries the whole
  cost of being clipped. If playtest shows the lanes are unreadable rather than
  hard, those are the numbers to move.
- **An unsynchronised Explorers kill is no longer scored.** The survivors gaining
  Relentless Escalation, Cataclysmic Invocation and Smashing Shovel *is* the
  punishment, and charging a failure row on top of it punishes one mistake twice.
  The kill-spread warning — one explorer under 10%, another more than 10% above
  it — stays as a teaching cue that **cannot be failed**. It is now the only
  mechanic-shaped thing in the raid with no failure path at all, which is
  deliberate and is the sort of thing a later reader will assume is a bug.
- **The raid stopped a few yards short of everywhere it was ever sent.** The
  ally deadzone — "close enough is close enough" — was measured against the
  *eased* step rather than the gap, and `ease` is `dt/lag`, which for the
  slowest-reacting raider is 0.083. So a 0.6 test was really a test against
  **7.2 yards**, and every ally in the game has always stopped that far from its
  mark. Invisible for a station and fatal for an errand: a Throw Junk crate is
  eaten inside three yards, so a raider sent to one walked to five, stopped, and
  watched it until the window closed — which on a fight where one uncollected
  crate wipes the raid ended every tank pull at t=30 with no action available to
  the player at all. Measuring it honestly for every ally on every fight moved
  **twenty** cells of the sweep in both directions, including three careless
  clears, so the correction is scoped: an errand that has to be physically
  arrived at closes the last few yards, gated on the pickup declaring `soakers`.
  The general fix is a balance pass on six other encounters and is still owed.
- **The Explorers' fish is planted uniformly, and 75% is emergent rather than
  rolled.** The decision is that the player finds it roughly three times in four,
  and that otherwise an ally feeds it on a fixed priority — Iku, then Gebbo, then
  Nama, skipping anyone already empowered — so a missed fish costs you the
  *choice* rather than the pull. The priority half is now real: `feedPriority` is
  a `BossDef` field, and after six seconds of first refusal the nearest non-tank
  raider carries a fish nobody claimed into the next mouth on the list. The
  weighted plant is not: the engine still hides the fish in any of the six
  crates. What makes the number come out roughly right anyway is where the player
  is standing — among the crates on a dps or healer pull, and nowhere near them
  on a tank pull, which is precisely the split the directive describes. A literal
  75% would need the plant to know which crates are yours.
- **Two engine improvements are deliberately scoped to the Explorers, because
  widening them re-tunes fights nobody has re-tuned yet.** A dead entity now
  stops casting — but only on a fight that declares `unlockedByDeathOf`. Applied
  everywhere it silenced eleven of the Coiled Altar's thirteen mechanics the
  moment Zul'jan fell, and a *careless* player cleared the fight in all three
  roles: the room went quiet at exactly the moment that fight's own `syncKill` is
  meant to be punishing an early kill, so the corpse's silence became the reward
  for the mistake. The Explorers are the only fight authored for it, because they
  are the only one where a death buys the survivors something. Likewise, the raid
  now claims the pickups FURTHEST from you and leaves the near ones — but only
  where the mechanic declares `soakers`. Applied to the Entombed Sentinels' Toxic
  Droplets, which declare no share, the raid swept them so much more efficiently
  that a careless healer cleared that fight too. Both wider changes are real
  improvements and both are a balance pass on somebody else's encounter; the
  opt-in keeps the two apart until that pass happens.
- **The Explorers' careless pull still ends on Throw Junk.** The directive is
  explicit that crates left standing wipe the raid, and a careless player
  collects nothing, so the first crate window is fatal in every role. Putting
  that window on the timeline at t=30 rather than in the opening rotation bought
  the careless half something real — it now meets Shell Spin and Blink Nova, and
  fails them, before the crates arrive — but the pull still ends there, and
  nothing past the first fish is measured by that half of the sweep — except on
  a tank pull, where the crates are the raid's and a careless tank now survives
  to about two minutes before the raid bar gives out. The two non-tank careless
  cells still end at forty seconds on the first window, and that is the
  directive's own consequence rather than a tuning choice.
- **The Explorers' tank kills marginally faster than its dps, and that is the
  fight's design showing up in the sweep.** The bar the project holds is "dps
  fastest, healer slowest"; the Explorers land 124s tank, 125s dps, 155s healer,
  so the healer half is right and the other two are a tie inside the noise. The
  cause is structural rather than a tuning error: a tank on this fight is a
  passenger on Throw Junk and never carries a fish, so they hold 99% accuracy
  standing next to Iku while the dps runs crates and errands at 96%. Moving it
  would mean giving the tank something to do during the crate window, which is
  the one thing the directive rules out.
- **The Creepy Statues are cut from the Explorers trainer.** Evil Eyes was the
  highest-cast ability in the real fight and is real content left out on purpose:
  with three rotations, a patrolling third boss, a fish economy and a polarity
  puzzle all running, a seventh source of small floor damage is noise over the
  top of decisions rather than another decision. Creepy Flames still has no
  confirmed damage ID at all.
- **Sszorak inverts its tactic file twice, on purpose.** Both are stated in the
  boss file rather than left to be found. Raging Crosswinds is authored so two
  raiders thrown into each other CANCEL — the source's Good line is "drift back
  to solid floor without touching anyone", and a mid-air collision is its Bad
  line. And the Maelstrom's gales blow the raid INTO the Viscous Cysts, where the
  source says to drop them "clear of the raid path and the next wind direction".
  Both changes turn a mechanic you survive by luck into one you get right or
  wrong on purpose, which is worth more in a trainer than fidelity here is.
- **Sszorak's four wind bearings are a Heroic reading of Mythic data.** The
  ability data has two direction debuffs at Heroic and two more that only ever
  appeared on Mythic. The mechanic is keyed to the Heroic knockback itself
  (`1285616`) and which of four bearings you are handed is a runtime detail, so
  no Mythic spell id is referenced — but the real Heroic fight throws two ways,
  not four.
- **Mythic content is excluded on purpose.** This is a Heroic trainer and a test
  enforces it.

## Arena geometry

Measured from WCL combat logs, not guessed. Positions come back from the events
API only when you pass `includeResources: true` — without it the response
carries no `x`/`y` at all, which is easy to mistake for the log lacking Advanced
Combat Logging. **1 yard = 100 coordinate units**, derived from a run-speed
histogram peaking at 700–725 units/s against WoW's 7.00 yd/s base.

| Boss | Radius | Shape | Confidence |
|---|---|---|---|
| Vashnik | 58 yd | circle | medium |
| Sszorak | 56 yd | circle | medium |
| Entombed Sentinels | 55 yd | circle | medium |
| The Lost Explorers | 50 yd | circle | **high** |
| Nek'zali | 46 yd | circle | medium |
| The Coiled Altar | 43 yd | rounded/octagonal | low |
| The Twin Fangs | 32 yd | rounded/octagonal | low |
| Ula'tek | — | — | **no data** |

Side rooms and entrance ramps are excluded from the radius: Vashnik has a
corridor reaching ~105 yd, Sszorak has spurs reaching ~90 yd.

From PTR (July 2026) and unverified against live. Player positions are a lower
bound on the room — they are where players actually went.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Enable it once under
**Settings → Pages → Source → GitHub Actions**.
