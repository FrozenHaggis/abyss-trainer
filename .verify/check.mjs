import { createWorld, step, TICK_MS } from './sim.mjs'
import { BOSSES } from './registry.mjs'

const boss = (BOSSES.explorers ?? Object.values(BOSSES).find(b => b.key === 'explorers'))
if (!boss) { console.log('registry keys:', Object.keys(BOSSES)); process.exit(1) }

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function run(role, seed, style) {
  const w = createWorld(boss, role)
  let minPair = Infinity
  let linkedTicks = 0
  let pullPrompts = 0
  let kickPrompts = 0
  let kickSuppressed = 0
  let swaps = 0
  let lastHolders = w.bosses.map(b => b.targetId).join(',')
  let t = 0
  // deterministic-ish rng
  let s = seed
  Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }

  while (t < boss.pullLengthSec * 1000 && w.player.alive) {
    // movement style: 'flee' runs from the nearest instance, 'still' stands, 'chase' runs to centre
    let up = false, down = false, left = false, right = false
    if (style === 'wander') {
      const a = Math.sin(t / 900) * Math.PI * 2
      right = Math.cos(a) > 0.3; left = Math.cos(a) < -0.3
      down = Math.sin(a) > 0.3; up = Math.sin(a) < -0.3
    }
    const input = { up, down, left, right, pressed: [], aim: null, firing: true }
    step(w, input, TICK_MS)
    t += TICK_MS

    const live = w.bosses.filter(b => !b.def.untargetable && b.alive)
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++)
        minPair = Math.min(minPair, dist(live[i].pos, live[j].pos))

    if (w.bossesLinked) linkedTicks++
    const holders = w.bosses.map(b => b.targetId).join(',')
    if (holders !== lastHolders) { swaps++; lastHolders = holders }
    if (w.prompt) {
      if (w.prompt.verb === 'PULL THEM APART') {
        pullPrompts++
        // was there an unanswered interruptible press instance at this moment?
        const kickable = w.instances.some(i => !i.resolved && !i.answered
          && i.def.rule.type === 'press' && i.def.rule.ability === 'interrupt'
          && i.def.roles.includes(role))
        if (kickable) kickSuppressed++
      }
      if (w.prompt.verb === 'KICK IT') kickPrompts++
    }
  }
  return { role, style, seed, minPair: +minPair.toFixed(2), linkedTicks, pullPrompts,
           kickPrompts, kickSuppressed, swaps, survivedSec: +(t / 1000).toFixed(0),
           killed: w.killed }
}

const rows = []
for (const role of ['dps', 'healer', 'tank'])
  for (const style of ['still', 'wander'])
    for (const seed of [1, 7, 42, 1337, 90210])
      rows.push(run(role, seed, style))

console.table(rows)
console.log('minimum boss separation observed across all runs:',
  Math.min(...rows.map(r => r.minPair)).toFixed(2), 'yd  (link radius 30)')
console.log('total ticks linked:', rows.reduce((n, r) => n + r.linkedTicks, 0))
console.log('total PULL THEM APART prompts shown to a non-tank:',
  rows.filter(r => r.role !== 'tank').reduce((n, r) => n + r.pullPrompts, 0))
console.log('ticks where PULL THEM APART hid a live kick:',
  rows.reduce((n, r) => n + r.kickSuppressed, 0))
