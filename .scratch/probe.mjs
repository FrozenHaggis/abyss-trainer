import { createWorld, step } from './sim.mjs'
import { BOSSES } from './registry.mjs'

const boss = BOSSES.find(b => b.key === 'coiledaltar') ?? Object.values(BOSSES).find?.(b => b.key === 'coiledaltar')
if (!boss) { console.log('registry shape:', Object.keys(BOSSES)); process.exit(1) }

// A player who does NOTHING wrong that the orb rule can see: never fires,
// never moves toward orbs. We only care about whether orb failures appear.
for (const role of ['dps', 'healer', 'tank']) {
  const w = createWorld(boss, role)
  const input = { move: { x: 0, y: 0 }, firing: false, aim: null, abilities: {} }
  for (let t = 0; t < 150000; t += 16) {
    step(w, input, 16)
    if (!w.player.alive) break
  }
  const rows = [...w.failures.values()]
  console.log(role, '| t=', Math.round(w.elapsedMs / 1000) + 's', '| shotsFired=', w.shotsFired)
  for (const r of rows) console.log('   ', r.mechanicId, r.count, '::', r.failText)
}
