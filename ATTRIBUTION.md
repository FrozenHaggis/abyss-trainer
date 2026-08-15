# Attribution and assets

## Boss and role art — game-icons.net (CC BY 3.0)

Boss sigils come from [game-icons.net](https://game-icons.net) and are licensed
**Creative Commons BY 3.0**. Attribution is required and must stay on the title
screen.

| Boss | Icon | Author |
|---|---|---|
| Tok'zali the Contextcoiler | `snake-spiral` | Delapouite |
| The Entombed Guardrails | `rock-golem` | Delapouite |
| Vashnik the Malformed | `poison-gas` | Lorc |
| The Lost Subagents | `compass` | Lorc |
| Ssztream, Herald of the Six Winds | `tornado` | Lorc |
| The Twin Prompts | `bestial-fangs` | Lorc |
| The Recursive Altar | `sword-altar` | Delapouite |
| Claude'Tek | `sea-serpent` | Lorc |

> Icons made by Lorc and Delapouite. Available on https://game-icons.net

The role glyphs (shield / cross / sword) are original, drawn for this project.
No licence obligation.

---

## Music — one fixed track

The game plays a single track on every pull:

```
public/music/boss-music.mp3
```

It loops while the pull runs, ducks under the voice callouts, and fades out at
the end. There is no in-app picker — replace the file to change it.

| Track | Artist | Composition | Source |
|---|---|---|---|
| Guile's Theme (cover) | Mitch Murder | Yoko Shimomura — © Capcom | [SoundCloud](https://soundcloud.com/mitchmurder) |

The track **is committed**, so a clone and the deployed site both have it. Any
*other* mp3 dropped into `public/music/` stays gitignored, so a personal copy of
something else cannot be published by accident. If the file is absent the game
runs silently — no errors, no missing-asset warnings.

### The licence position, stated plainly

This is shipped as non-commercial fan use, not under a licence. Recording it
honestly so nobody has to re-derive it later:

- Guile's Theme is **Yoko Shimomura's composition, owned by Capcom**. It is not
  public domain.
- Mitch Murder's cover is tagged CC BY on SoundCloud, but that tag can only
  cover *his recording*. Nobody except Capcom can license the composition
  underneath, so the CC BY tag does not make the track redistributable.
- Serving it from the deployed site is redistribution. Being free, non-profit
  and a raid guide are mitigating facts, not a licence — they weigh in a fair
  use argument, they do not settle one.
- YouTube creators use this music routinely because Google holds blanket
  licensing deals and Content ID lets rights holders claim the video instead of
  suing. GitHub Pages has no equivalent, so the realistic outcome here is a
  **DMCA takedown of the site**, not damages.

That risk was weighed and accepted. If the page ever does get pulled, the fix is
to swap in a clearable track from the list below — the file path is the only
thing the code cares about, so it is a one-file change.

### Tracks you can ship

If you want something the guild can share without that worry:

| Source | Licence | Notes |
|---|---|---|
| [Kevin MacLeod — incompetech.com](https://incompetech.com/music/royalty-free/) | CC BY | Huge library, credit required. Look under "Rock" / "Action". |
| [Free Music Archive](https://freemusicarchive.org/) | varies (filter to CC) | Filter by licence before downloading. |
| [OpenGameArt — music](https://opengameart.org/art-search-advanced?field_art_type_tid%5B%5D=12) | CC0 / CC BY | Written for games; plenty of driving chiptune and rock. |
| [Kenney — music packs](https://kenney.nl/assets?q=audio) | CC0 | No attribution needed at all. |

For that specific energy — mid-tempo, driving, brass-and-guitar — search
incompetech for "Hero" or OpenGameArt for "battle theme rock".

Add any CC BY track you use to this file.
