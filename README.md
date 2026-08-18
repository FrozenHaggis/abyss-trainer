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

A rotation entry can also be **gated** on something the pull has to reach: an
explorer eating a fish, or one of them dying. A gate that has just opened takes
the next beat rather than waiting its turn, and a beat that lands on a gate still
shut is spent on whichever open gate is overdue instead of on silence — so an
ability you have just paid for shows up, and no ability arrives more often than
its own boss file asked for.

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

## Boss models

The boss picker is a rotating barrel carrying the raid's real creature models,
lit one at a time by a spotlight. **The art is not in this repository.** Get it
with:

```sh
node scripts/fetch-boss-models.mjs   # ~110MB into public/models/, idempotent
```

Without it the picker falls back to the card grid it has always had, which is
what a fresh clone and the deployed site both see. Nothing else changes: both
layouts pick the same boss and print the same notes.

**Where it comes from.** Wowhead's model-viewer CDN serves the `.m2` models and
their `.skin` files; wago.tools serves the `.blp` textures, which Wowhead only
publishes pre-transcoded. Everything is addressed by FileDataID, and the M2 is
parsed in the browser by [three-m2loader](https://github.com/Mugen87/three-m2loader).
`three` is pinned to 0.159.0 because that loader depends on it directly and two
copies of three.js in one scene do not work.

**Why it is gitignored.** It is a hundred megabytes of Blizzard's creature art.
It has no business in a git history, and the Pages build does not ship it — see
[ATTRIBUTION.md](ATTRIBUTION.md).

**Who is on each slot.** `scripts/fetch-boss-models.mjs` decides which creatures
an encounter downloads; `src/ui/barrel/staging.ts` decides where they stand.
Four encounters stage two bodies — both Sentinel golems, both Twin Fangs, and
Hex Lord Malacrass behind Zul'jan — and for those four the NPC ids are read out
of the fight's own `entities` array, so the barrel and the sim cannot disagree
about who is in the room. `test/barrel.test.js` fails if they drift.

Two models need help the data cannot give them. Ula'tek's wings span two and a
half times her height in a single 18,000-triangle mesh with no geoset to switch
off, so `staging.ts` trims her to the five heads by discarding triangles more
than nine units off her centre line. Malacrass's display is a bare troll body —
his gear is item equipment composed at runtime from tables the loader cannot
assemble — so he is staged in near-silhouette at the back.

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
  bomb to blast — and now that the wave is a ring that travels, that chain runs
  on until the line reaches the far rim. Authored either way round without the
  answer, both are unwinnable and neither would have failed anything
- **a cure that is consumed must have exactly one customer.** A Fire or Frost
  Patch goes out the moment it cleanses somebody, which is only fair because a
  Frostfire Volley deals one carrier of each element and lays one patch of each,
  so nobody is ever second in a queue for one. Deal two carriers of one element
  and you owe them two patches of the opposite ground
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
(Blast Wave is an expanding ring now, so the front is on the floor *after* the
cast resolves rather than before it. The bot reads the line's eta instead: it
sets off for a pad when the walk plus half a launch is all the time it has left,
waits beside it, steps on when the line is about a launch out, and holds still
while airborne — because a mushroom slows you to a quarter speed and drifting
toward the crater brings the line back to meet you.)

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
  something this engine has. And the Bouncy Mushrooms scatter across the floor
  rather than around Gebbo — he now laps the middle of the room, so pads that
  followed him would cluster on the one ring of floor the tanks are steering
  everybody away from.
- **Shell Spin's spread and speed are chosen, not measured.** The directive gives
  the shape — one shell forward and one off each shoulder — and no angles. ±35°
  and an 8 yd lane are picked so the three lanes separate 13 yards out from Nama
  and are 22 yards apart at the rim, which is the arithmetic written into the
  boss file; the shells travel at 9 yd/s against a 14 yd/s run, so a lane can be
  outrun as well as sidestepped. The real ability's 4-second stun is **not**
  modelled — the engine has no stun — so the damage on contact carries the whole
  cost of being clipped. If playtest shows the lanes are unreadable rather than
  hard, those are the numbers to move.
- **Blast Wave's speed and width are chosen too, and the mushroom lifetime falls
  out of them.** The directive says the bomb sends a wave across the room and
  that the only answer is to jump it; it gives no numbers. 11 yd/s against a
  14 yd/s run is picked so the line can be backed away from to buy a second and
  line a mushroom up, and never escaped — outward is the rim and inward is the
  crater. A 6-yard band is picked so the danger is a stripe of floor you can time
  rather than a mathematical line nothing could be judged against at 60fps. The
  mushrooms then have to last 28 seconds, and that one is arithmetic rather than
  taste: worst case the pads land at T, the bomb is dealt at T+0.8 and drops at
  T+10.8, the ring is born at T+16.3 and is retired once it has passed
  2×50+4 = 104 yards, which at 11 yd/s takes 10 more seconds. An 18-second pad
  left the answer gone for eight seconds of the question.
- **Frostfire Volley drops one pool per carrier, not a trail, and a pool is
  spent when it cures somebody.** Each carrier lays a single patch of their own
  element the instant it lands, offset a few yards along the bearing *away* from
  the other carrier so the two patches end up further apart than the two bodies
  are. It used to drip a fresh pool every nine tenths of a second, which painted
  two converging stripes and solved the trade by accident somewhere in the
  middle — the mechanic is one decision about one destination. The patch then
  goes out on contact, reversing an earlier ruling that it lingered: the fear
  behind that ruling was that whoever arrived second would lose a race, and there
  is no second arrival to lose one, because `polarity` deals exactly one carrier
  of each element and lays exactly one patch of each, so every patch has exactly
  one customer. **That is an invariant rather than a coincidence** — a polarity
  that ever deals two carriers of one element owes them two patches of the
  opposite ground — and what it buys is a floor that tells the truth, with no
  spent cure still drawing next to the one that still works.
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
  watched it until the window closed — which on a fight where a failed crate
  window wipes the raid ended every tank pull at t=30 with no action available to
  the player at all. Measuring it honestly for every ally on every fight moved
  **twenty** cells of the sweep in both directions, including three careless
  clears, so the correction is scoped: an errand that has to be physically
  arrived at closes the last few yards, gated on the pickup declaring `soakers`.
  The general fix is a balance pass on six other encounters and is still owed.
- **The Explorers' fish is planted uniformly, and 75% is emergent rather than
  rolled.** The decision is that the player finds it roughly three times in four,
  and that otherwise an ally feeds it to a mouth from `feedPriority`, skipping
  anyone already empowered — so a missed fish costs you the *choice* rather than
  the pull. After six seconds of first refusal the nearest non-tank raider
  carries a fish nobody claimed into the next mouth on the list. The weighted
  plant is not built: the engine still hides the fish in any of the six crates.
  What makes the number come out roughly right anyway is where the player is
  standing — among the crates on a dps or healer pull, and nowhere near them on a
  tank pull, which is precisely the split the directive describes. A literal 75%
  would need the plant to know which crates are yours.
- **`feedPriority` is a pool, not a ranking, and that reversal is the whole of a
  reported bug.** It shipped as the fixed list Iku, then Gebbo, then Nama, which
  made Nama third on every pull anybody ever played — so Mighty Thud was always
  the empowerment the pull ran out of time for, and the report came back as
  "First Mate Nama's empowered ability comes in right before the enrage so it's
  not able to practise". No amount of rotation tuning fixes that, because being
  last was an *input* to the schedule rather than an output of it. The engine now
  shuffles the list once per world out of the same seeded stream every spawn roll
  draws from, so a fixed seed still reproduces a pull exactly while a session
  practises all three empowerments instead of two. A boss with no `feedPriority`,
  or a one-entry one, draws no numbers at all, so the other seven encounters'
  seeded sequences are untouched.
- **The simulated raid was killing the Explorer it was about to empower, and
  that was an instrument defect wearing a difficulty costume.** The playtest bot
  shoots the lowest of the three health bars, which on a council that starts
  level is a tie broken by array order — so it opened on `entities[0]` on every
  pull that has ever been played and drove that one body to a quarter of its
  health before the first crate window closed. It could not then stop: two of the
  three are tank-stacked four yards apart, so aiming at the other one still lands
  shots on it. Measured, Iku was at 3% when it finally ate at sixty-two seconds
  and dead four seconds later, and the Frostfire Volley the player had spent a
  crate window finding never fired once — a corpse casts nothing, and a dead
  mouth also deletes one of the three resets the pull is budgeted around. It is
  the same shape of defect as the old `feedPriority`: being first was an *input*
  to the schedule. The bot now levels the council while nobody has eaten and only
  ever burns a body that already has. Both halves are gated on the fight
  declaring a `feed` rule, so no other encounter's cells move. Three boss-file
  numbers were retuned around it — `maxHp` 0.76 &rarr; 0.62, because the floor
  under that dial was this bug and not the fight.
- **A competent raid banks a fish for a while, not for the better part of a
  minute.** The bot held every fish until the energy bar read 70%, which at the
  fight's rate is forty-eight seconds of standing on the answer — three times a
  pull, compounding, so the third Explorer was routinely still unfed at two
  minutes and on some seeds the pull ended with the fish in the raid's pocket. A
  percentage of a bar is a *duration* that scales with `energyPerSec`, which is
  what made that dial a cliff rather than a plateau: a slower bar did not buy
  time, it postponed every empowerment. The hold is now capped in seconds
  (`FISH_HOLD_CAP_MS`, 18s) with the percentage lowered to 55, so `energyPerSec`
  goes back to being the enrage clock and nothing else. Both figures were sampled
  across the sweep rather than interpolated; both fail at *both* ends, and for
  opposite reasons.
- **The Explorers' empowered abilities used to arrive too late to practise, and
  the cause was a round-robin standing in for a clock.** Every Throw Junk after
  the first is armed by the previous fish's empowered ability *resolving*, and
  that ability then had to wait its turn in an eighteen-slot rotation — measured,
  a fifty-second dead window, so the third fish frequently never landed at all.
  Two engine rules fix the wait and this fight's `loop` pays for them: a gate
  that has just opened takes the next beat *without* advancing the loop index
  (inserted, not substituted, so nothing is skipped), a beat that would have been
  silence goes to whichever open gate is overdue against the cadence its own
  array asked for, and each empowered entry now has three turns in a twenty-entry
  rotation at a six-second beat. Four turns each was tried and is *worse*: more
  heavy casts means a longer pull, a longer pull means later feeds, and the last
  empowerment ends up squeezed harder than before. The wait between paying for an
  ability and seeing it is now one beat, and across six seeds and three roles
  every one of the eighteen pulls buys all three empowerments — seventeen of them
  with 36–77s of pull left for the last one, the eighteenth with 6.6s. Fifty-one
  of the fifty-four abilities bought are then cast two to eight times, and Mighty
  Thud, the ability the report was about, is cast two to eight times on every row
  in the sweep. The three cast once are all the ability bought *last* on a dps
  pull, which is the shortest pull there is.
- **Mighty Thud leaps twice where its directive says three targets, and it is the
  one place an engine constant overrode the source.** The engine charges the raid
  a flat 0.3 of its single bar for every Deadly soak the *player* is not standing
  in — allies fill the other slots, but the last slot is always the player's and
  the resolve is measured at the player's feet. A player tank is anchored to a
  moving stack mark and this mechanic explicitly does not mark tanks, so on a
  tank pull every leap is a guaranteed miss: three of them is 0.9 of the raid bar
  per cast with nothing anybody can do about it. That was survivable only while
  the ability barely fired; once it started arriving promptly, two casts one beat
  apart came to 1.8 against a bar that starts at 1.0 and the tank cell wiped on
  two seeds in three with no mistake in it. Two leaps halves both numbers, the
  rota survives the cut, and the third leap comes back the day allies can satisfy
  a soak on the player's behalf — which is the lesson `reservePickups` has
  already learned for collects.
- **A failed Throw Junk window is the Explorers' wipe, not a single crate.** The
  directive says all boxes must be off the floor in ten seconds or the raid
  wipes, and that shipped as a full raid bar charged *per uncollected crate* —
  which with six crates models the window being failed six times over. One
  crate slipping during a Mighty Thud rota or a bomb chain therefore ended the
  pull outright, which is a cliff rather than a difficulty and made every other
  number in the fight untunable. It is now 0.20 a crate: four left standing is
  0.8 of the raid's single bar and effectively the pull, six is 1.2 and a wipe,
  and a careless player who collects nothing still dies on the first window at
  forty seconds in every role. It moved from 0.34 to 0.20 once every empowerment
  started landing, because each crate window is re-armed by an empowered ability
  resolving — so the windows come faster, collide with the rotation more often,
  and the tail of that distribution was ending a third of the sweep's pulls
  before the third fish. That one number took the count of empowered abilities
  that fire only once from eleven in fifty-four to three.
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
- **The Explorers now order the way the project asks them to.** The bar is "dps
  fastest, healer slowest"; the fight once landed 124s tank, 125s dps, 155s
  healer, which was a tie inside the noise at the front. The stated cause was
  that a tank here was a *passenger* — never on a crate, never on a fish, holding
  99% accuracy standing next to Iku while the dps ran errands at 96% — and that
  stopped being true when the tanks started stacking Nama and Iku and walking the
  pair around a lapping Gebbo. It now reads **131s dps, 133s tank, 168s healer**
  averaged over the three sweep seeds: the tank is genuinely paying for the
  empowered half of the rotation, because Mighty Thud marks non-tanks and a tank
  walking a moving stack mark cannot be inside any of the soaks it drops. The
  front two are close enough that the order is a claim about the average rather
  than about any single seed.
- **The Explorers' tank job was authored backwards and is now the other way
  round.** United Defense links when **all three** explorers are inside 30 yards
  of one another — which is "the widest pair is under 30" — so two of them
  standing on top of each other is legal, and the only distance that matters is
  the pair's distance to Gebbo. The fight shipped holding Nama and Iku *apart* at
  fixed stations, with a live readout of the gap between them, which measured a
  number nobody could fail and left neither tank watching the body that actually
  closes the link. Gebbo also patrolled a small circle off in the north, which
  made a link arithmetically impossible. He now laps the **arena centre** at
  radius 16 and the two tanked bodies are stacked and kited: the engine derives
  the walk from the fight's own data (link radius 30 + margin 8 − his reach 16 =
  a 22-yard ring, opposite him), and the middle of the room — a flat 16 yards
  from him wherever he is — is permanently inside the link and is not a parking
  space. The `keepApart` rule itself did not change; it was already right.
- **The Explorers' feed range came down from 6 yards to 3, and it had to.** The
  engine feeds the first living explorer inside the range, and two stacked bodies
  stand four yards apart, so a six-yard range covered both of them from anywhere
  near the mark and every fish walked to the pair went to Iku because Iku is
  `entities[0]`. "Which explorer do you empower" would have been answered by
  array order. At three yards the two shoulders are separable — walk in on the
  outboard side of the one you want — and the raid's own errand walk stops well
  inside it, so an ally delivery is unaffected.
- **A ring is answered on a schedule, and eight things in the engine were asking
  the wrong question.** Blast Wave is now an expanding ring off the bomb rather
  than a slab: the danger is the travelling line, it is judged on contact, and
  being airborne on a mushroom as it reaches you is the only exemption. Every
  consumer originally tested "is a wave live" as `!instance.resolved`, which is
  exactly backwards for a ripple — it resolves at the moment the ring is *born*
  and is dangerous for the ten seconds after — so the raid downed tools at the
  instant the danger started existing and a wave that killed 7 of 20 raiders as a
  slab killed all 20 as a ring. The fix is `wavePending` and `rippleEta`, and then
  seven separate things that each looked like the fight being too hard: an ally
  claimed a pad once per *mushroom on the floor* rather than once per tick, so
  capacity was full after two bodies; the idle sway was wider than the gap between
  the loiter ring and the trigger, so raiders drifted onto their pads one at a
  time; the clean-floor pass relocated a raider waiting beside one; a pad vanished
  under the group arriving with the first body onto it; raiders crossing the floor
  spent every mushroom they walked over, including the player's; the leaving time
  was measured at the pad instead of at the raider; and an AI tank was leashed six
  yards from its station and could not reach a pad at all — so it died, and the
  entity it held stopped moving for the rest of the pull. All eight are fixed and
  the ring is now answered by the raid, with tests.
- **Two things a player could not have prevented, found by chasing that.** A taunt
  took the nearest *entity*, so a tank whose footwork put them nearer Trader Gebbo
  than to their own pair took a boss nobody is meant to hold and orphaned Nama —
  thirteen United Defense links a pull, invisible and unrecoverable. And with the
  patroller dead, the two stacked explorers were still scored as a linked council,
  which charges the tank for the one thing the fight has spent the whole pull
  telling them to do. A taunt now only takes an entity some tank is meant to hold,
  and a pair the fight told the tanks to stack is not a pair.
- **The Explorers have no adds, and no Splinters.** Both were cut in the same
  pass. The Useless Junk kill-wave (with `addEverySec` and `maxAdds`) taught a
  raid to cleave crates while a fish sat unfound — Throw Junk crates are a
  `collect` you walk onto and Bouncy Mushrooms are launch pads, so nothing in the
  encounter is an enemy and nothing is shot down. Relic Rupture left with the add
  that cast it. Splinters is real, but it only ever happens as the price of
  soaking a crate; as a free-floating debuff on the rotation it showcased a
  mechanic the fight does not have. The one-box-per-player limit it enforces was
  already deliberately unmodelled, and stays so.
- **The Creepy Statues are cut from the Explorers trainer.** Evil Eyes was the
  highest-cast ability in the real fight and is real content left out on purpose:
  with three rotations, a lapping third boss, a fish economy, a moving tank mark
  and a polarity puzzle all running, a seventh source of small floor damage is
  noise over the top of decisions rather than another decision. Creepy Flames
  still has no confirmed damage ID at all.
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

**The edge is not the same thing in every room.** Six of these floors are
platforms: the floor stops, and walking off it is the fall — the single biggest
killer in the logs on Sszorak, and the thing Twin Fangs' Stone Breaker knock is
built on. Two are not. Nek'zali's hall and Vashnik's three-lobed one are enclosed
rooms, and the outline drawn round them is masonry: a body that walks into it —
the player, an ally, a boss, an add — is stopped, and nothing else happens. No
damage, no death, and nothing written into the debrief, because leaning on a wall
is not a mistake. Boss files say which they are with `walled: true`, the renderer
paints a walled rim in bone rather than the hot red it uses for a drop, and a room
may not be both walled and `acid` — the sweep in `invariants.test.js` refuses it.
What kills in those two rooms is in the middle of them: the Soulcoil Well and the
Malignant Cavity, both `lethalGround`, and neither one touched by this.

From PTR (July 2026) and unverified against live. Player positions are a lower
bound on the room — they are where players actually went.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Enable it once under
**Settings → Pages → Source → GitHub Actions**.

The deployed site has **no boss models** — `public/models/` is gitignored, so CI
never sees it and the picker serves its card fallback. That also keeps the main
bundle honest: three.js and the M2 parser are behind a dynamic import that only
fires once the models are found, so a visitor who will never use them does not
download 570KB of renderer to be told so.
