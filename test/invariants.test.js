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
  const FAILABLE = ['avoid', 'beInside', 'collect', 'carryOut', 'survive']
  for (const { key, mechanics } of readAllMechanics()) {
    const spells = spellsOf(key)
    for (const m of mechanics) {
      const sp = spells.get(m.spellId)
      const note = sp?.note ?? ''
      if (!/CAST MARKER|phase marker|Dummy effect|server-side script/i.test(note)) continue
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
      if (!['avoid', 'beInside', 'collect', 'carryOut'].includes(m.rule) || m.collective) continue
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
      if (!['beInside', 'collect'].includes(m.rule) || m.collective) continue
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
