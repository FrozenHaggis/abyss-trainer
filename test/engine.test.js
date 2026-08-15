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

// ── the stack economy ────────────────────────────────────────────────────────

const NO_INPUT = () => ({
  up: false, down: false, left: false, right: false, pressed: [], aim: null, firing: false,
})

/**
 * A Twin Fangs drill with exactly one Spawn of Vexhul alive and exactly one
 * Corrosive Spit in the air, aimed at an ally, with the player standing in it.
 *
 * The player is a TANK on purpose. A fixate never picks one, so the player is
 * always the BYSTANDER — which is the half of the cast that is charged a stack,
 * and therefore the half that has to stop being charged when the caster dies.
 * Rolled as a dps the player would be the marked target every time, and a marked
 * target is never billed for their own line, so the whole thing would pass
 * whatever the engine did.
 *
 * The drill is used rather than a pull because it isolates the claim: no loop,
 * no ambient venom, no energy bar, and the casting add is the only thing on the
 * field. Anything the player's count does here, this cast did.
 */
async function loneSpit(seed) {
  const { createDrill, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const spit = boss.mechanics.find(m => m.id === 'spit')
  assert.ok(spit?.applies?.hit, 'Corrosive Spit no longer applies a stack — this check would be vacuous')

  seedRng(seed)
  const w = createDrill(boss, 'tank', 'spit')
  const input = NO_INPUT()

  let inst = null
  for (let i = 0; i < 60 * 90 && !inst; i++) {
    step(w, input, TICK_MS)
    inst = w.instances.find(x => x.def.id === 'spit' && !x.resolved) ?? null
  }
  assert.ok(inst, 'no Corrosive Spit was ever cast in 90 seconds of its own drill')

  // The link the whole fix is built on. Without it the instance points at
  // Vexhul, nineteen yards away and very much alive, and nothing can say which
  // body actually cast this.
  const caster = w.adds.find(a => a.uid === inst.castByAddUid)
  assert.ok(caster, 'the spit instance carries no link back to the add that cast it')

  // Every other spawn goes, so the count can only move because of THIS beam.
  for (const a of w.adds) if (a !== caster) a.alive = false

  assert.ok(inst.aimedAt > 0, 'the line marked the player — a fixate must never pick a tank')
  const marked = w.allies.find(a => a.id === inst.aimedAt)
  assert.ok(marked, 'the line is aimed at a raider who does not exist')

  // Stand on the marked raider. The line runs from the pocket through them, so
  // this is the one position guaranteed to be inside it however it swings.
  const standIn = () => { w.player.pos = { ...marked.pos } }
  return { w, inst, caster, step, TICK_MS, input, standIn }
}

// A dead caster's beam must die with it.
//
// `fireFixated` spawned the instance and walked away: `spawn` fills in `fromId`
// from the def's owning ENTITY, so a Corrosive Spit pointed at Vexhul rather
// than at the spawn that cast it, and dead adds were dropped wholesale out of
// `w.adds` with no pass over `w.instances`. A five-second beam therefore outlived
// its caster and fired into the player out of a corpse.
//
// Which punished the exact play the fight is teaching. Killing the spawns fast
// is the single biggest lever on this fight's venom income, so a beam that
// survives its caster makes good add control cost you a stack anyway.
test('killing an add mid-cast takes its telegraph off the floor with it', async () => {
  const { w, inst, caster, step, TICK_MS, input, standIn } = await loneSpit(11)

  // Let it wind up first, so this is genuinely a cast in flight rather than one
  // that had not started.
  for (let i = 0; i < 30; i++) { standIn(); step(w, input, TICK_MS) }
  assert.ok(!inst.resolved && inst.timer > 500,
    'the beam had all but resolved before the add was killed — nothing is being measured')

  const venomBefore = w.player.venom
  const healthBefore = w.player.health
  const failsBefore = w.failures.get('spit')?.count ?? 0

  caster.alive = false      // shot down, exactly as killAdd and the fuse both do it
  standIn()
  step(w, input, TICK_MS)

  assert.ok(!w.instances.some(i => i.uid === inst.uid),
    'the beam is still on the floor after its caster died. A line still drawn is a line ' +
    'the player is still running from, and teaching them to dodge a dead add is worse ' +
    'than not drawing it')

  // And it never goes off. Stepped well past the full five-second telegraph.
  for (let i = 0; i < 60 * 6; i++) { standIn(); step(w, input, TICK_MS) }
  assert.equal(w.player.venom, venomBefore,
    'a dead add still charged a stack of Eternal Venom')
  assert.ok(w.player.health >= healthBefore,
    'a dead add still dealt damage')
  assert.equal(w.failures.get('spit')?.count ?? 0, failsBefore,
    'a dead add still put a failure against the player')
})

// The guard on the test above. If the beam simply never resolved, or never
// charged anything, that one would pass for the wrong reason — so the same cast,
// with its caster left standing, has to land and has to cost a stack.
test('the same beam, with its caster alive, resolves and charges its stack', async () => {
  const { w, inst, step, TICK_MS, input, standIn } = await loneSpit(11)

  const venomBefore = w.player.venom
  for (let i = 0; i < 60 * 7 && !inst.resolved; i++) { standIn(); step(w, input, TICK_MS) }

  assert.ok(inst.resolved, 'a Corrosive Spit with a live caster never resolved')
  assert.equal(w.player.venom, venomBefore + 1,
    'standing in another raider’s Corrosive Spit cost no Eternal Venom')
  assert.equal(w.failures.get('spit')?.count ?? 0, 1,
    'standing in another raider’s line was not scored against the player')
})

// A player who does nothing dies of the COUNTER, and the debrief says so.
//
// The whole point of modelling Eternal Venom as a counter rather than as a
// raid-damage floor is that it kills you for losing an economy rather than for
// being unlucky with chip damage — and the death has to name the thing it was,
// or the player goes away practising the wrong half of the fight.
//
// Deliberately synthetic. The fight has seven venom sources and only two of them
// are wired at this point in the work, so an unmodified pull cannot yet reach
// ten stacks inside its own enrage. Everything else is stripped out instead — no
// loop, no ambient tick, no adds, no bar — so the ONLY thing that can end this
// pull is the count, which is exactly the claim being made.
test('a player who does nothing dies of the counter, and the death names it', async () => {
  const { createWorld, fire, step, seedRng, buildResult, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const venom = boss.mechanics.find(m => m.counter)
  assert.ok(venom?.counter, 'the Twin Fangs no longer declares a counter')
  const cap = venom.counter.lethalAt

  seedRng(3)
  const w = createWorld(boss, 'dps', 'green')
  w.boss = {
    ...boss,
    loop: [], ambient: [], adds: [], atFullEnergy: undefined,
    // No bar and no clock, or the pull ends in an enrage before the count does.
    energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
  }
  const input = NO_INPUT()
  step(w, input, TICK_MS)

  // Venomous Emergence, over and over: "applying one Eternal Venom stack to all
  // players", nothing to dodge and nothing anybody can do about it.
  for (let cast = 0; cast < cap + 4 && w.player.alive; cast++) {
    const before = w.player.venom
    fire(w, 'emergence')
    for (let i = 0; i < 60 * 8 && w.player.alive && w.player.venom === before; i++) {
      step(w, input, TICK_MS)
    }
  }

  assert.equal(w.player.alive, false, `${cap} stacks of Eternal Venom did not kill the player`)
  assert.match(w.deathCause ?? '', new RegExp(venom.name),
    `died of "${w.deathCause}" rather than of the counter — a death attributed to chip ` +
    'damage sends the player away practising the wrong half of this fight')

  const r = buildResult(w)
  assert.equal(r.venomPeak, cap, 'the debrief does not report the count the player died at')
  // Unavoidable, so nobody is ever named for it. `raidDamage` has no path to a
  // failure row, and gaining a counter stack must not smuggle one in.
  assert.equal(r.failures.some(f => f.mechanicId === venom.id), false,
    'the counter recorded a failure against the player — it is unavoidable damage')
})

// ── the pickup rota ──────────────────────────────────────────────────────────

/**
 * A world with nothing in it but the pickups you fire by hand.
 *
 * The rota is an ordering question — who is sent where, and which one is left
 * alone — and on a live pull the answer is buried under a loop, an energy bar,
 * three adds and an ambient tick all moving the same bodies. Stripped down like
 * this, every raider who walks anywhere walked there because of a pickup, and
 * the only thing left that can take the raid bar down is a pickup nobody reached.
 */
async function pickupBench(bossKey, role, side, seed) {
  const { createWorld, fire, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === bossKey)
  const def = boss.mechanics.find(m => m.rule.type === 'collect')
  assert.ok(def, `${bossKey} no longer has a collect mechanic — this check would be vacuous`)

  seedRng(seed)
  const w = createWorld(boss, role, side)
  w.boss = {
    ...boss,
    loop: [], ambient: [], adds: [], atFullEnergy: undefined,
    energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
  }
  const input = NO_INPUT()
  step(w, input, TICK_MS)
  fire(w, def.id)
  // Only the unresolved ones. A pickup that somebody was already standing on
  // when it landed is answered and retired inside a single tick, so "still on
  // the floor" and "still in the array" are different questions.
  const live = () => w.instances.filter(i => i.def.id === def.id && !i.resolved)
  assert.equal(live().length, def.rule.count, 'the pickups were not all put on the floor')
  return { w, def, input, step, TICK_MS, live }
}

// Fix (a): the reservation used to be unconditional.
//
// `allyThink` held back "all but the last" pickup on every fight for every
// player, and never asked whether the mechanic was the player's at all. Caustic
// Globule is `roles: ['dps','healer']` — tanks are welded to a serpent and are
// not on the soak rota — so a player who rolled tank was saved a globule they
// were never going to eat, the raid was forbidden from touching it, and it
// ruptured on everybody. Ten globules a rotation, three rotations a pull, and
// nothing anyone in the room could have done about a single one of them.
test('nothing is saved for a tank who is not on the soak rota', async () => {
  const { w, input, step, TICK_MS, live } = await pickupBench('twinfangs', 'tank', 'green', 21)

  step(w, input, TICK_MS)
  assert.equal(w.reservedPickups.size, 0,
    'a globule is being held back for a tank, who is not on the globule rota — the raid ' +
    'is not allowed to clear it and it will rupture on them')

  // Past the 10s fuse, so every one of them has been either swept or lost.
  for (let i = 0; i < 60 * 12 && live().length; i++) step(w, input, TICK_MS)
  assert.equal(live().length, 0, 'a globule is still sitting on the floor past its own fuse')

  // A rupture is the only thing in this world that can touch the raid bar, and
  // the watermark remembers it even though the bar regenerates. Counting
  // instances instead would prove nothing: swept and ruptured both leave the
  // array.
  assert.equal(w.raidHealthLow, 1,
    'a globule ruptured on a raid that was free to clear every one of them — the bar fell ' +
    `to ${w.raidHealthLow}`)
})

// Fix (b) and (c): the one that IS saved has an identity, and the raid respects it.
//
// The old reservation was a slice of an array recomputed every tick, so as the
// raid swept, "the last one" became a different globule and everybody
// re-targeted — and because the contact check in the instance loop asked only
// whether ANY raider was standing on a pickup, a raider walking home over the
// reserved one ate it anyway. Both defects end the same way: the player's
// globule is gone before they reach it.
test('a dps is saved exactly one globule, always the same one, and no raider takes it', async () => {
  const { w, input, step, TICK_MS, live } = await pickupBench('twinfangs', 'dps', 'green', 21)

  // Parked on real floor and left there, so anything that happens to the
  // reserved globule was the raid's doing and not the player's.
  const park = { x: 0, y: -8 }
  const stay = () => { w.player.pos = { ...park } }

  stay()
  step(w, input, TICK_MS)
  assert.equal(w.reservedPickups.size, 1,
    'the fight stopped saving the player a globule — a collect mechanic the player has no ' +
    'stake in teaches nothing')
  const mine = [...w.reservedPickups][0]
  const inst = w.instances.find(x => x.uid === mine)
  assert.ok(inst && Math.hypot(inst.pos.x - park.x, inst.pos.y - park.y) > 4,
    'the reserved globule landed under the parked player, so the raid was never given the ' +
    'chance to take it and this check would be vacuous')

  let sawTheRestGo = false
  for (let i = 0; i < 60 * 9 && !inst.resolved; i++) {
    stay()
    step(w, input, TICK_MS)
    // (c) Identity. If this moves, the raid is re-deciding who sweeps what every
    // frame, which is what dithering looks like from the inside.
    assert.deepEqual([...w.reservedPickups], [mine],
      'the reservation moved to a different globule mid-run')
    // (b) Nobody else may have it. The stack is meant to be the player's price
    // for their own soak; handed to an ally, the player is left with no job and
    // the ally with a stack they did not need.
    assert.equal(inst.answered, false,
      'a raider swept the globule that was being held back for the player')
    if (!live().some(i => i.uid !== mine)) sawTheRestGo = true
  }

  // Two guards, both needed. The raid did finish the globules it WAS allowed to
  // have — so "nobody took the reserved one" is not passing because the raid
  // stood still — and it finished them by sweeping rather than by letting them
  // rupture.
  assert.ok(sawTheRestGo,
    'the raid never cleared the globules it was allowed to have, so leaving the reserved ' +
    'one alone proves nothing')
  assert.equal(w.raidHealthLow, 1, 'the raid let a globule rupture rather than sweeping it')
})

// The Good line, made true.
//
// `twinfangs.ts` has said from the first draft that "low-stack players soak
// globules", and until now that was decoration: the sweep order was whatever
// order `w.allies` happened to be in, so the raider closest to dying of Eternal
// Venom was as likely to be sent onto a globule as the one carrying none. The
// stack is uncapped and lethal, eating a globule costs one, and the raid loses
// a body and its share of the next rota when somebody tips over — so who picks
// first is not flavour, it is the mechanic.
test('the raiders with the fewest stacks are the ones sent onto the globules', async () => {
  const { edgeDistance, inArena } = await engine()
  const { w, input, step, TICK_MS, live } = await pickupBench('twinfangs', 'tank', 'green', 5)
  const arena = w.boss.arenaRadius
  // The two yards of idle sway `allyThink` finishes with, and the inset it then
  // tidies every destination back inside. A spot further from the edge than the
  // sum of the two cannot be dragged anywhere by either.
  const SWAY = 2.4
  const MARGIN = arena * 0.1 + SWAY

  // The globules are MOVED before anybody is asked to go and get one.
  //
  // Where a `collect` scatters them is a ring drawn round the arena centre, and
  // on this floor that ring lands more or less on top of the raid's own
  // formation — so most of them are eaten on the tick they spawn by whoever
  // happened to be standing there, which is a real behaviour but says nothing
  // about the rota. Put them on empty floor and the only way anybody reaches one
  // is by being sent.
  const CLEAR = 7
  const spots = []
  for (let x = -22; x <= 22 && spots.length < live().length; x += 0.5) {
    for (let y = -18; y <= 22 && spots.length < live().length; y += 0.5) {
      const p = { x, y }
      if (!inArena(w.boss, p) || edgeDistance(w.boss, p) < MARGIN) continue
      const clearOf = (q) => Math.hypot(q.x - x, q.y - y) > CLEAR
      if (!w.allies.every(a => clearOf(a.pos) && clearOf(a.want))) continue
      if (!spots.every(clearOf)) continue
      spots.push(p)
    }
  }
  assert.equal(spots.length, live().length,
    'could not find empty floor for every globule — the raid is standing everywhere')
  live().forEach((i, n) => { i.pos = { ...spots[n] } })

  // A tank player, so nothing is reserved and every globule is the raid's.
  const sweepers = w.allies.filter(a => a.alive && a.role !== 'tank')
  assert.ok(sweepers.length > spots.length,
    'there are no more sweepers than globules, so any order at all would send the same ' +
    'bodies and this check would be vacuous')

  // Stacks handed out so that the heaviest raiders are also the ones standing
  // closest to the work. Nearest-first alone would then pick exactly the wrong
  // people, which is what makes the ordering visible at all.
  const nearest = (a) => Math.min(...spots.map(p => Math.hypot(p.x - a.pos.x, p.y - a.pos.y)))
  const byNear = [...sweepers].sort((x, y) => nearest(x) - nearest(y))
  byNear.forEach((a, i) => { a.venom = byNear.length - i })

  step(w, input, TICK_MS)

  // Matched with slack, because `allyThink` finishes with a couple of yards of
  // idle sway on every destination so a raider at station never looks switched
  // off. The spots above are seven yards clear of everybody, so two yards of
  // wobble cannot make a formation position look like an assignment.
  const at = (a) => spots.find(p => Math.hypot(p.x - a.want.x, p.y - a.want.y) < SWAY)
  const sent = sweepers.filter(a => at(a))
  assert.equal(sent.length, spots.length, 'not every globule was assigned to somebody')
  assert.equal(new Set(sent.map(a => spots.indexOf(at(a)))).size, spots.length,
    'two raiders were sent to the same globule')

  const worst = Math.max(...sent.map(a => a.venom))
  const idle = sweepers.filter(a => !at(a))
  const bestIdle = Math.min(...idle.map(a => a.venom))
  assert.ok(worst < bestIdle,
    `a raider on ${worst} stacks was sent onto a globule while one on ${bestIdle} was left ` +
    'standing — the sweep order is not lowest-stack-first')
})

// The blast radius, pinned.
//
// Two other fights use `collect` and one of them is side-tagged: Toxic Droplets
// belong to Breath's half of the room, and a red raider crossing to sweep one is
// playing a fight nobody runs. So the reservation is made inside each side's own
// pile rather than across the raid, and the gate that decides whether to make
// one at all is `def_scored` — which asks about the player's SIDE as well as
// their role. A green player is therefore saved a green droplet; a red player is
// saved nothing, because none of this is theirs. Getting that wrong in either
// direction is invisible on the Twin Fangs, which has no sides at all.
test('a side-tagged pickup is only ever reserved for the side that owns it', async () => {
  for (const [side, want] of [['green', 1], ['red', 0]]) {
    const { w, def, input, step, TICK_MS, live } = await pickupBench('sentinels', 'dps', side, 9)
    assert.equal(def.side, 'green', 'Toxic Droplets are no longer side-tagged')

    step(w, input, TICK_MS)
    assert.equal(w.reservedPickups.size, want,
      `a ${side} player had ${w.reservedPickups.size} droplets held back for them, not ${want}`)

    const held = [...w.reservedPickups].map(u => w.instances.find(i => i.uid === u))
    // Stopped a second short of the 16s fuse, so nothing here has erupted yet.
    for (let ms = 0; ms + TICK_MS < def.telegraphMs - 1000; ms += TICK_MS) {
      step(w, input, TICK_MS)
      for (const i of held) {
        assert.equal(i.answered, false,
          'a raider swept the droplet that was being held back for the player')
      }
    }
    assert.equal(live().length >= want, true, 'the reserved droplet erupted early')
  }
})
