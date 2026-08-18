import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The boss picker's art, checked against the fight it claims to show.
//
// None of this can be checked at runtime. `public/models/` is gitignored, CI
// never downloads it, and the selector is built to fall back silently when the
// art is absent — which means a wrong NPC id ships green, deploys green, and is
// only ever caught by somebody looking at the barrel and thinking "that is not
// Nama". Every rule below is a claim the source makes about itself, so the text
// is what gets read.
//
// The claim being defended is the one in the fetch script's own comment: where
// a fight NAMES its bodies, the models are the bodies it names. Four of the
// eight encounters declare an `entities` array because the sim has to place
// more than one thing on the floor; those four are checkable, and they are
// exactly the four whose staging this change added. The other four are single
// bosses whose file declares no entity at all — the engine synthesises one at
// the centre — so there is nothing in the repository to check their display
// against, and the test says so rather than pretending otherwise.

const FETCH = readFileSync('scripts/fetch-boss-models.mjs', 'utf8')
const STAGING = readFileSync('src/ui/barrel/staging.ts', 'utf8')
const REGISTRY = readFileSync('src/bosses/registry.ts', 'utf8')

const BOSS_FILES = readdirSync('src/bosses')
  .filter(f => f.endsWith('.ts') && f !== 'registry.ts')
  .map(f => f.replace('.ts', ''))

/**
 * The fetch script's roster, as `{ bossKey: [{ id, npc }] }`.
 *
 * Parsed rather than imported because importing it would run it, and running it
 * downloads a hundred megabytes from Wowhead. A test suite does not get to do
 * that.
 */
function roster() {
  const out = {}
  // Each encounter is `{ key: 'x', creatures: [ ... ] }`, and the creature list
  // runs to the closing `] }`.
  const blocks = FETCH.matchAll(/\{\s*key:\s*'([a-z]+)',\s*creatures:\s*\[([\s\S]*?)\]\s*\}/g)
  for (const [, key, body] of blocks) {
    out[key] = [...body.matchAll(/\{\s*id:\s*'([a-z]+)'[\s\S]*?npc:\s*(\d+)/g)]
      .map(([, id, npc]) => ({ id, npc: Number(npc) }))
  }
  return out
}

/**
 * The npcIds a boss file declares in its `entities` array, or null when it has
 * none.
 *
 * Deliberately NOT every `npcId:` in the file. Adds carry them too, and a test
 * that accepted any of them would happily pass a roster that downloaded an add
 * instead of the boss.
 */
function entityNpcsOf(bossKey) {
  const src = readFileSync(join('src/bosses', `${bossKey}.ts`), 'utf8')
  const block = src.match(/entities:\s*\[([\s\S]*?)\n {2}\],/)
  if (!block) return null
  return new Set([...block[1].matchAll(/npcId:\s*(\d+)/g)].map(([, n]) => Number(n)))
}

test('every boss in the raid has models to download', () => {
  const have = roster()
  for (const key of BOSS_FILES) {
    assert.ok(have[key], `${key} has a boss file but no entry in fetch-boss-models.mjs`)
    assert.ok(have[key].length > 0, `${key} downloads no creatures`)
  }
  for (const key of Object.keys(have)) {
    assert.ok(BOSS_FILES.includes(key), `fetch-boss-models.mjs downloads '${key}', which is not a boss`)
  }
})

test('the picker and the registry agree on the raid', () => {
  // The registry is the list the app actually renders, so a boss file that
  // exists but was never wired in would otherwise pass the test above and then
  // never appear on the barrel.
  for (const key of Object.keys(roster())) {
    assert.match(REGISTRY, new RegExp(`\\b${key}\\b`), `${key} is downloaded but not in the registry`)
  }
})

test('every downloaded creature is one the fight declares', () => {
  // This is the point of the suite. An NPC id in the fetch script that is not
  // in the fight's own entity list is a creature somebody looked up by hand,
  // and the two lists have started to drift.
  const checked = []
  for (const [key, creatures] of Object.entries(roster())) {
    const declared = entityNpcsOf(key)
    if (declared === null) continue // single-boss fight; nothing to check against
    checked.push(key)
    for (const { id, npc } of creatures) {
      assert.ok(declared.has(npc),
        `${key}/${id} downloads npc ${npc}, which is not in ${key}.ts's entities — ` +
        'either the fight does not contain it or the boss file has moved on')
    }
  }

  // Guards the guard, and counts ENCOUNTERS rather than creatures. Creatures
  // would be the wrong unit: the Lost Explorers declares four entities and
  // stages one of them, so a count of bodies is a number that moves whenever
  // somebody restages a slot, and a test that has to be edited for a cosmetic
  // change is a test people learn to edit without reading. What must not change
  // is that all four entity-declaring fights got looked at — if the `entities`
  // regex stops matching, every one becomes "nothing to check against" and the
  // suite goes hollow while still passing.
  assert.deepEqual(checked.sort(), ['coiledaltar', 'explorers', 'sentinels', 'twinfangs'],
    'the set of fights that declare entities has changed, or the regex stopped matching')
})

test('staging only stages creatures that were downloaded', () => {
  // `STAGING` names creatures by directory. A typo here is not a compile error,
  // it is a 404 at load time and a slot that silently keeps its loading shard.
  const have = roster()
  const blocks = STAGING.matchAll(/^\s{2}([a-z]+):\s*\[([\s\S]*?)^\s{2}\],/gm)
  let staged = 0
  for (const [, key, body] of blocks) {
    assert.ok(have[key], `staging lists '${key}', which downloads nothing`)
    const ids = new Set(have[key].map(c => c.id))
    for (const [, id] of body.matchAll(/id:\s*'([a-z]+)'/g)) {
      staged++
      assert.ok(ids.has(id), `staging puts '${id}' on ${key}, which downloads [${[...ids]}]`)
    }
  }
  assert.ok(staged > 0, 'no staging entries parsed — the regex has stopped matching the file')
})

test('every multi-creature encounter is staged', () => {
  // Downloading two bodies and staging neither is the failure this catches: the
  // fallback in `loadBossScene` would put both at the origin, inside each other,
  // because nothing told it where the second one goes.
  for (const [key, creatures] of Object.entries(roster())) {
    if (creatures.length < 2) continue
    assert.match(STAGING, new RegExp(`^\\s{2}${key}:\\s*\\[`, 'm'),
      `${key} downloads ${creatures.length} creatures but has no staging entry`)
  }
})
