import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

// Runtime behaviour, as opposed to the source-text sweeps in the other files.
//
// Some defects cannot be read off a boss file at all: they live in the shape of
// a number the engine computes, and the only way to catch them is to run a pull
// and measure what happened. The knockback below is exactly that — every field
// involved was correct and the arithmetic between them was not.

const OUT = '.probe'

async function engine() {
  for (const [src, out] of [
    ['src/engine/sim.ts', `${OUT}/sim.mjs`],
    ['src/bosses/registry.ts', `${OUT}/registry.mjs`],
  ]) {
    buildSync({ entryPoints: [src], bundle: true, format: 'esm', outfile: out, logLevel: 'error' })
  }
  const sim = await import(`../${OUT}/sim.mjs`)
  const { BOSSES } = await import(`../${OUT}/registry.mjs`)
  return { ...sim, BOSSES }
}

// A cyst burst used to end exactly on the boss however hard it hit, because the
// step was capped at the distance to him: `min(push, distanceToBoss)`. Every
// field was right — the direction, the trigger, the fraction — and the result
// was a teleport with extra steps, which is what it was called in playtesting.
//
// So this measures the two things that were wrong. It travels the distance the
// boss file asks for, and it does NOT stop on the boss.
test('a raid knockback throws the player across the room, not onto the boss', async () => {
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'sszorak')
  const def = boss.mechanics.find(m => m.raidKnockRoom)
  assert.ok(def, 'no mechanic declares raidKnockRoom — this check would be vacuous')

  const want = boss.arenaRadius * 2 * def.raidKnockRoom
  seedRng(1337)
  const w = createWorld(boss, 'dps', 'green')
  const input = {
    up: false, down: false, left: false, right: false, pressed: [], aim: null, firing: true,
  }

  const flights = []
  let from = null
  let bossAt = null
  for (let i = 0; i < 60 * 400 && flights.length < 2 && w.player.alive; i++) {
    const before = { x: w.player.pos.x, y: w.player.pos.y }
    const was = !!w.player.knock
    step(w, input, TICK_MS)
    if (!was && w.player.knock) {
      from = before
      bossAt = { x: w.bosses[0].pos.x, y: w.bosses[0].pos.y }
    } else if (was && !w.player.knock && from) {
      flights.push({
        travelled: Math.hypot(w.player.pos.x - from.x, w.player.pos.y - from.y),
        endedFromBoss: Math.hypot(w.player.pos.x - bossAt.x, w.player.pos.y - bossAt.y),
      })
      from = null
    }
  }

  assert.ok(flights.length > 0,
    'no cyst ever burst in a full pull — the Maelstrom is not being reached, so this check ' +
    'would pass without measuring anything')

  for (const f of flights) {
    // One tick of slack: the flight runs on a fixed timestep, so the last step
    // lands a fraction short of the exact figure.
    assert.ok(Math.abs(f.travelled - want) < 2,
      `the burst carried the player ${f.travelled.toFixed(1)}yd, but the boss file asks for ` +
      `${def.raidKnockRoom} of a ${boss.arenaRadius * 2}yd room — ${want.toFixed(1)}yd`)
    // The signature of the bug: a knock that always finishes on the boss.
    assert.ok(f.endedFromBoss > 10,
      `the burst put the player ${f.endedFromBoss.toFixed(1)}yd from the boss. A knockback ` +
      'whose landing spot is fixed is not a knockback — it is a teleport, and it reads as one')
  }
})

// The wind partner used to hold a spot measured from the PLAYER — thirty yards
// along their bearing from wherever they happened to be standing. So it moved
// every time the player did: they walked at it, it walked away by exactly as
// much, and the pair drifted to the rim together with the mechanic never
// resolving. A carrot on a stick, on a platform that kills you for reaching the
// end of it.
//
// Playing it is the only way to see that, because every position involved is
// individually reasonable. So this plays it: walk straight at the partner for
// the whole window and check the two things that were wrong.
test('the wind partner holds still and can be reached', async () => {
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'sszorak')
  assert.ok(boss.mechanics.some(m => m.rule.type === 'windPair'),
    'no windPair mechanic — this check would be vacuous')

  seedRng(1337)
  const w = createWorld(boss, 'dps', 'green')
  const input = {
    up: false, down: false, left: false, right: false, pressed: [], aim: null, firing: false,
  }

  let windows = 0
  let cancelled = 0
  let drift = 0
  let worstRadius = 0
  let seen = null

  for (let i = 0; i < 60 * 300 && w.player.alive; i++) {
    const mate = w.allies.find(a => a.id === w.windPartnerId && a.wind)
    const had = !!w.player.wind
    if (mate) {
      if (!seen) { seen = { x: mate.pos.x, y: mate.pos.y }; windows++ }
      // How far the partner has wandered since it settled, and how close to the
      // edge it has taken the pair.
      drift = Math.max(drift, Math.hypot(mate.pos.x - seen.x, mate.pos.y - seen.y))
      worstRadius = Math.max(worstRadius, Math.hypot(mate.pos.x, mate.pos.y))
      // Walk straight at them, which is the input that used to fail.
      const dx = mate.pos.x - w.player.pos.x
      const dy = mate.pos.y - w.player.pos.y
      input.right = dx > 0.5; input.left = dx < -0.5
      input.down = dy > 0.5; input.up = dy < -0.5
    } else {
      input.right = input.left = input.up = input.down = false
    }
    step(w, input, TICK_MS)
    // Survived the expiry with the wind gone: the two of you cancelled.
    if (had && !w.player.wind && w.player.alive) cancelled++
    if (!mate) seen = null
  }

  assert.ok(windows > 0,
    'no Raging Crosswinds ever reached a partner in a full pull — this check would ' +
    'pass without measuring anything')
  assert.equal(cancelled, windows,
    `${cancelled} of ${windows} windows cancelled. Running at the body the fight reserved ` +
    'for you has to work — it is the instruction the fight gives')
  // Settling takes a moment, so this is about wandering rather than walking.
  assert.ok(drift < 24,
    `the partner moved ${drift.toFixed(1)}yd while the player closed on it. It is supposed ` +
    'to hold a mark, not retreat — a partner measured from the player can never be caught')
  assert.ok(worstRadius < boss.arenaRadius * 0.5,
    `the partner held ${worstRadius.toFixed(1)}yd out on a ${boss.arenaRadius}yd floor. ` +
    'Lining up must not mean standing next to an edge that kills you')
})
