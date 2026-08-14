import { createDrill, step, TICK_MS, isInside } from './sim.mjs'
import { BOSSES } from './registry.mjs'

const explorers = BOSSES.find(b => b.key === 'explorers')
const GEBBO = { x: 22.5, y: 13 }
const D = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y)

// Drill Blast Wave as a TANK. Strategy under test: when a blastwave instance is
// live, run AWAY from Gebbo (the outer safe crescent), never into the bubble.
function play(strategy, seconds = 120) {
  const w = createDrill(explorers, 'tank', 'blastwave')
  // deterministic RNG so the run is reproducible
  let s = 12345
  Math.random = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const noInput = { up:false,down:false,left:false,right:false,pressed:[],aim:null,firing:false }
  let linkedTicks = 0, maxLinkedMs = 0, everLinked = false
  const ticks = Math.round(seconds * 1000 / TICK_MS)
  for (let i = 0; i < ticks; i++) {
    const inst = w.instances.find(x => x.def.id === 'blastwave' && !x.resolved)
    let want = null
    if (inst) want = strategy(w, inst)
    const inp = { ...noInput, pressed: [] }
    if (want) {
      const dx = want.x - w.player.pos.x, dy = want.y - w.player.pos.y
      if (Math.hypot(dx,dy) > 0.6) {
        inp.right = dx > 0.4; inp.left = dx < -0.4
        inp.down  = dy > 0.4; inp.up   = dy < -0.4
      }
    }
    // taunt on prompt, as the claim says the tank is forced to
    if (w.prompt?.verb === 'TAUNT' && !w.player.cooldowns.taunt) inp.pressed.push('taunt')
    step(w, inp, TICK_MS)
    if (w.bossesLinked) { linkedTicks++; everLinked = true; maxLinkedMs = Math.max(maxLinkedMs, w.linkedMs) }
  }
  return { w, linkedPct: (linkedTicks/ticks*100).toFixed(1), everLinked, maxLinkedMs,
           reps: w.drillReps, clean: w.drillClean,
           fails: [...w.failures.values()].map(f => `${f.name} x${f.count}`) }
}

// Strategy OUTWARD: stand beyond 60yd from Gebbo (the far crescent).
const outward = (w) => {
  // aim for the far rim point away from Gebbo, clamped inside the arena
  const g = w.bosses.find(b => b.def.id === 'gebbo').pos
  const len = Math.hypot(g.x, g.y) || 1
  const target = { x: -(g.x/len)*46, y: -(g.y/len)*46 }
  return target
}
// Strategy INWARD (what the claim assumes is the only answer): Gebbo's bubble.
const inward = (w) => {
  const g = w.bosses.find(b => b.def.id === 'gebbo').pos
  return { x: g.x, y: g.y }
}

for (const [name, strat] of [['OUTWARD (far crescent)', outward], ['INWARD (Gebbo bubble)', inward]]) {
  const r = play(strat)
  console.log(`\n== ${name} ==`)
  console.log('  drill reps', r.reps, 'clean', r.clean)
  console.log('  bossesLinked ticks %', r.linkedPct, 'ever linked:', r.everLinked)
  console.log('  failures:', r.fails.length ? r.fails.join(', ') : 'none')
  const g = r.w.bosses.find(b=>b.def.id==='gebbo').pos
  console.log('  final player dist from Gebbo', D(r.w.player.pos, g).toFixed(1), '(safe if <16 or >60)')
  for (const b of r.w.bosses.filter(b=>!b.def.untargetable)) {
    for (const c of r.w.bosses.filter(x=>!x.def.untargetable)) {
      if (b.def.id >= c.def.id) continue
      console.log(`   ${b.def.id}-${c.def.id}: ${D(b.pos,c.pos).toFixed(1)}yd`)
    }
  }
}
