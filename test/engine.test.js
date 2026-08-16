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

// A split child is what an add BECOMES, not something the room sends at you.
//
// The wave timer excluded set-piece and summoned adds but never split targets,
// so Vashnik's "Clotting Venom split" arrived off the rim on a timer, at the
// generic spawn radius, with no parent — an add whose entire meaning is "you
// killed the thing that made me" appearing when nothing had been killed.
//
// Checked on a running pull rather than by matching the filter expression: the
// source-text version of this check broke the moment a third exclusion was added
// to the same line, which is a test failing because the code got MORE correct.
test('split children only ever arrive from their parent dying', async () => {
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'vashnik')
  const parents = (boss.adds ?? []).filter(a => a.splits)
  assert.ok(parents.length > 0, 'vashnik no longer declares a splitting add — check is vacuous')
  const childIds = new Set(parents.map(a => a.splits.intoId))

  seedRng(1337)
  const w = createWorld(boss, 'dps', 'green')
  const input = {
    up: false, down: false, left: false, right: false, pressed: [], aim: null, firing: true,
  }

  let orphans = 0
  let fromParent = 0
  for (let i = 0; i < 60 * 300; i++) {
    // Keep the pull running. This is a test of the WAVE SCHEDULER, not of
    // survival, and a stationary player dies to Vashnik at 40 seconds — long
    // before the timer has cycled far enough down the add list to reach a split
    // child. With the defect reinstated the pull has to reach ~100s before the
    // first orphan appears, so a check that ends when the player does silently
    // measures nothing and reports success.
    w.player.alive = true
    w.player.health = 1
    w.raidHealth = 1
    for (const b of w.bosses) { b.alive = true; b.hp = Math.max(b.hp, 0.5) }
    const before = new Set(w.adds.map(a => a.uid))
    // Positions, not just identities. "Did any parent die this tick" is too
    // loose: a Clotting Venom LEAKING into the pool also clears its `alive` flag,
    // so a rim-spawned orphan arriving on the same tick was being waved through
    // as legitimate — the check passed with the defect reinstated. A real split
    // is fanned within a few yards of the corpse (`spawnAdds(..., at = add.pos)`),
    // and a rim spawn is out at `spawnRadius`, so position separates them cleanly.
    const parentsBefore = w.adds
      .filter(a => a.alive && a.def.splits)
      .map(a => ({ uid: a.uid, x: a.pos.x, y: a.pos.y }))
    // Shoot the splitting add on sight. The shipped bot targets adds by fuse and
    // cannot kill a Clotting Venom before it crawls into the pool, so a default
    // pull produces no splits at all and this check would measure nothing — the
    // vacuity guard below caught exactly that.
    const parent = w.adds.find(a => a.alive && a.def.splits)
    input.aim = parent ? { x: parent.pos.x, y: parent.pos.y } : null
    step(w, input, TICK_MS)
    // Alive-only. A parent killed by a SHOT is flagged dead in the shot loop but
    // not spliced out of `w.adds` until the next tick's stepAdds — so a membership
    // test alone reports the parent as still present on the exact tick its halves
    // appear, which is every legitimate split.
    // Alive-only. A parent killed by a SHOT is flagged dead in the shot loop but
    // not spliced out of `w.adds` until the next tick's stepAdds, so a membership
    // test alone reports it as still present on the exact tick its halves appear.
    const now = new Set(w.adds.filter(a => a.alive).map(a => a.uid))
    const corpses = parentsBefore.filter(p => !now.has(p.uid))
    for (const a of w.adds) {
      if (before.has(a.uid) || !childIds.has(a.def.id)) continue
      const born = corpses.some(c => Math.hypot(a.pos.x - c.x, a.pos.y - c.y) < 8)
      if (born) fromParent++
      else orphans++
    }
  }

  assert.ok(fromParent + orphans > 0,
    'no split child appeared in a whole pull — the check would pass without measuring anything')
  assert.equal(orphans, 0,
    `${orphans} split children spawned with no parent dying (and ${fromParent} legitimately). ` +
    'The wave timer is dealing out the pieces of an add as though they were trash')
})

// Red adds come from the red fountain. Orange from orange, purple from purple.
//
// That is the fight's whole vocabulary — the raid calls "orange and purple are
// up" and knows from that alone what is walking at the Cavity and from where —
// and the wave timer was quietly breaking it, dealing the same three venoms out
// on a 26-second cadence from the generic spawn ring. Venoms from nowhere in
// particular, attached to no drink, in a colour nobody had called.
test('a fountain add only ever arrives out of its own fountain', async () => {
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'vashnik')
  assert.ok(boss.altars?.length, 'vashnik no longer declares altars — check is vacuous')
  const home = Object.fromEntries(boss.altars.map(a => [a.addId, a]))

  seedRng(1337)
  const w = createWorld(boss, 'dps', 'green')
  const input = {
    up: false, down: false, left: false, right: false, pressed: [], aim: null, firing: true,
  }

  const seen = new Set()
  let atPlinth = 0
  const strays = []
  for (let i = 0; i < 60 * 200; i++) {
    // Testing the SCHEDULER. A stationary player dies to Vashnik in about a
    // minute, long before the wave timer has cycled far enough to show this.
    w.player.alive = true
    w.player.health = 1
    w.raidHealth = 1
    step(w, input, TICK_MS)
    for (const a of w.adds) {
      if (seen.has(a.uid)) continue
      seen.add(a.uid)
      const altar = home[a.def.id]
      if (!altar) continue
      // Spawned in a tight fan around the plinth it came out of.
      const d = Math.hypot(a.pos.x - altar.pos.x, a.pos.y - altar.pos.y)
      if (d < 12) atPlinth++
      else strays.push(`${a.def.name} (${altar.colour}) ${d.toFixed(0)}yd from its plinth`)
    }
  }

  assert.ok(atPlinth + strays.length > 0,
    'no fountain add spawned in a whole pull — the check would measure nothing')
  assert.equal(strays.length, 0,
    `${strays.length} fountain adds arrived from somewhere other than their own plinth ` +
    `(${atPlinth} correctly): ${strays.slice(0, 3).join('; ')}. The colour is how the raid ` +
    'calls this fight, and an add that ignores it is a call nobody can make')
})

// Hungering Pyre and Slithering Flame are ONE ability, and the tactic file puts
// both halves in a single sentence: "a 10yd Fire soak circle that splits among
// everyone inside; anyone who misses it gets Slithering Flame". So the flame is
// not something that happens to you on a rota — it is what standing outside the
// circle gets you, and it is the fight's only torch.
//
// Two things have to hold, and only playing it can show either. Stack and you
// are clean. And whatever you are carrying, you are never told to BURN THE
// CORPSE unless it can actually burn one — this fight carries two things and
// Essence Rend is not a torch, which used to produce ten unbroken seconds of an
// instruction the player had no way to follow.
test('the flame comes from missing the stack, and only a torch says burn', async () => {
  const { createWorld, step, seedRng, TICK_MS, isInside, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'nekzali')
  const pyreDef = boss.mechanics.find(m => m.onMiss)
  assert.ok(pyreDef, 'nothing on Nek\'zali hands you anything for missing it — check is vacuous')
  const torch = pyreDef.onMiss.defId

  let stacked = 0
  let missed = 0
  let flameWhileStacked = 0
  let falseBurn = 0

  for (const role of ['tank', 'healer', 'dps']) {
    seedRng(1337)
    const w = createWorld(boss, role, 'green')
    const input = {
      up: false, down: false, left: false, right: false, pressed: [], aim: null, firing: true,
    }
    for (let i = 0; i < 60 * 220; i++) {
      // Testing the mechanic, not survival — the intermission is well past the
      // point a stationary player lives to on this fight.
      w.player.alive = true
      w.player.health = 1
      w.raidHealth = 1
      const pyre = w.instances.find(x => !x.resolved && x.def.id === pyreDef.id)
      const insideBefore = pyre ? isInside(pyre, w.player.pos) : null
      const hadTorch = !!w.player.carrying[torch]
      step(w, input, TICK_MS)
      if (pyre && pyre.resolved) {
        if (insideBefore) {
          stacked++
          if (!hadTorch && w.player.carrying[torch]) flameWhileStacked++
        } else missed++
      }
      if (w.prompt?.verb === 'BURN THE CORPSE' && !w.player.carrying[torch]) falseBurn++
    }
  }

  assert.ok(stacked > 0 && missed > 0,
    `the soak resolved ${stacked} stacked and ${missed} missed across three roles — both ` +
    'outcomes have to occur or this measures only one of them')
  assert.equal(flameWhileStacked, 0,
    `${flameWhileStacked} flames were handed to a player who WAS in the circle. Standing in ` +
    'it is the whole answer; being punished for it teaches the opposite')
  assert.equal(falseBurn, 0,
    `${falseBurn} ticks told the player to burn a corpse while they carried no torch. ` +
    'Nek\'zali carries two things and only one of them is fire')
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
