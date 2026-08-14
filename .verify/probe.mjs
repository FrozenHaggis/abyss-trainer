import { createWorld, step, TICK_MS } from './sim.mjs'
import { BOSSES } from './registry.mjs'

const boss = BOSSES.find(b => b.key === 'explorers')
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function run(role, seed, immortal, taunt) {
  const w = createWorld(boss, role)
  let s = seed
  Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  let minPair = Infinity, worst = null, linkedTicks = 0, pull = 0, kickHidden = 0
  let t = 0
  while (t < boss.pullLengthSec * 1000) {
    if (immortal) { w.player.alive = true; w.player.health = 1; w.raidHealth = Math.max(w.raidHealth, 0.9) }
    let up = false, down = false, left = false, right = false
    const pressed = []
    if (taunt) {
      // A player tank deliberately dragging: taunt on cd and walk toward the other station.
      if (!w.player.cooldowns.taunt) pressed.push('taunt')
      // walk toward nama's station
      const tgt = { x: -22.5, y: 13 }
      right = w.player.pos.x < tgt.x - 1 ? false : true
      left = w.player.pos.x > tgt.x + 1
      down = w.player.pos.y < tgt.y - 1
      up = w.player.pos.y > tgt.y + 1
      right = w.player.pos.x < tgt.x - 1
    }
    step(w, { up, down, left, right, pressed, aim: null, firing: true }, TICK_MS)
    t += TICK_MS
    const live = w.bosses.filter(b => !b.def.untargetable && b.alive)
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const d = dist(live[i].pos, live[j].pos)
      if (d < minPair) {
        minPair = d
        worst = {
          atSec: +(t / 1000).toFixed(1), pair: `${live[i].def.id}/${live[j].def.id}`, d: +d.toFixed(2),
          posA: { x: +live[i].pos.x.toFixed(1), y: +live[i].pos.y.toFixed(1), tank: live[i].targetId },
          posB: { x: +live[j].pos.x.toFixed(1), y: +live[j].pos.y.toFixed(1), tank: live[j].targetId },
          tanksAlive: w.allies.filter(a => a.role === 'tank' && a.alive).length,
        }
      }
    }
    if (w.bossesLinked) linkedTicks++
    if (w.prompt?.verb === 'PULL THEM APART') {
      pull++
      if (w.instances.some(i => !i.resolved && !i.answered && i.def.rule.type === 'press'
        && i.def.rule.ability === 'interrupt' && i.def.roles.includes(role))) kickHidden++
    }
  }
  return { role, seed, immortal: !!immortal, taunt: !!taunt, minPair: +minPair.toFixed(2),
           linkedTicks, pullPrompts: pull, kickHidden, worst,
           unitedFailures: w.failures.get('united')?.count ?? 0 }
}

const out = []
for (const seed of [1, 7, 42, 1337, 90210, 555, 8888])
  for (const role of ['dps', 'healer'])
    out.push(run(role, seed, true, false))
out.push(run('tank', 42, true, false))
out.push(run('tank', 42, true, true))   // player tank deliberately dragging a boss

for (const r of out) console.log(JSON.stringify(r))
console.log('\nGLOBAL MIN SEPARATION:', Math.min(...out.map(r => r.minPair)).toFixed(2), '(link at 30)')
console.log('non-tank linked ticks:', out.filter(r => r.role !== 'tank').reduce((n, r) => n + r.linkedTicks, 0))
console.log('non-tank PULL THEM APART prompts:', out.filter(r => r.role !== 'tank').reduce((n, r) => n + r.pullPrompts, 0))
console.log('non-tank United Defense failures scored:', out.filter(r => r.role !== 'tank').reduce((n, r) => n + r.unitedFailures, 0))
