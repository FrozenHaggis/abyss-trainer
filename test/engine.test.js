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

/** Nothing pressed, nothing held, no shots. The neutral input for a probe. */
const IDLE = () => ({
  up: false, down: false, left: false, right: false, pressed: [], aim: null, firing: false,
})

// ── The Lost Explorers' four new primitives ──────────────────────────────────
//
// Every one of these is a rule the engine did not have a fortnight ago, and none
// of them can be read off the boss file: they are states that only exist part way
// through a pull. The source-text guards in trace.test.js say the code does not
// contain the wrong thing; these say it does the right one.

test('a fish empties the bar and empowers exactly one explorer, once', async () => {
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'explorers')
  const feedDef = boss.mechanics.find(m => m.rule.type === 'feed')
  assert.ok(feedDef, 'the Explorers no longer declare a feed — this check would be vacuous')

  seedRng(1337)
  const w = createWorld(boss, 'dps', 'green')
  const input = IDLE()

  // Hand the player a fish and let the bar climb, so the reset is measurable
  // rather than a reset from zero to zero.
  w.fishCarried = true
  w.bossEnergy = 62
  const targets = w.bosses.filter(b => !b.def.untargetable)
  assert.equal(targets.length, 3, 'the council is no longer three bodies')
  const mark = targets[1]

  // Walk to that one body. Nothing else is touched: which boss eats it is
  // decided purely by where the player is standing, which is the mechanic.
  let fed = false
  for (let i = 0; i < 60 * 60 && !fed; i++) {
    const dx = mark.pos.x - w.player.pos.x, dy = mark.pos.y - w.player.pos.y
    input.right = dx > 0.5; input.left = dx < -0.5
    input.down = dy > 0.5; input.up = dy < -0.5
    step(w, input, TICK_MS)
    if (!w.fishCarried) fed = true
  }

  assert.ok(fed, 'a player who walked into an explorer holding a fish never fed it — the ' +
    'delivery is positional and there is no button, so if walking in does not work nothing does')
  assert.ok(w.bossEnergy < 20,
    `the bar sat at ${w.bossEnergy.toFixed(0)} after a fish was fed. Emptying it is the only ` +
    'thing three fish are ever spent on')
  assert.equal(w.fishSpent, 1, 'the fish was delivered but not counted')
  assert.ok(mark.empowered, 'the explorer that ate the fish was not empowered')
  assert.equal(w.bosses.filter(b => b.empowered).length, 1,
    'feeding one explorer empowered more than one. Each fish buys exactly one body')

  // ── and it cannot be spent on the same body twice ──
  // Assumption B: an explorer that has eaten refuses the fish and you keep it.
  // Without that a misclick on a three-body council is an unrecoverable wipe.
  w.fishCarried = true
  w.bossEnergy = 70
  const spentBefore = w.fishSpent
  for (let i = 0; i < 60 * 20; i++) {
    const dx = mark.pos.x - w.player.pos.x, dy = mark.pos.y - w.player.pos.y
    input.right = dx > 0.5; input.left = dx < -0.5
    input.down = dy > 0.5; input.up = dy < -0.5
    step(w, input, TICK_MS)
  }
  assert.ok(w.fishCarried,
    'an explorer that had already eaten took a second fish. Each boss empowers once, so the ' +
    'fish would have been destroyed for nothing and the bar would be one reset short')
  assert.equal(w.fishSpent, spentBefore, 'a rejected feed was still counted as spent')
  assert.ok(w.bossEnergy > 20,
    'a rejected feed still emptied the bar — the refusal has to cost the reset too')
  // Scoped to the fish's own id rather than the whole board: the loop is still
  // running underneath this probe, so a total would be measuring Shell Spin.
  assert.ok(!w.failures.has(feedDef.id),
    'walking a fish into the wrong body was recorded as a failure. It is a walk back, not a mistake')
})

test('an element comes off in the opposite pool and in no other', async () => {
  const { createWorld, step, seedRng, TICK_MS, fire, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'explorers')
  const pol = boss.mechanics.find(m => m.rule.type === 'polarity')
  assert.ok(pol, 'the Explorers no longer declare a polarity — this check would be vacuous')
  const fireDef = boss.mechanics.find(m => m.id === pol.rule.firePoolId)
  const frostDef = boss.mechanics.find(m => m.id === pol.rule.frostPoolId)

  // Standing in your OWN element must do nothing at all. If it cured, every
  // carrier would clear themselves on the pool they are dripping and the trade
  // between the two carriers — the entire mechanic — would never happen.
  for (const [carry, own, cure] of [['fire', fireDef, frostDef], ['frost', frostDef, fireDef]]) {
    seedRng(1337)
    const w = createWorld(boss, 'dps', 'green')
    const input = IDLE()
    w.player.element = carry
    w.player.elementMs = 60000
    fire(w, own.id, { ...w.player.pos })
    for (let i = 0; i < 60 * 6; i++) step(w, input, TICK_MS)
    assert.equal(w.player.element, carry,
      `a ${carry} carrier standing in a ${carry} pool was cleansed by it. Your own element is ` +
      'inert — trading ground with the carrier holding the other one is the mechanic')

    fire(w, cure.id, { ...w.player.pos })
    let cleaned = false
    for (let i = 0; i < 60 * 6 && !cleaned; i++) {
      step(w, input, TICK_MS)
      if (!w.player.element) cleaned = true
    }
    assert.ok(cleaned,
      `a ${carry} carrier standing in a ${cure.rule.element} pool was not cleansed. The opposite ` +
      'element is the ONLY cure, so if it does not work the debuff has no answer at all')
    assert.equal(w.player.elementMs, 0, 'the element was cleared but its timer was not')
    for (const id of [pol.id, own.id, cure.id]) {
      assert.ok(!w.failures.has(id),
        `'${id}' put a name on the board. Being handed an element is being chosen, not being ` +
        'wrong, and the cure is the correct play — neither can ever be a failure')
    }
  }
})

test('a second volley kills a carrier who never traded, and spares one who did', async () => {
  const { createWorld, step, seedRng, TICK_MS, fire, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'explorers')
  const pol = boss.mechanics.find(m => m.rule.type === 'polarity')
  const death = boss.mechanics.find(m => m.id === pol.rule.deathId)
  assert.ok(death, 'the polarity no longer names a death — assumption G would be unenforced')

  // Assumption G: the marker lasts until the next volley, and a volley landing
  // on an uncleansed carrier detonates. The death belongs to Elemental
  // Explosion — the Deadly id — exactly as a Mutilate death belongs to the Gash.
  // Frostfire Volley only exists on an EMPOWERED Iku — `fire()` gates it, so a
  // probe that skips the empowerment is quietly firing nothing and would report
  // "the carrier survived" for a volley that never happened.
  const empower = (w) => {
    const iku = w.bosses.find(b => b.def.id === pol.empoweredOnly)
    assert.ok(iku, `the polarity is gated on '${pol.empoweredOnly}', which is not an entity`)
    iku.empowered = true
  }

  seedRng(1337)
  const dirty = createWorld(boss, 'dps', 'green')
  empower(dirty)
  dirty.player.element = 'fire'
  dirty.player.elementMs = 60000
  fire(dirty, pol.id)
  assert.ok(dirty.instances.some(i => i.def.id === pol.id),
    'firing the volley produced no instance — the empowerment gate is still shut and this ' +
    'check would pass without a volley ever landing')
  for (let i = 0; i < 60 * 10 && dirty.player.alive; i++) step(dirty, IDLE(), TICK_MS)
  assert.equal(dirty.player.alive, false,
    'a carrier who never cleansed walked into a second Frostfire Volley and lived. The trade ' +
    'is the mechanic, and a mechanic with no consequence for skipping it is decoration')
  assert.equal(dirty.deathCause, death.name,
    `the death was attributed to '${dirty.deathCause}' rather than to ${death.name}. The volley ` +
    'is a cast marker and can never name anybody; the detonation is the Deadly id that can')

  // And the same volley on a clean body is survivable — otherwise the check
  // above would pass on an engine that simply kills everyone.
  seedRng(1337)
  const clean = createWorld(boss, 'dps', 'green')
  empower(clean)
  clean.player.element = null
  clean.player.elementMs = 0
  fire(clean, pol.id)
  for (let i = 0; i < 60 * 10; i++) step(clean, IDLE(), TICK_MS)
  assert.ok(clean.player.alive,
    'a carrier who HAD traded was killed by the next volley anyway. Cleansing has to be worth ' +
    'doing, or the pool trade is a ritual with no payoff')
})

test('a blast wave passes under an airborne player and kills a grounded one', async () => {
  const { createWorld, step, seedRng, TICK_MS, fire, isInside, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'explorers')
  const wave = boss.mechanics.find(m => m.rule.type === 'wave')
  const pad = boss.mechanics.find(m => m.rule.type === 'launchPad')
  assert.ok(wave && pad, 'the Explorers no longer declare a wave and a mushroom')
  assert.ok(wave.lethal, 'Blast Wave is no longer lethal — this check would measure nothing')

  // Both runs are identical except for the mushroom. Anything else that differed
  // would make the comparison meaningless.
  const run = (aloft) => {
    seedRng(1337)
    const w = createWorld(boss, 'dps', 'green')
    fire(w, wave.id, { x: w.player.pos.x, y: w.player.pos.y })
    const inst = w.instances.find(i => i.def.id === wave.id)
    assert.ok(inst, 'firing the wave produced no instance')
    assert.ok(isInside(inst, w.player.pos),
      'the wave did not cover the player, so neither run would measure the exemption')
    for (let i = 0; i < 60 * 8; i++) {
      // Topped up every tick: `aloft` ticks down, and the point is to be off the
      // floor AT the moment it passes.
      if (aloft) w.player.aloft = Math.max(w.player.aloft, pad.rule.launchMs)
      step(w, IDLE(), TICK_MS)
    }
    return w
  }

  const grounded = run(false)
  assert.equal(grounded.player.alive, false,
    'a player standing in a Blast Wave on the floor survived it. It is the deadliest ID in ' +
    'the fight and the shape is deliberately too wide to outrun')
  assert.equal(grounded.deathCause, wave.name, 'the wave killed without saying what happened')

  const airborne = run(true)
  assert.ok(airborne.player.alive,
    'a player airborne on a Bouncy Mushroom was still killed by the Blast Wave. Being off the ' +
    'floor is the ONLY answer the fight has, and if it does not work the mechanic is unwinnable')
  assert.ok(!airborne.failures.has(wave.id) && !airborne.failures.has(pad.id),
    'answering the wave correctly was recorded as a failure. Being airborne IS the answer, ' +
    'and touching the mushroom that put you there can never be scored')
  assert.ok(grounded.failures.has(wave.id),
    'a player killed on the floor by the Blast Wave left nothing on the failure board. It is ' +
    'the one thing in this fight the debrief most has to be able to explain')
})

test('United Defense links the council only while ALL THREE are close', async () => {
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'explorers')
  const apart = boss.mechanics.find(m => m.rule.type === 'keepApart')
  assert.ok(apart, 'the Explorers no longer declare a keepApart — this check would be vacuous')
  const min = apart.rule.minYards

  seedRng(1337)
  const w = createWorld(boss, 'dps', 'green')
  const bodies = w.bosses.filter(b => !b.def.untargetable)
  assert.equal(bodies.length, 3, 'United Defense is not being judged across three bodies')

  // The engine reads a stage's convergence and the patrol on the same tick it
  // reads this, so each arrangement is asserted on the tick after it is set.
  const place = (positions) => {
    positions.forEach((p, i) => {
      bodies[i].pos = { ...p }
      bodies[i].station = { ...p }
      // Gebbo's patrol would walk him straight back out of any arrangement,
      // which is the whole point of his circle — suspended for the probe.
      bodies[i].def = { ...bodies[i].def, patrol: undefined, stationary: true }
    })
    step(w, IDLE(), TICK_MS)
    return w.bossesLinked
  }

  // Two of them nose to nose and the third across the room. Under an all-pairs
  // MINIMUM this links, which is the bug: a patrolling Gebbo drifting past one
  // tanked explorer would hand the council 99% damage reduction for something no
  // tank could have prevented.
  assert.equal(
    place([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 44 }]), false,
    'two explorers standing on each other linked the council while the third was 44 yards ' +
    'away. "All three within 30" is the WIDEST pair, not the closest — under the closest ' +
    'reading Gebbo brushing past one tank is enough, and assumption F says a link is a ' +
    "tank's fault or it is not a mechanic")

  // Now all three inside the threshold. This is the failure state.
  assert.equal(
    place([{ x: 0, y: 0 }, { x: min * 0.4, y: 0 }, { x: 0, y: min * 0.4 }]), true,
    'all three explorers stood inside the link range and United Defense did not fire. The 99% ' +
    'damage reduction is the consequence the tanks are being taught to prevent')

  // And one tank walking ONE body out is enough to break it — under the minimum
  // reading it would take both.
  assert.equal(
    place([{ x: 0, y: 0 }, { x: min * 0.4, y: 0 }, { x: 0, y: min + 12 }]), false,
    'pulling a single explorer clear did not break the link. One tank walking one body out ' +
    'has to be enough, or the answer to the mechanic needs two people to agree on a tick')
})

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

// ── The scheduler ────────────────────────────────────────────────────────────
//
// `timeline` is the first thing in this engine that fires a mechanic off
// anything other than the shared round-robin, and every one of its failure modes
// is quiet. A period that drifts, a cast that is ALSO dealt by the loop, an entry
// that gets staged in by `introEverySec` after it has already named its own first
// cast, an event gate that never re-arms — none of them throw, and all of them
// read as the fight simply having a different rhythm from the one written down.

/**
 * Watch a pull and record every cast, by id and by the second it happened.
 *
 * Instances carry no birth timestamp, so this keys off the monotonic uid: an
 * instance the watcher has not seen before was created since the last poll.
 */
function castWatcher() {
  let top = -1
  const casts = []
  return {
    casts,
    poll(w) {
      for (const i of w.instances) {
        if (i.uid <= top) continue
        casts.push({ id: i.def.id, at: w.elapsedMs / 1000 })
      }
      for (const i of w.instances) if (i.uid > top) top = i.uid
    },
    /** Seconds at which `id` was cast, one entry per cast rather than per copy. */
    times(id) {
      const out = []
      for (const c of this.casts) {
        if (c.id !== id) continue
        // A fan is `count` instances born on the same tick; the fan is one cast.
        if (out.length && Math.abs(out[out.length - 1] - c.at) < 0.05) continue
        out.push(c.at)
      }
      return out
    },
  }
}

/**
 * Hold the pull open.
 *
 * `step` freezes the clock the moment the player dies or the raid falls over,
 * which for a probe about WHEN something fires is not a result — it is the
 * instrument switching itself off part way through. An idle dps is dead to the
 * second Shell Spin at six seconds, so a scheduler test written without this
 * measured the first thirty-five seconds of the fight and reported the rest as
 * "never happened". These probes are about the scheduler and the scoring; the
 * balance sweep is where survival is measured.
 */
function immortal(w) {
  w.player.health = 1
  w.player.alive = true
  w.raidHealth = 1
}

/** Run a pull with nothing pressed and nothing dodged, polling the watcher. */
function idlePull(sim, w, seconds, watcher) {
  const { step, TICK_MS } = sim
  const ticks = Math.round((seconds * 1000) / TICK_MS)
  for (let i = 0; i < ticks; i++) {
    immortal(w)
    step(w, IDLE(), TICK_MS)
    immortal(w)
    watcher.poll(w)
  }
}

test('a timeline mechanic fires on its own clock, and the loop never deals it', async () => {
  const sim = await engine()
  const { createWorld, seedRng, BOSSES } = sim
  const boss = BOSSES.find(b => b.key === 'explorers')
  assert.ok(boss.timeline?.length, 'the Explorers no longer declare a timeline — vacuous')

  for (const t of boss.timeline) {
    assert.ok(!boss.loop.includes(t.id),
      `'${t.id}' is on the timeline AND in the loop, so it fires twice a cycle`)
    assert.ok(boss.mechanics.some(m => m.id === t.id),
      `the timeline schedules '${t.id}', which is not a mechanic on this boss`)
  }

  seedRng(1337)
  const w = createWorld(boss, 'dps', 'green')
  // No fish is ever found, so no explorer is ever empowered and the event-gated
  // entry stays dormant. This test is about the two entries on a CLOCK.
  w.fishFound = 99
  const watch = castWatcher()
  idlePull(sim, w, 72, watch)

  for (const id of ['shellspin', 'blinknova']) {
    const entry = boss.timeline.find(t => t.id === id)
    assert.ok(entry?.everySec, `${id} is no longer a periodic timeline entry — vacuous`)
    const at = watch.times(id)
    const want = []
    for (let t = entry.startSec; t <= 71; t += entry.everySec) want.push(t)
    assert.equal(at.length, want.length,
      `${id} fired ${at.length} times in 72s (at ${at.map(x => x.toFixed(1))}), but its ` +
      `timeline says every ${entry.everySec}s from t=${entry.startSec} — ${want.length} casts`)
    for (let i = 0; i < want.length; i++) {
      assert.ok(Math.abs(at[i] - want[i]) < 0.1,
        `${id} cast #${i + 1} landed at ${at[i].toFixed(2)}s, not ${want[i]}s. A period re-armed ` +
        'from "now" rather than from the appointment drifts by a frame every cast')
    }
  }
})

test('a timeline entry bypasses intro staging while the loop still stages', async () => {
  const sim = await engine()
  const { createWorld, seedRng, BOSSES } = sim
  const boss = BOSSES.find(b => b.key === 'explorers')
  const intro = boss.introEverySec
  assert.ok(intro > 0, 'the Explorers no longer stage their loop — vacuous')

  seedRng(1337)
  const w = createWorld(boss, 'dps', 'green')
  w.fishFound = 99
  const watch = castWatcher()
  idlePull(sim, w, 12, watch)

  // The loop is still staged: unlockedCount() is 2 + floor(elapsed/introEverySec),
  // so nothing past that index can have been dealt yet.
  let staged = 0
  for (const c of watch.casts) {
    const idx = boss.loop.indexOf(c.id)
    if (idx < 0) continue                     // timeline, ambient, or a spawn
    staged++
    const unlocked = Math.min(boss.loop.length, 2 + Math.floor(c.at / intro))
    assert.ok(idx < unlocked,
      `loop entry '${c.id}' (index ${idx}) was dealt at ${c.at.toFixed(1)}s, when only ` +
      `${unlocked} entries had been introduced. Staging is what stops a trainer opening with ` +
      'the whole rotation at once')
  }
  assert.ok(staged > 0, 'no loop entry was dealt at all in twelve seconds — vacuous')

  // And the timeline is NOT staged. Shell Spin is at t=5 and Blink Nova at t=10;
  // neither is in `loop` at all, so `unlockedCount` cannot index them and
  // startSec IS the introduction.
  const spin = watch.times('shellspin')
  const nova = watch.times('blinknova')
  assert.ok(spin.length && Math.abs(spin[0] - 5) < 0.1,
    `Shell Spin's first cast was at ${spin[0]}s rather than 5s. Staging applied to the timeline ` +
    'as well would push its first cast out behind the rotation')
  assert.ok(nova.length && Math.abs(nova[0] - 10) < 0.1,
    `Blink Nova's first cast was at ${nova[0]}s rather than 10s`)
})

test('an event-gated cast waits for one of its rearmOn ids to resolve', async () => {
  const sim = await engine()
  const { createWorld, seedRng, fire, BOSSES } = sim
  const boss = BOSSES.find(b => b.key === 'explorers')
  const gate = boss.timeline.find(t => t.rearmOn)
  assert.ok(gate, 'no event-gated timeline entry on the Explorers — vacuous')
  assert.ok(gate.rearmOn.anyOf.length, 'the gate names nothing that could re-arm it')

  // ── A: nothing ever resolves, so it fires once and stays dormant ──
  seedRng(1337)
  const a = createWorld(boss, 'dps', 'green')
  // No fish found means no explorer is ever empowered, and every id in `anyOf`
  // is `empoweredOnly` — so nothing that could arm it can even be cast.
  a.fishFound = 99
  const wa = castWatcher()
  idlePull(sim, a, 120, wa)
  const solo = wa.times(gate.id)
  assert.equal(solo.length, 1,
    `${gate.id} fired ${solo.length} times (at ${solo.map(x => x.toFixed(1))}) in a pull where ` +
    'nothing that arms it ever resolved. An event gate that re-arms on its own is a clock')
  assert.ok(Math.abs(solo[0] - gate.startSec) < 0.1,
    `${gate.id}'s one cast was at ${solo[0]}s rather than its startSec of ${gate.startSec}s`)

  // ── B: one armer resolves, and it comes back ──
  seedRng(1337)
  const b = createWorld(boss, 'dps', 'green')
  b.fishFound = 99
  const wb = castWatcher()
  // Past the first cast, and dormant.
  idlePull(sim, b, gate.startSec + 8, wb)
  assert.equal(wb.times(gate.id).length, 1, 'setup: expected exactly one cast so far')

  // Now let one of the armers actually happen. Empowering the body by hand is
  // the same state a fish buys, without needing the player to run the errand.
  const armerId = gate.rearmOn.anyOf[0]
  const armer = boss.mechanics.find(m => m.id === armerId)
  assert.ok(armer, `rearmOn names '${armerId}', which is not a mechanic here`)
  const owner = b.bosses.find(u => u.def.id === armer.from)
  owner.empowered = true
  const firedAt = b.elapsedMs / 1000
  fire(b, armerId)
  idlePull(sim, b, 40, wb)

  const after = wb.times(gate.id)
  // At least one more, not exactly one more: empowering the body by hand also
  // opens that mechanic's `empoweredOnly` gate in the LOOP, so it comes round
  // again and honestly arms the crates again. Re-arming repeatedly is the
  // fight; never re-arming at all is the defect this is here to catch.
  assert.ok(after.length >= 2,
    `${gate.id} fired ${after.length} times after '${armerId}' was cast. The whole shape of this ` +
    'fight is crates → fish → feed → empowered cast → crates, and the last arrow is this gate')
  const delay = gate.rearmOn.delaySec ?? 0
  assert.ok(after[1] >= firedAt + armer.telegraphMs / 1000 + delay - 0.1,
    `${gate.id} came back at ${after[1].toFixed(1)}s, before '${armerId}' cast at ` +
    `${firedAt.toFixed(1)}s could have resolved. The gate is the cast RESOLVING, not being cast`)
})

// ── Whose mechanic it is ─────────────────────────────────────────────────────

test('Steady Strikes is the ally tank’s job and is never scored against you', async () => {
  const sim = await engine()
  const { createWorld, step, seedRng, fire, TICK_MS, BOSSES } = sim
  const boss = BOSSES.find(b => b.key === 'explorers')
  const strikes = boss.mechanics.find(m => m.id === 'strikes')
  assert.ok(strikes, 'Steady Strikes has gone from the Explorers — vacuous')
  assert.ok(strikes.collective,
    'Steady Strikes is not `collective`. It is measured on the ally tank holding Nama, and ' +
    '`collective` is the convention this engine already has for a mechanic judged somewhere ' +
    'other than on you')

  // Not merely unscheduled — actively fired, repeatedly, in every role, with the
  // player doing nothing about it. It was inert for the whole of the last pass
  // because it happened to be in neither the loop nor the timeline, which is an
  // accident of scheduling rather than a property of the mechanic.
  for (const role of ['tank', 'healer', 'dps']) {
    seedRng(2024)
    const w = createWorld(boss, role, 'green')
    for (let rep = 0; rep < 6; rep++) {
      fire(w, 'strikes')
      for (let i = 0; i < Math.round(6000 / TICK_MS); i++) {
        immortal(w)
        step(w, IDLE(), TICK_MS)
      }
    }
    assert.ok(!w.failures.has('strikes'),
      `${role}: Steady Strikes recorded ${w.failures.get('strikes')?.count} failures against the ` +
      'player. Nama is held by an ally tank all pull — the player holds Iku and answers ' +
      'Shredding Shards, and blaming them for a stack climbing on somebody else is the ' +
      'defect this project keeps refixing')
  }
})

test('a tank is not scored for Throw Junk, and a dps still is', async () => {
  const sim = await engine()
  const { createWorld, step, seedRng, fire, TICK_MS, BOSSES } = sim
  const boss = BOSSES.find(b => b.key === 'explorers')
  const junk = boss.mechanics.find(m => m.id === 'throwjunk')
  assert.ok(junk?.rule.type === 'collect', 'Throw Junk is no longer a collect — vacuous')
  assert.deepEqual([...junk.roles].sort(), ['dps', 'healer'],
    'Throw Junk is scored for roles ' + junk.roles.join('/') + '. The player tanks Iku and ' +
    'never leaves it, and one missed crate is a literal wipe — a tank cannot be on the hook ' +
    'for a window they have no way to answer')

  const ran = {}
  for (const role of ['tank', 'dps']) {
    seedRng(1337)
    const w = createWorld(boss, role, 'green')
    // The player deliberately does nothing, and the raid is taken out of it, so
    // every crate is genuinely missed in both runs. The ONLY difference between
    // the two is who the engine is willing to charge for it.
    fire(w, 'throwjunk')
    for (const a of w.allies) a.alive = false
    for (let i = 0; i < Math.round((junk.telegraphMs + 2000) / TICK_MS); i++) {
      // Held open on purpose: an idle player is dead to the second Shell Spin
      // at six seconds, and a dead player freezes the clock four seconds short
      // of the crate window ever resolving. Without this the tank result was a
      // true statement about a window that never closed.
      immortal(w)
      step(w, IDLE(), TICK_MS)
    }
    ran[role] = w.failures.get('throwjunk')?.count ?? 0
  }
  assert.equal(ran.tank, 0,
    `a tank was charged ${ran.tank} Throw Junk failures for crates they cannot reach. ` +
    '`roles` is what says whose job a mechanic is')
  assert.ok(ran.dps > 0,
    'a dps standing still through the whole crate window was charged nothing either, so this ' +
    'test proves only that the mechanic is inert. The tank result above means nothing without it')
})

// ── The kill-pacing lever ────────────────────────────────────────────────────
//
// `maxHp` was declared on `BossDef` and read by NOTHING: the health pool scaled
// off `pullLengthSec` alone, so the one number authored to tune how long a fight
// takes to kill did not exist. It looked exactly like a tuned number — it had a
// value, a comment and a plausible magnitude — which is the worst way for a
// field to be dead.
test('maxHp actually moves the health pool', async () => {
  const sim = await engine()
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = sim
  const base = BOSSES.find(b => b.key === 'explorers')

  /** Shoot the same body for the same time and report how much came off it. */
  const burn = (boss) => {
    seedRng(1337)
    const w = createWorld(boss, 'dps', 'green')
    const mark = w.bosses.find(b => !b.def.untargetable)
    const input = { ...IDLE(), firing: true, aim: { x: mark.pos.x, y: mark.pos.y } }
    for (let i = 0; i < Math.round(20000 / TICK_MS); i++) {
      input.aim = { x: mark.pos.x, y: mark.pos.y }
      step(w, input, TICK_MS)
    }
    return 1 - mark.hp
  }

  const one = burn(base)
  const two = burn({ ...base, maxHp: base.maxHp * 2 })
  assert.ok(one > 0.02,
    `twenty seconds of fire took ${(one * 100).toFixed(1)}% off an explorer — too little to ` +
    'measure a doubling against')
  const ratio = one / two
  assert.ok(ratio > 1.6 && ratio < 2.4,
    `doubling maxHp changed the damage taken by a factor of ${ratio.toFixed(2)}, not ~2. ` +
    'The field is the fight’s kill-pacing lever and it has already shipped once as a ' +
    'number that looked tuned and was read by nothing at all')
})
