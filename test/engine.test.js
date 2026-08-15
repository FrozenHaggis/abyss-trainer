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

// ── Caustic Deluge ───────────────────────────────────────────────────────────
//
// The arithmetic of the mechanic, run rather than read.
//
// It was one def doing three jobs: a channel, the splashes it throws and the
// globules those leave. Fused like that the fight could put three circles on the
// floor or three pickups on it, never the ten-circle, ten-globule wave the
// encounter is — and the raid leader's spec contradicts itself about the number,
// saying both "every 0.5 seconds it will spawn 2 green circles" across a
// five-second channel (twenty) and "a total of 10 Globules". Ten was the ruling,
// so the beat is a second rather than half of one.
//
// Ten is therefore a number three separate fields have to agree on — the
// channel's five, the fan's two, and one globule per splash — and no single file
// can be read to check it. This is the only place the product is visible.
test('one Caustic Deluge lands ten circles in five pairs and ten globules', async () => {
  const { createWorld, fire, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const parent = boss.mechanics.find(m => m.id === 'deluge')
  assert.ok(parent?.channel, 'Caustic Deluge no longer channels — it is a single cast again')

  // Neither child belongs in the rotation. A bare `fire('globule')` takes the
  // `collect` branch and scatters pickups on a ring round the arena centre with
  // no circles behind them, which is the behaviour this whole split replaces; a
  // bare `fire('splash')` is a lone pair with no channel to read them off.
  for (const id of ['globule', 'splash']) {
    assert.ok(!boss.loop.includes(id),
      `'${id}' is back in the loop. It is a consequence of Caustic Deluge, not an event ` +
      'the rotation schedules, and fired on its own it arrives from nowhere')
  }

  seedRng(11)
  const w = createWorld(boss, 'dps', 'green')
  w.boss = {
    ...boss,
    loop: [], ambient: [], adds: [], atFullEnergy: undefined,
    energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
  }
  const input = NO_INPUT()
  step(w, input, TICK_MS)
  fire(w, 'deluge')

  // Every instance that ever existed, and when. Resolved instances hang about
  // for the impact flash, so nothing can be born and swept between two samples.
  const seen = new Map()
  for (let i = 0; i < 60 * 20; i++) {
    step(w, input, TICK_MS)
    for (const inst of w.instances) {
      if (!seen.has(inst.uid)) seen.set(inst.uid, { id: inst.def.id, at: w.elapsedMs, pos: { ...inst.pos } })
    }
  }
  const of = (id) => [...seen.values()].filter(x => x.id === id).sort((a, b) => a.at - b.at)
  const splashes = of('splash')
  const globules = of('globule')

  assert.equal(splashes.length, 10,
    `${splashes.length} splashes, not ten. Five beats of two is the raid leader's ruling on ` +
    'their own spec — anything else and the globule count follows it')
  assert.equal(globules.length, 10,
    `${globules.length} globules from ten splashes. Every circle leaves one, so these two ` +
    'numbers are the same number and a difference means a splash resolved without spawning')

  // Two at a time, a second apart. Grouped by arrival rather than by index, so
  // this measures the beat rather than restating the config.
  const beats = []
  for (const s of splashes) {
    const last = beats[beats.length - 1]
    if (last && s.at - last[0].at < 300) last.push(s)
    else beats.push([s])
  }
  assert.equal(beats.length, 5, `the channel landed in ${beats.length} beats, not five`)
  for (const b of beats) assert.equal(b.length, 2, `a beat put ${b.length} circles down, not two`)
  for (let i = 1; i < beats.length; i++) {
    const gap = beats[i][0].at - beats[i - 1][0].at
    assert.ok(Math.abs(gap - parent.channel.everyMs) < 60,
      `beats ${i} and ${i + 1} are ${gap}ms apart against a declared ${parent.channel.everyMs}ms`)
  }

  // Each globule is where its splash was. The pickups being consequences of the
  // circles — rather than a ring drawn round the middle of the room — is the
  // entire reason reading the pairs as they land is worth anything.
  for (const g of globules) {
    assert.ok(splashes.some(s => Math.hypot(s.pos.x - g.pos.x, s.pos.y - g.pos.y) < 0.01),
      `a globule surfaced at (${g.pos.x.toFixed(1)}, ${g.pos.y.toFixed(1)}), where no splash landed`)
  }
})

// And the raid can actually clear them.
//
// Ten pickups on a 1158-square-yard wedge inside a ten-second fuse was an open
// question nobody had run — the plan lists it as one of three things "nobody
// established" — and the answer at first was no: three of the ten ruptured on
// every pull, on every seed. Two engine defects, both of which only a count this
// high could surface. An ally's arrival deadzone was measured in EASED yards, so
// a sweeper stopped between two and seven yards short of the globule it was sent
// to; and the destination clamp insets a tenth of the arena while a hazard is
// scattered with an inset of two, so anything landing in the gap was somewhere
// the raid was forbidden to stand.
//
// A globule the raid cannot reach is not a mechanic, it is a tax, so this is the
// bound that keeps it one.
test('the raid sweeps every globule a Caustic Deluge leaves', async () => {
  const { createWorld, fire, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const input = NO_INPUT()

  for (const seed of [1, 2, 3, 7, 21]) {
    seedRng(seed)
    const w = createWorld(boss, 'tank', 'green')
    // A TANK player, so nothing is held back and every globule is the raid's —
    // the strongest form of the claim, and the one a player rolling tank meets.
    w.boss = {
      ...boss,
      loop: [], ambient: [], adds: [], atFullEnergy: undefined,
      energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
    }
    step(w, input, TICK_MS)
    fire(w, 'deluge')

    const globules = new Map()
    for (let i = 0; i < 60 * 22; i++) {
      step(w, input, TICK_MS)
      for (const inst of w.instances) {
        if (inst.def.id === 'globule') globules.set(inst.uid, inst)
      }
    }
    assert.equal(globules.size, 10, `seed ${seed}: ${globules.size} globules, not ten`)
    const missed = [...globules.values()].filter(g => !g.answered)
    assert.equal(missed.length, 0,
      `seed ${seed}: ${missed.length} globule(s) ruptured on the raid — ` +
      missed.map(g => `(${g.pos.x.toFixed(1)}, ${g.pos.y.toFixed(1)})`).join(' ') +
      '. Nineteen raiders and ten seconds is not a close call; a miss means somebody was ' +
      'sent somewhere they were not allowed to stand, or stopped short of where they were sent')
  }
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
async function pickupBench(bossKey, role, side, seed, count) {
  const { createWorld, fire, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === bossKey)
  const authored = boss.mechanics.find(m => m.rule.type === 'collect')
  assert.ok(authored, `${bossKey} no longer has a collect mechanic — this check would be vacuous`)
  // How many pickups to put down, when the question being asked does not depend
  // on the fight's own number.
  //
  // Caustic Deluge leaves TEN globules and the boss file says so, which is right
  // — but a test that has to find ten patches of floor seven yards clear of
  // nineteen bodies and of each other cannot be run on a 1158-square-yard wedge,
  // and a test measuring the sweep ORDER never needed ten in the first place. So
  // the ordering check names its own number and everything else keeps reading
  // the fight's. Nothing about the rota changes with the count: the same
  // assignment runs whether there are three pickups or ten.
  const def = count === undefined
    ? authored
    : { ...authored, rule: { ...authored.rule, count } }

  seedRng(seed)
  const w = createWorld(boss, role, side)
  w.boss = {
    ...boss,
    mechanics: boss.mechanics.map(m => (m === authored ? def : m)),
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
  // Three, not the fight's ten — see pickupBench. The claim is about the ORDER
  // the raid picks in, and the order is the same at any count.
  const { w, input, step, TICK_MS, live } = await pickupBench('twinfangs', 'tank', 'green', 5, 3)
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

// ── Stone Breaker ────────────────────────────────────────────────────────────
//
// The mechanic with the most ways to be quietly broken in the raid, because
// three of its four pieces only misbehave in combination: a knock the rim does
// not catch, a run of soaks exactly one body may answer, the punishment for
// missing one, and a tank swap that is the reward for not missing any.

/**
 * A world with nothing in it but Stone Breaker.
 *
 * The rotation is stripped for the same reason `pickupBench` strips it: with the
 * loop running, a Caustic Deluge splash lands on the player two seconds into the
 * soak run and puts a failure row in the debrief that has nothing to do with the
 * thing being measured. Here every failure, every death and every body that
 * moved is Stone Breaker's.
 */
async function breakerBench(role, seed, seat) {
  const { createWorld, fire, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  seedRng(seed)
  const w = createWorld(boss, role, 'green')
  w.boss = {
    ...boss,
    loop: [], ambient: [], adds: [], atFullEnergy: undefined,
    energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
  }
  const ithraz = w.bosses.find(b => b.def.id === 'ithraz')
  const vexhul = w.bosses.find(b => b.def.id === 'vexhul')
  assert.ok(ithraz && vexhul, 'the Twin Fangs are no longer two named serpents')
  // Who the player is holding. The default seating gives them Vexhul and the AI
  // tank Ithraz, which is the case where the RAID has to do the soaks; 'ithraz'
  // is the case where the player does.
  if (seat === 'ithraz') {
    const displaced = ithraz.targetId
    ithraz.targetId = 0
    vexhul.targetId = displaced
  }
  const brk = boss.mechanics.find(m => m.id === 'stonebreaker')
  const slam = boss.mechanics.find(m => m.id === 'slam')
  assert.ok(brk && slam, 'Stone Breaker no longer splits into a knock and its slams')
  assert.equal(slam.rule.type, 'tankSoak', 'the slams are no longer a tank soak')
  return { w, boss, brk, slam, ithraz, vexhul, fire, step, TICK_MS }
}

/** How long the whole cast takes: the knock, then every beat of the channel. */
const breakerRunMs = brk =>
  brk.telegraphMs + (brk.channel.count - 1) * brk.channel.everyMs + 2000 + 1200

// Plan test 9, the positive half.
//
// A tanking player who does nothing at all must not lose the pull to this. They
// are holding Vexhul, which is where the fight starts them, so the run belongs
// to the AI tank on Ithraz — and the whole point of the check is that the AI
// really does walk all three. Every earlier version of this fight had "three
// slam swirlies" in a what: string and nothing on the floor, so there was
// nothing to walk and nothing to miss.
test('Stone Breaker is not an automatic wipe for a tanking player', async () => {
  const { w, brk, ithraz, vexhul, fire, step, TICK_MS } = await breakerBench('tank', 7)
  // In melee, between the serpents, which is where the boss file puts melee —
  // and, measured against the real polygon, a landing that stays on the floor.
  w.player.pos.x = 0
  w.player.pos.y = -13
  const before = { ithraz: ithraz.targetId, vexhul: vexhul.targetId }
  assert.equal(before.vexhul, 0, 'a tanking player no longer opens holding Vexhul')

  fire(w, 'stonebreaker')
  let swaps = 0
  let seat = `${vexhul.targetId}/${ithraz.targetId}`
  for (let ms = 0; ms < breakerRunMs(brk); ms += TICK_MS) {
    step(w, NO_INPUT(), TICK_MS)
    const now = `${vexhul.targetId}/${ithraz.targetId}`
    if (now !== seat) { swaps++; seat = now }
  }

  assert.equal(w.player.alive, true, `the player died to Stone Breaker doing nothing: ${w.deathCause}`)
  assert.equal(w.alliesLost, 0,
    `${w.alliesLost} raiders were killed by a knock they were supposed to be positioned for`)
  assert.equal(w.seen.has('pushoff'), false,
    'the untanked variant fired — the AI tank did not cover the run')
  assert.deepEqual([...w.failures.keys()], [],
    `failures recorded for a clean Stone Breaker: ${[...w.failures.keys()].join(', ')}`)

  assert.equal(swaps, 1, `the tanks traded ${swaps} times, not once`)
  assert.equal(vexhul.targetId, before.ithraz, 'Vexhul did not go to the tank who was on Ithraz')
  assert.equal(ithraz.targetId, before.vexhul, 'Ithraz did not go to the tank who was on Vexhul')
})

// Plan test 9, the negative half.
//
// The same cast with the player on Ithraz and nowhere near the pools. This is
// the consequence the whole mechanic is built on and it has to be total: a slam
// that strikes nobody fires the untanked variant, which throws every body off
// the platform. If this ever becomes survivable the soak run stops being a
// decision and the tank swap stops being earned.
test('a Stone Breaker slam nobody soaks throws the raid into the acid', async () => {
  const { w, brk, ithraz, fire, step, TICK_MS } = await breakerBench('tank', 7, 'ithraz')
  assert.equal(ithraz.targetId, 0, 'the player is not holding Ithraz')
  // Far from every pool on the arc, and — measured — a spot the opening 10-yard
  // knock itself survives, so the death below can only be the untanked variant.
  w.player.pos.x = -6
  w.player.pos.y = -5

  fire(w, 'stonebreaker')
  for (let ms = 0; ms < breakerRunMs(brk) && w.player.alive; ms += TICK_MS) {
    step(w, NO_INPUT(), TICK_MS)
  }

  assert.equal(w.seen.has('pushoff'), true, 'a slam landed on nobody and nothing happened')
  assert.equal(w.player.alive, false, 'the player survived a push that clears the whole platform')
  assert.match(w.deathCause ?? '', /acid/i,
    `died of "${w.deathCause}" rather than of the venom under the platform`)
  assert.ok(w.alliesLost > 0, 'the raid was thrown off the platform and nobody was lost')
  assert.ok(w.failures.has('slam'),
    'the tank who dropped the soak was not named — somebody has to be, and it is not the raid')
  assert.equal(w.failures.has('pushoff'), false,
    'the untanked variant named a player. It is collective: the missed soak is the failure')
})

// The raid leader's requirement, stated directly: the player must be able to do
// it when playing tank. The AI doing it is not evidence that a human can — the
// AI is exempt from the arena inset and gets a widened leash — so this drives
// the player's own feet through the run at player speed, through the knock,
// with nothing but WASD.
test('a player tank can walk all three Stone Breaker soaks themselves', async () => {
  const { w, brk, ithraz, vexhul, fire, step, TICK_MS } = await breakerBench('tank', 3, 'ithraz')
  w.player.pos.x = 7
  w.player.pos.y = -13

  fire(w, 'stonebreaker')
  let soaked = 0
  const seen = new Set()
  for (let ms = 0; ms < breakerRunMs(brk) && w.player.alive; ms += TICK_MS) {
    // Walk at whichever pool is on the floor; otherwise hold still.
    const pool = w.instances.find(i => !i.resolved && i.def.id === 'slam')
    const input = NO_INPUT()
    if (pool) {
      const dx = pool.pos.x - w.player.pos.x
      const dy = pool.pos.y - w.player.pos.y
      if (Math.hypot(dx, dy) > 1) {
        input.right = dx > 0.4
        input.left = dx < -0.4
        input.down = dy > 0.4
        input.up = dy < -0.4
      }
      if (!seen.has(pool.uid) && Math.hypot(dx, dy) <= 3.5) { seen.add(pool.uid); soaked++ }
    }
    step(w, input, TICK_MS)
  }

  assert.equal(w.player.alive, true, `the player died walking the run: ${w.deathCause}`)
  assert.equal(soaked, brk.channel.count,
    `the player reached ${soaked} of ${brk.channel.count} pools at player speed — the run is not walkable`)
  assert.equal(w.seen.has('pushoff'), false, 'a pool the player stood in still fired the untanked variant')
  assert.deepEqual([...w.failures.keys()], [],
    `failures on a clean player-tank run: ${[...w.failures.keys()].join(', ')}`)
  assert.equal(ithraz.targetId !== 0 && vexhul.targetId === 0, true,
    'the player soaked the whole run and did not get the swap')
})

// Plan test 12, first half: the argument for the whole mechanic, rasterised.
//
// knockbackYards is one number in a boss file and it decides what fraction of
// the room is a fatal place to stand. At 18 — what this shipped with — it was
// 72%, which is not a decision, it is a room with one right answer. At 10 it is
// 46%. Pinned because raising the push or reshaping the mouth moves it silently,
// and because the raid leader was shown this exact figure and ruled on it.
test('Stone Breaker leaves the raid somewhere to stand, and somewhere it cannot', async () => {
  const { inArena, knockLanding, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const brk = boss.mechanics.find(m => m.id === 'stonebreaker')
  const ithraz = boss.entities.find(e => e.id === 'ithraz')
  assert.equal(brk.offPlatform, true, 'the Stone Breaker knock is caught by the rim again')

  let cells = 0
  let survives = 0
  const rows = new Map()
  for (let x = -24; x <= 24; x += 0.25) {
    for (let y = -17; y <= 22; y += 0.25) {
      const p = { x, y }
      if (!inArena(boss, p)) continue
      cells++
      const ok = inArena(boss, knockLanding(p, ithraz.start, brk.knockbackYards))
      if (ok) survives++
      const r = rows.get(Math.round(y)) ?? { n: 0, ok: 0 }
      r.n++
      if (ok) r.ok++
      rows.set(Math.round(y), r)
    }
  }
  const fatal = 100 * (1 - survives / cells)
  // Both bounds matter. Too low and the knock is scenery nobody has to read;
  // too high and there is no route through the room that answers it.
  assert.ok(fatal > 35 && fatal < 55,
    `${fatal.toFixed(1)}% of the floor is a fatal stand. Below 35 nobody has to read the ` +
    'knock; above 55 there is no route through the room that answers it')

  // The mouth is certain death and the middle of the wedge is not. This is the
  // shape the briefing promises the player — stay south of the ledge and well
  // north of the mouth — and a brief that promises a band the floor does not
  // have is worse than no brief.
  assert.equal(rows.get(16).ok, 0, 'the mouth of the platform is survivable — the danger band is gone')
  assert.ok(rows.get(0).ok / rows.get(0).n > 0.7,
    'the middle of the wedge is not reliably survivable, so there is nowhere to be told to go')
})

// Hazard 4.4, measured rather than trusted.
//
// The three pools are laid on an arc and then CLAMPED onto the floor, and the
// clamp is not shape-preserving: the right-hand point runs into the leg of the
// wedge and is dragged inward. So whether the tank has to walk is decided by the
// post-clamp positions, and the honest test is the smallest circle containing
// all three — if that is inside the soak radius, one spot covers the run and the
// tank never moves. ringYards 6 gives 4.02 against 3.5, which is half a yard of
// margin. This is why the fight uses 8.
test('the Stone Breaker arc cannot be soaked from a standing start', async () => {
  const { arcOnFloor, clampToArena, edgeDistance, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const brk = boss.mechanics.find(m => m.id === 'stonebreaker')
  const slam = boss.mechanics.find(m => m.id === 'slam')
  const from = boss.entities.find(e => e.id === 'ithraz').start
  const ch = brk.channel
  // The same bearing the engine uses: out of the caster toward the middle of the
  // room, NOT the caster's own facing. See the comment at the channel block.
  const ps = arcOnFloor(boss, from, Math.atan2(-from.y, -from.x), ch.count, ch.ringYards, ch.arcDeg)

  // Smallest enclosing circle of three points: the diameter of the longest side
  // when the triangle is not acute, the circumcircle otherwise.
  let mec = Infinity
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const c = { x: (ps[i].x + ps[j].x) / 2, y: (ps[i].y + ps[j].y) / 2 }
      const r = Math.hypot(ps[i].x - c.x, ps[i].y - c.y)
      if (ps.every(p => Math.hypot(p.x - c.x, p.y - c.y) <= r + 1e-9)) mec = Math.min(mec, r)
    }
  }
  if (mec === Infinity) {
    const [A, B, C] = ps
    const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y))
    const ux = ((A.x ** 2 + A.y ** 2) * (B.y - C.y) + (B.x ** 2 + B.y ** 2) * (C.y - A.y)
      + (C.x ** 2 + C.y ** 2) * (A.y - B.y)) / d
    const uy = ((A.x ** 2 + A.y ** 2) * (C.x - B.x) + (B.x ** 2 + B.y ** 2) * (A.x - C.x)
      + (C.x ** 2 + C.y ** 2) * (B.x - A.x)) / d
    mec = Math.hypot(A.x - ux, A.y - uy)
  }
  const soak = slam.shape.radius
  assert.ok(mec > soak + 1,
    `the three pools fit inside a ${mec.toFixed(2)}yd circle against a ${soak}yd soak — a tank ` +
    'standing in the right spot covers the whole run without moving')

  // And the run has to be reachable from the tank's own mark, or the AI cannot
  // play it and the leash exemption at allyThink 6b is aimed at the wrong number.
  const station = clampToArena(boss, from, 2)
  for (const p of ps) {
    const d = Math.hypot(p.x - station.x, p.y - station.y)
    assert.ok(d < 9, `a pool is ${d.toFixed(1)}yd from the tank's station — beyond a sidestep`)
  }
  // Two of the three land inside the arena inset the ally AI is otherwise held
  // to, which is exactly why that bound relaxes for a tank's own soak. If this
  // ever stops being true the exemption is dead code and should go.
  assert.ok(ps.some(p => edgeDistance(boss, p) < boss.arenaRadius * 0.1),
    'no pool lands inside the ally floor inset any more — the soak reach exemption is unreachable')
})

// Hazard 4.2's other half, and the reason the ally knock and the ally
// pre-position are one commit.
//
// A tank cannot leave their station: the leash is six yards. So if a station's
// landing is off the platform and there is nothing survivable within six yards
// of it, that tank dies to every Stone Breaker for the whole pull and no AI
// change can save them. Measured, the Ithraz mark is already safe and the Vexhul
// one is not — its nearest survivable spot is 5.8 yards away, which fits, but
// only just.
test('both tank stations have somewhere survivable inside the tank leash', async () => {
  const { inArena, clampToArena, knockLanding, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const brk = boss.mechanics.find(m => m.id === 'stonebreaker')
  const from = boss.entities.find(e => e.id === 'ithraz').start
  const LEASH = 6                       // allyThink step 6b

  for (const e of boss.entities) {
    const station = clampToArena(boss, e.start, 2)
    let nearest = Infinity
    for (let i = 0; i < 180; i++) {
      for (let r = 0; r <= LEASH; r += 0.25) {
        const th = (i / 180) * Math.PI * 2
        const p = { x: station.x + Math.cos(th) * r, y: station.y + Math.sin(th) * r }
        if (!inArena(boss, p)) continue
        if (!inArena(boss, knockLanding(p, from, brk.knockbackYards + 3))) continue
        nearest = Math.min(nearest, r)
      }
    }
    assert.ok(nearest <= LEASH,
      `${e.id}'s tank has nowhere inside their ${LEASH}yd leash that survives Stone Breaker — ` +
      'they are thrown into the venom every cast and there is nothing the AI can do about it')
  }
})
