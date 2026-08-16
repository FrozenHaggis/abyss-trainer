# Phase structure — The Venomous Abyss

Every boss split into its phases, derived from the tactic files in
`raidlens/12.1/VenomousAbyss/<Boss>/<Boss>.md`. Quoted phrases are verbatim from
those files.

**Two of the eight fights have no phases at all.** That is a finding, not a gap —
encoding invented stages for them would make the trainer teach something the
fight does not do. It was three until the Twin Fangs' own tactic file was read
against the raid leader's account of the encounter: the file says "a fixed
cadence gated by an energy bar" and the encounter is a script with an
intermission in it, which is a stage structure however the guide describes it.

| Boss | Structure | Phases |
|---|---|---|
| Nek'zali the Soulcoiler | Linear | 2 + intermission |
| Entombed Sentinels | Recurring cycle | — |
| Vashnik the Malignant | Recurring cycle | **none — stated** |
| The Lost Explorers | Council | **none** |
| Sszorak | Recurring cycle | 1 + intermission |
| The Twin Fangs | Recurring cycle | 1 scripted rotation + intermission, cycling |
| The Coiled Altar | Linear | 3 + intermission |
| Ula'tek | Linear | 3 |

---

## Linear-stage fights

### Nek'zali the Soulcoiler — 2 stages + intermission

| # | Phase | Entered by | What defines it |
|---|---|---|---|
| 1 | **Stage One** | pull | Add control around the Soulcoil Well. Every spirit that reaches it — or player who dies in it — fires a **Soulcoil Rite**: raid-wide Shadow damage, a permanent stacking DoT, and **5 energy** to Nek'zali. |
| — | **Intermission — Ritual of Awakening** | **50% boss health** *(stated)* | Summoner Jawae raises the Tethers and channels **Soul Transfer** (`1293211`) for **15s** into an **Echo of Jawae**, ending in a Shadow burst (`1295085`). Kill every Echo to sever the tethers. |
| 2 | **Stage Two — Uncoiling** | **energy bar full** | **Uncoiling** (`1292315`) ticks Shadow damage on the raid every second until she dies. At 100 energy **Uncoiled Rage** grants +500% damage, +150% speed and taunt immunity — a hard end to the pull. |

Note the two triggers are different quantities: the intermission is a **health**
threshold, Stage Two is the **energy bar**. The fight is an energy race with a
health-gated interruption, not a health-percentage ladder.

`1295085` is 300 yd — raid-wide, a healing check, and explicitly **"not the 'get
out of the path' positioning failure the guides imply"**.

### The Coiled Altar — 3 stages + intermission

| # | Phase | Entered by | What defines it |
|---|---|---|---|
| 1 | **Stage One — Zul'jan** | pull | Zul'jan (`257911`) fills the arena with poison orbs. |
| 2 | **Stage Two — Hex Lord Malacrass** | ⚠ **UNKNOWN** | Malacrass (`259854`): mind-control marches, soul fragmentation, and a lethal kickable cast behind a shield. |
| — | **Intermission — Soulbinding** | end of Stage Two | Malacrass binds his soul to Zul'jan's corpse (`1304032`), healing **2% max HP per second for 35s** while taking **+100% damage** (`1304033`). The ritual completing is the failure. |
| 3 | **Stage Three — both** | Soulbinding ends | Both bosses up, linked by `1309987` so **killing one berserks the other**. Health pools must stay level. Deathguard (`1304028`) absorbs stunned Manifestations at 99% reduced damage — damage logged in that window is wasted. |

⚠ **Evidence gap, quoted from the tactic file:** *"both PTR Mythic and Heroic
reports died in Stage One. Everything past it has Normal-difficulty log evidence
only."* The Stage One → Two trigger is not stated in any source.

### Ula'tek — 3 stages

⚠ **No combat logs exist for this boss at all.** The tactic file carries a
`## ⚠ Unverified — no combat logs exist` header. Everything below is from guide
prose, and none of the stage transitions is stated.

| # | Phase | Entered by | What defines it |
|---|---|---|---|
| 1 | **Stage One** | pull | *"melee uptime and egg control"* — Blightscale Viper / Rawling adds; every egg allowed to hatch adds a permanent **Putrid Membrane**. |
| 2 | **Stage Two** | ⚠ **UNKNOWN** | *"an add-priority puzzle gated behind the Doomscale Wardens"*. Wardens die first; their aura forbids egg touching while alive. A 20s **Writhing Gestation** channel turns Spawn into a Clutch — **not kickable**, break the clutch instead. |
| 3 | **Stage Three** | ⚠ **UNKNOWN** | *"a shrinking-arena survival check"* on a collapsing platform. |

Across all three: **Necrotic Vapors**, a stacking raid-wide DoT that never falls
off, is what actually wipes raids. *"Healing attrition race; the adds set the
clock."*

**Rage of the Shackled** → Falling Debris → **Venomous Heart** is the one burn
window: 20s of raid damage, then the Heart exposed at +100% damage taken. Which
stage it belongs to is not stated.

---

## Recurring-cycle fights

These have no stages. They run one loop, gated by an energy bar, until the boss
dies. The "phase" is a window inside the loop that repeats.

### Entombed Sentinels — energy cycle

Two golems, **Breath of Ula'tek** (`258557`, Nature) and **Blood of Ula'tek**
(`258558`, Shadow), sharing one energy bar.

| Window | Trigger | What happens |
|---|---|---|
| Normal | — | Keep them apart or **Ula'tek's Dominance** parks both at 99% damage reduction. |
| **Vitriolic Stasis** | **100 energy** | Both channel, healing the weaker up to match the healthier — *"uneven damage is a reset, not a meter problem"*. Applies **Helical Toxins**; players collide to reach **exactly four** applications. |

Soft enrage: Mark of Acid and Mark of Blood stack forever.

### Vashnik the Malignant — Imbibe loop

> *"No phases — one loop driven by **Imbibe**."* — stated outright.

At 100 energy Vashnik drinks from the **two fountains nearest him**, firing their
Expulsions, adding a permanent **Toxic Vapor** stack, and dragging a living venom
out of each toward the **Malignant Cavity**. **His position picks the fountains,
so the tank picks the raid's next mechanics** — that is the whole fight.

Top killer: a venom reaching the Cavity and firing **Malignant Burst** — 45
killing blows in six Mythic pulls, more than everything else combined. Nothing
here is kickable.

### Sszorak — three-beat loop

Single target, no adds, nothing to kick.

| Beat | What happens |
|---|---|
| 1 | Venom and cone pressure |
| 2 | **Raging Crosswinds** spread |
| 3 | **Howling Maelstrom** — he plants himself with **Dig In** and takes **+30% damage**. The only burn window. |

**What wipes raids here is falling off the platform.** `Falling` (spell 3) took
**31 killing blows** in 6 Mythic PTR pulls, more than every boss ability
combined.

Authored as beats 1-2 in one stage and beat 3 as an intermission, cycling. That
is a real structure rather than an invented one — the beats are the tactic file's
own — but note what it is NOT: `Howling Maelstrom` (1285732) is a phase marker
with no cast events, so the stage is detected through `Dig In` exactly as the
ability data instructs, and nothing in the trainer lets you fail the marker.

### The Twin Fangs — a scripted rotation and an intermission, cycling

> *"There are no health phases, just a fixed cadence gated by an energy bar."*

The tactic file's sentence is right about health and wrong about the bar, and the
raid leader's account of the fight is what settles it. Every joint in that
account is the word "once" — *"the Stone Breaker and soaks do not happen at the
same time as the Caustic Deluge and the Globules"*, *"once both of these
abilities have been performed, Vexhul casts Venomous Emergence"*, *"once this
completes start the intermission phase where the boss casts submerge"*. That is a
**script**: six steps in a fixed order, each waiting for the one before it to
finish, and then an intermission. It is authored as two cycling stages with
`PhaseDef.sequential`, which is what makes "waits for" the mechanism rather than
a gap somebody tuned.

Vexhul and Ithraz are tanked apart on a shrinking platform and do **not** share a
health pool.

| # | Stage | Entered by | What defines it |
|---|---|---|---|
| 1 | **The cadence** | pull, and every Submerge ending | Caustic Deluge → Stone Breaker → Venomous Emergence → Coiling Ichor → Stir the Depths → Ravenous Feast, strictly in that order. A step is over when its channel's beats and everything still telegraphing below them are gone — so the Deluge holds through the last globule's fuse (which is what keeps it off Stone Breaker), a Congealed Gore pool on the rim holds nothing, and the Spawn of Vexhul are still alive and spitting two steps later. |
| — | **Intermission — Submerge** (`1308556`) | the cadence running out of script | Both serpents leave the floor: Vexhul into the venom pocket to channel **Vile Flood**, a beam that arcs 150° round the platform over ten seconds, and Ithraz out into the acid beside the right leg raining **Sanguine Storm** for the same ten. Both are immune for the duration. Ends when the beam does. |

| End-state | Trigger | What happens |
|---|---|---|
| **Uncoiled Wrath** | first serpent dies | The survivor gains uncapped rage; the other must die within **5 seconds** or the raid wipes. |
| **The third Submerge** | energy bar full | Vile Flood is the only thing that feeds the bar, at 34 a cast, so it reads 34 / 68 / 102: *"if the boss isnt dead by the 3rd submerge, the raid wipes."* |

⚠ **The third Submerge is not reachable inside the trainer's own pull clock.** A
rotation plus its intermission measures 79.8 seconds, so the three Vile Floods
resolve at roughly 69 / 149 / 229 against a `pullLengthSec` of 200. The wipe is
implemented and tested; a pull that runs on the clock simply times out first.
Resolving it means moving one of two settled numbers — the 200, or a Submerge
after every rotation — and neither is guesswork this file should do.

Nothing here is dispellable.

---

## The Lost Explorers — council, no phases

Three possessed tortollans — **Scrollsage Iku** (`261843`), **First Mate Nama**
(`261835`), **Trader Gebbo** (`261848`) — puppeted by **Mor'zahi** (`261584`),
who *"sits outside the health pool and cannot be attacked"*.

Confirmed from a Mythic PTR log: Mor'zahi took **0 damage across 10,001 player
damage events** while casting Malevolent Presence 1,911 times.

**United Defense** (`1297646`) gives all three 99% damage reduction within 30 yds
of each other, so they stay parked apart all night and must die within seconds of
each other or the survivors enrage. **Final Ascension**, Mor'zahi's raid-killing
channel, is an event rather than a phase — stopped only by feeding a **Disgusting
Fish** to whichever tortollan he controls.

Top killer: **Blast Wave** — 18 killing blows on the Mythic PTR sample, more than
any other ID — *"and the only answer is being airborne on a Bouncy Mushroom when
it passes."*

---

## Open questions

Answer these and the linear fights can be encoded exactly:

1. **Coiled Altar** — what ends Stage One? A Zul'jan health percentage, or a
   timer?
2. **Ula'tek** — what triggers Stage Two and Stage Three?
3. **Ula'tek** — which stage contains the Venomous Heart burn window?

Not guessing at these deliberately. Every other number on this page is quoted
from a source.
