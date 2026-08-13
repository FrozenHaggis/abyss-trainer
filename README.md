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

**Load your own on the title screen.** Pick any audio file from your PC and it
plays on pull, ducks under the voice callouts, and fades at the end. The file is
read straight into the browser via an object URL — it is **never uploaded**, so
nothing is hosted or shared, and your own copy of a soundtrack works fine on the
deployed site. Every raider loads their own; the choice is remembered per browser.

**No music ships with the repo.** `public/music/*.mp3` is gitignored so a personal
copy can never be published by accident. If you want a default track baked into
the deployed site for everyone, it has to be one you may redistribute — see
[ATTRIBUTION.md](ATTRIBUTION.md). Drop it at `public/music/pull.mp3`.

Without either, the game runs silently — no errors, no missing-asset warnings.

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

## Adding a boss

Author `src/bosses/<key>.ts` against `MechanicDef` in `src/engine/types.ts`, then
import it in `registry.ts`. A test fails if a boss file exists but is unwired.

## Balance

`npm run playtest` runs a headless bot through every boss in every role. The bar:
a careless player dies, a competent one kills it, DPS fastest and healer slowest.
Check balance changes against it rather than by eye — it has caught an annulus
being fled outward off the platform, pools detonating on the carrier who dropped
them, and a tank dying to a dispel they cannot cast.

## Known gaps

- **Arena shapes are placeholder.** Every fight is currently a circle. Research
  confirms Sszorak is a platform with lethal edges and Twin Fangs is a platform
  ringed by a venom sea, but no source publishes room geometry, and the raid only
  opened on 18–19 August 2026. Real shapes need in-game confirmation.

  Geometry *is* derivable from combat logs — position data falls straight out of
  a log recorded with **Advanced Combat Logging** enabled. The PTR log checked so
  far had it switched off, which is why no `x`/`y` was available. One live night
  with it on and every room's shape and size can be measured rather than guessed.
- **Mor'zahi is targetable here but untargetable in the real fight** (0 damage
  taken across 10,001 events in the PTR log). He should be a caster you cannot
  shoot.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Enable it once under
**Settings → Pages → Source → GitHub Actions**.
