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
  // Parse from `mechanics:` onward only. The `entities:` block also carries
  // `id:` fields, and without this bound the first entity was picked up as a
  // mechanic and swallowed a real one — a parser that silently drops mechanics
  // is exactly what these tests exist to prevent.
  const body = src.slice(Math.max(0, src.indexOf('mechanics: [')))
  const mechanics = []
  const re = /id:\s*'([^']+)',\s*\n\s*name:[\s\S]*?spellId:\s*(\d+)[\s\S]*?rule:\s*\{\s*type:\s*'([^']+)'/g
  let m
  while ((m = re.exec(body))) {
    const from = /from:\s*'([^']+)'/.exec(m[0])
    mechanics.push({ id: m[1], spellId: Number(m[2]), rule: m[3], from: from?.[1] ?? null })
  }
  return { src, mechanics }
}

/** The entities a boss file declares, if any. */
function readEntities(key) {
  const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
  const block = src.match(/entities:\s*\[([\s\S]*?)\n {2}\]/)
  if (!block) return []
  const out = []
  for (const m of block[1].matchAll(/id:\s*'([^']+)',\s*name:\s*"([^"]+)",\s*npcId:\s*(\d+)/g)) {
    out.push({ id: m[1], name: m[2], npcId: Number(m[3]) })
  }
  return out
}

/** spellId -> owning entity NAME, straight from abilities.json. */
function spellOwners(bossKey) {
  const raw = JSON.parse(readFileSync(join(ABILITIES, `${bossKey}.json`), 'utf8'))
  const owners = new Map()
  for (const b of raw.bosses ?? []) {
    for (const s of b.spells ?? []) if (!owners.has(s.spellId)) owners.set(s.spellId, b.name)
  }
  return owners
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

  test(`${key}: declared entities are real NPCs from abilities.json`, () => {
    const ents = readEntities(key)
    if (!ents.length) return          // single-boss fight, nothing to check
    const raw = JSON.parse(readFileSync(join(ABILITIES, `${dir}.json`), 'utf8'))
    const real = new Map((raw.bosses ?? []).map(b => [b.name, b.npcId]))
    assert.equal(ents.length, real.size,
      `declares ${ents.length} entities but abilities.json lists ${real.size}`)
    for (const e of ents) {
      assert.ok(real.has(e.name), `entity "${e.name}" is not a boss in ${dir}/abilities.json`)
      assert.equal(e.npcId, real.get(e.name),
        `entity "${e.name}" has npcId ${e.npcId}, but abilities.json says ${real.get(e.name)}`)
    }
  })

  test(`${key}: each mechanic is cast by the entity that really owns it`, () => {
    const ents = readEntities(key)
    if (!ents.length) return
    const byName = new Map(ents.map(e => [e.name, e.id]))
    const ids = new Set(ents.map(e => e.id))
    const owners = spellOwners(dir)
    for (const m of readBoss(key).mechanics) {
      assert.ok(m.from, `${m.id} has no 'from' on a multi-entity fight`)
      assert.ok(ids.has(m.from), `${m.id} is cast by '${m.from}', which is not a declared entity`)
      // Where abilities.json names the caster, the file must agree with it.
      // Ownership is derived from the data, never chosen — this is the check
      // that keeps it that way.
      const owner = owners.get(m.spellId)
      if (owner) {
        assert.equal(m.from, byName.get(owner),
          `${m.id} is tagged from '${m.from}' but abilities.json says ${owner} casts it`)
      }
    }
  })

  test(`${key}: the tank mechanic belongs to the primary entity`, () => {
    const ents = readEntities(key)
    if (!ents.length) return
    // The player's tank holds entity 0, so a tankSwap or faceAway owned by any
    // other entity would be unplayable — you would be told to swap something
    // you are not holding.
    for (const m of readBoss(key).mechanics) {
      if (m.rule !== 'tankSwap' && m.rule !== 'faceAway') continue
      assert.equal(m.from, ents[0].id,
        `${m.id} is a ${m.rule} owned by '${m.from}', but the player tanks '${ents[0].id}'`)
    }
  })

  test(`${key}: lethality is derived from the ability data, not chosen`, () => {
    const byId = new Map(realSpells(dir).map(s => [s.spellId, s]))
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const body = src.slice(Math.max(0, src.indexOf('mechanics: [')))
    for (const b of body.split(/\n {4}\{\n {6}id:/).slice(1)) {
      const sid = /spellId:\s*(\d+)/.exec(b)
      const rule = /rule:\s*\{\s*type:\s*'([^']+)'/.exec(b)
      if (!sid || !rule) continue
      const deadly = byId.get(Number(sid[1]))?.category === 'Deadly'
      const marked = /\blethal:\s*true/.test(b)
      // raidDamage is a healing check and must never carry a failure semantic,
      // so a Deadly one stays unmarked on purpose.
      const shouldMark = deadly && rule[1] !== 'raidDamage'
      assert.equal(marked, shouldMark,
        `spell ${sid[1]} is category=${byId.get(Number(sid[1]))?.category} rule=${rule[1]}` +
        ` but lethal is ${marked} — lethality must match abilities.json`)
    }
  })

  test(`${key}: every add is a real add from abilities.json`, () => {
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const block = src.match(/\n {2}adds:\s*\[([\s\S]*?)\n {2}\],/)
    if (!block) return                       // a boss with no adds is allowed
    const raw = JSON.parse(readFileSync(join(ABILITIES, `${dir}.json`), 'utf8'))
    // spellId -> the add entry that owns it, from the real data.
    const owner = new Map()
    for (const a of raw.adds ?? []) {
      for (const s of a.spells ?? []) if (!owner.has(s.spellId)) owner.set(s.spellId, a)
    }
    const authored = [...block[1].matchAll(
      /name: '([^']+)', npcId: (\d+), spellId: (\d+),\s*\n\s*job: '([^']+)'/g)]
    assert.ok(authored.length > 0, 'adds block parsed no entries')
    for (const [, name, npcId, spellId, job] of authored) {
      const real = owner.get(Number(spellId))
      assert.ok(real, `add "${name}" uses spellId ${spellId}, which no add in ${dir}/abilities.json casts`)
      if (Number(npcId) !== 0) {
        assert.equal(Number(npcId), real.npcId,
          `add "${name}" has npcId ${npcId} but abilities.json says ${real.npcId}`)
      }
      assert.ok(['kill', 'kick', 'intercept', 'leave'].includes(job), `add "${name}" has unknown job ${job}`)
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

// Lethality raises the stakes on every "is this actually fair?" question, so
// the two ways it could become unfair are pinned down here.
test('missing a soak never kills the player outright', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("case 'beInside':")
  assert.ok(i > 0, "sim.ts no longer handles 'beInside'")
  const body = sim.slice(i, i + sim.slice(i).indexOf('break'))
  assert.ok(!body.includes('killPlayer'),
    'a missed soak kills the player — an unsoaked hit lands on the raid, and ' +
    'blaming one person for a collective miss is the defect this project keeps refixing')
})

test('a contact hazard cannot kill on the frame it spawns', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("case 'avoid':")
  assert.ok(i > 0, "sim.ts no longer handles 'avoid'")
  const body = sim.slice(i, i + sim.slice(i).indexOf('break'))
  assert.ok(/inside\s*&&\s*!def\.popsOnContact/.test(body),
    'avoid resolves without excluding contact hazards — a Deadly orb with a 1ms ' +
    'telegraph can then spawn on top of you and kill you with no reaction window')
})

// The Coiled Altar orbs are the one add in the raid where shooting it is the
// mistake. A trainer that quietly rewarded killing everything on screen would
// drill in exactly the habit that fight punishes hardest.
test('shooting a "leave" add is a failure, not a kill', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("if (add.def.job === 'leave')")
  assert.ok(i > 0, 'sim.ts no longer special-cases "leave" adds when a shot connects')
  const body = sim.slice(i, i + 500)
  assert.ok(body.includes('recordAddFailure'),
    'destroying a "leave" add records no failure — Venom Rupture is the biggest killer on that boss')
  assert.ok(!/w\.addsKilled\+\+/.test(body),
    'destroying a "leave" add counts as a kill — it must never read as progress')
})

// Caustic Globule: "un-soaked ruptures only, never soakers". Running over one
// is the job, and the engine must have no way to score it against you.
test('eating a pickup can never be a failure', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("case 'collect':")
  assert.ok(i > 0, "sim.ts no longer handles 'collect'")
  const body = sim.slice(i, i + sim.slice(i).indexOf('break'))
  assert.ok(/if \(!inst\.answered\)/.test(body),
    'collect resolves without checking whether it was picked up — the soaker would be blamed')
  assert.ok(!body.includes('killPlayer'),
    'a ruptured pickup kills the player outright; it ruptures onto the raid')
})

test('pickups are drawn as pickups, not as ground to avoid', () => {
  const render = readFileSync('src/engine/render.ts', 'utf8')
  assert.ok(/case 'collect': return GREEN/.test(render),
    'collect telegraphs are not green — red reads as "do not stand here", the opposite of the mechanic')
  assert.ok(render.includes("inst.def.rule.type === 'collect') continue"),
    'collect instances also fall through to the generic telegraph draw, so they render as one big shape')
})

// Taunting off you is the co-tank's job. The engine used to have no proactive
// co-tank at all: it only ever took the boss after you had already been marked
// down for holding too long, which taught a swap partnership that does not
// exist and made a player-tank fail every single cycle.
test('the co-tank taunts off you before it becomes your failure', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf('// ── tank swap ──')
  assert.ok(i > 0, 'tank swap block not found in sim.ts')
  const body = sim.slice(i, i + 2200)
  assert.ok(body.includes('if (tank.isPlayer)'),
    'the swap block does not branch on whether YOU are holding it, so holding it ' +
    'while overstacked falls through to the failure path')
  // The player-holding branch must hand off without ever recording a failure.
  const branch = body.slice(body.indexOf('if (tank.isPlayer)'))
  const mine = branch.slice(0, branch.indexOf('} else if'))
  assert.ok(!mine.includes('recordFailure'),
    'holding the boss while overstacked is scored against you — that swap is the co-tank\'s job')
  assert.ok(mine.includes('CO_TANK_REACTION_MS'),
    'the co-tank has no reaction window; it must taunt off you on its own')
})

// 300-yard raid-wide abilities must never be dodgeable shapes. Every tactic
// file that has one says the same thing: "a per-player hit leaderboard would
// name the whole raid".
test('no 300-yard raid-wide ability is scored as a player failure', () => {
  for (const [key, dir] of present) {
    const raw = JSON.parse(readFileSync(join(ABILITIES, `${dir}.json`), 'utf8'))
    const all = [...(raw.spells ?? [])]
    for (const a of [...(raw.bosses ?? []), ...(raw.adds ?? [])]) all.push(...(a.spells ?? []))
    const wide = new Set(all.filter(s => /\b300\s*(yd|yard)/i.test(s.note ?? '')).map(s => s.spellId))
    for (const m of readBoss(key).mechanics) {
      if (!wide.has(m.spellId)) continue
      assert.ok(['raidDamage', 'press', 'tankSwap', 'keepApart'].includes(m.rule),
        `${key}/${m.id} (spell ${m.spellId}) is 300yd raid-wide but its rule is '${m.rule}' — ` +
        'that produces a failure leaderboard naming the entire raid every pull')
    }
  }
})

test('adds cannot pile up faster than they can be cleared', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  // The cap is now a per-boss dial with a default, so match either form.
  assert.ok(/w\.adds\.length < \(w\.boss\.maxAdds \?\? MAX_CONCURRENT_ADDS\)/.test(sim),
    'the wave scheduler has no concurrency cap — waves landing on uncleared waves ' +
    'is a wipe you cannot play out of, and it teaches nothing except that the trainer is unfair')
})

test('avoid frontals do not track the player', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("inst.def.origin === 'boss' && inst.def.shape?.kind !== 'circle'")
  assert.ok(i > 0, 'boss-frontal tracking block not found in sim.ts')
  const body = sim.slice(i, i + 320)
  assert.ok(body.includes("rule.type === 'faceAway'"),
    'boss frontals track unconditionally — an avoid cone glued to the player cannot be dodged')
})
