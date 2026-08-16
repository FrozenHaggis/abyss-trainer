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

// ── reading the nested structures ────────────────────────────────────────────
//
// Phases, arenas and side tags nest: a `phases` array holds objects holding
// arrays holding objects. A non-greedy regex stops at the first `]` it meets,
// which on a phase list is the end of the FIRST phase's loop — everything after
// it then goes unchecked while the test still reports success. That is the same
// vacuous-pass failure this file already had once with its LF-only splits, so
// these read brackets by counting them instead.

/** End index of the string literal opening at `at`. */
function endOfString(src, at) {
  const quote = src[at]
  for (let i = at + 1; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue }
    if (src[i] === quote) return i
  }
  return src.length - 1
}

/**
 * The source with `//` comments removed.
 *
 * These files carry more prose than code, and that prose contains brackets,
 * apostrophes and the very field names being searched for. Stripping it first
 * means a comment can never be mistaken for a declaration.
 */
function stripComments(src) {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      const end = endOfString(src, i)
      out += src.slice(i, end + 1)
      i = end
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      if (nl < 0) break
      out += '\n'
      i = nl
      continue
    }
    out += c
  }
  return out
}

/** The balanced `[...]` or `{...}` beginning at `at`, string literals honoured. */
function balancedAt(src, at) {
  const open = src[at]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  for (let i = at; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') { i = endOfString(src, i); continue }
    if (c === open) depth++
    else if (c === close && --depth === 0) return src.slice(at, i + 1)
  }
  return null
}

/** The literal assigned to `name:` in `text`, brackets and all. */
function literalAfter(text, name) {
  const m = new RegExp(`\\b${name}:\\s*([\\[{])`).exec(text)
  return m ? balancedAt(text, m.index + m[0].length - 1) : null
}

/** Every top-level `{...}` inside an array literal. */
function objectsIn(arrayText) {
  const out = []
  for (let i = 0; i < arrayText.length; i++) {
    const c = arrayText[i]
    if (c === "'" || c === '"' || c === '`') { i = endOfString(arrayText, i); continue }
    if (c !== '{') continue
    const obj = balancedAt(arrayText, i)
    if (!obj) break
    out.push(obj)
    i += obj.length - 1
  }
  return out
}

/** A quoted field's value: `name: 'x'` or `name: "x"`. */
function strField(text, name) {
  return new RegExp(`\\b${name}:\\s*['"]([^'"]*)['"]`).exec(text)?.[1] ?? null
}

/** Every quoted string in an array literal, in order. Either quote style. */
function stringsIn(arrayText) {
  return [...arrayText.matchAll(/'([^']*)'|"([^"]*)"/g)].map(m => m[1] ?? m[2])
}

/** Comment-free boss source. */
function codeOf(key) {
  return stripComments(readFileSync(join('src/bosses', `${key}.ts`), 'utf8'))
}

/** One entry per MechanicDef, with the fields the newer checks read. */
function mechanicDefs(key) {
  const code = codeOf(key)
  const arr = literalAfter(code, 'mechanics')
  assert.ok(arr, `${key}: found no mechanics array — every check reading it would pass vacuously`)
  const defs = objectsIn(arr).map(blk => {
    const rule = literalAfter(blk, 'rule') ?? ''
    return {
      blk,
      id: strField(blk, 'id'),
      rule: strField(rule, 'type'),
      ruleLiteral: rule,
      side: strField(blk, 'side'),
      spawnsAtSoakers: strField(blk, 'spawnsAtSoakers'),
      failText: strField(blk, 'failText') ?? '',
    }
  })
  assert.ok(defs.length > 0, `${key}: parsed no mechanics — this check would be vacuous`)
  return defs
}

/** The add objects, in order. Empty on a boss that spawns nothing. */
function addDefs(key) {
  const arr = literalAfter(codeOf(key), 'adds')
  return arr ? objectsIn(arr) : []
}

/** Add ids, for the phase fields that name an add rather than a mechanic. */
function addIds(key) {
  return addDefs(key).map(blk => strField(blk, 'id')).filter(Boolean)
}

/** The phase objects, in order. Empty on the fights that have no stages. */
function phaseDefs(key) {
  const arr = literalAfter(codeOf(key), 'phases')
  if (!arr) return []
  const phases = objectsIn(arr)
  assert.ok(phases.length > 0, `${key}: declares phases but none parsed — the phase checks would be vacuous`)
  return phases
}

/** The altar objects, in order. Empty on the seven fights with no fountains. */
function altarDefs(key) {
  const arr = literalAfter(codeOf(key), 'altars')
  if (!arr) return []
  const altars = objectsIn(arr)
  assert.ok(altars.length > 0,
    `${key}: declares altars but none parsed — every fountain check below would be vacuous`)
  return altars
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
    // CRLF-tolerant: LF-only split found nothing on a Windows checkout and this
    // test passed without checking anything. See invariants.test.js.
    const blocks = body.split(/\r?\n {4}\{\r?\n {6}id:/).slice(1)
    assert.ok(blocks.length > 0, `${key}: parsed no mechanic blocks — this check would be vacuous`)
    for (const b of blocks) {
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
    // Comment lines are allowed between the identity fields and `job`. The
    // regex used to demand they be adjacent, so adding a comment to an add
    // silently emptied this test's input and it passed by parsing nothing —
    // a test that discourages comments in a codebase built on them, and one
    // whose failure mode is a false pass.
    const authored = [...block[1].matchAll(
      /name: '([^']+)', npcId: (\d+), spellId: (\d+),(?:\s*\/\/[^\n]*)*\s*job: '([^']+)'/g)]
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
    // matchAll rather than match: a phased boss carries a loop and an ambient
    // list PER PHASE as well as at the top, and matching once only ever checked
    // the first of each. The phase lists went unread — which is exactly where a
    // renamed mechanic leaves a dangling id behind.
    for (const loop of src.matchAll(/loop:\s*\[([\s\S]*?)\]/g)) {
      for (const m of loop[1].matchAll(/'([^']+)'/g)) refs.push(['loop', m[1]])
    }
    for (const m of src.matchAll(/atFullEnergy:\s*'([^']+)'/g)) refs.push(['atFullEnergy', m[1]])
    for (const amb of src.matchAll(/ambient:\s*\[([\s\S]*?)\]/g)) {
      for (const m of amb[1].matchAll(/'([^']+)'/g)) refs.push(['ambient', m[1]])
    }
    for (const m of src.matchAll(/spawns:\s*\{\s*defId:\s*'([^']+)'/g)) refs.push(['spawns', m[1]])
    for (const [where, id] of refs) {
      assert.ok(ids.has(id), `${where} references '${id}', which is not a mechanic on this boss`)
    }
  })

  // Everything a phase or a mechanic can point at by name. A dangling id here
  // is not a type error — these are all plain strings — so nothing but this
  // test stands between a renamed mechanic and a stage that silently fires
  // nothing at all.
  test(`${key}: every phase and cross-reference id resolves`, () => {
    const mechanics = new Set(mechanicDefs(key).map(m => m.id))
    const adds = new Set(addIds(key))
    // A THIRD namespace. `empoweredOnly` and `unlockedByDeathOf` name bodies,
    // not mechanics, and a typo in either is silent in the worst possible way:
    // the gate in fire() never opens, so the mechanic simply never fires and the
    // fight looks like it is working. Six of the Explorers' most interesting
    // abilities hang off these two fields.
    const entitiesLit = literalAfter(codeOf(key), 'entities')
    const entities = new Set(
      (entitiesLit ? objectsIn(entitiesLit) : []).map(e => strField(e, 'id')).filter(Boolean))
    const refs = []          // [where, id, which namespace it must live in]

    for (const p of phaseDefs(key)) {
      const at = `phase '${strField(p, 'id') ?? '?'}'`
      const loop = literalAfter(p, 'loop')
      if (loop) for (const id of stringsIn(loop)) refs.push([`${at} loop`, id, mechanics, 'mechanic'])
      const ambient = literalAfter(p, 'ambient')
      if (ambient) for (const id of stringsIn(ambient)) refs.push([`${at} ambient`, id, mechanics, 'mechanic'])
      const onEnter = literalAfter(p, 'onEnter')
      if (onEnter) {
        for (const spawn of objectsIn(onEnter)) {
          const id = strField(spawn, 'addId')
          if (id) refs.push([`${at} onEnter`, id, adds, 'add'])
        }
      }
      for (const field of ['endsWhenAddsDead', 'resurrectCorpsesAs']) {
        const id = strField(p, field)
        if (id) refs.push([`${at} ${field}`, id, adds, 'add'])
      }
      // The mechanic a stage casts the instant it begins. Dangling, the
      // intermission opens with nothing at all and the burn window never runs.
      const opens = strField(p, 'opensWith')
      if (opens) refs.push([`${at} opensWith`, opens, mechanics, 'mechanic'])
    }

    for (const m of mechanicDefs(key)) {
      // proximityStack carries no id of its own today — it is radius, cadence
      // and damage — but it is read here so that one added later cannot slip
      // through unchecked.
      for (const field of ['channel', 'stacks', 'alternatesWith', 'proximityStack']) {
        const literal = literalAfter(m.blk, field)
        const id = literal && strField(literal, 'defId')
        if (id) refs.push([`${m.id} ${field}`, id, mechanics, 'mechanic'])
      }
      if (m.spawnsAtSoakers) {
        refs.push([`${m.id} spawnsAtSoakers`, m.spawnsAtSoakers, mechanics, 'mechanic'])
      }
      // The five abilities a flurry deals out, and the DoT a group soak applies.
      // Both live inside the rule literal rather than on the mechanic, and both
      // are plain strings — a renamed mechanic would leave Apex Predator firing
      // four of five, or Mutilate applying a Gash that does not exist, and
      // nothing else in the build would notice.
      const parts = literalAfter(m.ruleLiteral, 'parts')
      if (parts) {
        for (const id of stringsIn(parts)) refs.push([`${m.id} combo part`, id, mechanics, 'mechanic'])
      }
      const dotId = strField(m.ruleLiteral, 'dotId')
      if (dotId) refs.push([`${m.id} dotId`, dotId, mechanics, 'mechanic'])
      // The Lost Explorers' new rule literals. Each of these is a plain string
      // pointing at another mechanic: the two cure pools and the detonation a
      // polarity attributes its death to, and the raid cost a feed pays.
      for (const f of ['firePoolId', 'frostPoolId', 'deathId', 'costId']) {
        const v = strField(m.ruleLiteral, f)
        if (v) refs.push([`${m.id} ${f}`, v, mechanics, 'mechanic'])
      }
      // `hides: { defId: '…' }` — what a junk box was concealing. Read off the
      // hides literal specifically rather than off the whole block, or a
      // `spawns: { defId }` on the same mechanic would be attributed to it.
      const hides = literalAfter(m.blk, 'hides')
      const hidden = hides && strField(hides, 'defId')
      if (hidden) refs.push([`${m.id} hides`, hidden, mechanics, 'mechanic'])
      // And the two ENTITY gates.
      const emp = strField(m.blk, 'empoweredOnly')
      if (emp) refs.push([`${m.id} empoweredOnly`, emp, entities, 'entity'])
      const unlocked = literalAfter(m.blk, 'unlockedByDeathOf')
      if (unlocked) {
        for (const id of stringsIn(unlocked)) {
          refs.push([`${m.id} unlockedByDeathOf`, id, entities, 'entity'])
        }
      }
    }

    const NOUN = { add: 'an add', entity: 'an entity', mechanic: 'a mechanic' }
    for (const [where, id, known, kind] of refs) {
      assert.ok(known.has(id),
        `${where} references '${id}', which is not ${NOUN[kind]} on this boss`)
    }
  })

  // A side tag decides who a mechanic fires at and who it is scored against.
  // Naming a side nobody is parked on hands it to an empty half of the raid.
  test(`${key}: a side tag names a side the raid is actually split across`, () => {
    const code = codeOf(key)
    const entities = literalAfter(code, 'entities')
    const sides = new Set(
      (entities ? objectsIn(entities) : []).map(e => strField(e, 'side')).filter(Boolean))

    for (const m of mechanicDefs(key)) {
      if (!m.side) continue
      assert.ok(sides.has(m.side),
        `${m.id} fires at the '${m.side}' group, but no entity is parked on that side — ` +
        'the mechanic belongs to a half of the raid that does not exist')
    }

    if (!/\bsided:\s*true/.test(code)) return
    assert.ok(sides.size >= 2,
      `${key} splits the raid but its entities declare ${sides.size} side(s) — ` +
      'a split fight needs a golem on each side for the two halves to have anywhere to stand')
  })

  // Vitriolic Stasis hands every raider four orbs split green and red, and a
  // pair has to combine to exactly the target. Nobody carries none or all four
  // — either would need no partner — so a marked raider brings between one and
  // three, and two of them can only ever sum to between two and six. A target
  // outside that band is unwinnable by anybody: no pairing in the raid resolves
  // it, so the mechanic the tactic file calls "the one that ends pulls" ends
  // every pull, with nothing the player could have done differently.
  test(`${key}: a pairUp target two players can actually reach`, () => {
    const MIN_MARKS = 1, MAX_MARKS = 3
    for (const m of mechanicDefs(key)) {
      if (m.rule !== 'pairUp') continue
      const target = Number(/\btarget:\s*(-?[\d.]+)/.exec(m.ruleLiteral)?.[1])
      assert.ok(Number.isFinite(target), `${m.id} is a pairUp with no target to combine to`)
      assert.ok(target >= 2 * MIN_MARKS && target <= 2 * MAX_MARKS,
        `${m.id} asks a pair to combine to ${target}, but two raiders carrying ` +
        `${MIN_MARKS}-${MAX_MARKS} marks each can only reach ${2 * MIN_MARKS}-${2 * MAX_MARKS} — ` +
        'no pairing clears it, so the window can only ever end in Cultivated Burst')
    }
  })

  // A death the debrief cannot explain teaches nothing. Both of these kill
  // outright — a hole in the floor, and a collision with the wrong partner —
  // so both have to be able to say so afterwards.
  test(`${key}: a rule that kills outright always says what happened`, () => {
    // A second Mutilated Gash and an unpaired Crosswinds both end the pull on
    // the spot, so both owe the debrief a sentence for the same reason a hole in
    // the floor and a wrong orb collision do.
    // `wave` joins them. Blast Wave is the deadliest ID in the Explorers' data —
    // 18 killing blows on the Mythic PTR sample — and it ends the pull on the
    // spot for anyone still on the floor when it passes. A new Rule member that
    // kills is invisible to this list until somebody decides about it, which is
    // the whole reason the list is written out rather than derived.
    const KILLS_OUTRIGHT = ['lethalGround', 'pairUp', 'stackingDot', 'windPair', 'wave']
    for (const m of mechanicDefs(key)) {
      if (!KILLS_OUTRIGHT.includes(m.rule)) continue
      assert.notEqual(m.failText.trim(), '',
        `${m.id} is a '${m.rule}' with no failText — it can end the pull, and the ` +
        'debrief would list the death with nothing written against it')
    }
  })

  // A phase with no way out is a dead end: the pull sits in it until the
  // enrage, and every stage authored after it is unreachable. The last one is
  // exempt — it ends when the boss does.
  test(`${key}: every phase but the last can be left`, () => {
    const phases = phaseDefs(key)
    // `windToCysts` is an exit like the others: the Maelstrom ends when every
    // glob on the floor has burst, and entering it guarantees there are two.
    const EXITS = ['endsAtBossHp', 'endsAtFullEnergy', 'endsWhenAddsDead', 'windToCysts']
    for (const p of phases.slice(0, -1)) {
      const id = strField(p, 'id') ?? '?'
      assert.ok(EXITS.some(field => new RegExp(`\\b${field}:`).test(p)),
        `phase '${id}' declares no exit condition — the pull would never leave it, ` +
        `and every phase after it is unreachable. One of ${EXITS.join(', ')} is required.`)
    }
    // A fight that CYCLES has no last phase — the stage list wraps, so a stage
    // with no way out is a dead end wherever it sits in the array. The exemption
    // for the final stage only holds when the final stage is the one the boss
    // dies in, and Sszorak's is not: its Maelstrom hands the fight back to the
    // flurry and round it goes again.
    if (phases.length > 1) {
      const last = phases[phases.length - 1]
      const id = strField(last, 'id') ?? '?'
      const wraps = phases.every(p => EXITS.some(f => new RegExp(`\\b${f}:`).test(p)))
      const cycles = /endsAtFullEnergy/.test(phases[0])
      if (cycles) {
        assert.ok(wraps,
          `${key} cycles its stages, so phase '${id}' is not the last one — it hands the ` +
          'fight back to the first. It needs an exit condition like every other stage.')
      }
    }
  })

  // The Sentinels' floor is an octagon with an alcove at each end, and the
  // fight asks whether two 40-yard bubbles held 40 yards apart actually fit
  // inside it. That question only has an answer if the polygon is a real room:
  // enough points to be one, no crossed edges to make "inside" ambiguous, and
  // nothing sticking out past arenaRadius, which the engine still treats as the
  // bounding radius everywhere else.
  test(`${key}: a polygon arena is a simple floor inside its own radius`, () => {
    const code = codeOf(key)
    const arena = literalAfter(code, 'arena')
    if (!arena) return                     // a round room needs no polygon
    const points = literalAfter(arena, 'points')
    assert.ok(points,
      `${key} declares an arena whose points are not written out — the floor is data ` +
      'like everything else here, and a computed one cannot be checked against the fight')
    const pts = [...points.matchAll(/x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+)/g)]
      .map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
    const radius = Number(/arenaRadius:\s*([\d.]+)/.exec(code)[1])

    assert.ok(pts.length >= 6,
      `${key}: a ${pts.length}-point arena is not a room — it reads as a wedge, ` +
      'and the floor a fight is judged against has to be the floor players see')

    for (const p of pts) {
      const d = Math.hypot(p.x, p.y)
      assert.ok(d <= radius + 1e-9,
        `${key}: arena corner (${p.x}, ${p.y}) is ${d.toFixed(1)}yd out on a ${radius}yd floor — ` +
        'arenaRadius is no longer a bounding radius, so every check that uses it is wrong')
    }

    const n = pts.length
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n]
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 1e-9,
        `${key}: arena corners ${i} and ${(i + 1) % n} sit on top of each other — a zero-length wall`)
    }
    // Proper crossings only: two walls that pass through one another leave the
    // room with no unambiguous inside, and "did they leave the arena?" stops
    // having an answer.
    const turn = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue      // walls that share a corner
        const [a, b, c, d] = [pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]]
        const crosses = (turn(c, d, a) > 0) !== (turn(c, d, b) > 0) &&
                        (turn(a, b, c) > 0) !== (turn(a, b, d) > 0)
        assert.ok(!crosses,
          `${key}: arena walls ${i} and ${j} cross — the floor is not a simple polygon, ` +
          'so it has no inside to stand in')
      }
    }
  })

  // ── the fountains ──────────────────────────────────────────────────────────
  //
  // An altar is nothing but a bundle of references: the add it sends at the
  // pool, the infection it hands the raid, the Expulsion it fires, the Infusion
  // it stacks. Every one of them is a plain string or a bare number, so nothing
  // but these checks stands between a renamed mechanic and a fountain that
  // drains into thin air — and the drain is the mechanic the whole fight turns
  // on, because the boss follows its tank and his footwork picks the pair.

  test(`${key}: every altar points at a real add, debuff and Expulsion`, () => {
    const altars = altarDefs(key)
    if (!altars.length) return              // only one fight in the raid has fountains
    const mechanics = new Set(mechanicDefs(key).map(m => m.id))
    const adds = new Set(addIds(key))
    const seen = new Set()

    for (const a of altars) {
      const id = strField(a, 'id')
      assert.ok(id, `${key}: an altar has no id — nothing can refer to it`)
      // Two fountains under one id is the drain quietly reading the wrong one:
      // the raid is told red is up while orange's add is walking at the pool.
      assert.ok(!seen.has(id),
        `${key}: two altars share the id '${id}' — the drain can only ever find the first, ` +
        'so one fountain fires under the other\'s name')
      seen.add(id)

      const addId = strField(a, 'addId')
      assert.ok(addId && adds.has(addId),
        `${key}: altar '${id}' sends '${addId}', which is not an add on this boss — ` +
        'draining it would spawn nothing and the raid would never learn what that colour means')

      // The infection and the Expulsion are mechanics: the debuff the drain puts
      // on two random raiders, and the unavoidable hit it fires on the way past.
      for (const field of ['debuffId', 'expulsionId']) {
        const ref = strField(a, field)
        assert.ok(ref && mechanics.has(ref),
          `${key}: altar '${id}' names ${field} '${ref}', which is not a mechanic on this boss`)
      }
    }
  })

  // The Infusion is what makes draining the same pair twice running a mistake,
  // so it is the id a raider is actually being taught to read off the altar. It
  // has to be the real spell, like every other id in this game.
  test(`${key}: every altar's Infusion is a real spell`, () => {
    const altars = altarDefs(key)
    if (!altars.length) return
    const byId = new Map(realSpells(dir).map(s => [s.spellId, s]))
    for (const a of altars) {
      const id = strField(a, 'id')
      const spell = /\binfusionSpellId:\s*(\d+)/.exec(a)
      assert.ok(spell, `${key}: altar '${id}' has no infusionSpellId — stacking it would show nothing`)
      assert.ok(byId.has(Number(spell[1])),
        `${key}: altar '${id}' stacks Infusion ${spell[1]}, which is not in ${dir}/abilities.json — invented content`)
    }
  })

  // Draining fewer than one fountain is a cast that does nothing. Draining more
  // than the room holds is the same cast every single time: every altar fires,
  // every Infusion stacks, and the tank's position — the one thing this fight
  // asks him to think about — stops choosing anything at all.
  test(`${key}: a drain takes a number of fountains the room actually has`, () => {
    const altars = altarDefs(key)
    for (const m of mechanicDefs(key)) {
      if (m.rule !== 'drainNearest') continue
      const count = Number(/\bcount:\s*(\d+)/.exec(m.ruleLiteral)?.[1])
      assert.ok(Number.isFinite(count), `${key}/${m.id} is a drainNearest with no count`)
      assert.ok(count >= 1,
        `${key}/${m.id} drains ${count} fountains — the cast resolves and nothing happens`)
      // A drain on a boss with no fountains at all is the next test's story to
      // tell, and it tells it far better than "2 of 0" would.
      if (!altars.length) continue
      assert.ok(count <= altars.length,
        `${key}/${m.id} drains ${count} of ${altars.length} fountains, so it always drains all of them — ` +
        'the pair stops depending on where the boss is standing, and the fight loses its only tank decision')
    }
  })

  // The two halves have to arrive together. Altars with nothing to drain them
  // are scenery the renderer paints and the fight never uses; a drain with no
  // altars picks the nearest of nothing and quietly fires no mechanics at all.
  test(`${key}: altars and the mechanic that drains them arrive together`, () => {
    const altars = altarDefs(key)
    const drains = mechanicDefs(key).filter(m => m.rule === 'drainNearest')
    if (altars.length) {
      assert.ok(drains.length > 0,
        `${key} declares ${altars.length} altars but no drainNearest mechanic — ` +
        'nothing ever drinks from them, so they are scenery')
    }
    if (drains.length) {
      assert.ok(altars.length > 0,
        `${key}/${drains[0].id} drains the nearest fountains but the boss declares none — ` +
        'the cast has nothing to pick from and fires nothing')
    }
  })

  // What an add leaves behind is the whole reason two of them are dangerous:
  // the Clotting Venom that becomes two smaller ones still walking, and the
  // Shrouded Venom that drops a pool at every player at once. Both are id
  // references, and a dangling one turns the scariest death in the fight into
  // an add that simply disappears.
  test(`${key}: what an add leaves behind when it dies is real`, () => {
    const blocks = addDefs(key)
    if (!blocks.length) return
    const adds = new Set(addIds(key))
    const mechanics = new Set(mechanicDefs(key).map(m => m.id))
    for (const blk of blocks) {
      const id = strField(blk, 'id')
      const splits = literalAfter(blk, 'splits')
      if (splits) {
        const into = strField(splits, 'intoId')
        assert.ok(into && adds.has(into),
          `${key}: add '${id}' splits into '${into}', which is not an add on this boss — ` +
          'killing it would end the threat instead of doubling it')
      }
      const drops = strField(blk, 'deathSpawnsAtAllPlayers')
      if (drops) {
        assert.ok(mechanics.has(drops),
          `${key}: add '${id}' drops '${drops}' at every player on death, but that is not a ` +
          'mechanic on this boss — the raid would never be made to relocate')
      }
    }
  })

  // A trail is a debuff that keeps dropping the same hazard under whoever holds
  // it. Name a hazard that does not exist and the carrier walks a clean floor,
  // which teaches the exact opposite of the mechanic.
  test(`${key}: a trail drops a hazard that exists`, () => {
    const defs = mechanicDefs(key)
    const mechanics = new Set(defs.map(m => m.id))
    for (const m of defs) {
      if (m.rule !== 'trail') continue
      const defId = strField(m.ruleLiteral, 'defId')
      assert.ok(defId && mechanics.has(defId),
        `${key}/${m.id} trails '${defId}', which is not a mechanic on this boss — ` +
        'the carrier would leave nothing behind them')
    }
  })
}

// ── the four new primitives, guarded at the source ───────────────────────────
//
// Same shape as the pickup and soak guards below: slice sim.ts from the case
// label to the next `break` and assert on what is and is not in it. These are
// not stylistic. Each one is a rule this project has already broken once on some
// other mechanic, transplanted onto the rule that could break it next.
test('a rejected feed is free — no failure, no death', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("case 'feed':")
  assert.ok(i > 0, "sim.ts no longer handles 'feed'")
  const body = sim.slice(i, sim.indexOf('break', i))
  assert.ok(!/\b(recordFailure|killPlayer|hurt)\(/.test(body),
    'a fish that expired, or a feed the boss refused, is being charged for. Walking a ' +
    'fish into the wrong one of three bodies standing close together must not be an ' +
    'unrecoverable wipe, and the bar already charges for the reset you did not get')

  // And the delivery itself. A boss that has already eaten refuses the fish and
  // you keep it — the empowerment must be gated, or three fish fed into one body
  // would empower it three times and strand the other two.
  const at = sim.indexOf('if (w.fishCarried) {')
  assert.ok(at > 0, 'the feed block in step() is gone')
  const block = sim.slice(at, at + 1400)
  assert.match(block, /!u\.empowered/,
    'the feed does not check whether its target has already eaten. Each boss empowers ' +
    'once, and without the check a fish is consumed on a body that gains nothing')
  assert.ok(!/\b(recordFailure|killPlayer)\(/.test(block),
    'the feed block scores or kills. Assumption B is that a misclick costs you nothing ' +
    'but the walk back')
})

test('touching a mushroom can never be a failure', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("case 'launchPad':")
  assert.ok(i > 0, "sim.ts no longer handles 'launchPad'")
  assert.ok(!/\b(recordFailure|killPlayer|hurt)\(/.test(sim.slice(i, sim.indexOf('break', i))),
    'a launchPad resolves into damage or a failure. The ability data calls the airborne ' +
    'debuff the SUCCESS signal in as many words — running over a mushroom is the answer ' +
    'to Blast Wave, not a mistake')

  const at = sim.indexOf("if (inst.def.rule.type === 'launchPad'")
  assert.ok(at > 0, 'the mushroom contact test in step() is gone')
  assert.ok(!/\b(recordFailure|killPlayer|hurt)\(/.test(sim.slice(at, at + 700)),
    'the mushroom contact test damages or scores whoever stepped on it')
})

test('an element pool is purely a cure and never a hazard', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("case 'elementPool':")
  assert.ok(i > 0, "sim.ts no longer handles 'elementPool'")
  assert.ok(!/\b(recordFailure|killPlayer|hurt)\(/.test(sim.slice(i, sim.indexOf('break', i))),
    'an elementPool resolves into harm. It is the only thing on this floor that is purely ' +
    'good news, and a cure that also hurts cannot be told apart from the thing it cures')

  // The positive half: the cure must actually be the OPPOSITE element. A pool
  // that strips its own element makes every carrier self-clearing and deletes
  // the trade that IS the mechanic.
  const at = sim.indexOf("if (inst.def.rule.type === 'elementPool') {")
  assert.ok(at > 0, 'the element-pool contact test in step() is gone')
  const block = sim.slice(at, at + 900)
  assert.match(block, /w\.player\.element !== el/,
    'the cure does not check that the pool is the opposite element. Standing in your own ' +
    'element must do nothing at all — trading ground with the other carrier is the mechanic')
})

test('a wave is escaped by being airborne and by nothing else', () => {
  const sim = readFileSync('src/engine/sim.ts', 'utf8')
  const i = sim.indexOf("case 'wave':")
  assert.ok(i > 0, "sim.ts no longer handles 'wave'")
  const body = sim.slice(i, sim.indexOf('break', i))
  assert.match(body, /w\.player\.aloft <= 0/,
    'the wave no longer reads `aloft`. Being off the floor is the entire mechanic, and a ' +
    'wave that lands on an airborne player is a telegraph with no answer at all')
  // And the allies have to be seen playing it, or the raid stands in a front
  // that kills the player and reports no losses.
  assert.match(body, /a\.aloft <= 0/,
    'the wave exempts the player but not the raid. A front that kills only you is not a ' +
    'raid mechanic, and the bots have to be visibly answering it')
})

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
    // CRLF-tolerant, and asserted non-empty: LF-only this found nothing on a
    // Windows checkout, so "every avoid mechanic is escapable" checked nothing.
    const blocks = src.split(/\r?\n {4}\{\r?\n {6}id: /).slice(1)
    assert.ok(blocks.length > 0, `${key}: parsed no mechanic blocks — this check would be vacuous`)
    for (const block of blocks) {
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
  // Bounded by the NEXT section header rather than by a character count. The
  // count was 2200, and the block outgrew it the moment the swap started
  // iterating every tankSwap mechanic instead of the first — at which point the
  // slice ended mid-branch, `} else if` was not in it, and the co-tank check
  // below failed against code that was perfectly correct. A window measured in
  // characters is a window that expires.
  const end = sim.indexOf('// ── ', i + 20)
  const body = sim.slice(i, end > i ? end : i + 4000)
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
      // Kept in step with `SAFE` in invariants.test.js — the two lists check the
      // same class from opposite ends, and a rule allowed by one and not the
      // other is a decision that was only half taken. `wave` and `polarity` are
      // absent from both: each of them genuinely can name a player.
      assert.ok(['raidDamage', 'press', 'tankSwap', 'keepApart',
        'launchPad', 'elementPool', 'feed'].includes(m.rule),
        `${key}/${m.id} (spell ${m.spellId}) is 300yd raid-wide but its rule is '${m.rule}' — ` +
        'that produces a failure leaderboard naming the entire raid every pull')
    }
  }
})

// Entombed Sentinels shipped with its golems 26 yards apart against a 25-yard
// Dominance threshold — a yard outside the failure state, on a fight whose
// whole tank job is holding them at 40+. If a boss declares keepApart, its
// entities must actually start apart.
test('keepApart entities start outside their own link range', () => {
  for (const [key] of present) {
    const src = readFileSync(join('src/bosses', `${key}.ts`), 'utf8')
    const rule = src.match(/rule: \{ type: 'keepApart', minYards: (\d+) \}/)
    if (!rule) continue
    const min = Number(rule[1])
    const ents = [...src.matchAll(/start: \{ x: (-?\d+(?:\.\d+)?), y: (-?\d+(?:\.\d+)?) \}(.*)/g)]
      .filter(m => !/untargetable: true/.test(m[3]))
      .map(m => ({ x: Number(m[1]), y: Number(m[2]) }))
    assert.ok(ents.length > 1, `${key} declares keepApart but has fewer than two targetable entities`)
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        const d = Math.hypot(ents[i].x - ents[j].x, ents[i].y - ents[j].y)
        assert.ok(d >= min, `${key}: two entities start ${d.toFixed(1)}yd apart but link at ${min}yd — ` +
          'the fight would open already inside its own failure state')
      }
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
