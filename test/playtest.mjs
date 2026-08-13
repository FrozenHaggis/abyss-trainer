import { createWorld, step, buildResult, TICK_MS } from '../.playtest/sim.mjs'
import { BOSSES } from '../.playtest/registry.mjs'

// Headless playtest across every boss and every role.
//
// The bar: a careless player dies, a competent one kills it, dps fastest and
// healer slowest. Check balance changes against this rather than by eye — it
// has already caught an annulus being fled outward off the platform, pools
// detonating on the carrier who dropped them, and a tank dying to a dispel they
// cannot cast.
//
// It previously ran Sszorak alone while the README claimed eight bosses. Now it
// runs the registry, so a boss that cannot be cleared cannot hide.

function play(boss, role, smart) {
  const w = createWorld(boss, role)
  const input = {
    up: false, down: false, left: false, right: false, pressed: [],
    aim: null, firing: false,
  }
  let ticks = 0
  while (w.player.alive && !w.killed && w.elapsedMs / 1000 < boss.pullLengthSec && ticks < 40000) {
    if (smart) {
      // Crude "good player": run from the nearest unresolved avoid-telegraph,
      // soak what needs soaking, run debuffs out, stay on the platform.
      let tx = 0, ty = 0
      for (const i of w.instances) {
        if (!i.def.shape || i.def.rule.type !== 'avoid') continue
        // A one-shot outranks everything else on screen. A player who knows the
        // fight drops whatever they are doing for it, so the bot must too —
        // otherwise the clear rate measures the bot's indifference to lethality
        // rather than whether the fight is survivable.
        const weight = i.def.lethal ? 6 : 1
        const dx = w.player.pos.x - i.pos.x, dy = w.player.pos.y - i.pos.y
        const d = Math.hypot(dx, dy) || 1
        if (i.def.shape.kind === 'annulus') {
          // Safety is inward for a ring.
          if (d >= i.def.shape.inner - 2) { tx -= (dx / d) * 4 * weight; ty -= (dy / d) * 4 * weight }
          continue
        }
        const reach = (i.def.shape.radius ?? 8) + 6
        if (d < reach) { tx += (dx / d) * (reach / d) * weight; ty += (dy / d) * (reach / d) * weight }
      }
      // Run over pickups — a globule nobody eats ruptures on the whole raid.
      let near = null, nd = Infinity
      for (const i of w.instances) {
        if (i.resolved || i.answered || i.def.rule.type !== 'collect') continue
        const d = Math.hypot(i.pos.x - w.player.pos.x, i.pos.y - w.player.pos.y)
        if (d < nd) { nd = d; near = i }
      }
      if (near) {
        tx += (near.pos.x - w.player.pos.x) / (nd || 1) * 4
        ty += (near.pos.y - w.player.pos.y) / (nd || 1) * 4
      }

      for (const i of w.instances) {
        if (i.resolved || i.def.rule.type !== 'beInside') continue
        // A Deadly soak is as urgent as a Deadly puddle. Weighting only the
        // fleeing made the bot run away from soaks it had to be standing in.
        const weight = i.def.lethal ? 6 : 2
        const dx = i.pos.x - w.player.pos.x, dy = i.pos.y - w.player.pos.y
        const d = Math.hypot(dx, dy) || 1
        tx += (dx / d) * weight; ty += (dy / d) * weight
      }
      const carrying = Object.keys(w.player.carrying).length > 0
      const r = Math.hypot(w.player.pos.x, w.player.pos.y) || 1
      if (carrying && r < 26) { tx += w.player.pos.x / r * 3; ty += w.player.pos.y / r * 3 }
      // The rim is a hard constraint, not a preference — falling off is an
      // instant death. It has to outweigh every other pull, or the bot chases a
      // soak straight over the edge, which is exactly what it started doing the
      // moment lethal soaks were weighted up.
      if (r > boss.arenaRadius * 0.66) {
        const push = 14 * (r / boss.arenaRadius)
        tx -= (w.player.pos.x / r) * push; ty -= (w.player.pos.y / r) * push
      }
      input.right = tx > 0.1; input.left = tx < -0.1
      input.down = ty > 0.1; input.up = ty < -0.1

      // Adds come first. A real player swaps to them the moment they land, and
      // a bot that ignores them measures nothing except how fast the raid bar
      // empties — which is what it did when adds were first switched on.
      let target = null
      let td = Infinity
      for (const a of w.adds) {
        if (!a.alive || a.def.job === 'leave') continue   // never shoot an orb
        const d = Math.hypot(a.pos.x - w.player.pos.x, a.pos.y - w.player.pos.y)
        // Intercept adds are blocked with your body, not shot.
        if (a.def.job === 'intercept') {
          if (d < td) { td = d; tx += (a.pos.x - w.player.pos.x) / (d || 1) * 3; ty += (a.pos.y - w.player.pos.y) / (d || 1) * 3 }
          continue
        }
        // Only URGENT adds pull damage off the boss: one whose fuse is running
        // out, or one that still has a shield to break. A bot that shot every
        // add on sight never touched the boss at all on the add-heavy fights —
        // 98% accuracy and 98% boss health, because every shot went into crates.
        const urgent = a.def.fuseSec >= 900 ? false : (a.fuse ?? 0) < 9000 || a.shield > 0
        if (!urgent) continue
        if (d < td) { td = d; target = a }
      }
      input.firing = true
      input.aim = target ? { x: target.pos.x, y: target.pos.y } : null

      // Kick on sight when an add is winding up, otherwise tick over.
      const casting = w.adds.some(a => a.alive && a.def.job === 'kick' && a.castMs >= 0 && !a.kicked)
      if (casting) input.pressed.push('interrupt')
      if (w.elapsedMs % 900 < TICK_MS) input.pressed.push('dispel', 'interrupt')
    }
    step(w, input, TICK_MS)
    input.pressed.length = 0
    ticks++
  }
  return buildResult(w)
}

const pad = (s, n) => String(s).padEnd(n)
let clears = 0, expected = 0

for (const [label, smart] of [['careless', false], ['competent', true]]) {
  console.log(`\n── ${label} player ──`)
  for (const boss of BOSSES) {
    for (const role of ['tank', 'healer', 'dps']) {
      const res = play(boss, role, smart)
      const fails = res.failures.reduce((n, f) => n + f.count, 0)
      const acc = res.shotsFired ? Math.round((res.shotsHit / res.shotsFired) * 100) : 0
      if (smart) { expected++; if (res.cleared) clears++ }
      console.log(
        `  ${pad(boss.key, 12)} ${pad(role, 7)} ` +
        `${String(res.survivedSec).padStart(3)}s  ` +
        `boss ${String(Math.round(res.bossHpLeft * 100)).padStart(3)}%  ` +
        `acc ${String(acc).padStart(3)}%  ` +
        `mech ${String(res.mechanicsResolved).padStart(3)}  ` +
        `fails ${String(fails).padStart(3)}  ` +
        `${res.cleared ? 'KILL' : (res.deathCause || 'enrage')}`)
    }
  }
}

console.log(`\ncompetent clears: ${clears}/${expected}`)
