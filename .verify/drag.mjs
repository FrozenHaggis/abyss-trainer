import { createWorld, step, TICK_MS } from './sim.mjs'
import { BOSSES } from './registry.mjs'
const boss = BOSSES.find(b => b.key === 'explorers')
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

// A player TANK who deliberately drags their boss into another one.
function drag(role) {
  const w = createWorld(boss, role)
  let s = 42; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  let linked = 0, pull = 0, kickHidden = 0, minPair = Infinity, firstLinkSec = null
  let t = 0
  while (t < 90000) {
    w.player.alive = true; w.player.health = 1; w.raidHealth = 1
    const pressed = []
    if (!w.player.cooldowns.taunt) pressed.push('taunt')
    // Walk straight at Iku's station, dragging whatever we hold.
    const tgt = { x: 0, y: -26 }
    const dx = tgt.x - w.player.pos.x, dy = tgt.y - w.player.pos.y
    step(w, { up: dy < -0.5, down: dy > 0.5, left: dx < -0.5, right: dx > 0.5,
              pressed, aim: null, firing: false }, TICK_MS)
    t += TICK_MS
    const live = w.bosses.filter(b => !b.def.untargetable && b.alive)
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++)
      minPair = Math.min(minPair, dist(live[i].pos, live[j].pos))
    if (w.bossesLinked) { linked++; if (firstLinkSec === null) firstLinkSec = +(t / 1000).toFixed(1) }
    if (w.prompt?.verb === 'PULL THEM APART') {
      pull++
      if (w.instances.some(i => !i.resolved && !i.answered && i.def.rule.type === 'press'
        && i.def.rule.ability === 'interrupt' && i.def.roles.includes(role))) kickHidden++
    }
  }
  return { role, minPair: +minPair.toFixed(2), linkedTicks: linked, firstLinkSec,
           pullPrompts: pull, kickHidden, unitedFailures: w.failures.get('united')?.count ?? 0,
           hasTaunt: role === 'tank' }
}
for (const r of ['tank', 'dps', 'healer']) console.log(JSON.stringify(drag(r)))
