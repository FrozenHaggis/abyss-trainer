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
