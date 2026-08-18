import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The sweep.
//
// Every defect found on ONE boss, checked against ALL of them. This file exists
// because the same bug kept being found and fixed a boss at a time — a soak
// scored as a failure on Twin Fangs, then the identical thing on Sentinels and
// again on Sszorak; two entities parked inside their own link radius on the
// Sentinels, then again on the Lost Explorers. Each of those was a class, not
// an incident, and the class is what gets checked here.
//
// Every rule below traces to a real defect that shipped.

const ABILITIES = 'data/abilities'
const BOSSES = readdirSync('src/bosses')
  .filter(f => f.endsWith('.ts') && f !== 'registry.ts')
  .map(f => f.replace('.ts', ''))

/** Abilities bound to 1-4 per role — from ABILITIES_BY_ROLE in sim.ts. */
const KIT = {
  tank: ['taunt', 'defensive', 'interrupt', 'burst'],
  healer: ['dispel', 'raidcd', 'defensive', 'interrupt'],
  dps: ['interrupt', 'defensive', 'burst', 'dispel'],
}
const PLAYER_SPEED = 14      // yards/sec, from sim.ts
const REACTION = 0.35        // seconds of human reaction budget
const TANK_LEASH = 6         // yards a tank may drift from its station, from sim.ts

function spellsOf(key) {
  const raw = JSON.parse(readFileSync(join(ABILITIES, `${key}.json`), 'utf8'))
  const all = [...(raw.spells ?? [])]
  for (const a of [...(raw.bosses ?? []), ...(raw.adds ?? [])]) all.push(...(a.spells ?? []))
  return new Map(all.map(s => [s.spellId, s]))
}

/** Split a boss file into one text block per MechanicDef. */
function mechanicsOf(key) {
  const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
  const body = src.slice(Math.max(0, src.indexOf('mechanics: [')))
  // CRLF-tolerant on purpose. This was LF-only, and a Windows working copy
  // checks out CRLF — so the split matched nothing, every sweep below iterated
  // zero mechanics, and this whole file passed VACUOUSLY on the author's machine
  // while CI (which checks out LF) caught a real defect. A parser that silently
  // finds nothing is worse than no parser, hence readAllMechanics' guard.
  return body.split(/\r?\n {4}\{\r?\n/).slice(1).map(blk => {
    const g = (re, d = null) => (blk.match(re)?.[1] ?? d)
    const roles = (g(/roles: \[([^\]]*)\]/) ?? '')
      .split(',').map(r => r.trim().replace(/'/g, '')).filter(Boolean)
    return {
      blk,
      id: g(/id: '(\w+)'/),
      spellId: Number(g(/spellId: (\d+)/, 0)),
      rule: g(/rule: \{ type: '(\w+)'/),
      pressAbility: g(/rule: \{ type: 'press', ability: '(\w+)'/),
      shape: g(/kind: '(\w+)'/),
      radius: Number(g(/radius: ([\d.]+)/, 0)),
      telegraphMs: Number(g(/telegraphMs: (\d+)/, 0)),
      roles,
      lethal: /\blethal: true/.test(blk),
      collective: /\bcollective: true/.test(blk),
      failText: g(/failText: ['"]([^'"]*)['"]/, ''),
    }
  }).filter(m => m.id && m.rule)
}

/**
 * Every boss's mechanics, with a hard guarantee that parsing actually worked.
 *
 * Without this a broken regex turns every sweep in this file into a no-op that
 * reports success. That happened.
 */
function readAllMechanics() {
  const out = BOSSES.map(key => ({ key, mechanics: mechanicsOf(key) }))
  const empty = out.filter(b => b.mechanics.length === 0).map(b => b.key)
  assert.equal(empty.length, 0,
    `parsed zero mechanics from: ${empty.join(', ')} — the sweep would pass vacuously`)
  return out
}

const arenaOf = key =>
  Number(readFileSync(join('src/bosses', `${key}.ts`), 'utf8').match(/arenaRadius: (\d+)/)[1])

/**
 * True when the note points at a marker/dummy ID but the real player-facing ID
 * is genuinely unresolved (`spellId: 0`) in the same ability data. Using the
 * marker is then the only honest handle available, and the data says so — see
 * Living Venom and Volatile Purge, both flagged for re-mapping on the first
 * live log. Not a defect; a documented data gap.
 */
function realIdIsUnresolved(spells, name, note) {
  // Stated as a sibling entry with no id — Living Venom does this.
  for (const s of spells.values()) {
    if (s.name === name && s.spellId === 0) return true
  }
  // Or stated in prose on the note itself. Volatile Purge: "CAVEAT: this ID
  // carries a Dummy effect, so the eruption damage likely lands on a child ID
  // (siblings ...) — re-map on the first log." The candidates are named but not
  // confirmed, so the marker is still the only honest handle.
  return /re-map on the first log|SPELL ID NEEDED|likely lands on a child ID/i.test(note ?? '')
}

// ── 1. Unavoidable damage must never be scored against a player ──────────────
// Shipped three times: Noxious Blast, Malignant Burst and Serpent's Bite were
// all 300-yard raid-wide and all blamed the player for standing somewhere.
test('sweep: no 300-yard ability is scored per-player on any boss', () => {
  // `launchPad`, `elementPool` and `feed` join the list because none of them can
  // put a name in the debrief at all: touching a mushroom, standing in a cure and
  // walking a fish into a boss are all things the engine refuses to score. A new
  // Rule member is invisible to this sweep unless it is decided about here, and
  // `wave` and `polarity` are deliberately NOT here — both can name a player.
  const SAFE = ['raidDamage', 'press', 'tankSwap', 'keepApart', 'burnWindow', 'syncKill',
    'launchPad', 'elementPool', 'feed']
  for (const { key, mechanics } of readAllMechanics()) {
    const spells = spellsOf(key)
    for (const m of mechanics) {
      const note = spells.get(m.spellId)?.note ?? ''
      if (!/\b300\s*(yd|yard)/i.test(note)) continue
      assert.ok(SAFE.includes(m.rule) || m.collective,
        `${key}/${m.id}: 300yd raid-wide but rule='${m.rule}' — names the whole raid every pull`)
    }
  }
})

// ── 2. Markers and dummies must not produce failures ─────────────────────────
// Howling Maelstrom was a dummy phase marker given a lethal annulus.
test('sweep: no marker or dummy ID can be failed on any boss', () => {
  // Every rule that can put a player's name in the debrief. `combo` is not one:
  // it is a container that fires other mechanics and is never scored, which is
  // the only reason Apex Predator — "a server-side dummy with no events, so it
  // never produces a failure" — is allowed to be in the file at all.
  //
  // `wave` and `polarity` are here because both end with a name attached: a
  // player caught on the floor by a Blast Wave, and a carrier who walked an
  // uncleansed element into a second Frostfire Volley. Frostfire Volley's own ID
  // (1295891) IS a cast marker, and without this line a polarity keyed to it
  // would have passed silently — it only survives the check because it is
  // `collective`, which is the honest escape rather than the invisible one.
  //
  // `shedStack` is on the list because it can kill you and name you for it — a
  // second bite of one Ravenous Feast is a failure row and a corpse. It joined
  // when Ravenous Feast stopped being a `beInside`, and without it a mechanic
  // that had been swept here for its whole life would have quietly dropped out.
  const FAILABLE = ['avoid', 'beInside', 'collect', 'carryOut', 'survive', 'groupSoak', 'windPair',
    'stackingDot', 'shedStack', 'wave', 'polarity']
  for (const { key, mechanics } of readAllMechanics()) {
    const spells = spellsOf(key)
    for (const m of mechanics) {
      const sp = spells.get(m.spellId)
      const note = sp?.note ?? ''
      // "server-side dummy" as well as "server-side script": Apex Predator's
      // note uses the first wording and slipped straight past a check written
      // against the second, which is how a window marker nearly shipped as a
      // mechanic you could be blamed for.
      if (!/CAST MARKER|phase marker|Dummy effect|server-side (script|dummy)|Window marker/i.test(note)) continue
      if (!FAILABLE.includes(m.rule) || m.collective) continue
      assert.ok(realIdIsUnresolved(spells, sp?.name, note),
        `${key}/${m.id}: note calls ${m.spellId} a marker/dummy but rule='${m.rule}', ` +
        'and a real player-facing ID exists — key it to that instead')
    }
  }
})

// ── 3. Correct play is never a failure ───────────────────────────────────────
// Caustic Globule, Toxic Droplets and Mutilate each scored the player for doing
// exactly what their tactic file asks.
test('sweep: mechanics the tactic files call collective never name a player', () => {
  const MD = {
    nekzali: 'Nekzali/Nekzali.md', sentinels: 'Sentinels/EntombedSentinels.md',
    vashnik: 'Vashnik/Vashnik.md', explorers: 'Explorers/LostExplorers.md',
    sszorak: 'Sszorak/Sszorak.md', twinfangs: 'TwinFangs/TwinFangs.md',
    coiledaltar: 'CoiledAltar/CoiledAltar.md', ulatek: 'Ulatek/Ulatek.md',
  }
  const BASE = 'C:/Users/Matthew/ai-projects/raidlens/12.1/VenomousAbyss/'
  for (const key of BOSSES) {
    if (!existsSync(BASE + MD[key])) continue     // tactic files are outside the repo
    const tactic = readFileSync(BASE + MD[key], 'utf8')
    const spells = spellsOf(key)
    for (const m of mechanicsOf(key)) {   // guarded by readAllMechanics elsewhere
      // `shedStack` for the same reason it is on FAILABLE above: it names
      // people, so its tactic file's Bad line has to agree that naming them is
      // right. Ravenous Feast's does — "Deaths on 1290662 ... or 1290662 on a
      // player already holding 1310096" — which is precisely the second bite.
      // `wave` and `polarity` are here for the same reason again: both end with
      // a name attached, so both owe their tactic file's Bad line the same
      // agreement.
      if (!['avoid', 'beInside', 'collect', 'carryOut', 'groupSoak', 'windPair', 'shedStack',
        'wave', 'polarity'].includes(m.rule) || m.collective) continue
      const name = spells.get(m.spellId)?.name
      if (!name) continue
      // Find this ability's section and read its Bad line.
      const head = new RegExp(`^#{2,3} [^\\n]*${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[^\\n]*$`, 'm')
      const at = tactic.search(head)
      if (at < 0) continue
      const seg = tactic.slice(at, at + 800)
      const disclaims = /[Nn]ot a per-player failure|never a per-player|never blame|flag as collective/.test(seg)
      assert.ok(!disclaims,
        `${key}/${m.id} (${name}): its tactic file says this is not a per-player failure, ` +
        `but rule='${m.rule}' scores it. Mark it collective.`)
    }
  }
})

// ── 4. Never scored for a button the role does not have ──────────────────────
// A tank died to a Venomfang dispel they cannot cast.
test('sweep: no mechanic is scored against a role that lacks the button', () => {
  for (const { key, mechanics } of readAllMechanics()) {
    for (const m of mechanics) {
      if (m.pressAbility) {
        for (const r of m.roles) {
          assert.ok(KIT[r].includes(m.pressAbility),
            `${key}/${m.id}: needs '${m.pressAbility}' but scores ${r}, who has ${KIT[r]}`)
        }
      }
      if (m.rule === 'burnWindow') {
        for (const r of m.roles) {
          assert.ok(KIT[r].includes('burst'), `${key}/${m.id}: burnWindow scores ${r}, who has no burst`)
        }
      }
      // `tankSoak` joins the list for exactly the same reason the other three are
      // on it: it is one person's job by construction. Stone Breaker's slams are
      // soaked by the tank holding Ithraz and by nobody else, and a def that
      // listed a dps in `roles` would put a failure row on somebody the knock
      // happened to throw into a pool.
      //
      // `holdMelee` joins them for the narrowest reason of the five: it is judged
      // against ONE body's distance to the entity that body is holding, and
      // nobody who is not a tank ever holds one. A dps listed in `roles` would be
      // scored on a range check they are in no position to fail — and would be
      // told, on the one fight that has this, to go and stand on a serpent that
      // is coiled in the acid off the edge of the platform.
      if (['tankSwap', 'faceAway', 'keepApart', 'tankSoak', 'holdMelee'].includes(m.rule)) {
        for (const r of m.roles) {
          assert.equal(r, 'tank', `${key}/${m.id}: '${m.rule}' is a tank job but scores ${r}`)
        }
      }
    }
  }
})

// ── 5. An avoid must have somewhere to stand ─────────────────────────────────
// Arena radii were measured from logs and several shrank; Twin Fangs went from
// 44 to 32, which can silently turn a wide AoE into the whole floor.
test('sweep: no avoid circle covers its entire arena', () => {
  for (const { key, mechanics } of readAllMechanics()) {
    const arena = arenaOf(key)
    for (const m of mechanics) {
      if (m.rule !== 'avoid' || m.shape !== 'circle') continue
      assert.ok(m.radius < arena,
        `${key}/${m.id}: ${m.radius}yd circle on a ${arena}yd floor — nowhere to go`)
    }
  }
})

// ── 6. A soak you cannot reach is not a mechanic ─────────────────────────────
test('sweep: every soak and pickup is reachable inside its telegraph', () => {
  for (const { key, mechanics } of readAllMechanics()) {
    const arena = arenaOf(key)
    for (const m of mechanics) {
      // `groupSoak` is a soak like any other: you are told to get into it, so
      // getting into it has to be possible. It is exempt from the `collective`
      // skip that beInside gets, because being late to THIS one is not merely a
      // missed split — the group that eats the next cone instead dies to it.
      // `tankSoak` is the strictest case of all. One named tank has to be
      // standing in it, so if the telegraph is shorter than the walk there is
      // literally nobody who can answer it — and a Stone Breaker slam nobody
      // answers does not cost a stack, it throws the whole raid into the acid.
      // `shedStack` is a soak you run INTO, so it belongs here too — and it
      // arrived on this list by being taken off it. Ravenous Feast was swept
      // here for its whole life as a `beInside`, and changing its rule would
      // have dropped it out with nothing to notice: the one mechanic in the
      // raid whose telegraph you have to cross the room for three separate
      // times would have stopped being checked that it can be reached once.
      //
      // `launchPad` and `feed` are "get to a thing" rules like all of the above.
      // A mushroom that despawns before the wave it answers, or a fish that
      // rots before you can walk it anywhere, is a mechanic with no play in it.
      if (!['beInside', 'collect', 'groupSoak', 'tankSoak', 'shedStack', 'launchPad', 'feed']
        .includes(m.rule)) continue
      if (m.collective && m.rule !== 'groupSoak') continue
      const reach = PLAYER_SPEED * Math.max(0, m.telegraphMs / 1000 - REACTION)
      assert.ok(reach >= arena * 0.55,
        `${key}/${m.id}: ${(m.telegraphMs / 1000)}s telegraph reaches ${reach.toFixed(0)}yd ` +
        `on a ${arena}yd floor — a player caught on the far side cannot get in`)
    }
  }
})

// ── 7. Entities that must stay apart must START apart ────────────────────────
// Shipped twice: Sentinels at 26yd against a 25yd link, Explorers at 36yd
// against a 30yd link — both opened inside their own failure state, and the
// Explorers then sat there all pull barking PULL THEM APART.
test('sweep: keepApart entities stay apart even after both tanks drift', () => {
  for (const key of BOSSES) {
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const link = src.match(/rule: \{ type: 'keepApart', minYards: (\d+) \}/)
    if (!link) continue
    const min = Number(link[1])
    const ents = [...src.matchAll(/id: '(\w+)',[^\n]*?start: \{ x: (-?[\d.]+), y: (-?[\d.]+) \}([^\n]*)/g)]
      .filter(m => !/untargetable: true/.test(m[4]))
      .map(m => ({ id: m[1], x: Number(m[2]), y: Number(m[3]) }))
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        const d = Math.hypot(ents[i].x - ents[j].x, ents[i].y - ents[j].y)
        // Both tanks can drift a full leash toward each other.
        assert.ok(d - 2 * TANK_LEASH > min,
          `${key}: ${ents[i].id} and ${ents[j].id} start ${d.toFixed(0)}yd apart, ` +
          `${(d - 2 * TANK_LEASH).toFixed(0)}yd once both tanks drift, and link at ${min}yd`)
      }
    }
  }
})

// ── 8. Lethality is read from the data, never chosen ─────────────────────────
test('sweep: lethal matches category Deadly on every boss', () => {
  for (const { key, mechanics } of readAllMechanics()) {
    const spells = spellsOf(key)
    for (const m of mechanics) {
      const cat = spells.get(m.spellId)?.category
      const should = cat === 'Deadly' && m.rule !== 'raidDamage'
      assert.equal(m.lethal, should,
        `${key}/${m.id}: lethal=${m.lethal} but category=${cat} rule=${m.rule}`)
    }
  }
})

// ── 9. Unavoidable raid damage carries no failure text ───────────────────────
test('sweep: raidDamage never has failure text on any boss', () => {
  for (const { key, mechanics } of readAllMechanics()) {
    for (const m of mechanics) {
      if (m.rule !== 'raidDamage') continue
      assert.equal(m.failText, '', `${key}/${m.id}: raidDamage with failText "${m.failText}"`)
    }
  }
})

// ── 10. A summoned add is summoned, and only summoned ────────────────────────
//
// Venomous Emergence brings the Spawn of Vexhul, and the trash timer must not
// bring them as well. Both halves are checked because both have a silent
// failure mode: a `summons` naming an add that does not exist fires a 3-second
// telegraph that does nothing at all, and an add on both paths puts fixate
// frontals on the raid with no cast to read them off.
test('sweep: every summons names a real add, and takes it off the wave timer', () => {
  for (const key of BOSSES) {
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const addIds = [...src.matchAll(/^ {6}id: '(\w+)', name:/gm)].map(m => m[1])
    for (const m of src.matchAll(/summons: \{ addId: '(\w+)'/g)) {
      assert.ok(addIds.includes(m[1]),
        `${key}: summons names add '${m[1]}', which does not exist — the cast would summon nothing`)
    }
  }
  // The scheduler has to be the thing that enforces it, rather than each boss
  // remembering to flag its own adds.
  //
  // Checked by NAME rather than by matching the filter expression letter for
  // letter. The literal-text version broke the moment a third exclusion was
  // added to the same line, which is a test failing because the code got more
  // correct — and it is the reason `test/engine.test.js` now checks the actual
  // behaviour of this filter on a running pull.
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const at = sim.indexOf('const list = w.boss.adds.filter(')
  const filter = at < 0 ? '' : sim.slice(at, at + 240)
  assert.ok(filter, 'the wave scheduler no longer builds its list with a filter')
  for (const [what, needle] of [
    ['set-piece adds (the Echoes of Jawae as Stage One trash)', 'phaseOnly'],
    ['summoned adds (Venomous Emergence and the trash timer both delivering Spawn of Vexhul)', 'summonedIds'],
    ['split children (a Clotting Venom half arriving off the rim with no parent)', 'splitIds'],
    ['fountain adds (a Shrouded Venom off a ring instead of out of the purple plinth)', 'altarIds'],
  ]) {
    assert.ok(filter.includes(needle),
      `the wave scheduler still deals out ${what} — only one of the two sources is a mechanic`)
  }
})

// ── 11. A fixated cast is wired to a rule that can actually be aimed ──────────
test('sweep: every add cast names a real mechanic, and that mechanic is aimAway', () => {
  for (const { key, mechanics } of readAllMechanics()) {
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    for (const m of src.matchAll(/casts: \{ defId: '(\w+)'/g)) {
      const target = mechanics.find(x => x.id === m[1])
      assert.ok(target, `${key}: an add casts '${m[1]}', which is not a mechanic on this boss`)
      assert.equal(target.rule, 'aimAway',
        `${key}/${m[1]}: cast by a fixating add but its rule is '${target.rule}'. Only aimAway ` +
        'reads the fixate — anything else scores the marked player for standing in a line ' +
        'that is glued to them and cannot be left')
    }
  }
})

// ── 12. An aimAway line is never fired by the rotation ────────────────────────
//
// It has no meaning without a caster and a mark: fired from the loop it comes
// off a serpent, aimed at nobody, and the marked-player branch scores whoever
// happens to be standing there for a line they were never given.
test('sweep: aimAway mechanics are cast by adds, never listed in the loop', () => {
  for (const { key, mechanics } of readAllMechanics()) {
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const loop = src.slice(src.indexOf('loop: ['), src.indexOf(']', src.indexOf('loop: [')))
    for (const m of mechanics) {
      if (m.rule !== 'aimAway') continue
      assert.ok(!new RegExp(`'${m.id}'`).test(loop),
        `${key}/${m.id}: an aimAway mechanic is in the loop. It only works cast by the add ` +
        'that fixated someone — from the rotation it is aimed at nobody')
      assert.ok(new RegExp(`casts: \{ defId: '${m.id}'`).test(src),
        `${key}/${m.id}: an aimAway mechanic nothing casts. It can never fire`)
    }
  }
})

// ── 13. Being marked is not a failure ────────────────────────────────────────
//
// The rule this project keeps having to re-learn: a carrier is "chosen, never
// at fault". The marked player is answerable for where they pointed the line
// and for nothing else, so the aimAway branch must not deal them damage.
test('the marked player takes no damage from their own line', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("case 'aimAway': {")
  assert.ok(i > 0, 'aimAway resolve branch not found in sim.ts')
  const branch = sim.slice(i, sim.indexOf("case 'press':", i))
  const mine = branch.slice(branch.indexOf('if (inst.carriedByPlayer)'), branch.indexOf('} else if (inside)'))
  assert.ok(!/\b(hurt|killPlayer)\(/.test(mine),
    'the marked player is being damaged by the line they were handed — they are scored on ' +
    'where they aimed it, and billing them for being chosen teaches them to hide from the mark')
})

// ── 14. The Emergence chain exists, end to end ───────────────────────────────
//
// Sweeps 10-12 check that whatever IS wired is wired correctly, which means they
// all pass on a boss that wires nothing. This is the positive half: the fight
// has a Venomous Emergence, it summons Spawn of Vexhul, they fixate, and what
// they cast is an aimable line. Delete any link and the sweeps above go quiet,
// so this is the test that notices.
test('twinfangs: Venomous Emergence summons spawns that fixate and spit', () => {
  const src = readFileSync('src/bosses/twinfangs.ts', 'utf8')
  const mechs = mechanicsOf('twinfangs')

  const emergence = mechs.find(m => m.id === 'emergence')
  assert.ok(emergence, 'Venomous Emergence is gone — nothing summons the spawns')
  assert.match(src, /summons: \{ addId: 'spawn', count: 3 \}/,
    'Venomous Emergence no longer summons three Spawn of Vexhul')
  assert.equal(emergence.failText, '',
    'Venomous Emergence is "an add-spawn marker, not a failure" — it must never name anybody')

  assert.match(src, /id: 'spawn', name: 'Spawn of Vexhul'/, 'the Spawn of Vexhul add is gone')
  assert.match(src, /fixates: true/, 'the spawns no longer fixate — the lines would aim at nobody')
  assert.match(src, /spawnAt: \{ x: 0, y: \d+ \}/,
    'the spawns no longer surface at a fixed point, so the raid cannot read where the lines start')
  assert.match(src, /casts: \{ defId: 'spit', everySec: \d+ \}/,
    'the spawns no longer repeat Corrosive Spit — killing them fast would stop mattering')

  const spit = mechs.find(m => m.id === 'spit')
  assert.ok(spit, 'Corrosive Spit is gone')
  assert.equal(spit.rule, 'aimAway', `Corrosive Spit is rule '${spit.rule}', not aimAway`)
  assert.equal(spit.shape, 'line', 'Corrosive Spit is not a line any more')
  assert.equal(spit.telegraphMs, 5000, 'Corrosive Spit lost its 5s marker window')
})

// ── 20. The fish economy is finite, and cannot be spent twice ────────────────
//
// Three fish exist in the whole encounter and each one empowers one explorer
// permanently. Both halves of that can be authored wrong in silence: more fish
// than there are bodies to feed makes the last ones worthless and the enrage
// unreachable, and a feed range wide enough to touch two explorers at once turns
// "which one do you empower" — the only decision the mechanic contains — into
// whichever body the array happened to list first.
test('sweep: the fish economy is finite and cannot be double-spent', () => {
  let checked = 0
  for (const key of BOSSES) {
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const mechanics = mechanicsOf(key)
    const hides = [...src.matchAll(/hides: \{ defId: '(\w+)', maxTotal: (\d+) \}/g)]
    const feeds = mechanics.filter(m => m.rule === 'feed')
    if (!hides.length && !feeds.length) continue
    checked++

    // Targetable entities only. Mor'zahi is the bar, not a mouth.
    const bodies = [...src.matchAll(/id: '(\w+)',[^\n]*?start: \{ x: (-?[\d.]+), y: (-?[\d.]+) \}([^\n]*)/g)]
      .filter(m => !/untargetable: true/.test(m[4])).length

    for (const [, defId, maxTotal] of hides) {
      assert.ok(mechanics.some(m => m.id === defId),
        `${key}: a pickup hides '${defId}', which is not a mechanic on this boss`)
      assert.ok(Number(maxTotal) <= bodies,
        `${key}: ${maxTotal} fish are hidden but only ${bodies} bodies can eat one. Each ` +
        'boss empowers once, so every fish past the last mouth is found and then wasted')
    }
    if (hides.length) {
      assert.equal(feeds.length, 1,
        `${key}: ${feeds.length} mechanics carry a 'feed' rule. The engine feeds the FIRST ` +
        'one it finds, so a second is authored content that can never fire')
    }
    const arena = arenaOf(key)
    for (const m of feeds) {
      const range = Number(/feedRange:\s*([\d.]+)/.exec(m.blk)?.[1] ?? 0)
      assert.ok(range > 0, `${key}/${m.id}: a feed with no feedRange — it could never be delivered`)
      assert.ok(range < arena / 4,
        `${key}/${m.id}: a ${range}yd feed range on a ${arena}yd floor. Walking the fish to a ` +
        'CHOSEN body is the whole mechanic, and a range this wide picks the body for you')
    }
  }
  // The regexes above read a shape no other boss uses. If the boss file's layout
  // drifts they match nothing, the loop `continue`s past every fight, and this
  // reports success without having looked at anything.
  assert.ok(checked > 0,
    'no boss declares a fish economy — either the Explorers lost theirs or the parser ' +
    'stopped finding it, and this sweep would pass vacuously either way')
})

// ── 21. A polarity carrier always has a cure on the floor ────────────────────
//
// The debuff comes off by standing in the OPPOSITE element and by nothing else,
// so the two pools are not decoration — they are the entire answer. A polarity
// pointing at a pool that is not a pool, or at two pools of the same element, or
// at ground that evaporates before the next volley, is a debuff with no cure and
// a death nobody in the room could have played out of.
test('sweep: a polarity carrier always has a cure on the floor', () => {
  let checked = 0
  for (const { key, mechanics } of readAllMechanics()) {
    for (const m of mechanics) {
      if (m.rule !== 'polarity') continue
      checked++
      for (const [field, want] of [['firePoolId', 'fire'], ['frostPoolId', 'frost']]) {
        const id = new RegExp(`${field}:\\s*'([^']*)'`).exec(m.blk)?.[1]
        assert.ok(id, `${key}/${m.id}: a polarity with no ${field}`)
        const pool = mechanics.find(x => x.id === id)
        assert.ok(pool, `${key}/${m.id}: ${field} names '${id}', which is not a mechanic here`)
        assert.equal(pool.rule, 'elementPool',
          `${key}/${id}: named as ${field} but its rule is '${pool.rule}'. Only elementPool cures`)
        const el = /element:\s*'(\w+)'/.exec(pool.blk)?.[1]
        assert.equal(el, want,
          `${key}/${id}: named as ${field} but its element is '${el}'. A carrier sent to their ` +
          'OWN element stands in it and stays lit')
        const linger = Number(/lingerMs:\s*(\d+)/.exec(pool.blk)?.[1] ?? 0)
        assert.ok(linger >= m.telegraphMs,
          `${key}/${id}: lingers ${linger}ms against a ${m.telegraphMs}ms volley. The cure has ` +
          'to still be on the floor when the thing it cures arrives')
      }
      const deathId = /deathId:\s*'([^']*)'/.exec(m.blk)?.[1]
      assert.ok(mechanics.some(x => x.id === deathId),
        `${key}/${m.id}: deathId names '${deathId}', which is not a mechanic on this boss — ` +
        'the death would be attributed to nothing')
    }
  }
  assert.ok(checked > 0, 'no polarity mechanic in the registry — this sweep would be vacuous')
})

// ── 22. A wave has a mushroom to jump ────────────────────────────────────────
//
// `wave` has exactly one exemption and it is being airborne. If the boss never
// puts a launch pad on the floor, or puts one there that expires before the wave
// arrives, the mechanic is not hard — it is unwinnable, and it looks identical
// to a hard mechanic from every angle except this one.
test('sweep: a wave always has a mushroom left to jump', () => {
  let checked = 0
  for (const { key, mechanics } of readAllMechanics()) {
    const waves = mechanics.filter(m => m.rule === 'wave')
    if (!waves.length) continue
    checked += waves.length
    const pads = mechanics.filter(m => m.rule === 'launchPad')
    assert.ok(pads.length > 0,
      `${key}: declares a wave but no launchPad. Being off the floor is the only answer to a ` +
      'wave, and there is nothing here to get off the floor with')
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    for (const wave of waves) {
      // Walk the spawn chain backwards: whatever spawns the wave has its own
      // telegraph, and the pads have to outlive the whole chain.
      let chain = wave.telegraphMs
      for (const m of mechanics) {
        const sp = new RegExp(`spawns: \\{ defId: '${wave.id}'(?:, delayMs: (\\d+))?`).exec(m.blk)
        if (!sp) continue
        chain = Math.max(chain, m.telegraphMs + Number(sp[1] ?? 0) + wave.telegraphMs)
      }
      void src
      assert.ok(pads.some(p => p.telegraphMs > chain),
        `${key}/${wave.id}: the mushrooms last ${Math.max(...pads.map(p => p.telegraphMs))}ms ` +
        `but the bomb-to-wave chain takes ${chain}ms. The answer expires before the question`)
    }
  }
  assert.ok(checked > 0, 'no wave mechanic in the registry — this sweep would be vacuous')
})

// ── 23. The venom economy closes for the one body that can never shed ────────
//
// Ravenous Feast exempts the tank holding the entity that casts it — the melee
// leash welds them inside a 14-yard circle drawn from a serpent they may not
// leave, so without the exemption the mechanic would feed them on bite one and
// kill them on bite two, every rotation, for standing exactly where the fight
// requires. The price of that exemption is that the same tank can never SHED
// either. Their count only ever climbs.
//
// Which turns the whole economy into arithmetic for one body, and arithmetic is
// something a test can check. If the unavoidable, whole-raid income of one
// rotation ever grows to the point where three rotations reach the cap, that
// tank dies of the fight working correctly and there is nothing they or the
// player can do about it. Pure text over the boss file on purpose: it stays true
// through any amount of engine churn, and it re-derives the income rather than
// hard-coding it, so adding a second Venomous Emergence to the loop is caught
// here rather than in a playtest three steps later.
test('twinfangs: a clean tank stays under the venom cap for three rotations', () => {
  const src = readFileSync('src/bosses/twinfangs.ts', 'utf8')
  const mechs = mechanicsOf('twinfangs')

  const cap = Number(src.match(/counter: \{ lethalAt: (\d+) \}/)?.[1] ?? 0)
  assert.ok(cap > 0, 'the Twin Fangs no longer declares a lethal stack count — nothing to check')

  const loopSrc = src.slice(src.indexOf('loop: ['), src.indexOf(']', src.indexOf('loop: [')))
  const slots = [...loopSrc.matchAll(/'([^']+)'/g)].map(m => m[1])
  assert.ok(slots.length > 0, 'the rotation is empty — this sum would be vacuous')

  // What the raid takes whatever it does. `applies.raid` is the unavoidable
  // half of the counter: Venomous Emergence hands one to every body in the room
  // and there is nothing to dodge, soak or aim. Everything else on the fight is
  // avoidable and a clean tank takes none of it.
  const raidOf = id => {
    const m = mechs.find(x => x.id === id)
    return Number(m?.blk.match(/applies: \{[^}]*\braid: (\d+)/)?.[1] ?? 0)
  }
  const perRotation = slots.reduce((s, id) => s + raidOf(id), 0)
  assert.ok(perRotation > 0,
    'nothing in the rotation charges the whole raid a stack. Either the counter has no ' +
    'unavoidable source left, in which case the economy is not one, or the parse broke')

  // And the exemption is real, so the sum genuinely has nothing on the other
  // side of it. If Ravenous Feast ever stops being the fight's shedder this
  // whole calculation is measuring the wrong thing.
  const feast = mechs.find(m => m.id === 'feast')
  assert.ok(feast, 'Ravenous Feast is gone — nothing on this fight removes a stack at all')
  assert.equal(feast.rule, 'shedStack',
    `Ravenous Feast is rule '${feast.rule}', not shedStack — the one removal has moved`)

  const afterThree = perRotation * 3
  assert.ok(afterThree < cap,
    `a tank who dodges everything still collects ${perRotation} unavoidable stacks a rotation, ` +
    `so ${afterThree} after three against a cap of ${cap}. They cannot shed — the exemption ` +
    'that stops Ravenous Feast killing them also stops it feeding them — so this is a death ' +
    'with no play available. Cut an unavoidable source or raise the cap')
})

/**
 * The arena polygon's corners, or null for a round room.
 *
 * Local to this file on purpose: trace.test.js has a general literal reader, and
 * importing test helpers across suites couples two files that are meant to be
 * independent sweeps.
 */
function arenaPointsOf(code) {
  const i = code.indexOf('arena: {')
  if (i < 0) return null
  const j = code.indexOf('points: [', i)
  if (j < 0) return null
  const body = code.slice(j, code.indexOf(']', j))
  return [...body.matchAll(/x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+)/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
}

// ── 15. You start a pull standing on the floor ───────────────────────────────
//
// The player is seated at a hard-coded (0, 12) in createWorld, and a drill
// respawn puts them back there. On a round room that is trivially inside; on the
// Twin Fangs' wedge, (0,12) landed inside the venom pocket — every pull and
// every drill rep began off the floor, and it only survived because safeSpot()
// silently shoved the player somewhere else on the first tick. A start position
// that depends on being rescued is a bug waiting for the next arena.
test('sweep: the pull starts on solid floor in every room', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const m = /pos: \{ x: (-?[\d.]+), y: (-?[\d.]+) \}, role/.exec(sim)
  assert.ok(m, 'could not find the hard-coded player start in createWorld')
  const start = { x: Number(m[1]), y: Number(m[2]) }

  for (const key of BOSSES) {
    const code = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const pts = arenaPointsOf(code)
    if (!pts) {
      const r = Number(/arenaRadius:\s*([\d.]+)/.exec(code)[1])
      assert.ok(Math.hypot(start.x, start.y) < r,
        `${key}: the player starts outside a ${r}yd room`)
      continue
    }
    // Same crossing-number test the engine uses.
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j]
      if ((a.y > start.y) !== (b.y > start.y) &&
          start.x < ((b.x - a.x) * (start.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside
    }
    assert.ok(inside,
      `${key}: the player starts at (${start.x}, ${start.y}), which is off this floor — ` +
      'every pull and every drill respawn begins out of bounds and is rescued by safeSpot()')
  }
})

// ── 16. A hole in the floor has to be wide enough to walk around ─────────────
//
// The venom pocket was authored as a triangle tapering to a point. Near the
// apex it was 0.6 yards across — narrower than one movement tick — so players
// crossed it without ever being on it and died on the far side of a gap they
// could not see. A concave notch is a legitimate piece of room design; one that
// tapers to nothing is a trap, and the failure it produces looks like a physics
// bug rather than a mistake the player made.
test('twinfangs: the venom pocket is wide enough to be read', () => {
  const code = readFileSync('src/bosses/twinfangs.ts', 'utf8')
  const pts = arenaPointsOf(code)
  assert.ok(pts, 'the Twin Fangs arena polygon is gone')
  // The notch is the run of corners with y at the bottom edge or above it that
  // sit between the two mouth corners — measure the narrowest span across it.
  const bottom = Math.max(...pts.map(p => p.y))
  const inner = pts.filter(p => p.y < bottom && p.y > 0)
  assert.ok(inner.length >= 2,
    'the venom pocket is gone, or is no longer cut into the bottom edge')
  const width = Math.max(...inner.map(p => p.x)) - Math.min(...inner.map(p => p.x))
  assert.ok(width >= 6,
    `the venom pocket narrows to ${width}yd at its inner edge. A gap thinner than ` +
    'a player can see across is crossed without ever being entered — make it a ' +
    'flat-bottomed bite, not a spike')
})

// ── 17. A spread you can survive by ignoring it is not a spread ───────────────
// Raging Crosswinds shipped at a 22-yard push on a 56-yard floor, which meant
// the answer to the fight's headline mechanic was to stand in the middle and do
// nothing: an unpaired knock landed you comfortably back on the platform. A
// stationary player cleared the pull. If failing to pair is survivable from the
// centre, the mechanic teaches nothing at all.
test('sweep: an unpaired wind knock actually leaves the platform', () => {
  for (const { key, mechanics } of readAllMechanics()) {
    const arena = arenaOf(key)
    for (const m of mechanics) {
      if (m.rule !== 'windPair') continue
      const push = Number(/pushYards:\s*([\d.]+)/.exec(m.blk)?.[1] ?? 0)
      assert.ok(push > arena,
        `${key}/${m.id}: throws ${push}yd on a ${arena}yd floor, so a player standing ` +
        'in the middle survives ignoring it — pairing has to be the only answer')
    }
  }
})

// ── 18. One cone must not be able to take both stack groups ──────────────────
// The whole Mutilate rota is "hit this crowd, then the other one". A cone wide
// enough to cover both marks at once makes the second application land on the
// group that already has a Gash however well the tank plays it, and the rota
// stops being something anybody can get right.
test('sweep: a group soak cone cannot cover both stack marks', () => {
  const MARKS_APART_DEG = 90       // GROUP_BEARINGS in sim.ts
  for (const { key, mechanics } of readAllMechanics()) {
    for (const m of mechanics) {
      if (m.rule !== 'groupSoak') continue
      const arc = Number(/arcDeg:\s*([\d.]+)/.exec(m.blk)?.[1] ?? 0)
      assert.ok(arc > 0, `${key}/${m.id}: a groupSoak with no cone to aim`)
      assert.ok(arc < MARKS_APART_DEG,
        `${key}/${m.id}: a ${arc}-degree cone reaches both marks, which sit ` +
        `${MARKS_APART_DEG} degrees apart — the second cast would always land on ` +
        'the group that is already carrying a Gash')
    }
  }
})

// ── 19. An entity standing off the floor must never move ─────────────────────
//
// The Twin Fangs are coiled in the acid three yards off the top edge, which is
// only stable because they are flagged `stationary`. Every other tanked entity
// walks after its tank and is clamped back inside the arena every tick, so an
// unflagged entity placed off the floor is hauled onto the platform within a
// second of the pull — the boss file says one thing and the fight does another,
// and nothing fails. The tank AI has the mirror of the same problem: its station
// is the entity's own position, so a tank sent to a serpent in the acid walks
// into the acid.
test('sweep: an entity placed off the floor is stationary', () => {
  for (const key of BOSSES) {
    const code = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const pts = arenaPointsOf(code)
    if (!pts) continue                       // a round room: nothing sits outside it
    for (const m of code.matchAll(/\{ id: '(\w+)'[^\n]*?start: \{ x: (-?[\d.]+), y: (-?[\d.]+) \}[^\n]*/g)) {
      const [line, id, sx, sy] = m
      const p = { x: Number(sx), y: Number(sy) }
      let inside = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j]
        if ((a.y > p.y) !== (b.y > p.y) &&
            p.x < ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside
      }
      if (inside) continue
      assert.match(line, /stationary: true/,
        `${key}/${id} starts at (${p.x}, ${p.y}), which is off the floor, but is not ` +
        'stationary — the follow step will clamp it onto the platform in the first second ' +
        'and its tank will be sent into the acid to reach it')
    }
  }
})

// ── 24. Nothing is scheduled twice, and every timeline id resolves ───────────
//
// `timeline` is a second, independent scheduler beside `loop`, and both are
// plain arrays of strings — so every failure mode here is silent. An id in BOTH
// fires twice a cycle, which reads as a mechanic being twice as frequent as the
// fight says it is and as nothing else. An id in NEITHER namespace fires never,
// and a fight with a mechanic that never happens looks exactly like a fight
// whose rotation is merely long. And `rearmOn` names mechanics that must exist
// for a gated cast to ever come back: a typo there does not throw, it simply
// leaves Throw Junk dormant for the rest of the pull and the enrage arrives for
// a reason nobody in the room could have seen.
test('sweep: every timeline id resolves and nothing is scheduled twice', () => {
  let checked = 0
  for (const { key, mechanics } of readAllMechanics()) {
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const head = src.slice(0, Math.max(0, src.indexOf('mechanics: [')))
    const block = /\n {2}timeline:\s*\[([\s\S]*?)\n {2}\],/.exec(head)
    if (!block) continue
    checked++
    const ids = new Set(mechanics.map(m => m.id))
    const loop = new Set()
    for (const l of src.matchAll(/loop:\s*\[([\s\S]*?)\]/g)) {
      for (const s of l[1].matchAll(/'([^']+)'/g)) loop.add(s[1])
    }
    const entries = [...block[1].matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)].map(m => m[0])
    assert.ok(entries.length > 0,
      `${key}: declares a timeline but no entries parsed — this sweep would pass vacuously`)
    const seen = new Set()
    for (const e of entries) {
      const id = /\bid:\s*'([^']+)'/.exec(e)?.[1]
      assert.ok(id, `${key}: a timeline entry with no id: ${e}`)
      assert.ok(ids.has(id),
        `${key}: timeline schedules '${id}', which is not a mechanic on this boss`)
      assert.ok(!loop.has(id),
        `${key}: '${id}' is in BOTH loop and timeline, so it fires twice a cycle. The ` +
        'timeline is the more specific statement — take it out of the loop')
      assert.ok(!seen.has(id), `${key}: '${id}' appears twice in the timeline`)
      seen.add(id)

      const start = Number(/\bstartSec:\s*(-?[\d.]+)/.exec(e)?.[1] ?? NaN)
      assert.ok(Number.isFinite(start) && start >= 0,
        `${key}/${id}: startSec is ${start}. A first cast has to be at or after the pull`)
      const every = /\beverySec:\s*(-?[\d.]+)/.exec(e)?.[1]
      if (every !== undefined) {
        assert.ok(Number(every) > 0,
          `${key}/${id}: everySec is ${every}. A period of zero or less fires every frame`)
      }
      const rearm = /rearmOn:\s*\{([^}]*\}[^}]*|[^}]*)\}/.exec(e)
      if (rearm) {
        const anyOf = /anyOf:\s*\[([^\]]*)\]/.exec(rearm[1])
        assert.ok(anyOf, `${key}/${id}: a rearmOn with no anyOf — nothing could ever wake it`)
        const armers = [...anyOf[1].matchAll(/'([^']+)'/g)].map(m => m[1])
        assert.ok(armers.length > 0,
          `${key}/${id}: rearmOn.anyOf is empty, so this cast fires once and never again`)
        for (const a of armers) {
          assert.ok(ids.has(a),
            `${key}/${id}: rearmOn names '${a}', which is not a mechanic on this boss. The ` +
            'cast would go dormant at its first firing and never come back')
        }
        assert.ok(every === undefined,
          `${key}/${id}: declares BOTH everySec and rearmOn. The clock would re-arm it before ` +
          'the event ever did, and the event gate would never be what brings it back')
      } else {
        assert.ok(every !== undefined,
          `${key}/${id}: has neither everySec nor rearmOn, so it is a one-shot. If that is ` +
          'meant, say so — every timeline entry so far recurs')
      }
    }
  }
  assert.ok(checked > 0,
    'no boss declares a timeline — either the Explorers lost theirs or the parser stopped ' +
    'finding it, and this sweep would pass vacuously either way')
})

// ── 25. The bot has heard of every rule in the engine ────────────────────────
//
// The playtest bot is a measuring instrument, and what it cannot do is a blind
// spot in the MEASUREMENT rather than a fact about the fight. That distinction
// has cost this project real time twice: nine cells were failing and four of the
// six recovered were bot defects, and the last pass shipped four new primitives
// the bot knew nothing about, so three instrument gaps printed as the Explorers
// being too hard before anybody found the cause.
//
// A rule the bot has never heard of is therefore not a small omission — it is a
// number in the balance report that means something other than what it says. So
// a new `Rule` variant fails here until somebody has written down what a
// competent player does about it. "Nothing, and here is why" is a perfectly good
// answer; not having looked is not.
test('sweep: every Rule variant is declared in the playtest bot', () => {
  const types = readFileSync('src/engine/types.ts', 'utf8')
  const union = types.slice(types.indexOf('export type Rule ='))
  // Stop at the blank line that ends the union, so the shapes below it are not
  // swept in with it.
  const body = union.slice(0, union.search(/\r?\n\r?\n/))
  const variants = [...body.matchAll(/\|\s*\{\s*type:\s*'(\w+)'/g)].map(m => m[1])
  assert.ok(variants.length >= 20,
    `parsed only ${variants.length} Rule variants from types.ts — the union's shape has moved ` +
    'and this check would pass vacuously')

  const bot = readFileSync('test/playtest.mjs', 'utf8')
  const table = /const BOT_KNOWS = \{([\s\S]*?)\n\}/.exec(bot)
  assert.ok(table, 'playtest.mjs no longer declares BOT_KNOWS — the bot has no manifest at all')
  const known = new Set([...table[1].matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]))
  assert.ok(known.size > 0, 'BOT_KNOWS parsed as empty — this check would pass vacuously')

  for (const v of variants) {
    assert.ok(known.has(v),
      `the engine has a '${v}' rule and the playtest bot's manifest does not mention it. A rule ` +
      'the bot cannot see reads as the FIGHT being too hard, which is how four cells were ' +
      'misdiagnosed already. Add it to BOT_KNOWS with what a competent player does about it')
  }
  for (const k of known) {
    assert.ok(variants.includes(k),
      `BOT_KNOWS describes a '${k}' rule that no longer exists in types.ts — the manifest is ` +
      'drifting away from the engine it is supposed to describe')
  }
})

// ── 26. A melee leash must be reachable from the floor ───────────────────────
//
// Plan test 11, the second of its two static sweeps, and it exists because the
// obvious number was wrong. `holdMelee` is a distance a tank must keep to the
// entity they are holding, and the obvious value for it is the engine's own
// MELEE_RANGE of 5 — which on the Twin Fangs is unsatisfiable: both serpents are
// coiled in the acid three yards off the top edge of the platform, so the
// nearest square of floor a body may stand on is 3.00 yards from either of them
// and the AI tank's station is 4.947. A five-yard leash therefore fails both
// tanks from the pull, forever, with nowhere on the platform to go and no AI
// change able to fix it — a rule the room cannot satisfy.
//
// The margin is three yards rather than nothing. A leash satisfiable only by
// standing on the single nearest point of floor is not a leash a body can hold:
// the idle sway alone is worth 2.26 yards, the tank has to walk soaks and
// sidestep pools inside it, and the AI station is itself a clamp two yards
// inside the edge. So the demand is that the floor gets within `maxYards - 3` of
// the entity, which leaves a tank somewhere to actually stand.
//
// Exact rather than rasterised: the nearest point of a polygon to a point
// outside it is on its boundary, so this projects onto every edge and takes the
// minimum. A room with no polygon uses the entity's distance from the centre
// against the radius, the same way `inArena` falls back.
test('sweep: every melee leash has floor a tank can hold it from', () => {
  /** Distance from p to the segment ab. */
  const toSeg = (p, a, b) => {
    const vx = b.x - a.x, vy = b.y - a.y
    const len2 = vx * vx + vy * vy
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0
    return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
  }

  let checked = 0
  for (const key of BOSSES) {
    const code = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const leashes = [...code.matchAll(/rule: \{ type: 'holdMelee', maxYards: ([\d.]+) \}/g)]
    if (!leashes.length) continue
    // Which entity each one belongs to. Read out of the same block the rule is
    // in, because a leash on the wrong serpent is measured from the wrong place.
    const blocks = code.split(/\r?\n {4}\{\r?\n/).slice(1)
    const pts = arenaPointsOf(code)
    const radius = Number(/arenaRadius:\s*([\d.]+)/.exec(code)[1])
    const starts = new Map([...code.matchAll(
      /\{ id: '(\w+)'[^\n]*?start: \{ x: (-?[\d.]+), y: (-?[\d.]+) \}/g,
    )].map(m => [m[1], { x: Number(m[2]), y: Number(m[3]) }]))

    for (const blk of blocks) {
      const rule = blk.match(/rule: \{ type: 'holdMelee', maxYards: ([\d.]+) \}/)
      if (!rule) continue
      const max = Number(rule[1])
      const id = blk.match(/id: '(\w+)'/)?.[1] ?? '?'
      const from = blk.match(/from: '(\w+)'/)?.[1]
      const at = from && starts.get(from)
      assert.ok(at, `${key}/${id}: holdMelee is cast by '${from}', which has no start position`)

      let nearest
      if (pts) {
        nearest = Infinity
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          nearest = Math.min(nearest, toSeg(at, pts[i], pts[j]))
        }
        // Inside the polygon the entity is standing on its own floor.
        let inside = false
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[i], b = pts[j]
          if ((a.y > at.y) !== (b.y > at.y) &&
              at.x < ((b.x - a.x) * (at.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside
        }
        if (inside) nearest = 0
      } else {
        nearest = Math.max(0, Math.hypot(at.x, at.y) - radius)
      }

      checked++
      assert.ok(nearest <= max - 3,
        `${key}/${id}: the nearest floor to '${from}' is ${nearest.toFixed(2)}yd away and the ` +
        `leash is ${max}yd, so a tank holding it has under three yards of platform to live on. ` +
        'A range check the room cannot satisfy fails every tank from the pull and no AI ' +
        'change can save them')
    }
  }
  assert.ok(checked > 0, 'no holdMelee rule was found anywhere — this sweep would pass vacuously')
})

// ── 27. A carry-out must have somewhere to be carried to ─────────────────────
//
// Plan test 11, the first of its two static sweeps, and it exists because a
// shipped rule was unsatisfiable by the room it was written for. Coiling Ichor
// asked its carriers for 26 yards from the arena centre. On the Twin Fangs'
// wedge that is 3.3% of 1158 square yards of floor, only TWO points of it are 12
// yards apart, and the whole northern ledge — where both tanks are welded to
// their serpents — tops out at 18.87, so a raider standing there failed the
// mechanic no matter how they played it and a third carrier had nowhere legal to
// stand at all. Nothing anywhere said so: every field was individually sensible
// and the room was the thing that made them wrong together.
//
// So the demand is existence, checked against the real polygon: at least
// `carriers` cells of floor satisfy every clause of the rule at once while being
// pairwise `apart` apart. Rasterised at half-yard cells, which is finer than any
// body in this engine can stand on.
//
// And none of them may be inside a tank's melee leash. That is the general form
// of "not on the tanks' ledge": a `holdMelee` is a tank welded within so many
// yards of an entity, so any drop spot inside that radius is a pool dropped on
// top of somebody who is not allowed to walk away from it. It is vacuous on the
// seven fights with no leash and exact on the one that has them.
test('sweep: every carry-out has enough legal drop spots for its carriers', () => {
  const CELL = 0.5

  let checked = 0
  for (const key of BOSSES) {
    const code = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const pts = arenaPointsOf(code)
    const radius = arenaOf(key)
    const starts = new Map([...code.matchAll(
      /\{ id: '(\w+)'[^\n]*?start: \{ x: (-?[\d.]+), y: (-?[\d.]+) \}/g,
    )].map(m => [m[1], { x: Number(m[2]), y: Number(m[3]) }]))

    const inside = (p) => {
      if (!pts) return Math.hypot(p.x, p.y) <= radius
      let hit = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j]
        if ((a.y > p.y) !== (b.y > p.y)
            && p.x < ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x) hit = !hit
      }
      return hit
    }
    // Distance to the rim. On a polygon that is the nearest point of any edge;
    // on a circle it is what is left of the radius.
    const toRim = (p) => {
      if (!pts) return Math.abs(radius - Math.hypot(p.x, p.y))
      let best = Infinity
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[j], b = pts[i]
        const vx = b.x - a.x, vy = b.y - a.y
        const len2 = vx * vx + vy * vy
        const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0
        best = Math.min(best, Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t)))
      }
      return best
    }

    // Every welded tank on this fight, as a circle nothing may be dropped in.
    const leashes = []
    for (const blk of code.split(/\r?\n {4}\{\r?\n/).slice(1)) {
      const rule = blk.match(/rule: \{ type: 'holdMelee', maxYards: ([\d.]+) \}/)
      if (!rule) continue
      const at = starts.get(blk.match(/from: '(\w+)'/)?.[1] ?? '')
      if (at) leashes.push({ at, max: Number(rule[1]) })
    }

    for (const blk of code.split(/\r?\n {4}\{\r?\n/).slice(1)) {
      const rule = blk.match(/rule: \{ type: 'carryOut',([^}]*)\}/)
      if (!rule) continue
      const id = blk.match(/id: '(\w+)'/)?.[1] ?? '?'
      const num = (name) => {
        const m = new RegExp(`${name}: ([\\d.]+)`).exec(rule[1])
        return m ? Number(m[1]) : undefined
      }
      const minDistance = num('minDistance')
      const edgeWithin = num('edgeWithin')
      const apart = num('apart') ?? 0
      const carriers = Number(/\n\s*carriers: (\d+)/.exec(blk)?.[1] ?? 1)
      assert.ok(minDistance !== undefined, `${key}/${id}: a carryOut with no minDistance`)

      // Greedy in scan order, capped at what the mechanic actually needs. Scan
      // order is the weakest possible witness — it takes whatever it meets
      // first rather than searching for a good set — so finding enough this way
      // is a stronger statement than finding enough at all.
      const spots = []
      let legal = 0
      for (let x = -radius; x <= radius && spots.length < carriers; x += CELL) {
        for (let y = -radius; y <= radius && spots.length < carriers; y += CELL) {
          const p = { x, y }
          if (!inside(p)) continue
          if (Math.hypot(x, y) < minDistance) continue
          if (edgeWithin !== undefined && toRim(p) > edgeWithin) continue
          if (leashes.some(l => Math.hypot(x - l.at.x, y - l.at.y) <= l.max)) continue
          legal++
          if (spots.every(q => Math.hypot(x - q.x, y - q.y) >= apart)) spots.push(p)
        }
      }

      checked++
      assert.equal(spots.length, carriers,
        `${key}/${id}: ${carriers} carriers are told to get ${minDistance}yd out`
        + (edgeWithin !== undefined ? `, inside ${edgeWithin}yd of the rim` : '')
        + (apart ? `, and ${apart}yd from each other` : '')
        + ` — and only ${spots.length} such spot(s) exist on a ${radius}yd floor `
        + `(${legal} legal cells found before the search gave up). A rule the room cannot satisfy `
        + 'fails whoever is handed it, however they play')
    }
  }
  assert.ok(checked > 0, 'no carryOut rule was found anywhere — this sweep would pass vacuously')
})

// ── 28. The Twin Fangs room is finished, and finished means frozen ───────────
//
// Every other sweep in this file checks that a number is SENSIBLE. This one
// checks that a number has not MOVED, which is a different kind of claim and
// needs a different kind of justification.
//
// The wedge, the venom pocket bitten out of its bottom edge, the two serpents
// coiled three yards off the top edge, and the point in the pocket the Spawn of
// Vexhul surface at were designed, measured and merged as their own piece of
// work, and the raid leader has since declared them settled. Everything built on
// this floor afterwards was measured against it and nothing else: Stone Breaker's
// 46.2% fatal band, Coiling Ichor's six legal drop spots, Vile Flood's 253
// square yards of never-swept reserve, the six waves' worst-case fifth of the
// room, the 12-yard melee leash that exists because the nearest floor to a
// serpent is 3.00 yards. Move one vertex and every one of those numbers is
// quietly wrong while every test that asserts them keeps passing, because they
// all re-derive from the polygon rather than from a constant.
//
// So this is not a design check. It is a receipt. The values below are the ones
// in commits 45955e7 and 4c81e39, and a red build here means somebody reshaped a
// room that was explicitly closed — which is a decision to be taken on purpose,
// with the numbers above re-measured, and never a tidy-up that slipped in
// alongside a mechanic.
//
// THE ONE THING THIS DELIBERATELY DOES NOT FORBID: the Submerge stage's
// `relocate`, which moves both serpents off the floor for the length of the
// intermission and puts them back on `def.start` when it ends. That is
// phase-scoped and lives on the PhaseDef; `entities[]` is what is frozen, and
// the assertion below is written against that array so the two cannot be
// confused for each other.
test('twinfangs: the room is exactly the room that was signed off', () => {
  const src = readFileSync('src/bosses/twinfangs.ts', 'utf8')
  // Comments carry vertices too — every one of these numbers is argued for in
  // prose a few lines above it — so the whole check runs over comment-free text.
  const code = src.replace(/\/\/[^\n]*/g, '')

  const arena = code.slice(code.indexOf('arena: {'), code.indexOf('],', code.indexOf('points: [')))
  const pts = [...arena.matchAll(/x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+)/g)].map(m => [+m[1], +m[2]])
  assert.deepEqual(pts, [
    [-10, -16], [10, -16],        // the tanks' ledge
    [23, 21],                     // the right leg, flaring to the mouth
    [6, 21], [4, 15], [-4, 15], [-6, 21],   // the venom pocket
    [-23, 21],                    // the left leg
  ], 'the Twin Fangs arena polygon has moved. Every geometric bound on this fight was ' +
     'measured over these eight corners and re-derives from them, so they will all keep ' +
     'passing against the wrong floor')

  assert.match(code, /arenaRadius: 32,/, 'the Twin Fangs bounding radius has moved off 32')
  assert.match(code, /\n\s*acid: true,/,
    'the venom sea outside the platform is gone — falling off is no longer a death, and the ' +
    'Stone Breaker knock and the pushoff both stop meaning anything')

  // Both serpents, in one assertion, because what matters is the pair: they sit
  // symmetrically about x = 0 three yards off the top edge, and Vile Flood's
  // mirrored sweep is only provably the same sweep because of that symmetry.
  const ents = code.slice(code.indexOf('entities: ['), code.indexOf('],', code.indexOf('entities: [')))
  for (const [id, x, y] of [['vexhul', -8, -19], ['ithraz', 8, -19]]) {
    const m = new RegExp(`id: '${id}'[^}]*start: \\{ x: (-?[\\d.]+), y: (-?[\\d.]+) \\}`).exec(ents)
    assert.ok(m, `${id} is no longer declared in entities[] with a start position`)
    assert.deepEqual([+m[1], +m[2]], [x, y],
      `${id} has been moved off (${x}, ${y}). The serpents are coiled in the acid on purpose — ` +
      'a shot is eaten by the first entity it passes, so floor behind them means the raid ' +
      'shoots its own boss in the back at 100% recorded accuracy')
  }
  assert.equal((ents.match(/stationary: true/g) ?? []).length, 2,
    'one of the serpents can walk again. They never move and the raid comes to them; a tank ' +
    'dragging one changes every distance the melee leash, the Feast circle and the slam arc ' +
    'are measured against')

  assert.match(code, /spawnAt: \{ x: 0, y: 19 \}/,
    'the Spawn of Vexhul no longer surface at (0, 19). Deeper or shallower and one of the ' +
    'three fans onto the lip of the pocket, where the raid can stand on top of it')
})

// A wall and a fall are the same test asked of the same polygon, and a room that
// claims both cannot be reasoned about: `acid` says the outside of the floor is a
// sea you drown in, `offPlatform` says a knock is allowed to finish out there, and
// `walled` says there is no out there. Tok'zali's hall and Vashnik's are enclosed;
// Twin Fangs is a platform in a venom sea, and every bound on its Stone Breaker is
// measured on the rim NOT catching you.
//
// Source text rather than runtime, deliberately: this is a contradiction that has
// to be impossible to author, not one to be caught on the pull where it bites.
test('sweep: a walled room has nothing to be thrown into', () => {
  let walled = 0
  for (const key of BOSSES) {
    const code = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    if (!code.includes('  walled: true,')) continue
    walled++
    assert.equal(code.includes('acid: true,'), false,
      `${key} is walled AND floating in acid. The rim cannot both stop a body and drown it`)
    assert.equal(code.includes('offPlatform: true'), false,
      `${key} is walled and still throws somebody off the platform. There is no off — the ` +
      'knock ends against the masonry, and the mechanic drills a dodge that does not exist')
  }
  assert.equal(walled, 2,
    `${walled} walled rooms rather than 2. Tok'zali's hall and Vashnik's are the enclosed ` +
    'ones; every other room in this tier is a platform and walking off it is the fall')
})
