import { createWorld, step, buildResult, TICK_MS } from '../.playtest/sim.mjs'
import { sszorak } from '../.playtest/sszorak.mjs'

// Headless playtest: does the fight actually produce mechanics, failures and a
// result? Two simulated players — one who never moves, one who dodges perfectly.
function play(role, smart) {
  const w = createWorld(sszorak, role)
  const input = { up: false, down: false, left: false, right: false, pressed: [] }
  let ticks = 0
  while (w.player.alive && !w.killed && w.elapsedMs / 1000 < sszorak.pullLengthSec && ticks < 20000) {
    if (smart) {
      // Crude "good player": run from the nearest unresolved avoid-telegraph,
      // and keep inside the arena.
      let tx = 0, ty = 0
      // flee anything dangerous, resolved or not
      for (const i of w.instances) {
        if (!i.def.shape || i.def.rule.type !== 'avoid') continue
        const dx = w.player.pos.x - i.pos.x, dy = w.player.pos.y - i.pos.y
        const d = Math.hypot(dx, dy) || 1
        if (i.def.shape.kind === 'annulus') {
          // Safety is inward for a ring.
          if (d >= i.def.shape.inner - 2) { tx -= (dx / d) * 4; ty -= (dy / d) * 4 }
          continue
        }
        const reach = (i.def.shape.radius ?? 8) + 6
        if (d < reach) { tx += (dx / d) * (reach / d); ty += (dy / d) * (reach / d) }
      }
      // soak what must be soaked
      for (const i of w.instances) {
        if (i.resolved || i.def.rule.type !== 'beInside') continue
        const dx = i.pos.x - w.player.pos.x, dy = i.pos.y - w.player.pos.y
        const d = Math.hypot(dx, dy) || 1
        tx += (dx / d) * 2; ty += (dy / d) * 2
      }
      // carrying something? run it out
      const carrying = Object.keys(w.player.carrying).length > 0
      const r = Math.hypot(w.player.pos.x, w.player.pos.y) || 1
      if (carrying && r < 26) { tx += w.player.pos.x / r * 3; ty += w.player.pos.y / r * 3 }
      if (r > sszorak.arenaRadius * 0.62 && !carrying) { tx -= w.player.pos.x / r * 3; ty -= w.player.pos.y / r * 3 }
      input.right = tx > 0.1; input.left = tx < -0.1
      input.down = ty > 0.1; input.up = ty < -0.1
      if (w.elapsedMs % 900 < TICK_MS) input.pressed.push('dispel', 'interrupt')
    }
    step(w, input, TICK_MS)
    input.pressed.length = 0
    ticks++
  }
  const res = buildResult(w)
  return { res, w }
}

for (const [label, smart] of [['AFK player', false], ['dodging player', true]]) {
  for (const role of ['tank', 'healer', 'dps']) {
    const { res, w } = play(role, smart)
    const fails = res.failures.reduce((n, f) => n + f.count, 0)
    console.log(
      `${label.padEnd(15)} ${role.padEnd(7)} ` +
      `survived ${String(res.survivedSec).padStart(3)}s  ` +
      `boss ${String(Math.round(res.bossHpLeft * 100)).padStart(3)}%  ` +
      `mechanics ${String(res.mechanicsResolved).padStart(3)}  ` +
      `failures ${String(fails).padStart(3)}  ` +
      `${res.cleared ? 'KILL' : (res.deathCause || 'enrage')}`)
  }
}
