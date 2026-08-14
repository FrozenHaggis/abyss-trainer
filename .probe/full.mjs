import { createWorld, step, TICK_MS } from './sim.mjs'
import { BOSSES } from './registry.mjs'
const explorers = BOSSES.find(b => b.key === 'explorers')
const D = (a,b)=>Math.hypot(a.x-b.x,a.y-b.y)

function play(label, dodge, seconds = 150) {
  let s = 987654321
  Math.random = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const w = createWorld(explorers, 'tank')
  let linkedTicks = 0, linkFails = 0, wavesSeen = 0, wavesHit = 0
  let heldWhileDodging = new Set()
  const ticks = Math.round(seconds*1000/TICK_MS)
  let prevBW = 0
  for (let i=0;i<ticks;i++){
    if (!w.player.alive) break
    const bw = w.instances.find(x=>x.def.id==='blastwave' && !x.resolved)
    if (bw && !prevBW) wavesSeen++
    prevBW = bw ? 1 : 0
    const inp = {up:false,down:false,left:false,right:false,pressed:[],aim:null,firing:true}
    let want = null
    if (bw) {
      want = dodge(w, bw)
      const held = w.bosses.find(b=>b.targetId===0)
      if (held) heldWhileDodging.add(held.def.id)
    }
    if (want){
      const dx=want.x-w.player.pos.x, dy=want.y-w.player.pos.y
      if (Math.hypot(dx,dy)>0.6){ inp.right=dx>0.5; inp.left=dx<-0.5; inp.down=dy>0.5; inp.up=dy<-0.5 }
    }
    if (w.prompt?.verb==='TAUNT' && !w.player.cooldowns.taunt) inp.pressed.push('taunt')
    const before = w.failures.get('united')?.count ?? 0
    step(w, inp, TICK_MS)
    if (w.bossesLinked) linkedTicks++
    linkFails = w.failures.get('united')?.count ?? 0
  }
  const g = w.bosses.find(b=>b.def.id==='gebbo').pos
  console.log(`\n== ${label} ==`)
  console.log('  survived', (w.elapsedMs/1000).toFixed(0),'s  death:', w.deathCause ?? 'alive')
  console.log('  blast waves seen', wavesSeen)
  console.log('  entity held by player while dodging:', [...heldWhileDodging].join(',') || 'NONE')
  console.log('  linked ticks %', (linkedTicks/ticks*100).toFixed(1))
  console.log('  "Two explorers linked" failures:', linkFails)
  console.log('  all failures:', [...w.failures.values()].map(f=>`${f.name} x${f.count}`).join(' | ') || 'none')
}

const gebboPos = w => w.bosses.find(b=>b.def.id==='gebbo').pos
// the claim's assumed answer: run into Gebbo's 16yd bubble
play("INWARD — into Gebbo's bubble (the claim's premise)", w => ({ ...gebboPos(w) }))
// the alternative the claim says does not exist
play('OUTWARD — the far crescent beyond 60yd', w => {
  const g = gebboPos(w); const l = Math.hypot(g.x,g.y)||1
  return { x: -(g.x/l)*46, y: -(g.y/l)*46 }
})
