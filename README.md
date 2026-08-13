# World of Claudcraft — Curse of Claude'Tek

A top-down trainer for the **Heroic** mechanics of The Venomous Abyss, in the
spirit of [Castle Pineapplia](https://tacticalairhorse.itch.io/castle-pineapplia):
silly boss names over real, transferable mechanics.

Pick tank, healer or DPS. **WASD** to move, **1–4** for abilities. Kill the boss
before the enrage. Spoken callouts name each mechanic and tell you what to do —
the arena slows and the music ducks while one is being explained. The 🔊 button
turns the voice off.

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

**No music ships with this repo**, and `public/music/*.mp3` is gitignored so a
personal copy of a commercial track can never be published to Pages by accident.

Drop a file at `public/music/pull.mp3` and it plays on pull, ducks under the
voice callouts, and fades at the end. Without it the game runs silently — no
errors, no missing-asset warnings.

If you want music on the **deployed** site, it has to be something you are
allowed to redistribute. See [ATTRIBUTION.md](ATTRIBUTION.md) for CC0 and CC-BY
sources.

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
- **Multi-boss encounters render one boss.** Entombed Sentinels, Twin Fangs
  (tanked apart, confirmed), Lost Explorers and Coiled Altar all have two or more
  entities.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Enable it once under
**Settings → Pages → Source → GitHub Actions**.
