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
- every id referenced by `loop`, `spawns`, `ambient`, `atFullEnergy` resolves
- **which mechanics kill outright** is read from `category: "Deadly"` in the
  ability data, not chosen for balance — the same categorisation RaidLens uses
  to attribute a death to a mechanic
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
reach the boss, and adds accumulating faster than any player could clear them.

## Known gaps

Recorded honestly rather than quietly left out.

- **Arena shapes are still circles.** The sizes are measured (below) but Twin
  Fangs (corner/axis 1.19) and Coiled Altar (1.27) sit between a circle (1.00)
  and a square (1.41) — probably octagonal. Drawn as circles until live logs
  settle it.
- **Ula'tek's arena is unknown.** Zero logs across 625 PTR reports; it was never
  publicly tested. Its radius is a placeholder.
- **Frostfire Volley's element pairing** (opposing Fire/Frost patches detonate on
  contact) is folded into a generic Fire Patch entry. It is a polarity mechanic
  and the engine has no polarity primitive.
- **Turbulent Gusts** (Sszorak) — being aloft is a movement state with no
  mid-air collision. Two-body airborne physics, deliberately deferred.
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
