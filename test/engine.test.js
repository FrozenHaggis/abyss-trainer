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
  // Named rather than spread, so a helper added to the registry can never
  // silently shadow one of sim.ts's exports.
  const { BOSSES, drillableMechanics } = await import(`../${OUT}/registry.mjs`)
  return { ...sim, BOSSES, drillableMechanics }
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
    // Standing where a tank stands. Not a convenience: this world runs for
    // twenty-two seconds with no input, and a tank left at the raid's spawn
    // point is 32 yards from the serpent they are holding — the melee leash
    // empties the raid bar in four seconds, the raid starts dying, and what the
    // test would then be measuring is a leash wipe rather than the soak rota.
    // Every assertion below is unchanged; the player is simply doing the one
    // thing a tank does on this fight all pull.
    w.player.pos.x = -7
    w.player.pos.y = -14
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

  // STONE BREAKER DOES NOT TRADE THE TANKS, and this assertion is the inverse of
  // the one it replaced. The raid leader corrected the fight after the swap
  // shipped here: Stone Breaker is a soak the tanks take turns at, and the turns
  // come from Envenomed swapping who holds Ithraz. A clean run is worth exactly
  // what it says — the raid is not thrown into the venom — and nothing else.
  assert.equal(swaps, 0, `Stone Breaker traded the tanks ${swaps} times; the swap belongs to Envenomed`)
  assert.equal(vexhul.targetId, before.vexhul, 'Vexhul changed hands on a Stone Breaker')
  assert.equal(ithraz.targetId, before.ithraz, 'Ithraz changed hands on a Stone Breaker')
})

// The other half of the same correction: the swap that DOES exist.
//
// Envenomed is not cast, so nothing fires it and no loop contains it — Caustic
// Deluge lands it on whoever it is channelling into, one stack per channel, via
// `stacksTank`. This drives Deluge until the tanks trade and checks that they
// trade for that reason, at that stack count, on their own.
test('Caustic Deluge stacks Envenomed until the tanks trade', async () => {
  const { boss } = await breakerBench('tank', 7)
  const env = boss.mechanics.find(m => m.id === 'envenomed')
  assert.ok(env, 'Envenomed is gone — it is the fight\'s swap driver')
  assert.equal(env.rule.type, 'tankSwap', 'Envenomed is no longer the tankSwap mechanic')
  assert.equal(
    (boss.loop ?? []).includes('envenomed') ||
    (boss.phases ?? []).some(p => (p.loop ?? []).includes('envenomed')),
    false,
    'Envenomed is in a loop. It is applied BY Caustic Deluge and must never be cast on its own',
  )

  // A REAL PULL, not the stripped bench. Hand-firing `deluge` into a world with
  // no phases resolves the parent once and never again — the sequential script
  // is what brings the next one round — so a bench cannot reach a second stack
  // and cannot see this swap at all.
  //
  // The player is held immortal, in melee of Vexhul, and ON THE FLOOR every
  // tick. That last part is not decoration: Stone Breaker's knock is lethal by
  // the raid leader's ruling, so a player revived where it dropped them dies
  // again immediately, and a dead player early-returns out of step() before the
  // channel queue is drained — which stops the fight advancing at all and looks
  // exactly like a scheduler bug. This asks WHEN THE SWAP FIRES, not whether
  // the pull is survivable.
  const { createWorld, step: rstep, seedRng, TICK_MS: T, BOSSES } = await engine()
  const real = BOSSES.find(b => b.key === 'twinfangs')
  seedRng(7)
  const rw = createWorld(real, 'tank', 'green')
  const rvex = rw.bosses.find(b => b.def.id === 'vexhul')
  const rith = rw.bosses.find(b => b.def.id === 'ithraz')
  const before = { vexhul: rvex.targetId, ithraz: rith.targetId }
  assert.equal(before.vexhul, 0, 'a tanking player no longer opens holding Vexhul')

  let tradedAt = -1
  let peak = 0
  for (let ms = 0; ms < 120000 && tradedAt < 0; ms += T) {
    rw.player.alive = true; rw.player.health = 1; rw.raidHealth = 1; rw.player.venom = 0
    rw.player.pos.x = -8; rw.player.pos.y = -14; rw.player.knock = null
    rstep(rw, NO_INPUT(), T)
    peak = Math.max(peak, rw.playerStacks)
    if (rvex.targetId !== before.vexhul) tradedAt = rw.elapsedMs / 1000
  }

  assert.ok(tradedAt > 0,
    `the tanks never traded in 120s (Envenomed peaked at ${peak.toFixed(1)} of ${env.rule.maxStacks}) — Caustic Deluge is not applying it`)
  assert.equal(rith.targetId, before.vexhul, 'Ithraz did not go to the tank who was on Vexhul')
  // Deluge opens each rotation and one channel is one stack, so at maxStacks 2
  // the trade lands in the second rotation. Bounded loosely on purpose: the
  // claim is that it takes more than one channel and still arrives inside a
  // pull, not that it happens on a particular second.
  assert.ok(tradedAt > 20 && tradedAt < 110,
    `the trade landed at ${tradedAt.toFixed(0)}s — expected it inside the second rotation`)
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
  // No swap here either. The player walked the run because they were the one
  // holding Ithraz, and they still are at the end of it — Stone Breaker asks
  // who is holding Ithraz, it does not change the answer. See the Envenomed
  // test above for the swap that actually exists.
  assert.equal(ithraz.targetId, 0, 'the player stopped holding Ithraz mid-run')
  assert.equal(vexhul.targetId !== 0, true, 'the player somehow ended up holding both serpents')
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

// ── the melee leash ───────────────────────────────────────────────────────────
//
// "The tanks must never move out of melee range of the bosses otherwise they
// both start doing heavy raid damage and wipe the raid very quickly."
//
// The rule itself is two lines of arithmetic. Everything hard about it is the
// three windows where a tank is legitimately not standing where they belong —
// the pull, a knockback and the swap — because each one is a moment the fight
// creates and would then punish the raid for. Two of the checks below are about
// those windows, and the knock one is hazard 4.3: from the Ithraz tank's own
// station a Stone Breaker push lands them fifteen yards out, so without a grace
// the fight's showpiece tank mechanic is an automatic wipe on every cast.

/**
 * A world with the leash live and nothing else moving.
 *
 * Stone Breaker keeps its knock and loses its channel. The three slams are a
 * different mechanic with their own tests above, and an unsoaked one throws the
 * entire raid into the acid — which would end the pull several seconds before
 * the leash had anything to say about it.
 */
async function leashBench(seat, seed = 7) {
  const { createWorld, clampToArena, fire, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  seedRng(seed)
  const w = createWorld(boss, 'tank', 'green')
  w.boss = {
    ...boss,
    mechanics: boss.mechanics.map(m => (m.id === 'stonebreaker' ? { ...m, channel: undefined } : m)),
    loop: [], ambient: [], adds: [], atFullEnergy: undefined,
    energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
  }
  const vexhul = w.bosses.find(b => b.def.id === 'vexhul')
  const ithraz = w.bosses.find(b => b.def.id === 'ithraz')
  const leashes = boss.mechanics.filter(m => m.rule.type === 'holdMelee')
  assert.equal(leashes.length, 2,
    'the Twin Fangs no longer declares one melee leash per serpent — this bench would be vacuous')
  assert.deepEqual(leashes.map(m => m.from).sort(), ['ithraz', 'vexhul'],
    'the two leashes are not owned one by each serpent')
  const max = leashes[0].rule.maxYards
  assert.ok(leashes.every(m => m.rule.maxYards === max),
    'the two serpents leash their tanks at different distances — the tanks TRADE serpents, ' +
    'so the same footwork would be judged differently depending on which one you held')
  if (seat === 'ithraz') {
    const displaced = ithraz.targetId
    ithraz.targetId = 0
    vexhul.targetId = displaced
  }
  const gap = unit => Math.hypot(w.player.pos.x - unit.pos.x, w.player.pos.y - unit.pos.y)
  /**
   * The nearest floor to a serpent — the same `clampToArena(start, 2)` the ally
   * AI parks its own tanks on.
   *
   * Walking at the serpent itself is not "walking back into melee", it is
   * walking into the acid: both serpents are coiled three yards OFF the top edge
   * and the player is not clamped to the floor. A human tank aims at the ledge
   * in front of their serpent, and so does this.
   */
  const stationOf = unit => clampToArena(w.boss, unit.def.start, 2)
  /** Walk the player at full tilt toward a point, the way a human would. */
  const walkAt = (to) => {
    const i = NO_INPUT()
    i.right = to.x - w.player.pos.x > 0.3
    i.left = to.x - w.player.pos.x < -0.3
    i.down = to.y - w.player.pos.y > 0.3
    i.up = to.y - w.player.pos.y < -0.3
    return i
  }
  return { w, boss, vexhul, ithraz, max, gap, stationOf, walkAt, fire, step, TICK_MS }
}

// The rule, both ways round, in one pull. Standing on your serpent costs nothing
// at all for twenty seconds; walking off it empties the raid bar inside five,
// which is what "wipe the raid very quickly" has to mean if the tank job on this
// fight is going to be a job at all.
test('a tank on their serpent is never scored, and a tank who walks off it wipes the raid', async () => {
  const { w, vexhul, max, gap, step, TICK_MS } = await leashBench('vexhul')
  assert.equal(vexhul.targetId, 0, 'a tanking player no longer opens holding Vexhul')

  // Where the AI parks its own tanks — on the floor, in range, nowhere near the
  // edge. Twenty seconds of standing there with no input at all.
  w.player.pos.x = -7
  w.player.pos.y = -14
  assert.ok(gap(vexhul) <= max, 'the tank station is not inside the leash it is a station for')
  for (let ms = 0; ms < 20000; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)

  assert.deepEqual([...w.failures.keys()], [],
    `a tank standing in melee was scored: ${[...w.failures.keys()].join(', ')}`)
  assert.equal(w.raidHealthLow, 1,
    `the raid bar fell to ${w.raidHealthLow} with both tanks standing exactly where they belong`)
  assert.equal(w.leashOutMs.vexhul, 0, 'the leash thinks a tank in melee is out of range')
  assert.equal(w.leashOutMs.ithraz, 0, 'the AI tank on Ithraz cannot hold its own leash')

  // Now walk off. Teleported rather than driven, so the clock below measures the
  // consequence rather than the walk.
  w.player.pos.x = 0
  w.player.pos.y = 14
  assert.ok(gap(vexhul) > max, 'the mouth of the platform is somehow still in melee of Vexhul')
  let died = -1
  for (let ms = 0; ms < 12000 && died < 0; ms += TICK_MS) {
    step(w, NO_INPUT(), TICK_MS)
    if (!w.player.alive) died = ms
  }
  assert.ok(died >= 0, 'a tank stood 33 yards from their serpent for twelve seconds and the raid lived')
  assert.ok(died < 6000,
    `the raid took ${(died / 1000).toFixed(1)}s to fall over. "Very quickly" is the whole ` +
    'consequence — a leash the raid can be healed through is a tax, not a rule')
  assert.match(w.deathCause ?? '', /raid wiped/i,
    `died of "${w.deathCause}" rather than of the raid bar the leash empties`)
  // Once, not once per tick. A tank who stood out of range for four seconds made
  // one mistake, and a debrief counting frames would bury every other row.
  assert.equal(w.failures.get('spittle')?.count, 1,
    `Concentrated Spittle was recorded ${w.failures.get('spittle')?.count} times for one departure`)
  assert.equal(w.failures.has('clottedbolt'), false,
    'the tank on the OTHER serpent was named for a leash they were holding perfectly')
})

// Hazard 4.3, which is the reason the grace exists at all.
//
// Stone Breaker throws every body ten yards straight away from Ithraz. From the
// Ithraz tank's own station — the only place they are allowed to be — that lands
// them about fifteen yards from him, outside any leash this fight could sanely
// set. So the mechanic that most needs the tank in position is also the one that
// guarantees they are not, and with no window to walk back the fight would wipe
// the raid every time it cast its own tank mechanic.
test('a Stone Breaker knock does not break the leash it throws the tank out of', async () => {
  const { w, ithraz, max, gap, stationOf, walkAt, fire, step, TICK_MS } = await leashBench('ithraz')
  assert.equal(ithraz.targetId, 0, 'the player is not holding Ithraz')
  w.player.pos.x = 7.4
  w.player.pos.y = -14.1
  assert.ok(gap(ithraz) <= max, 'the Ithraz station is not inside its own leash')

  fire(w, 'stonebreaker')
  // Through the cast and the throw, standing still — the knock is not something
  // anybody plays around once it is in the air.
  let thrownTo = 0
  for (let ms = 0; ms < 3400; ms += TICK_MS) {
    step(w, NO_INPUT(), TICK_MS)
    thrownTo = Math.max(thrownTo, gap(ithraz))
  }
  assert.equal(w.player.alive, true, `the tank died to the knock from their own station: ${w.deathCause}`)
  assert.ok(thrownTo > max,
    `the push left the tank ${thrownTo.toFixed(1)}yd from Ithraz, inside the ${max}yd leash — ` +
    'this check exists to prove the grace is load-bearing and it is proving nothing')

  // And walk back, which is the whole of what the grace buys.
  let backAt = -1
  for (let ms = 0; ms < 2600 && backAt < 0; ms += TICK_MS) {
    step(w, walkAt(stationOf(ithraz)), TICK_MS)
    if (gap(ithraz) <= max) backAt = ms
  }
  assert.ok(backAt >= 0,
    'the tank could not get back inside the leash in the time the grace gives them')
  assert.deepEqual([...w.failures.keys()], [],
    `the tank was scored for a knockback the fight put them in: ${[...w.failures.keys()].join(', ')}`)
  assert.equal(w.raidHealthLow, 1,
    `the raid bar fell to ${w.raidHealthLow} while both tanks were airborne. The grace has to ` +
    'suspend the cost as well as the blame, or Stone Breaker wipes the raid on every cast')
})

// The trade Stone Breaker is the reward for. The two stations are fifteen yards
// apart, so there is no arrangement of two bodies in which the crossing does not
// break at least one leash — a swap with no grace on it punishes the raid for
// completing the mechanic that earns it.
test('the tanks may cross to the other serpent without the raid paying for it', async () => {
  const { w, vexhul, ithraz, max, gap, stationOf, walkAt, step, TICK_MS } = await leashBench('vexhul')
  w.player.pos.x = -7
  w.player.pos.y = -14
  for (let ms = 0; ms < 2000; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)
  assert.equal(w.raidHealthLow, 1, 'the raid bar moved before the swap this check is about')

  // Exactly what a clean Stone Breaker does to the seats.
  const other = ithraz.targetId
  vexhul.targetId = other
  ithraz.targetId = 0
  assert.ok(gap(ithraz) > max,
    'the two stations are close enough that a tank is already in range of the serpent they ' +
    'have just taken — there is no crossing here and this check measures nothing')

  let backAt = -1
  for (let ms = 0; ms < 3600 && backAt < 0; ms += TICK_MS) {
    step(w, walkAt(stationOf(ithraz)), TICK_MS)
    if (gap(ithraz) <= max) backAt = ms
  }
  assert.ok(backAt >= 0, 'a tank cannot cross to the other serpent inside the swap grace')
  assert.deepEqual([...w.failures.keys()], [],
    `a tank was scored for making the swap the fight asked for: ${[...w.failures.keys()].join(', ')}`)
  assert.equal(w.raidHealthLow, 1,
    `the raid bar fell to ${w.raidHealthLow} during a tank swap both tanks performed correctly`)
})

// A tank resting ON the line, which is where a tank ends up whenever the pull
// toward their serpent and whatever is shoving them the other way happen to
// cancel. The playtest harness found exactly that at seed 1337: the bot came to
// rest 12.0 yards from Ithraz and oscillated a fifth of a yard across the
// boundary at one tick each, and because every tick back inside cleared the
// clock, every tick back outside was a fresh departure. The debrief read Clotted
// Bolt x156 for one continuous mistake.
//
// The claim being pinned is the one the engine already made in a comment and did
// not keep: the BLAME is once per departure. The cost is not what is under test
// and is deliberately left alone — a tank sitting on their own leash line should
// still be paying for it.
test('a tank hovering on the leash line is blamed once, not once a frame', async () => {
  const { w, vexhul, max, gap, stationOf, step, TICK_MS } = await leashBench('vexhul')
  assert.equal(vexhul.targetId, 0, 'a tanking player no longer opens holding Vexhul')

  // Straight out from the serpent through the station the AI parks on, so the
  // two hover points are over real floor rather than out in the acid the
  // serpents are coiled in.
  const st = stationOf(vexhul)
  const ux = (st.x - vexhul.pos.x) / Math.hypot(st.x - vexhul.pos.x, st.y - vexhul.pos.y)
  const uy = (st.y - vexhul.pos.y) / Math.hypot(st.x - vexhul.pos.x, st.y - vexhul.pos.y)
  const at = yards => ({ x: vexhul.pos.x + ux * yards, y: vexhul.pos.y + uy * yards })

  // Settle inside first, so the pull's opening grace is spent and nothing below
  // is that window expiring.
  Object.assign(w.player.pos, at(max - 4))
  for (let ms = 0; ms < 8000; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)
  assert.deepEqual([...w.failures.keys()], [], 'the tank was scored before the hover began')

  // A fifth of a yard either side of the line, alternating every tick — a
  // hundredth of the drift a real body produces, and the smallest movement that
  // can straddle a single threshold.
  let flips = 0
  for (let ms = 0; ms < 6000; ms += TICK_MS) {
    Object.assign(w.player.pos, at(flips++ % 2 ? max + 0.1 : max - 0.1))
    step(w, NO_INPUT(), TICK_MS)
    if (!w.player.alive) break
  }
  assert.ok(flips > 100, 'the hover ended early — the tank died before the count could be read')
  assert.ok(gap(vexhul) > 0, 'the hover points collapsed onto the serpent')
  assert.equal(w.failures.get('spittle')?.count, 1,
    `Concentrated Spittle was recorded ${w.failures.get('spittle')?.count} times for a tank who ` +
    'left melee once and then sat on the line. A leash with one threshold is a leash a body ' +
    'straddles, and the debrief ends up counting frames instead of failures')
})

// The other half of the rule, and the half nobody watches: the AI tanks hold
// their own leashes. They are pulled at by every dodge in `allyThink` — flee the
// splash, relocate off the pool, pre-position for the knock — and any one of
// those walking them a yard too far costs the raid 30% a second for something no
// player did and no player can stop. A full pull of the real rotation, with the
// loop, the adds and the energy bar all running.
test('the AI tanks never walk out of melee on a full pull', async () => {
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  for (const seed of [1, 3, 7]) {
    seedRng(seed)
    // A HEALER, so both tanks are AI and every leash on the fight is theirs.
    const w = createWorld(boss, 'healer', 'green')
    let worst = 0
    let worstId = null
    for (let ms = 0; ms < 120000 && w.player.alive; ms += TICK_MS) {
      step(w, NO_INPUT(), TICK_MS)
      for (const [id, out] of Object.entries(w.leashOutMs)) {
        if (out > worst) { worst = out; worstId = id }
      }
    }
    assert.equal(worst, 0,
      `seed ${seed}: the AI tank on ${worstId} spent ${(worst / 1000).toFixed(2)}s out of range ` +
      'on a pull where nothing asked them to leave. The raid pays 30% a second for that, and ' +
      'the player has no way to stop it')
  }
})

// ── Uncoiled Wrath ────────────────────────────────────────────────────────────
//
// "If one dies and the other isnt dead within 5 seconds its a wipe due to
// uncoiled wrath." It used to be twelve seconds and 20% off the raid bar on a
// repeating clock — long enough to kill the second serpent from a third of its
// health, and cheap enough to eat four times and still take the kill.
test('leaving one serpent alive past the sync window ends the pull', async () => {
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const sync = boss.mechanics.find(m => m.rule.type === 'syncKill')
  assert.ok(sync, 'the Twin Fangs no longer forces a synchronised kill')
  const window = sync.rule.withinSec
  assert.ok(window <= 5,
    `the sync window is ${window}s. The raid leader's number is five, and it is the number ` +
    'the whole switch is timed against')

  seedRng(7)
  const w = createWorld(boss, 'healer', 'green')
  w.boss = {
    ...boss,
    loop: [], ambient: [], adds: [], atFullEnergy: undefined,
    energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
  }
  const vexhul = w.bosses.find(b => b.def.id === 'vexhul')
  const ithraz = w.bosses.find(b => b.def.id === 'ithraz')
  // Settle the raid first, so nothing below is the pull timer or a stray tick.
  for (let ms = 0; ms < 2000; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)
  vexhul.hp = 0
  vexhul.alive = false

  let died = -1
  for (let ms = 0; ms < (window + 4) * 1000 && died < 0; ms += TICK_MS) {
    step(w, NO_INPUT(), TICK_MS)
    if (!w.player.alive) died = ms
  }
  assert.ok(died >= 0,
    `one serpent was left alive for ${window + 4}s and the pull carried on. The survivor's ` +
    'rage is uncapped — there is no number of seconds at which this is survivable')
  assert.ok(died >= window * 1000 - 200,
    `the wipe landed at ${(died / 1000).toFixed(1)}s, inside the ${window}s the raid is given`)
  assert.ok(died < (window + 1) * 1000,
    `the wipe landed at ${(died / 1000).toFixed(1)}s against a ${window}s window — a grace ` +
    'nobody declared is a grace nobody can plan around')
  assert.ok(w.failures.has(sync.id),
    'nobody was named for a sync kill they overran, on a rule whose roles include every role')
  assert.equal(w.raidHealthLow, 0,
    'the debrief will report a comfortable raid bar beside a dead raid')
  assert.equal(ithraz.alive, true,
    'the surviving serpent died on its own, which is not the case being tested')
})

// The negative, and the reason the window is worth having: a raid that lands the
// switch takes the kill. Without this the check above is satisfied by a rule that
// simply kills you the moment one serpent dies.
test('killing both serpents inside the window is a clean kill', async () => {
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const sync = boss.mechanics.find(m => m.rule.type === 'syncKill')

  seedRng(7)
  const w = createWorld(boss, 'healer', 'green')
  w.boss = {
    ...boss,
    loop: [], ambient: [], adds: [], atFullEnergy: undefined,
    energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
  }
  const [vexhul, ithraz] = ['vexhul', 'ithraz'].map(id => w.bosses.find(b => b.def.id === id))
  for (let ms = 0; ms < 2000; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)
  vexhul.hp = 0
  vexhul.alive = false
  // A second and a half later, which is a switch a raid can actually make.
  for (let ms = 0; ms < 1500; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)
  ithraz.hp = 0
  ithraz.alive = false
  for (let ms = 0; ms < 4000; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)

  assert.equal(w.killed, true, 'both serpents are dead and the pull is not a kill')
  assert.equal(w.player.alive, true, `the raid wiped on a switch it made: ${w.deathCause}`)
  assert.equal(w.failures.has(sync.id), false,
    'a raid that killed them a second and a half apart was named for the sync')
})

// ── Ravenous Feast ────────────────────────────────────────────────────────────
//
// Hazard 4.1, which no single reading of this fight found because it needs three
// slices at once: the tank swap seats a player on Ithraz, the melee leash welds
// them within twelve yards of a serpent coiled at (8,-19), and Ravenous Feast is
// a fourteen-yard circle drawn from the same point. That tank is inside it on
// every cast and leaving is a raid wipe — so the naive rule feeds them on bite
// one and kills them on bite two, forever, for playing perfectly.
//
// The tests below are the halves of the answer, and they have to be a set: the
// exemption must not kill the tank, it must not become a general amnesty that
// stops the mechanic killing anybody, and the AI raid has to be able to walk the
// rota the mechanic is built around.

/**
 * A Twin Fangs pull with Ravenous Feast and nothing else.
 *
 * The loop, the ambient venom, the adds and the energy bar are all off, so every
 * stack that moves below was moved by this cast. `seat` decides who holds
 * Ithraz: 'player' swaps the tanks so the player is the welded body, 'ai' leaves
 * the AI tank on him so the player is judged like any other raider.
 */
async function feastBench(role, seat, seed = 7) {
  const { createWorld, fire, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const feast = boss.mechanics.find(m => m.id === 'feast')
  assert.ok(feast, 'Ravenous Feast is gone')
  assert.equal(feast.rule.type, 'shedStack',
    `Ravenous Feast is rule '${feast.rule.type}' — this bench measures a shedStack`)
  assert.equal(feast.origin, 'boss',
    'Ravenous Feast no longer comes out of Ithraz, so "the same place each time" is not a ' +
    'claim this bench can make')

  seedRng(seed)
  const w = createWorld(boss, role, 'green')
  w.boss = {
    ...boss,
    loop: [], ambient: [], adds: [], atFullEnergy: undefined,
    energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
  }
  const ithraz = w.bosses.find(b => b.def.id === 'ithraz')
  const vexhul = w.bosses.find(b => b.def.id === 'vexhul')
  if (seat === 'player') {
    const displaced = ithraz.targetId
    ithraz.targetId = 0
    vexhul.targetId = displaced
  }
  return { w, boss, feast, ithraz, vexhul, fire, step, TICK_MS }
}

// Hazard 4.1 itself. Three bites, a tank standing in every one of them because
// the leash gives them nowhere else to be, and at the end of it they are alive,
// unnamed — and carrying exactly what they walked in with, because the exemption
// that stops the Feast killing them also stops it feeding them.
test('Ravenous Feast does not kill the tank who cannot leave it', async () => {
  const { w, feast, ithraz, fire, step, TICK_MS } = await feastBench('tank', 'player')
  assert.equal(ithraz.targetId, 0, 'the player is not holding Ithraz — nothing here is welded')

  // On the station the ally AI parks its own tanks on: the nearest floor to
  // Ithraz, which is the only place this tank is allowed to stand.
  w.player.pos.x = 7.417
  w.player.pos.y = -14.087
  w.player.venom = 3
  const start = { ...w.player.pos }

  fire(w, 'feast')
  const inst = w.instances.find(i => i.def.id === 'feast')
  assert.ok(inst, 'firing Ravenous Feast produced no instance')
  const reach = Math.hypot(start.x - inst.pos.x, start.y - inst.pos.y)
  assert.ok(reach <= feast.shape.radius,
    `the Ithraz tank's own station is ${reach.toFixed(1)}yd from the bite against a ` +
    `${feast.shape.radius}yd radius — they are not inside it, so this test measures nothing. ` +
    'The hazard it exists for is that they ARE')

  // The whole cast: 4.25s of telegraph and two 2s gaps, with slack.
  //
  // Counted off `bitesLeft`, not off `resolved`. The re-arm runs at the bottom
  // of the same `resolveInstance` call that set `resolved`, so from outside
  // `step` that flag is only ever seen true after the LAST bite — watching it
  // reports one bite out of three and calls a working mechanic broken.
  const places = []
  let bites = 0
  let left = inst.bitesLeft
  for (let ms = 0; ms < 12000; ms += TICK_MS) {
    step(w, NO_INPUT(), TICK_MS)
    if (inst.bitesLeft !== left) {
      bites++
      places.push({ ...inst.pos })
      left = inst.bitesLeft
    }
    if (!w.instances.includes(inst)) break
  }

  assert.equal(bites, feast.rule.bites,
    `${bites} bites out of a cast that declares ${feast.rule.bites}`)
  // "It will expire 3 times but spawn in the same place each time." The re-arm
  // exists to make that literally true rather than approximately so.
  for (const p of places) {
    assert.ok(Math.hypot(p.x - places[0].x, p.y - places[0].y) < 0.001,
      'the three bites did not land in the same place — a raid cannot rotate three groups ' +
      'through a circle that moves')
  }

  assert.equal(w.player.alive, true,
    `the welded tank died: ${w.deathCause}. They cannot walk out of this circle without ` +
    'breaking a leash that wipes the raid, so the fight would be killing them for doing the ' +
    'one thing it requires')
  assert.deepEqual([...w.failures.keys()], [],
    `the welded tank was named for: ${[...w.failures.keys()].join(', ')}`)
  assert.equal(w.player.venom, 3,
    `the welded tank's count moved to ${w.player.venom}. The exemption is symmetric on ` +
    'purpose — a tank who cannot be killed by their own entity\'s soak cannot be fed by it ' +
    'either, and one who shed three times a cast without moving would make the economy free')
  assert.equal(w.venomShed, 0, 'the welded tank shed a stack they are exempt from shedding')
})

// The other half, and the reason the exemption has to be narrow. A dps who takes
// two bites of one cast dies for it, having got exactly one stack back — which is
// the whole rule the raid leader stated, in one measurement.
test('a dps who takes two bites of one Ravenous Feast dies with venom down exactly 1', async () => {
  const { w, ithraz, fire, step, TICK_MS } = await feastBench('dps', 'ai')
  assert.notEqual(ithraz.targetId, 0,
    'the player is holding Ithraz — this case needs an ordinary body')

  w.player.venom = 4
  fire(w, 'feast')
  const inst = w.instances.find(i => i.def.id === 'feast')
  assert.ok(inst, 'firing Ravenous Feast produced no instance')
  // Well inside it, and staying there. A player who does not move is the exact
  // mistake the mechanic punishes: every other soak in the raid rewards standing
  // in it for longer, and this one kills for it.
  w.player.pos.x = inst.pos.x
  w.player.pos.y = inst.pos.y + 5

  let afterFirst = null
  let died = -1
  for (let ms = 0; ms < 12000 && died < 0; ms += TICK_MS) {
    step(w, NO_INPUT(), TICK_MS)
    if (afterFirst === null && inst.fed?.includes(-1)) afterFirst = w.player.venom
    if (!w.player.alive) died = ms
  }

  assert.equal(afterFirst, 3,
    `the first bite took the player from 4 to ${afterFirst}. One stack per cast is the ` +
    'fight\'s central claim and the only thing pulling the other way')
  assert.ok(died >= 0,
    'a player stood in all three bites of a Ravenous Feast and lived. "Standing in the circle ' +
    'more than one time kills them" is the rule, and without it the correct play is to park ' +
    'in it and shed three')
  assert.match(w.deathCause ?? '', /Ravenous Feast/,
    `died of "${w.deathCause}" rather than of the bite that killed them`)
  assert.equal(w.player.venom, 3,
    `the player ended on ${w.player.venom} against the 4 they started with. The second bite ` +
    'is a death, not a second removal')
  assert.equal(w.venomShed, 1, `the debrief will report ${w.venomShed} stacks shed for one bite`)
  assert.equal(w.failures.get('feast')?.count, 1,
    `Ravenous Feast was recorded ${w.failures.get('feast')?.count ?? 0} times for one greedy cast`)
})

// The AI raid has to be able to play its own rota, or the player's half of the
// fight is unplayable: every bot that eats two bites is a body off the health bar
// and a share of the globule sweep gone. Nineteen raiders, one circle, three
// bites, and the engine's own answer to "who goes in".
//
// This one also pins the reason the rota exists at all. The melee ring sits about
// ten yards from Ithraz and the circle has a fourteen-yard radius, so the raid's
// DEFAULT formation is inside it: with no rota most of the raid is fed on bite
// one and dead on bite two, without anybody doing anything.
test('the AI raid rotates through the three bites and loses nobody', async () => {
  for (const seed of [1, 3, 7]) {
    const { w, feast, fire, step, TICK_MS } = await feastBench('healer', 'ai', seed)
    // A spread of counts, so the highest-venom-first ordering has work to do.
    for (const a of w.allies) a.venom = a.id % 4
    for (let ms = 0; ms < 3000; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)

    const before = w.alliesLost
    fire(w, 'feast')
    const inst = w.instances.find(i => i.def.id === 'feast')
    // Sampled on every change of `bitesLeft` — see the note in the tank test
    // above for why `resolved` is the wrong flag to watch from out here.
    const fedByBite = []
    let left = inst.bitesLeft
    for (let ms = 0; ms < 12000; ms += TICK_MS) {
      step(w, NO_INPUT(), TICK_MS)
      if (inst.bitesLeft !== left) {
        fedByBite.push((inst.fed ?? []).length)
        left = inst.bitesLeft
      }
      if (!w.instances.includes(inst)) break
    }

    assert.equal(w.alliesLost, before,
      `seed ${seed}: ${w.alliesLost - before} raiders were fed twice by one Ravenous Feast. ` +
      'A rota the AI cannot walk is a rota the player is watching fail')
    assert.equal(fedByBite.length, feast.rule.bites, `seed ${seed}: ${fedByBite.length} bites`)
    // Every bite has to feed somebody new, or two thirds of the cast is scenery
    // and "three groups, one per bite" is a sentence in a tooltip.
    for (let i = 1; i < fedByBite.length; i++) {
      assert.ok(fedByBite[i] > fedByBite[i - 1],
        `seed ${seed}: bite ${i + 1} fed nobody new (${fedByBite.join(' -> ')}). The raid is ` +
        'answering one bite and standing clear of the rest, which is not a rota')
    }
  }
})

// ── Stir the Depths ──────────────────────────────────────────────────────────
//
// Six waves out of the venom, one a second, each one running the length of the
// wedge. The argument for the whole mechanic is geometric — it has to be
// dodgeable on a concave floor with a hole bitten out of one edge, and it must
// never herd anybody at that hole — so the tests for it are measurements over
// the real polygon rather than assertions about fields.

/**
 * A Twin Fangs pull with Stir the Depths and nothing else on the floor.
 *
 * Same isolation `feastBench` uses and for the same reason: with the loop, the
 * ambient venom, the adds and the energy bar switched off, every shape measured
 * below was put there by this channel and every stack that moves was its doing.
 */
async function depthsBench(role, seed) {
  const eng = await engine()
  const { createWorld, seedRng, BOSSES } = eng
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const depths = boss.mechanics.find(m => m.id === 'depths')
  const wave = boss.mechanics.find(m => m.id === 'wave')

  assert.ok(depths, 'Stir the Depths is gone')
  assert.equal(depths.channel?.defId, 'wave',
    'Stir the Depths no longer channels its waves — everything below would measure nothing')
  assert.ok(wave, 'the Stir the Depths wave def is gone')
  assert.ok(wave.edgeArc, 'the wave no longer declares an edgeArc, which is what aims it inward')
  assert.equal(wave.origin, 'edge', `the wave rises from '${wave.origin}' rather than the rim`)
  assert.ok(wave.radialDrift && wave.driftSpeed,
    'the wave no longer travels on the bearing it was thrown — it would sit where it spawned')

  seedRng(seed)
  const w = createWorld(boss, role, 'green')
  w.boss = {
    ...boss,
    loop: [], ambient: [], adds: [], atFullEnergy: undefined,
    energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
  }
  return { ...eng, w, boss, depths, wave }
}

/** Every wave one channel produced, with where it came from and where it went. */
function runChannel(bench, seconds = 16) {
  const { w, step, fire, TICK_MS } = bench
  fire(w, 'depths')
  const seen = new Map()
  for (let i = 0; i < (seconds * 1000) / TICK_MS; i++) {
    step(w, NO_INPUT(), TICK_MS)
    for (const v of w.instances) {
      if (v.def.id !== 'wave') continue
      const rec = seen.get(v.uid)
      if (!rec) {
        seen.set(v.uid, { from: { ...v.pos }, last: { ...v.pos }, drift: { ...v.drift }, back: 0 })
        continue
      }
      // How far it has ever moved BACKWARD along its own heading. A bounce off
      // the far rim shows up here and nowhere else.
      const d = Math.hypot(rec.drift.x, rec.drift.y) || 1
      const along = ((v.pos.x - rec.last.x) * rec.drift.x + (v.pos.y - rec.last.y) * rec.drift.y) / d
      if (along < -0.01) rec.back += -along
      rec.last = { ...v.pos }
    }
  }
  return [...seen.values()]
}

// The shape of the mechanic, measured rather than declared: six waves, each one
// rising off the SOUTHERN rim and running up the room, none of them turning
// round, and none of them creeping toward the mouth fast enough to push anybody
// at the hole in the floor.
test('six waves rise off the mouth end of the wedge and run up the room', async () => {
  for (const seed of [1, 7, 1337]) {
    const bench = await depthsBench('dps', seed)
    const { wave, boss, edgeDistance } = bench
    const waves = runChannel(bench)

    assert.equal(waves.length, bench.depths.channel.count,
      `seed ${seed}: the channel put ${waves.length} waves out, not ` +
      `${bench.depths.channel.count} — "spawn 6 circles" is the spec's own number`)

    for (const v of waves) {
      const spawnDeg = (Math.atan2(v.from.y, v.from.x) * 180) / Math.PI
      assert.ok(spawnDeg >= wave.edgeArc.fromDeg - 0.01 && spawnDeg <= wave.edgeArc.toDeg + 0.01,
        `seed ${seed}: a wave rose on bearing ${spawnDeg.toFixed(1)}deg, outside the declared ` +
        `arc ${wave.edgeArc.fromDeg}-${wave.edgeArc.toDeg}. An arc that is not honoured is a ` +
        'wave coming out of the tanks’ ledge at the raid from behind')
      assert.ok(edgeDistance(boss, v.from) < 0.5,
        `seed ${seed}: a wave rose ${edgeDistance(boss, v.from).toFixed(1)}yd from any rim — ` +
        'it is supposed to come out of the venom, not appear in the middle of the room')

      // The whole anti-trap guarantee in one number. Every wave travels UP the
      // wedge, so a raider backing away from one walks north onto the widest
      // part of the floor. A wave with real southward speed would push the raid
      // down onto the mouth and into the venom pocket, which is not a dodge
      // anybody can make — you cannot outrun a wave by stepping into a hole.
      assert.ok(v.drift.y < wave.driftSpeed * 0.5,
        `seed ${seed}: a wave is travelling ${v.drift.y.toFixed(1)}yd/s toward the mouth. ` +
        'The southern rim is where the pocket is, and a wave heading that way herds the raid ' +
        'at it')

      assert.equal(v.back.toFixed(2), '0.00',
        `seed ${seed}: a wave travelled ${v.back.toFixed(1)}yd backward along its own heading. ` +
        'It bounced — the Axegrinder’s mechanic, not this one — which sends the swell back ' +
        'through a raid that had already read it and walked in behind it')

      const gone = Math.hypot(v.last.x - v.from.x, v.last.y - v.from.y)
      assert.ok(gone > 20,
        `seed ${seed}: a wave covered ${gone.toFixed(1)}yd. It is supposed to cross the ` +
        'platform, not break on the rim it came out of')
    }
  }
})

// The measurement the mechanic lives or dies by, on the floor it is played on.
//
// Rasterised at half-yard cells over the real wedge, sampled ten times a second
// for the whole channel, and the question asked at every sample is not "how much
// is covered" but "how far is the nearest clear cell" — computed as a flood fill
// out of the clear ground, so the answer is a distance a body could actually
// WALK rather than a straight line across the venom pocket.
//
// Two claims, and the second is the one the raid leader asked for. Nowhere on
// the floor is ever cut off; and the mouth end, where the pocket is, is no worse
// than anywhere else. A wave pattern that sealed the mouth would be a death
// sentence for whoever was standing in it, because the only way out is past the
// waves and the alternative is a hole.
test('Stir the Depths always leaves a step out, and never seals the mouth', async () => {
  const CELL = 0.5
  const X0 = -24, Y0 = -17
  const NX = Math.round(48 / CELL) + 1
  const NY = Math.round(39 / CELL) + 1

  let worstCover = 0, leastFree = Infinity, worstWalk = 0, worstMouthWalk = 0
  let samples = 0, cut = 0

  for (const seed of [1, 7, 1337]) {
    const bench = await depthsBench('dps', seed)
    const { w, step, fire, TICK_MS, inArena, isInside, boss } = bench

    // The floor, once. Same crossing test the engine uses, so the pocket is a
    // hole here exactly as it is a hole in play.
    const floor = new Uint8Array(NX * NY)
    const pts = []
    for (let ix = 0; ix < NX; ix++) {
      for (let iy = 0; iy < NY; iy++) {
        const x = X0 + ix * CELL, y = Y0 + iy * CELL
        if (inArena(boss, { x, y })) { floor[ix * NY + iy] = 1; pts.push([ix, iy, x, y]) }
      }
    }
    assert.ok(pts.length > 4000, `only ${pts.length} floor cells — the raster missed the room`)

    fire(w, 'depths')
    for (let i = 0; i < (16 * 1000) / TICK_MS; i++) {
      step(w, NO_INPUT(), TICK_MS)
      if (i % 6 !== 0) continue
      const waves = w.instances.filter(v => v.def.id === 'wave')
      if (!waves.length) continue
      samples++

      const covered = new Uint8Array(NX * NY)
      let nCov = 0
      for (const [ix, iy, x, y] of pts) {
        if (waves.some(v => isInside(v, { x, y }))) { covered[ix * NY + iy] = 1; nCov++ }
      }
      worstCover = Math.max(worstCover, (nCov / pts.length) * 100)
      leastFree = Math.min(leastFree, (pts.length - nCov) * CELL * CELL)

      // Flood fill out of every clear cell at once: `dd` ends up holding each
      // cell's walking distance to safety, in cells.
      const dd = new Int16Array(NX * NY).fill(-1)
      const q = []
      for (const [ix, iy] of pts) {
        const k = ix * NY + iy
        if (!covered[k]) { dd[k] = 0; q.push(k) }
      }
      for (let head = 0; head < q.length; head++) {
        const k = q[head]
        const ix = Math.floor(k / NY), iy = k % NY
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (!dx && !dy) continue
            const jx = ix + dx, jy = iy + dy
            if (jx < 0 || jy < 0 || jx >= NX || jy >= NY) continue
            const j = jx * NY + jy
            if (!floor[j] || dd[j] >= 0) continue
            dd[j] = dd[k] + 1
            q.push(j)
          }
        }
      }
      for (const [ix, iy, , y] of pts) {
        const d = dd[ix * NY + iy]
        if (d < 0) { cut++; continue }
        worstWalk = Math.max(worstWalk, d * CELL)
        if (y > 11) worstMouthWalk = Math.max(worstMouthWalk, d * CELL)
      }
    }
  }

  assert.ok(samples > 100, `only ${samples} samples — the channel is not being measured`)
  assert.equal(cut, 0,
    `${cut} cell-samples had no walkable route to clear ground at all. Somebody standing there ` +
    'is taking the stack whatever they do')
  // A fifth of the floor at the worst instant. Six four-yard circles on 1156
  // square yards is 20%, and the number is pinned because it is the one that
  // moves if anybody adds a seventh wave or widens the circles: at half the
  // floor the mechanic stops being a route to walk and becomes a dice roll.
  assert.ok(worstCover < 30,
    `the waves cover ${worstCover.toFixed(1)}% of the floor at their worst`)
  assert.ok(leastFree > 700,
    `only ${leastFree.toFixed(0)} square yards of the wedge are ever clear at once`)
  // Under a second of walking at PLAYER_SPEED 14, from anywhere, at any moment.
  assert.ok(worstWalk <= 10,
    `the worst spot on the floor is ${worstWalk.toFixed(1)}yd from safety`)
  assert.ok(worstMouthWalk <= worstWalk + 0.01,
    `the mouth end is ${worstMouthWalk.toFixed(1)}yd from safety against ` +
    `${worstWalk.toFixed(1)}yd everywhere else — the waves are sealing the one part of the ` +
    'room with a hole in it')
})

// The two halves of "off the floor", which are opposites, and the reason the
// retirement test is a dot product rather than a bare `inArena` check.
//
// This floor has a hole in it: the venom pocket is bitten out of the bottom
// edge, so `inArena` is false over the pocket exactly as it is false past the
// rim. Measured over ten seeds, roughly one wave in thirty crosses the corner of
// the notch and spends half a second over open venom in the middle of the room —
// and it has to come out the other side, because a wave that evaporated over the
// pocket would teach the raid that the hole is cover.
test('a wave crosses the venom pocket, and retires at the far rim', async () => {
  const bench = await depthsBench('dps', 7)
  const { w, step, fire, TICK_MS, inArena, wave, boss } = bench

  // The far rim first, driven rather than waited for: a wave is put outside the
  // top edge with its heading pointing further out, which is the state a wave
  // reaches after it has crossed.
  fire(w, 'wave')
  const out = w.instances.find(i => i.def.id === 'wave')
  assert.ok(out, 'firing a wave on its own produced no instance')
  for (let ms = 0; ms <= wave.telegraphMs + 200; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)
  assert.ok(w.instances.includes(out), 'the wave was gone before it had finished rising')
  out.pos = { x: 0, y: -16.4 }                       // just past the top edge
  out.drift = { x: 0, y: -wave.driftSpeed }          // and still going
  assert.equal(inArena(boss, out.pos), false, 'the test point is on the floor — nothing to retire')
  step(w, NO_INPUT(), TICK_MS)
  assert.equal(w.instances.includes(out), false,
    'a wave that crossed the platform is still in play. Either it bounced — which is the ' +
    'Axegrinder’s mechanic and would send it back through the raid — or it is drifting ' +
    'around in the venom sea being drawn as a hazard nobody can reach')

  // And the pocket: the same "outside the polygon" state, but still heading for
  // the middle of the room, so it keeps going.
  fire(w, 'wave')
  const over = w.instances.find(i => i.def.id === 'wave' && i !== out)
  assert.ok(over, 'firing a second wave produced no instance')
  for (let ms = 0; ms <= wave.telegraphMs + 200; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)
  over.pos = { x: 0, y: 18 }                         // inside the notch
  over.drift = { x: 0, y: -wave.driftSpeed }         // running up the room
  assert.equal(inArena(boss, over.pos), false, 'the venom pocket is no longer a hole in the floor')
  const was = { ...over.pos }
  step(w, NO_INPUT(), TICK_MS)
  assert.ok(w.instances.includes(over),
    'a wave crossing the venom pocket was deleted in mid-room. The pocket is a hole, not the ' +
    'far side of the platform, and a swell that vanishes over it teaches the raid that ' +
    'standing at the hole is cover')
  assert.ok(over.pos.y < was.y - 0.05,
    `the wave over the pocket stopped moving (${was.y.toFixed(2)} -> ${over.pos.y.toFixed(2)})`)
})

// One wave is one stack and one row, however long it sits on you.
//
// Both halves matter. The stack is what the mechanic costs — "touching these
// gives a stack of Eternal Venom" — and the single row is what makes the debrief
// readable: a wave rolls over a body for the best part of a second at sixty
// frames a second, and "Stir the Depths x54" would be counting frames rather
// than the one mistake that was made.
test('a wave that rolls over you costs one stack and names you once', async () => {
  const bench = await depthsBench('dps', 3)
  const { w, step, fire, TICK_MS, wave } = bench
  assert.equal(wave.applies?.hit, 1, 'the wave no longer applies a stack — this checks nothing')

  fire(w, 'wave')
  const inst = w.instances.find(i => i.def.id === 'wave')
  assert.ok(inst, 'firing a wave produced no instance')
  w.player.venom = 2

  // Parked in its path and left there. Standing still in front of a wave is the
  // mistake; it should cost exactly once.
  let touched = 0
  for (let ms = 0; ms < 5000 && w.instances.includes(inst); ms += TICK_MS) {
    w.player.pos.x = inst.pos.x
    w.player.pos.y = inst.pos.y
    step(w, NO_INPUT(), TICK_MS)
    touched++
  }

  assert.ok(touched > 60, `the wave was only in play for ${touched} frames`)
  assert.equal(w.player.venom, 3,
    `standing in one wave for ${touched} frames moved the count from 2 to ${w.player.venom}`)
  assert.equal(w.failures.get('wave')?.count, 1,
    `the debrief will read "Stir the Depths x${w.failures.get('wave')?.count ?? 0}" for one wave`)
})

// The gate, from the other side. `edgeArc` is a field rather than a test on
// `origin === 'edge'` for exactly one reason: the Coiled Altar's Axegrinder is
// the raid's other edge mechanic, and its own comment says it "comes off the
// wall and ricochets". The random facing and the bounce ARE that mechanic —
// suppress either of them globally and an axe that criss-crosses the room for
// five seconds becomes one that leaves on its first pass.
test('the Coiled Altar axes still come off any wall, and still ricochet', async () => {
  const { createWorld, fire, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'coiledaltar')
  const axe = boss.mechanics.find(m => m.id === 'axegrinder')
  assert.ok(axe, 'Axegrinder is gone')
  assert.equal(axe.origin, 'edge', `Axegrinder now spawns at '${axe.origin}'`)
  assert.equal(axe.edgeArc, undefined,
    'Axegrinder has been given an edgeArc, which turns it inward and stops it bouncing — it ' +
    'is supposed to ricochet')

  const bearings = []
  let bounces = 0
  for (const seed of [1, 2, 3, 5, 7]) {
    seedRng(seed)
    const w = createWorld(boss, 'dps', 'green')
    w.boss = {
      ...boss,
      loop: [], ambient: [], adds: [], atFullEnergy: undefined,
      energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
    }
    for (let cast = 0; cast < 4; cast++) {
      w.instances.length = 0
      fire(w, 'axegrinder')
      const inst = w.instances.find(i => i.def.id === 'axegrinder')
      if (!inst) continue
      bearings.push(Math.atan2(inst.pos.y, inst.pos.x))
      let sign = Math.sign(inst.drift.x)
      for (let ms = 0; ms < axe.telegraphMs + 500; ms += TICK_MS) {
        step(w, NO_INPUT(), TICK_MS)
        if (!w.instances.includes(inst)) break
        if (Math.sign(inst.drift.x) !== sign) { bounces++; sign = Math.sign(inst.drift.x) }
      }
    }
  }

  assert.ok(bearings.length >= 10, `only ${bearings.length} axes measured`)
  // Off any wall, not off half of them. An arc-gated spawn would bunch every one
  // of these into a 160-degree slice.
  const spread = Math.max(...bearings) - Math.min(...bearings)
  assert.ok(spread > Math.PI * 1.5,
    `${bearings.length} axes came off ${((spread * 180) / Math.PI).toFixed(0)} degrees of wall. ` +
    'Axegrinder spawns anywhere on the rim; this looks like the edgeArc gate has leaked')
  assert.ok(bounces > 0,
    'not one axe bounced in twenty casts. The bounce suppression was supposed to be gated on ' +
    'edgeArc — without that gate this fight loses its ricochet')
})

// ── Coiling Ichor ────────────────────────────────────────────────────────────
//
// The most clearly demonstrated defect in the whole plan, and its numbers are
// reproduced in the static sweep in invariants.test.js rather than asserted
// here: `minDistance: 26` selected 3.3% of this wedge, only TWO points of which
// were 12 yards apart, and the tanks' ledge — where two of the raid's bodies are
// welded — topped out at 18.87 and therefore failed automatically. What the
// runtime tests below add is the half a static sweep cannot see: that the
// mechanic really is dealt to three bodies, that the raid walks its two to
// different parts of the rim, and that an ally's carry can never be your row in
// the debrief.
async function ichorBench(role, seed) {
  const eng = await engine()
  const { createWorld, seedRng, BOSSES } = eng
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const ichor = boss.mechanics.find(m => m.id === 'ichor')
  const gore = boss.mechanics.find(m => m.id === 'gore')

  assert.ok(ichor, 'Coiling Ichor is gone')
  assert.equal(ichor.rule.type, 'carryOut', `Coiling Ichor is a ${ichor.rule.type} now`)
  assert.ok(ichor.carriers > 1,
    'Coiling Ichor no longer declares `carriers`, so it lands on one body and every '
    + 'assertion below about the raid doing it alongside you would be vacuous')
  assert.ok(ichor.rule.edgeWithin !== undefined && ichor.rule.apart !== undefined,
    'the rim and spread clauses are gone from the rule — this bench checks nothing')
  assert.ok(gore, 'Congealed Gore is gone')

  seedRng(seed)
  const w = createWorld(boss, role, 'green')
  // A quiet room, the way the Stir the Depths bench makes one. This is about
  // where three bodies walk; a rotation throwing knocks and waves at them
  // measures the rest of the fight instead.
  w.boss = {
    ...boss,
    loop: [], ambient: [], adds: [], atFullEnergy: undefined,
    energyPerSec: 0, pullLengthSec: 3600, phases: undefined,
  }
  return { ...eng, w, boss, ichor, gore }
}

/** Run one cast to its expiry and hand back the pools it left. */
function runIchor(bench) {
  const { w, step, fire, TICK_MS, ichor } = bench
  fire(w, 'ichor')
  const dealt = w.instances.filter(i => i.def.id === 'ichor')
  for (let ms = 0; ms <= ichor.telegraphMs + 500; ms += TICK_MS) step(w, NO_INPUT(), TICK_MS)
  return { dealt, pools: w.instances.filter(i => i.def.id === 'gore') }
}

// Three bodies, three pools, and the raid's two land where the rule says they
// must. The AI half is the half that used to be invisible: before `carriers` the
// debuff only ever landed on the player, so "the player and any ai bots that get
// this" was a line in the spec with nothing behind it — and the spread clause
// could never be exercised, because there was never a second carrier to spread
// away from.
test('Coiling Ichor is dealt to three bodies and the raid takes its two to the rim', async () => {
  const bench = await ichorBench('dps', 5)
  const { w, boss, ichor, edgeDistance } = bench
  const { dealt, pools } = runIchor(bench)

  assert.equal(dealt.length, ichor.carriers,
    `one cast produced ${dealt.length} debuffs for ${ichor.carriers} carriers`)
  assert.equal(dealt.filter(i => i.carriedByPlayer).length, 1,
    'exactly one of them is yours — a dps is in the rota, and watching the raid do it is not a rep')
  const holders = dealt.filter(i => !i.carriedByPlayer).map(i => w.carriers[i.uid])
  assert.equal(new Set(holders).size, holders.length,
    `the raid's carries went to ${holders.join(', ')} — two debuffs on one raider is one carry `
    + 'that silently never happened')
  assert.equal(pools.length, ichor.carriers,
    `${dealt.length} carries left ${pools.length} pools`)

  // The two the RAID took, identified by being somewhere other than the middle
  // of the room. The player's own is deliberately not asserted: this bench gives
  // them no input, and a player who stands still is supposed to fail.
  const theirs = pools.filter(p => Math.hypot(p.pos.x, p.pos.y) > ichor.rule.minDistance - 4)
  assert.ok(theirs.length >= 2, `only ${theirs.length} pools were carried anywhere`)
  for (const p of theirs) {
    const out = Math.hypot(p.pos.x, p.pos.y)
    assert.ok(out >= ichor.rule.minDistance - 1,
      `an AI carrier dropped ${out.toFixed(1)}yd from the middle against a ${ichor.rule.minDistance}yd `
      + 'rule. The station search is choosing somewhere the rule does not accept')
    assert.ok(edgeDistance(boss, p.pos) <= ichor.rule.edgeWithin,
      `an AI carrier dropped ${edgeDistance(boss, p.pos).toFixed(1)}yd off the rim against an `
      + `edgeWithin of ${ichor.rule.edgeWithin} — the arena inset in allyThink step 7 is hauling `
      + 'them back off the edge they were sent to')
  }
  let closest = Infinity
  for (let i = 0; i < theirs.length; i++) {
    for (let j = i + 1; j < theirs.length; j++) {
      closest = Math.min(closest,
        Math.hypot(theirs[i].pos.x - theirs[j].pos.x, theirs[i].pos.y - theirs[j].pos.y))
    }
  }
  assert.ok(closest >= ichor.rule.apart,
    `the raid's pools landed ${closest.toFixed(1)}yd apart against a ${ichor.rule.apart}yd spread. `
    + 'Both carriers walked to the same station, which is the pile-up the stations exist to stop')
})

// The spread is a real rule rather than decoration — and it is the one the old
// briefing never mentioned and the old prompt never shouted. A carrier who has
// walked the full distance out to the rim and then stands on another carrier has
// failed, and has to be told so while there is still time to move.
test('a carrier who parks on another carrier fails Coiling Ichor at full distance', async () => {
  const bench = await ichorBench('dps', 5)
  const { w, step, fire, TICK_MS, ichor, boss, edgeDistance, carryOutMisses } = bench

  fire(w, 'ichor')
  const mine = w.instances.find(i => i.def.id === 'ichor' && i.carriedByPlayer)
  const theirs = w.instances.find(i => i.def.id === 'ichor' && !i.carriedByPlayer)
  assert.ok(mine && theirs, 'the cast did not produce both a player carry and a raid carry')

  // Standing on their shoulder wherever the raid takes it. Distance: met. Rim:
  // met. The only thing wrong is that there are two of them there.
  const holder = w.allies.find(a => a.id === w.carriers[theirs.uid])
  assert.ok(holder, 'the raid carry has no holder')
  let sawTheShout = false
  for (let ms = 0; ms <= ichor.telegraphMs + 500; ms += TICK_MS) {
    w.player.pos.x = holder.pos.x
    w.player.pos.y = holder.pos.y
    step(w, NO_INPUT(), TICK_MS)
    if (mine.resolved) continue
    if (Math.hypot(mine.pos.x, mine.pos.y) < ichor.rule.minDistance) continue
    if (edgeDistance(boss, mine.pos) > ichor.rule.edgeWithin) continue
    assert.deepEqual(carryOutMisses(w, mine), ['apart'],
      `on another carrier at a legal rim spot the engine reads `
      + `${JSON.stringify(carryOutMisses(w, mine))}. The spread is the only thing wrong here, `
      + 'so it has to be the thing named')
    if (w.prompt?.mechanic === ichor.name) {
      assert.equal(w.prompt.verb, 'SPREAD — NOT ON ANOTHER CARRIER',
        `the prompt says "${w.prompt.verb}" while the resolve is about to fail you for the spread`)
      sawTheShout = true
    }
  }
  assert.ok(sawTheShout,
    'the prompt never once named the spread while the player stood on another carrier at the rim. '
    + 'A rule that is scored and never shouted is a rule the player finds out about in the debrief')
  assert.equal(w.failures.get('ichor')?.count, 1,
    'dropping a Coiling Ichor on top of another carrier at the rim was not scored. The distance is '
    + 'the easy half of this rule on a floor where 87% of the far band is already at the edge')
})

// The gate. Six of the raid's nine carry-outs are `targeted` and land on an ally
// better than a quarter of the time, and this one deals two to the raid on every
// cast — so an instance arriving at the resolve is as likely to be somebody
// else's as it is to be yours. Judged against the player's feet it blamed them
// for where a raider stood, and the `delete w.player.carrying` two lines further
// on wiped their own carry off the HUD while they were still holding it.
//
// A TANK, because on this fight that is the clean case: Coiling Ichor is
// `['dps','healer']` — the file's reason is that a tank running it out has left
// their serpent — so all three go to the raid and the player has nothing at all
// to answer for. Pinned at the Vexhul station, because the melee leash is judged
// continuously and would end the probe before the debuff expired.
test('an ally carrying a Coiling Ichor is never the player’s failure', async () => {
  const bench = await ichorBench('tank', 5)
  const { w, step, fire, TICK_MS, ichor, clampToArena, boss } = bench
  const vexhul = boss.entities.find(e => e.id === 'vexhul')
  const station = clampToArena(boss, vexhul.start, 2)

  fire(w, 'ichor')
  const dealt = w.instances.filter(i => i.def.id === 'ichor')
  assert.equal(dealt.length, ichor.carriers,
    `a tank's cast produced ${dealt.length} debuffs — the raid still has to carry them`)
  assert.equal(dealt.filter(i => i.carriedByPlayer).length, 0,
    'a tank was handed a Coiling Ichor. The def is dps/healer because a tank who runs one out has '
    + 'left their serpent, which is a wipe')

  let sawCarrying = false
  for (let ms = 0; ms <= ichor.telegraphMs + 1000; ms += TICK_MS) {
    w.player.pos.x = station.x
    w.player.pos.y = station.y
    step(w, NO_INPUT(), TICK_MS)
    if (w.player.carrying.ichor !== undefined) sawCarrying = true
  }

  assert.ok(w.player.alive, `the pinned tank died of ${w.deathCause} before the debuff expired`)
  assert.equal(sawCarrying, false,
    'the HUD showed the player carrying a Coiling Ichor that was dealt to the raid')
  assert.equal(w.failures.get('ichor'), undefined,
    'the player was named for a Coiling Ichor three raiders were carrying, from a station they are '
    + 'not allowed to leave')
})

// One rule, three surfaces. The briefing is read before the pull, the prompt is
// shouted during it and the resolve decides whether you failed — and until
// `carryOutClauses` they were three separate accounts of the same demand. On
// this mechanic they had already come apart: the panel promised a distance, the
// engine scored a distance AND a rim AND a spread, and a raider who did exactly
// what they were told still got a row in the debrief.
test('the Coiling Ichor briefing names every demand the resolve scores', async () => {
  buildSync({
    entryPoints: ['src/engine/brief.ts'], bundle: true, format: 'esm',
    outfile: `${OUT}/brief.mjs`, logLevel: 'error',
  })
  const { briefFor } = await import(`../${OUT}/brief.mjs`)
  const { BOSSES } = await engine()
  const ichor = BOSSES.find(b => b.key === 'twinfangs').mechanics.find(m => m.id === 'ichor')

  const line = briefFor(ichor, 'dps').line
  for (const n of [ichor.rule.minDistance, ichor.rule.edgeWithin, ichor.rule.apart]) {
    assert.match(line, new RegExp(`\\b${n}\\b`),
      `the briefing never mentions ${n}: "${line}". Every clause the resolve checks has to be in `
      + 'the sentence the player reads, or they are being taught a different mechanic from the one '
      + 'they are scored on')
  }

  // And the nine that declare neither clause must not have grown one. A carry on
  // a round floor asks for a distance and nothing else, and inventing a rim rule
  // for them would be this step leaking onto six other fights.
  for (const boss of BOSSES) {
    for (const m of boss.mechanics) {
      if (m.rule.type !== 'carryOut' || m.id === 'ichor') continue
      assert.equal(m.rule.edgeWithin, undefined, `${boss.key}/${m.id} grew an edgeWithin`)
      assert.equal(m.rule.apart, undefined, `${boss.key}/${m.id} grew an apart`)
      assert.equal(m.carriers, undefined, `${boss.key}/${m.id} grew a carriers count`)
      assert.doesNotMatch(briefFor(m, 'dps').line, /rim|carrier/,
        `${boss.key}/${m.id}'s briefing now talks about the rim or about other carriers, and its `
        + 'rule asks for neither')
    }
  }
})

// The gate, from the side that can actually observe it. A raid carry judged
// against the PLAYER's feet is a failure row with somebody else's name on it,
// and the `delete w.player.carrying` two lines further on takes the player's own
// debuff off the HUD while they are still holding it.
//
// The array is deliberately reordered so the raid's two resolve first. Nothing
// in the engine promises an order — instances resolve in whatever order they
// happen to sit in `w.instances`, and with three dealt at once and every one of
// them expiring on the same tick, WHICH of them is judged first decided whether
// the player was blamed. That is the defect stated exactly: the same three
// bodies, the same three drops, a different verdict depending on a uid.
test('an ally who drops a Coiling Ichor on the raid is not the player’s failure', async () => {
  const bench = await ichorBench('dps', 5)
  const { w, step, fire, TICK_MS, ichor, carryOutStation, carryOutSatisfied } = bench

  fire(w, 'ichor')
  const mine = w.instances.find(i => i.def.id === 'ichor' && i.carriedByPlayer)
  const theirs = w.instances.filter(i => i.def.id === 'ichor' && !i.carriedByPlayer)
  assert.ok(mine && theirs.length >= 1, 'the cast did not deal both a player carry and a raid carry')
  w.instances = [...theirs, ...w.instances.filter(i => !theirs.includes(i))]

  // One raider does it as badly as it can be done: stood in the middle of the
  // room with it when it expires, which is the whole failure this rule names.
  const stray = w.allies.find(a => a.id === w.carriers[theirs[0].uid])
  assert.ok(stray, 'the raid carry has no holder')
  // The player does it right, at a station nobody else was handed.
  const spot = carryOutStation(w, ichor, ichor.carriers - 1)

  for (let ms = 0; ms <= ichor.telegraphMs + 500; ms += TICK_MS) {
    w.player.pos.x = spot.x
    w.player.pos.y = spot.y
    stray.pos.x = 0
    stray.pos.y = 0
    step(w, NO_INPUT(), TICK_MS)
  }

  assert.ok(carryOutSatisfied(w, mine),
    'the probe parked the player somewhere the rule rejects, so it is measuring the player rather '
    + 'than the ally — pick a different station')
  assert.equal(w.failures.get('ichor'), undefined,
    'the player was named for a Coiling Ichor an ally dropped in the middle of the room, from a '
    + `rim spot ${Math.hypot(spot.x, spot.y).toFixed(1)}yd out that satisfies every clause of the rule`)
})

// ── the script ───────────────────────────────────────────────────────────────
//
// Everything below measures the SEQUENCE rather than the play, so the probe
// player is immortal and parked. That is not a way of dodging a hard test — it
// is the only way to ask the question. A pull that ends at fifty seconds because
// a do-nothing player walked into Stone Breaker tells you nothing about whether
// the third Submerge arrives in the right order, and the order is the claim.

/**
 * Run a Twin Fangs pull for `secs`, keeping the player on their feet, and log
 * every step the script casts.
 *
 * `sweepGlobules` simulates a raid that clears a Caustic Deluge the instant it
 * lands: it does exactly what the toucher branch in the linger tick does when a
 * body walks over a pickup — marks it answered and expires it — and nothing
 * else. It is the lever plan test 3 needs, because how fast the globules go is
 * the one thing about this fight that the RAID decides.
 */
async function runScript(eng, { secs = 250, seed = 7, role = 'dps', sweepGlobules = false } = {}) {
  const { createWorld, step, seedRng, TICK_MS, BOSSES } = eng
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  seedRng(seed)
  const w = createWorld(boss, role, 'green')
  const cast = []            // { id, t, phase, live, queued, spawnsAlive }
  const floods = []          // seconds at which each Vile Flood resolved
  const resolvedFloods = new Set()
  let firstEnrage = null
  let pending = null

  for (let i = 0; i < (secs * 1000) / TICK_MS; i++) {
    step(w, NO_INPUT(), TICK_MS)
    if (w.seqPending && w.seqPending !== pending) {
      cast.push({
        id: w.seqPending,
        t: w.elapsedMs / 1000,
        phase: w.phaseIndex,
        // What was still on the floor at the instant this was cast, by def id,
        // split by whether it had already gone off.
        live: w.instances.map(x => ({ id: x.def.id, resolved: x.resolved })),
        queued: w.queue.map(q => q.id),
        spawnsAlive: w.adds.filter(a => a.alive && a.def.id === 'spawn').length,
      })
    }
    pending = w.seqPending
    for (const inst of w.instances) {
      if (inst.def.id === 'flood' && inst.resolved && !resolvedFloods.has(inst.uid)) {
        resolvedFloods.add(inst.uid)
        floods.push(w.elapsedMs / 1000)
      }
    }
    if (!w.player.alive) {
      if (w.enraged && firstEnrage === null) {
        firstEnrage = { t: w.elapsedMs / 1000, cause: w.deathCause }
      }
      w.player.alive = true
      w.player.health = 1
      w.player.venom = 0
      w.killed = false
      w.deathCause = null
    }
    // Parked out on the right-hand leg — on the floor, out of the way, and
    // deliberately not moving, so nothing the player does can change the pace.
    w.player.pos.x = 17
    w.player.pos.y = 6
    w.raidHealth = 1
    if (sweepGlobules) {
      for (const inst of w.instances) {
        if (inst.def.id !== 'globule' || inst.resolved || inst.answered) continue
        inst.answered = true
        inst.timer = 0
      }
    }
  }
  return { w, boss, cast, floods, firstEnrage }
}

// PLAN TEST 1. The whole sequence slice in one assertion.
//
// Six steps in the cadence, one in the Submerge, and round again — nothing
// skipped, nothing out of place, however long the pull runs. This is what
// `sequential` is for, and it is also the check that catches the two subtler
// ways the script can come apart: `unlockedCount` drip-feeding the loop, which
// would run the first two steps over and over for the first half-minute, and a
// step whose closure never clears, which would stop the fight dead.
test('the Twin Fangs runs one script, in order, for the whole pull', async () => {
  const eng = await engine()
  const { cast, boss } = await runScript(eng, { secs: 250 })
  const cadence = boss.phases[0].loop
  const submerge = boss.phases[1].loop
  const want = [...cadence, ...submerge]

  assert.ok(cast.length >= want.length * 3,
    `only ${cast.length} steps in 250 seconds — the script stalls somewhere. Cast: ` +
    cast.map(c => `${c.id}@${c.t.toFixed(0)}`).join(' '))

  for (let i = 0; i < cast.length; i++) {
    assert.equal(cast[i].id, want[i % want.length],
      `step ${i} was ${cast[i].id} at ${cast[i].t.toFixed(1)}s, and the script says ` +
      `${want[i % want.length]}. Full order: ` + cast.map(c => c.id).join(' '))
  }
  // ...and the two stages really are alternating, rather than one stage
  // happening to contain everything.
  for (const c of cast) {
    assert.equal(c.phase, submerge.includes(c.id) ? 1 : 0,
      `${c.id} was cast in stage ${c.phase}`)
  }
})

/**
 * Every def id a step owns, walked out of the boss file rather than out of the
 * engine — see `stepClosure` in sim.ts for the rule this is a second opinion on.
 * A test that imported the engine's own answer would agree with it by
 * construction and catch nothing.
 */
function ownedBy(boss, id, out = new Set()) {
  if (out.has(id)) return out
  out.add(id)
  const def = boss.mechanics.find(m => m.id === id)
  if (!def) return out
  if (def.channel) ownedBy(boss, def.channel.defId, out)
  if (def.spawns) ownedBy(boss, def.spawns.defId, out)
  return out
}

// PLAN TEST 2. "The Stone Breaker and soaks do not happen at the same time as
// the Caustic Deluge and the Globules" — the raid leader's sentence, checked as
// a sentence rather than as a gap somebody tuned.
//
// Nothing enforces it directly. It falls out of the closure rule: a globule is a
// splash's child, a splash is a beat of the Deluge's channel, so the Deluge step
// is not over until the last pickup is gone. Which is why the Stone Breaker
// clause below is checked against the FLOOR — no Caustic Deluge object of any
// kind exists, resolved or otherwise — rather than against any flag the engine
// keeps.
test('nothing from the previous step is still in the air when the next one is cast', async () => {
  const eng = await engine()
  const { cast, boss } = await runScript(eng, { secs: 250 })
  const order = [...boss.phases[0].loop, ...boss.phases[1].loop]

  let checkedStoneBreaker = 0
  for (let i = 1; i < cast.length; i++) {
    const prev = order[(i - 1) % order.length]
    const owned = ownedBy(boss, prev)
    const stillGoing = cast[i].live.filter(l => owned.has(l.id) && !l.resolved)
    assert.equal(stillGoing.length, 0,
      `${cast[i].id} was cast at ${cast[i].t.toFixed(1)}s with ` +
      `${stillGoing.map(s => s.id).join(', ')} from the previous step (${prev}) still telegraphing`)
    const stillQueued = cast[i].queued.filter(q => owned.has(q))
    assert.equal(stillQueued.length, 0,
      `${cast[i].id} was cast with ${stillQueued.join(', ')} still queued by ${prev}`)

    if (cast[i].id !== 'stonebreaker') continue
    checkedStoneBreaker++
    const deluge = cast[i].live.filter(l => ownedBy(boss, 'deluge').has(l.id))
    assert.equal(deluge.length, 0,
      `Stone Breaker was cast at ${cast[i].t.toFixed(1)}s with ${deluge.length} Caustic Deluge ` +
      `object(s) still on the floor (${deluge.map(d => d.id).join(', ')}) — the one overlap the ` +
      'raid leader ruled out by name')
  }
  assert.ok(checkedStoneBreaker >= 3, `only ${checkedStoneBreaker} Stone Breakers were checked`)
})

// PLAN TEST 4, and the other half of the closure rule. It pulls in the exact
// opposite direction from the test above, which is the point: `summons` must NOT
// hold the beat, or "whilst the adds are being killed Ithraz casts Coiling
// Ichor" becomes "the fight stops until the raid finishes a kill". Collapse the
// two rules into one and whichever of these two tests you did not think about is
// the one that breaks.
test('Coiling Ichor is cast with the Spawn of Vexhul still up', async () => {
  const eng = await engine()
  const { cast } = await runScript(eng, { secs: 250 })
  const ichors = cast.filter(c => c.id === 'ichor')
  assert.ok(ichors.length >= 3, `only ${ichors.length} Coiling Ichors in 250 seconds`)
  for (const c of ichors) {
    assert.ok(c.spawnsAlive > 0,
      `Coiling Ichor was cast at ${c.t.toFixed(1)}s with no Spawn of Vexhul alive. Venomous ` +
      'Emergence is the step before it and its adds are supposed to still be spitting')
  }
})

// PLAN TEST 3. The gate is event-driven, not a metronome.
//
// Two identical pulls differing only in how fast the raid clears its globules.
// If the script were a clock with a dependency painted on it, both would reach
// their first Submerge at the same second; because it genuinely waits, the raid
// that sweeps buys back the whole tail of the Caustic Deluge step, every
// rotation, and arrives measurably sooner.
test('the script waits for the raid rather than for a clock', async () => {
  const eng = await engine()
  const slow = await runScript(eng, { secs: 250, sweepGlobules: false })
  const fast = await runScript(eng, { secs: 250, sweepGlobules: true })

  assert.ok(slow.floods.length >= 2 && fast.floods.length >= 2,
    `only ${slow.floods.length}/${fast.floods.length} Submerges were reached`)
  const gained = slow.floods[0] - fast.floods[0]
  assert.ok(gained > 3,
    'the raid that swept every globule the instant it landed reached its first Submerge ' +
    `${gained.toFixed(2)}s sooner (${fast.floods[0].toFixed(1)}s against ` +
    `${slow.floods[0].toFixed(1)}s). If that number is zero the gate is still a metronome; if it ` +
    'is under a second the closure is not really waiting for the pickups')
  // And it compounds, which is what makes it the pace of the fight rather than a
  // one-off saving at the start.
  assert.ok(slow.floods[1] - fast.floods[1] > gained,
    'the saving did not grow over two rotations, so only the first Deluge is being waited on')
})

// The third Submerge, and the one hard stop on this fight.
//
// "If the boss isnt dead by the 3rd submerge, the raid wipes." There is no
// machinery behind that at all: `energyPerSec` is zero, Vile Flood puts 34 on
// the bar, and a bar that fills with nothing to spend it already ends the pull.
// What this pins is the arithmetic — that it is the THIRD and not the second or
// the fourth — and that the death says so, which is the whole of
// `BossDef.enrageText`.
test('the third Submerge wipes the raid, and the debrief says which one', async () => {
  const eng = await engine()
  const { boss, floods, firstEnrage } = await runScript(eng, { secs: 250 })
  const flood = boss.mechanics.find(m => m.id === 'flood')

  assert.equal(boss.energyPerSec, 0,
    'something feeds the energy bar on a clock again, so the bar is no longer a Submerge counter')
  assert.equal(boss.atFullEnergy, undefined,
    'the bar has a spender again, which means it resets and three Submerges cost nothing')
  assert.ok(flood.energy * 3 > 100 && flood.energy * 2 <= 100,
    `Vile Flood puts ${flood.energy} on the bar, which wipes on Submerge number ` +
    `${Math.ceil(100 / flood.energy)} rather than the third`)

  assert.ok(firstEnrage, 'the pull never ended, so the third Submerge is not a wipe')
  assert.ok(floods.length >= 3, `only ${floods.length} Vile Floods resolved`)
  // Within a tick of the third beam switching on, and not the second.
  assert.ok(Math.abs(firstEnrage.t - floods[2]) < 0.1,
    `the wipe fired at ${firstEnrage.t.toFixed(1)}s and the third Vile Flood resolved at ` +
    `${floods[2].toFixed(1)}s`)
  assert.equal(firstEnrage.cause, boss.enrageText,
    `the debrief blamed "${firstEnrage.cause}" for a wipe the third Submerge caused`)
  assert.doesNotMatch(firstEnrage.cause, /bar filled/,
    'the generic enrage line is back, on a bar that is not a timer')
})

// The intermission moves both serpents and gives them back.
//
// Three separate promises, and the third would be an instant wipe if it were
// dropped: neither position is somewhere a body can stand, the tanks are not
// judged against a serpent that is thirty yards out in the acid, and both come
// home to exactly where the boss file coiled them.
test('Submerge takes both serpents off the floor and returns them', async () => {
  const eng = await engine()
  const { createWorld, step, seedRng, TICK_MS, BOSSES, inArena } = eng
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const relocate = boss.phases.find(p => p.id === 'submerge').relocate
  assert.equal(relocate.length, 2, 'the Submerge no longer moves both serpents')

  seedRng(7)
  const w = createWorld(boss, 'tank', 'green')
  let sawSubmerged = false
  let leashBrokeDuring = 0
  let restored = false
  let ticksIn = 0

  for (let i = 0; i < (200 * 1000) / TICK_MS; i++) {
    // Which stage the tick RAN in, not which one it ended in. A stage change
    // happens at the very bottom of `step`, so the tick that first reads
    // `phaseIndex === 1` afterwards was judged as a cadence tick throughout —
    // with both serpents still coiled and both leashes rightly live. Reading it
    // as an intermission tick would blame the Submerge for a tank who was out of
    // range a moment before it started.
    const ran = w.phaseIndex
    step(w, NO_INPUT(), TICK_MS)
    if (!w.player.alive) {
      w.player.alive = true
      w.player.health = 1
      w.player.venom = 0
      w.killed = false
      w.deathCause = null
    }
    w.player.pos.x = 17
    w.player.pos.y = 6
    w.raidHealth = 1
    if (ran === 1 && w.phaseIndex === 1) {
      ticksIn++
      sawSubmerged = true
      for (const r of relocate) {
        const unit = w.bosses.find(b => b.def.id === r.id)
        assert.equal(unit.pos.x, r.to.x, `${r.id} is not where the Submerge sent it`)
        assert.equal(unit.pos.y, r.to.y, `${r.id} is not where the Submerge sent it`)
        assert.equal(inArena(boss, unit.pos), false,
          `${r.id} submerged onto the floor at (${r.to.x},${r.to.y}) — the raid can stand on it, ` +
          'and the beam then comes out of a body somebody is standing in')
      }
      if (w.leashBroken) leashBrokeDuring++
    } else if (sawSubmerged) {
      restored = true
      for (const b of w.bosses) {
        assert.equal(b.pos.x, b.def.start.x, `${b.def.id} did not come home after the Submerge`)
        assert.equal(b.pos.y, b.def.start.y, `${b.def.id} did not come home after the Submerge`)
      }
      break
    }
  }
  assert.ok(sawSubmerged, 'the pull never reached a Submerge')
  assert.ok(ticksIn > 600, `the Submerge lasted ${((ticksIn * 50) / 3 / 1000).toFixed(1)}s`)
  assert.ok(restored, 'the pull never came back out of the Submerge')
  // Hazard 4.6. A leash judged against a serpent that has dived is a wipe for
  // doing what the stage asks, and the two tanks are the two bodies with the
  // least freedom to answer it.
  assert.equal(leashBrokeDuring, 0,
    `a melee leash was live for ${leashBrokeDuring} ticks of the intermission — both serpents are ` +
    'submerged and immune, so the raid was being drained for standing where it must stand')
  // The two of them have to read as coming from different places, or the beam
  // and the swirlies look like one mechanic.
  const [a, b] = relocate.map(r => r.to)
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 20,
    `the two submerged positions are only ${Math.hypot(a.x - b.x, a.y - b.y).toFixed(1)}yd apart`)
})

/**
 * A Vile Flood drill, with the room the intermission puts it in.
 *
 * A drill deliberately throws the stages away — "a drill that phased out from
 * under you would be a pull with extra steps" — but this mechanic is only ever
 * cast from the venom pocket, and every number in it is a fact about being cast
 * from there. So `createDrill` applies the stage's `relocate` even though it
 * drops the stage, and the assertion below is the only place that is checked.
 */
async function floodBench(seed = 7) {
  const eng = await engine()
  const { createDrill, seedRng, BOSSES } = eng
  const boss = BOSSES.find(b => b.key === 'twinfangs')
  const flood = boss.mechanics.find(m => m.id === 'flood')
  const pocket = boss.phases.find(p => p.id === 'submerge').relocate
    .find(r => r.id === 'vexhul').to

  assert.ok(flood.sweep, 'Vile Flood no longer sweeps — everything below would measure a still cone')
  assert.equal(flood.shape.kind, 'cone', 'Vile Flood is no longer a cone')
  assert.ok(flood.lingerMs > 0, 'Vile Flood has no linger, so the beam has no life to arc through')

  seedRng(seed)
  const w = createDrill(boss, 'dps', 'flood')
  const vexhul = w.bosses.find(b => b.def.id === 'vexhul')
  assert.equal(vexhul.pos.x, pocket.x,
    'the Vile Flood drill left Vexhul coiled on the ledge instead of down in the pocket — the ' +
    'beam then sweeps a different room from the one the intermission plays in')
  assert.equal(vexhul.pos.y, pocket.y, 'the Vile Flood drill did not move Vexhul into the pocket')

  // One beam at a time. The drill's own rotation would start a second Vile Flood
  // 3.5 seconds into a fourteen-second cast and the coverage figures would be
  // measuring two of them.
  w.boss = { ...w.boss, loop: [], ambient: [], adds: [] }
  return { ...eng, w, boss, flood, pocket }
}

// PLAN TEST 12, second half: VILE FLOOD ALWAYS LEAVES A LANE.
//
// "Vile Flood should slowly arc around the platform and leave enough space for
// the player at the end of the platform to also keep avoiding the sanguine storm
// so they manage this intermission without taking avoidable damage and
// unnecessary Eternal Venom stacks."
//
// That is a geometric promise about a beam, a cone width and a floor, and there
// is exactly one way to check it: rasterise the real polygon and step the real
// instance through its whole arc, asking at every sample how much of the room is
// under it and how much has never been under it at all. Six numbers, all
// measured, all of which move the moment anybody widens the cone, speeds up the
// sweep or reshapes the mouth.
//
// Both handednesses, because `mirror` alternates them and a lane that only
// exists one way round is a lane for every other Submerge.
test('Vile Flood always leaves a lane, whichever way it turns', async () => {
  const CELL = 0.25
  const bench = await floodBench()
  const { w, step, fire, TICK_MS, inArena, isInside, boss, flood, pocket } = bench

  const cells = []
  for (let x = -24; x <= 24; x += CELL) {
    for (let y = -17; y <= 22; y += CELL) {
      const p = { x, y }
      if (inArena(boss, p)) cells.push(p)
    }
  }
  const AREA = cells.length * CELL * CELL
  assert.ok(AREA > 1000, `only ${AREA.toFixed(0)} square yards of floor — the raster missed the room`)

  const furthest = Math.max(...cells.map(c => Math.hypot(c.x - pocket.x, c.y - pocket.y)))
  // The beam has to be able to touch every part of the floor it sweeps over. A
  // shorter reach leaves a ring of ground the cone passes through without ever
  // being dangerous, which reads as the mechanic being broken rather than as a
  // safe spot somebody earned.
  assert.ok(flood.shape.radius >= furthest,
    `the beam reaches ${flood.shape.radius}yd and the furthest floor from the pocket is ` +
    `${furthest.toFixed(2)}yd`)
  // The TRAILING edge at that furthest point is the fastest piece of floor the
  // beam covers, and it is what decides whether walking away from it is a
  // decision or a dice roll. 80% of PLAYER_SPEED, which is 14.
  const tip = ((flood.sweep.degPerSec * Math.PI) / 180) * furthest
  assert.ok(tip < 11,
    `the beam's far edge crosses the floor at ${tip.toFixed(2)} yd/s against a player's 14 — at ` +
    'that speed the raid cannot outwalk it and the arc stops being readable')

  // Two casts: the first as authored, the second mirrored.
  const runs = []
  for (let cast = 0; cast < 2; cast++) {
    fire(w, 'flood')
    const inst = w.instances.find(i => i.def.id === 'flood' && !i.resolved)
    assert.ok(inst, 'the drill did not put a Vile Flood in the air')

    const everSwept = new Uint8Array(cells.length)
    let peak = 0
    let leastClearNow = Infinity
    let atSwitchOn = -1
    let samples = 0
    let lastAngle = inst.angle

    for (let i = 0; i < ((flood.telegraphMs + flood.lingerMs + 500) / TICK_MS) | 0; i++) {
      step(w, NO_INPUT(), TICK_MS)
      const live = w.instances.find(x => x.uid === inst.uid)
      if (!live) break
      if (!live.resolved) continue
      if (i % 6 !== 0 && atSwitchOn >= 0) continue
      samples++
      let now = 0
      for (let c = 0; c < cells.length; c++) {
        if (!isInside(live, cells[c])) continue
        now++
        everSwept[c] = 1
      }
      // The instant it switches on. It has to come on over open water, or the
      // bodies standing where it starts are hit by something that was never
      // telegraphed anywhere on the floor.
      if (atSwitchOn < 0) atSwitchOn = now
      peak = Math.max(peak, now * CELL * CELL)
      leastClearNow = Math.min(leastClearNow, (cells.length - now) * CELL * CELL)
      lastAngle = live.angle
    }

    const reserve = everSwept.reduce((n, v) => n + (v ? 0 : 1), 0) * CELL * CELL
    runs.push({ peak, leastClearNow, reserve, atSwitchOn, samples, turned: lastAngle - inst.angle })
    // Let the beam and its swirlies clear before the next cast, so the second
    // run measures one beam and not two.
    for (let i = 0; i < 6000 / TICK_MS; i++) step(w, NO_INPUT(), TICK_MS)
  }

  for (const [i, r] of runs.entries()) {
    const which = i === 0 ? 'the beam' : 'the mirrored beam'
    assert.ok(r.samples > 40, `${which} was only sampled ${r.samples} times`)
    assert.equal(r.atSwitchOn, 0,
      `${which} had ${r.atSwitchOn} cells of floor inside it the instant it switched on. The ` +
      'sweep has to come on over the water and arrive already moving')
    assert.ok((r.peak / AREA) * 100 < 25,
      `${which} covers ${((r.peak / AREA) * 100).toFixed(1)}% of the platform at its worst — past ` +
      'a quarter of a floor this small it stops being a beam and becomes a wall')
    assert.ok(r.leastClearNow > 200,
      `${which} leaves only ${r.leastClearNow.toFixed(0)} square yards clear at its worst instant`)
    assert.ok(r.reserve > 200,
      `${which} sweeps all but ${r.reserve.toFixed(0)} square yards of the platform. There has to ` +
      'be an end of the room it never reaches, or "leave enough space for the player at the end ' +
      'of the platform" is not true and the intermission is unsurvivable standing still')
  }
  // ...and the second one really did go the other way, which is the whole of
  // what `mirror` buys: the half of the room that stays clear is the other half.
  assert.ok(runs[0].turned * runs[1].turned < 0,
    `both casts swept the same way (${runs[0].turned.toFixed(2)} and ` +
    `${runs[1].turned.toFixed(2)} radians), so a raid learns one answer and never has to read it`)
})

// ── the drill row is one button per mechanic ─────────────────────────────────
//
// The defect this pins was live for the whole of the Twin Fangs'
// implementation. Splitting a mechanic into a parent and its pieces — Caustic
// Deluge into deluge/splash/globule, Stone Breaker into stonebreaker/slam/
// pushoff, Stir the Depths into depths/wave, Vile Flood into flood/storm — was
// right, and every one of those pieces then appeared on the boss picker as a
// drill button of its own. Three of them read "Stone Breaker"; two read "Caustic
// Deluge"; one of them, `pushoff`, threw the raid off the platform and killed
// the player on every rep with nothing whatsoever to practise, because the
// mistake it answers is made in a mechanic that a `pushoff` drill never casts.
//
// The rule is ownership, not naming: a def named by another def's `channel`,
// `spawns` or `missFires` is a PIECE, and its parent is the drill. The exception
// runs the other way — a shapeless raidDamage parent that channels something you
// dodge IS the mechanic, and without it Caustic Deluge and Stir the Depths have
// no button at all.
//
// Both halves are asserted here rather than in a source grep because the rule is
// now a function over the boss data (`drillableMechanics`), and a grep would
// only prove the text of it, not the result.
test('no drill button is a piece of a mechanic, and every mechanic keeps one', async () => {
  const { BOSSES, drillableMechanics } = await engine()

  for (const boss of BOSSES) {
    const owned = new Map()
    for (const m of boss.mechanics) {
      if (m.channel) owned.set(m.channel.defId, `${m.id}.channel`)
      if (m.spawns) owned.set(m.spawns.defId, `${m.id}.spawns`)
      if (m.rule.type === 'tankSoak') owned.set(m.rule.missFires, `${m.id}.missFires`)
    }

    const drills = drillableMechanics(boss)
    assert.ok(drills.length >= 5,
      `${boss.key} offers only ${drills.length} drills — the filter has eaten the fight`)

    for (const m of drills) {
      assert.ok(!owned.has(m.id),
        `${boss.key}: "${m.name}" (${m.id}) is a drill button, but ${owned.get(m.id)} already ` +
        'owns it. A piece of a mechanic fired on its own is not the mechanic — it arrives out ' +
        'of nothing, with the cast that produces it nowhere on screen')
      assert.ok(m.shape || m.channel,
        `${boss.key}: "${m.name}" (${m.id}) has neither a shape nor a channel, so a drill of it ` +
        'is a rep with nothing to do')
    }

    // And the row must read as a list of mechanics, not as the same name three
    // times. This is the symptom a player actually sees.
    const names = drills.map(m => m.name)
    const dup = names.filter((n, i) => names.indexOf(n) !== i)
    assert.equal(dup.length, 0,
      `${boss.key}: the drill row shows ${[...new Set(dup)].join(', ')} more than once`)
  }

  // The Twin Fangs, exactly, because it is the fight that forced the rule and
  // the only one where getting it wrong loses a whole mechanic in either
  // direction. Six mechanics and the adds' Corrosive Spit — no orphans, no
  // pieces, and nothing that kills you for free.
  const tf = BOSSES.find(b => b.key === 'twinfangs')
  assert.deepEqual(
    drillableMechanics(tf).map(m => m.id).sort(),
    ['deluge', 'depths', 'feast', 'flood', 'ichor', 'spit', 'stonebreaker'],
    'the Twin Fangs drill row is not its seven mechanics. Either a piece has come back ' +
    '(splash, globule, slam, pushoff, wave, gore, storm) or a parent has dropped out')
})

// The half of the rule that is easy to lose: a shapeless `raidDamage` parent
// looks exactly like a healing check, and the first clause of the filter throws
// healing checks away. Caustic Deluge IS the drill for Caustic Deluge, and this
// proves the button does something — one press has to put circles on the floor
// and leave globules behind them, which is the entire mechanic.
test('drilling Caustic Deluge runs the whole chain, not just a cast bar', async () => {
  const { createDrill, step, seedRng, TICK_MS, BOSSES } = await engine()
  const boss = BOSSES.find(b => b.key === 'twinfangs')

  seedRng(11)
  const w = createDrill(boss, 'dps', 'deluge')
  const seen = new Set()
  // One cast is 1s of telegraph plus five beats, and each splash fuses for 2.5s
  // into a globule that lives 10s. Twelve seconds covers the chain end to end
  // without needing a second rep.
  for (let i = 0; i < 12000 / TICK_MS; i++) {
    step(w, NO_INPUT(), TICK_MS)
    for (const inst of w.instances) seen.add(inst.def.id)
  }

  for (const id of ['deluge', 'splash', 'globule']) {
    assert.ok(seen.has(id),
      `a Caustic Deluge drill never produced a ${id}. The parent is shapeless, so if the ` +
      'channel does not run there is nothing on the floor and the button is a cast bar')
  }
})
