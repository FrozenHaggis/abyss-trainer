import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The honesty tests.
//
// The game's whole claim is that practising here transfers to the real raid.
// That only holds if every mechanic is a real Heroic mechanic. These are what
// stop it drifting into invented content:
//
//   1. Every spellId must exist in the boss's real abilities.json.
//   2. Nothing tagged Mythic-only may appear — the game is Heroic only.
//   3. A mechanic whose tactic file says "Bad: Nothing" must never be able to
//      produce a per-player failure. RaidLens shipped exactly that defect once
//      (a dispel section for a bleed nobody dispels); it must not reappear here.
//   4. Internal consistency: every id referenced by `loop`, `spawns`,
//      `atFullEnergy` and `ambient` must actually exist.

// Vendored under data/abilities so these checks run anywhere the repo is
// cloned. They previously read a sibling checkout by absolute path, which meant
// they passed on the author's machine and failed in CI — the worst of both.
const ABILITIES = 'data/abilities'
const BOSS_DIRS = {
  nekzali: 'nekzali',
  sentinels: 'sentinels',
  vashnik: 'vashnik',
  explorers: 'explorers',
  sszorak: 'sszorak',
  twinfangs: 'twinfangs',
  coiledaltar: 'coiledaltar',
  ulatek: 'ulatek',
}

/** Boss files that actually exist yet. */
const present = Object.entries(BOSS_DIRS).filter(([key]) =>
  existsSync(join('src/bosses', `${key}.ts`)))

/** Pull the MechanicDef literals out of a boss .ts without a TS toolchain. */
function readBoss(key) {
  const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
  const mechanics = []
  const re = /id:\s*'([^']+)'[\s\S]*?spellId:\s*(\d+)[\s\S]*?rule:\s*\{\s*type:\s*'([^']+)'/g
  let m
  while ((m = re.exec(src))) mechanics.push({ id: m[1], spellId: Number(m[2]), rule: m[3] })
  return { src, mechanics }
}

function realSpells(bossKey) {
  const raw = JSON.parse(readFileSync(join(ABILITIES, `${bossKey}.json`), 'utf8'))
  const spells = [...(raw.spells ?? [])]
  for (const a of [...(raw.bosses ?? []), ...(raw.adds ?? [])]) spells.push(...(a.spells ?? []))
  return spells
}

test('every boss in the registry has a file', () => {
  const reg = readFileSync('src/bosses/registry.ts', 'utf8')
  for (const m of reg.matchAll(/from '\.\/([a-z]+)'/g)) {
    assert.ok(existsSync(join('src/bosses', `${m[1]}.ts`)), `registry imports missing ${m[1]}.ts`)
  }
  const files = readdirSync('src/bosses').filter(f => f.endsWith('.ts') && f !== 'registry.ts')
  for (const f of files) {
    const key = f.replace('.ts', '')
    assert.ok(reg.includes(`'./${key}'`), `${key}.ts exists but is not wired into the registry`)
  }
})

for (const [key, dir] of present) {
  test(`${key}: every spell ID exists in the real abilities.json`, () => {
    const byId = new Map(realSpells(dir).map(s => [s.spellId, s]))
    const { mechanics } = readBoss(key)
    assert.ok(mechanics.length > 0, 'parsed no mechanics from the boss file')
    for (const m of mechanics) {
      assert.ok(byId.has(m.spellId),
        `${m.id} uses spellId ${m.spellId}, which is not in ${dir}/abilities.json — invented content`)
    }
  })

  test(`${key}: no Mythic-only mechanics leak into a Heroic trainer`, () => {
    const byId = new Map(realSpells(dir).map(s => [s.spellId, s]))
    for (const m of readBoss(key).mechanics) {
      const spell = byId.get(m.spellId)
      const d = spell?.difficulties
      if (Array.isArray(d) && d.length === 1 && d[0] === 'Mythic') {
        assert.fail(`${m.id} (${spell.name}) is Mythic-only but appears in the Heroic trainer`)
      }
    }
  })

  test(`${key}: unavoidable raid damage can never be a per-player failure`, () => {
    const { src } = readBoss(key)
    for (const b of src.split(/\n\s*\{\s*\n\s*id:/).slice(1)) {
      if (!/type:\s*'raidDamage'/.test(b)) continue
      const ft = b.match(/failText:\s*'([^']*)'/)
      assert.ok(ft, 'raidDamage mechanic has no failText field')
      assert.equal(ft[1], '',
        'a raidDamage mechanic has failure text — the tactic file says "Bad: Nothing", so it must never read as a failure')
    }
  })

  test(`${key}: every referenced mechanic id resolves`, () => {
    const { src, mechanics } = readBoss(key)
    const ids = new Set(mechanics.map(m => m.id))
    const refs = []
    const loop = src.match(/loop:\s*\[([\s\S]*?)\]/)
    if (loop) for (const m of loop[1].matchAll(/'([^']+)'/g)) refs.push(['loop', m[1]])
    for (const m of src.matchAll(/atFullEnergy:\s*'([^']+)'/g)) refs.push(['atFullEnergy', m[1]])
    const amb = src.match(/ambient:\s*\[([\s\S]*?)\]/)
    if (amb) for (const m of amb[1].matchAll(/'([^']+)'/g)) refs.push(['ambient', m[1]])
    for (const m of src.matchAll(/spawns:\s*\{\s*defId:\s*'([^']+)'/g)) refs.push(['spawns', m[1]])
    for (const [where, id] of refs) {
      assert.ok(ids.has(id), `${where} references '${id}', which is not a mechanic on this boss`)
    }
  })
}

test('engine has no path from raidDamage to a recorded failure', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const idx = sim.indexOf("case 'raidDamage':")
  assert.ok(idx > 0, "sim.ts no longer handles 'raidDamage'")
  const body = sim.slice(idx, idx + 400)
  assert.ok(!body.slice(0, body.indexOf('break')).includes('recordFailure'),
    'raidDamage records a failure — unavoidable damage must never blame the player')
})

// A mechanic that tells you to move out must be possible to move out of.
// Two ways it can be impossible: the shape is bigger than you can clear in the
// telegraph, or the shape follows you. Both shipped at least once.
test('every avoid mechanic is actually escapable', () => {
  const PLAYER_SPEED = 14      // yards/sec, from sim.ts
  const REACTION = 0.35        // seconds of human reaction budget
  for (const [key] of present) {
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    for (const block of src.split(/\n    \{\n      id: /).slice(1)) {
      const id = block.match(/^'([^']+)'/)?.[1] ?? '?'
      const origin = block.match(/origin:\s*'([^']+)'/)?.[1]
      const rule = block.match(/rule:\s*\{\s*type:\s*'([^']+)'/)?.[1]
      if (rule !== 'avoid') continue
      if (origin !== 'player' && origin !== 'targeted') continue
      const tele = Number(block.match(/telegraphMs:\s*(\d+)/)?.[1] ?? 0) / 1000
      const r = Number(
        block.match(/kind:\s*'circle',\s*radius:\s*([\d.]+)/)?.[1] ??
        block.match(/kind:\s*'cone',\s*radius:\s*([\d.]+)/)?.[1] ?? 0)
      if (!r) continue
      assert.ok(tele >= r / PLAYER_SPEED + REACTION,
        `${key}/${id}: lands on you with radius ${r}yd but only ${tele}s to clear it — "MOVE OUT" is impossible advice`)
    }
  }
})

test('avoid frontals do not track the player', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("inst.def.origin === 'boss' && inst.def.shape?.kind !== 'circle'")
  assert.ok(i > 0, 'boss-frontal tracking block not found in sim.ts')
  const body = sim.slice(i, i + 320)
  assert.ok(body.includes("rule.type === 'faceAway'"),
    'boss frontals track unconditionally — an avoid cone glued to the player cannot be dodged')
})
