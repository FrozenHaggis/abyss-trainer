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
