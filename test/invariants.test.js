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
  const SAFE = ['raidDamage', 'press', 'tankSwap', 'keepApart', 'burnWindow', 'syncKill']
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
  const FAILABLE = ['avoid', 'beInside', 'collect', 'carryOut', 'survive', 'groupSoak', 'windPair', 'stackingDot']
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
      if (!['avoid', 'beInside', 'collect', 'carryOut', 'groupSoak', 'windPair'].includes(m.rule)
          || m.collective) continue
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
      if (['tankSwap', 'faceAway', 'keepApart'].includes(m.rule)) {
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
      if (!['beInside', 'collect', 'groupSoak'].includes(m.rule)) continue
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
