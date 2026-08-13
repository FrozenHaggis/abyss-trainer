# Adds — what each one actually asks of you

Every add in The Venomous Abyss, and the job it demands. Derived from the
`adds[]` arrays in each boss's `abilities.json` (observed spells, categories,
interrupt and dispel flags verified against DB2) plus the tactic files in
`raidlens/12.1/VenomousAbyss/`. Quoted phrases are verbatim.

**40 adds across 7 bosses. Sszorak has none** — single target, no adds, nothing
to kick.

The headline: **"kill it fast" is the right answer for only about a third of
them.** Several must be shielded-broken first, two must be intercepted rather
than killed, and on the Coiled Altar the central add **must not be killed at
all**.

---

## The six jobs

### 1. Kick it — the cast is the threat

**On Heroic there are exactly four**, and they live on two bosses. Everything
else kickable in this raid is Mythic-only.

| Boss | Add | Cast | ID | What it does |
|---|---|---|---|---|
| Coiled Altar | Spiteful Soulcoiler | **Wail of Terror** | `1286399` | 7s cast, **fears the entire raid for 5s** |
| Ula'tek | Doomscale Warden | **Malice** | `1290779` | 1.5s cast, 6s raid-wide Nature — *"the highest-value kick in the fight"* |
| Ula'tek | Ravenous Doomscale | **Anguished Cry** | `1305650` | Nature damage + **6s raid-wide stun** |
| Ula'tek | Blightscale Shrieker | **Vicious Echoes** | `1310764` | 2.5s cast, **unlimited range**, raid-wide Nature + 6s stun |

Malice, Anguished Cry and Vicious Echoes are all **VERIFIED InterruptFlags 45**
in DB2. Wail of Terror is flagged interruptible by both warcraft.wiki and the
journal but has **no log evidence yet** — treat as probable, not confirmed.

Anguished Cry is also **Magic-dispellable**, but the note is explicit about why
that is not an assignment: *"the stun is raid-wide, so dispellers are usually
stunned too; treat the Magic dispel as situational."* **Kick first.**

Mythic-only kicks, listed so nobody assigns them on Heroic: Soulcoiler's Curse
(Nek'zali), Visceral Burst and Barbed Bulwark (Twin Fangs). This is why the Twin
Fangs file says outright there is **no interrupt on that boss** at Heroic.

**Two traps.** Both look kickable and are not:

- **Writhing Gestation** (`1290990`, Doomscale Warden) — *"InterruptFlags 0 with
  channel-interrupt flags set — it is a channel, not a kickable cast. Stop it by
  breaking the clutch."*
- **Dread Roar** (`1305775`, Ravenous Doomscale) — a raid-wide DoT plus a **20
  second raid stun**, *"a wipe if it lands"*. **InterruptFlags 41, NOT kickable;
  prevented only by weakening the Doomscale first.**

### 2. Break the shield, then kill

The add cannot die while its absorb holds. Burning it without breaking the shield
is wasted damage.

| Boss | Add | Shield | ID | Size |
|---|---|---|---|---|
| Nek'zali | Restless Amani | Gravebound Advance | `1287533` | 25% of the add's health — *"while it holds the add cannot die or be stopped"* |
| Vashnik | Shrouded Venom | Miasmic Coating | `1312366` | **100%** of the add's max health |
| Ula'tek | Blightscale Spawn | Hardened | `1299650` | Mythic only. Also makes the spawn **immovable** |
| Coiled Altar | Spiteful Soulcoiler | Spirit Shield | `1309105` | Mythic only. 99% reduction, stripped only by Gloombomb |

⚠ Restless Amani: guides call the absorb magic-breakable, but wowhead's effect
reads Absorb Damage (All). **School requirement unconfirmed** — do not build an
assignment on it.

### 3. Kill it before a timer completes

No interrupt available. The clock is the mechanic.

| Boss | Add | Clock |
|---|---|---|
| Twin Fangs | **Bloodcurdled Mass** | Bloody Expulsion — *"a permanent channel pulsing the raid every 4s and gaining +15% of its own damage per pulse — a soft enrage with no interrupt, so kill the add."* **12 killing blows on Heroic PTR.** |
| Ula'tek | **Blightscale Clutch** | *"The spawn inside grow in power while the clutch is unbroken — break it before gestation completes."* |
| Ula'tek | Blightscale Spawn | **Boiling Venom** at 25–30s: +100% haste and damage |
| Sentinels | Venom Coagulation | Not kickable, zero interrupts logged; *"cast count proxies add kill speed"* |

### 4. Kill it — but *where* and *when* decide whether that helps

These punish killing them carelessly.

- **Burning Venom** (Vashnik) — Caustic Surge `1285979` erupts **on death**.
  *"A large slice of the raid hit on one cast means it was killed inside the
  stack."* Kill it away from the group.
- **Clotting Venom** (Vashnik) — **splits on death** (`1286631`, 10yd trigger)
  and *"each split still walks for the Cavity"*. Also carries Sanguineous
  Fortitude: immune to Disarm, Disorient, Fear, Slow, Root and Stun —
  *"cannot be kited or CC'd, only killed."*
- **Restless Amani** (Nek'zali) — every death applies **Corpse Blight**, a
  stacking raid-wide DoT with **no dispel type**. *"Unavoidable, the price of
  killing adds."* Killing them is correct; the healing cost is not a failure.

### 5. Intercept it — do not kill it

The add is going somewhere. Your job is to be in the way.

- **Fragment of Malacrass** (Coiled Altar) — crawls toward Zul'jan. Step on it.
  One that gets through casts **Reclaim Essence** (`1287718`), healing him 1% max
  HP. Stepping on one fires raid-wide Shadow (`1287722`) — *"destroying fragments
  is the assigned job, so report simultaneous occurrences, never per-player
  failures."*
- **Manifestation of Dread** (Coiled Altar) — fixates, and **only moves while its
  target is not looking at it** (`1285911`). Reaching its target fires **Despair**
  (`1307009`): heavy Shadow plus *"a knockback that can throw the player off the
  platform."*

### 6. Do not touch it

- **Coalesced Venom Stalker** (Coiled Altar) — the orbs. Their aura pulses
  raid-wide Nature every 2s until destroyed, so *"orbs alive over time is the
  core management metric"* — but **destroying one detonates Venom Rupture, which
  took 58 Mythic killing blows, more than everything else in the fight
  combined.**

  The fight is *"arena management, not reflexes: every orb left where an axe or a
  tank cone will destroy it is a Rupture waiting to happen."* The job is not
  killing them and not standing near them — it is keeping them out of the path of
  your own abilities.

---

## Tools, hazards and scenery

Not adds you fight — adds you use or dodge.

| Boss | Entity | What it is |
|---|---|---|
| Explorers | **Bouncy Mushroom** (`268045`) | **The only answer to Blast Wave.** Contact fires Bounce (`1299855`) and you must be airborne when the wave passes. |
| Explorers | **Creepy Statue** (`264706`) | Evil Eyes — the most-cast ability in the fight (700× Mythic). Up to **7 concurrent**. |
| Explorers | **Useless Junk** (`272110`) | Up to **117 concurrent**. Relic Rupture is Deadly: *"20 players hit and 6 killing blows on Mythic PTR"*. Deaths here are **a crate-cleave failure, not a positioning one.** |
| Nek'zali | **Soulcoil Well** (`266756`) | The fight's centre. Every spirit reaching it fires a Soulcoil Rite. |
| Nek'zali | **Latent Cultist** | Spawn explosion plus a persistent puddle, Shadow damage per second and a 40% snare. *"Any hit on any player is a failure."* |
| Vashnik | 3 fountain stalkers (`259391/2/3`) | Blood / Fire / Shadow. Vashnik drinks from **the two nearest him**, so the tank's position picks the raid's next mechanics. |
| Twin Fangs | Spawn of Vexhul | **Corrosive Spit is NOT kickable** — *"the Journal tags it Frontal/Avoidable only, DB2 PreventionType is 0, and no log shows an interrupt. Dodge it."* |

---

## Per-boss summary

| Boss | Adds | The add job, in one line |
|---|---|---|
| Nek'zali | 6 | Break Amani shields, keep everything off the Well; eat the Corpse Blight cost |
| Entombed Sentinels | 2 | Kill Coagulations quickly — no kick exists |
| Vashnik | 4 | Break the 100% Shrouded shield; kill Burning Venoms away from the raid; Clotting Venoms split and cannot be CC'd |
| The Lost Explorers | 4 | Scenery, not adds. Use the mushrooms, cleave the crates |
| Sszorak | **0** | — |
| The Twin Fangs | 5 | Kill the Bloodcurdled Mass before its channel snowballs. **No Heroic kicks** |
| The Coiled Altar | 7 | **Do not destroy the orbs.** Kick Wail of Terror, body-block Fragments, look at the Manifestations |
| Ula'tek | 12 | The kick fight. Wardens first, break clutches, and weaken Doomscales before Dread Roar |

---

## Gaps

Flagged rather than guessed:

- **Ula'tek has no combat logs at all.** Every npcId in its `adds[]` is `0`.
  Categories come from journal and guide prose only.
- **Latent Cultist** (Nek'zali) — `npcId: 0`, unresolved.
- **Living Venom** (Sentinels) — `spellId: 0`. Confirmed avoidable by
  warcraft.wiki, but undetectable until the ID is observed.
- **Wail of Terror** interruptibility — journal and wiki agree, no log evidence.
- **Restless Amani** absorb school — sources disagree with wowhead.
- **Spew Venom** (Hatchling of Vexhul) was **deliberately demoted out of the kick
  table**: 4 interrupts against 19 casts in one Normal PTR log, but no guide or
  journal documents it. *"Kick-failure reporting here would be a phantom."*
  Re-promote only if a real log confirms it.

Run `raidlens abilities --boss <key> --merge` once live logs exist and the
resolvable ones fill in without touching curated categories.
