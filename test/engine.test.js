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

// A tanking player with nothing to tank.
//
// `seatPlayerTank` was gated on `boss.sided`, and only one multi-entity fight in
// the raid is sided. `makeAllies` builds a second AI tank only when the player
// is NOT tanking, so on the other three the single AI tank took the primary and
// every remaining entity was left on -1. A tank rolling the Twin Fangs opened
// with `vexhul targetId=1, ithraz targetId=-1` — the player held nothing for the
// whole pull, and Ithraz was held by nobody.
//
// That is invisible until you look for it, because nothing crashes: the fight
// runs, the bar goes down, and every system keyed on `bosses[0].targetId === 0`
// — the taunt prompt, `hud.tanking`, `faceAway`, the Twin Fangs melee leash —
// silently addresses nobody. So the check is the crudest possible one, run at
// t = 0 on every fight in the raid, because the defect was a whole role being
// quietly absent rather than anything subtle about what it was doing.
test('a tanking player holds an entity on tick one', async () => {
  const { createWorld, seedRng, BOSSES } = await engine()

  const twins = BOSSES.find(b => b.key === 'twinfangs')
  assert.ok(twins && twins.entities?.length === 2, 'the Twin Fangs is no longer a two-serpent fight')

  for (const boss of BOSSES) {
    seedRng(7)
    const w = createWorld(boss, 'tank', 'green')
    // Which entities the fight asked to have a tank on: the primary, plus
    // anything held apart from it. Mirrors `makeBosses`.
    const wants = w.bosses.filter((b, i) => (i === 0 || b.def.tankedApart) && !b.def.untargetable)

    if (w.bosses.length < 2) {
      // Single-boss fights are deliberately untouched. The co-tank opens on the
      // boss and the player TAUNTS it off them — that is the tank's first job
      // here, and seating the player from the pull would delete the mechanic.
      assert.equal(w.bosses[0].targetId > 0, true,
        `${boss.key}: the co-tank should open holding the boss so the player has something ` +
        'to taunt off them')
      continue
    }

    assert.ok(w.bosses.some(b => b.targetId === 0),
      `${boss.key}: a player who picked tank holds nothing on tick one — ` +
      w.bosses.map(b => `${b.def.id}:${b.targetId}`).join(' '))
    assert.equal(w.bosses[0].targetId === 0 || !!w.boss.sided, true,
      `${boss.key}: the player holds something other than the primary on a fight with no sides`)

    // And nobody is holding two at once. Two tanks, two hands: if the displaced
    // ally is handed an entity they are already on, one of them is untanked and
    // the other is being walked to two places.
    const holders = w.bosses.filter(b => b.targetId !== -1).map(b => b.targetId)
    assert.equal(new Set(holders).size, holders.length,
      `${boss.key}: one tank is holding two entities — ` +
      w.bosses.map(b => `${b.def.id}:${b.targetId}`).join(' '))

    // Every entity the fight wanted tanked is tanked, up to the two tanks that
    // exist. This is the half that catches the opposite mistake: seating the
    // player by orphaning somebody else.
    const tanked = wants.filter(b => b.targetId !== -1).length
    assert.equal(tanked, Math.min(2, wants.length),
      `${boss.key}: ${wants.length} entities want a tank and ${tanked} have one — ` +
      w.bosses.map(b => `${b.def.id}:${b.targetId}`).join(' '))
  }
})
