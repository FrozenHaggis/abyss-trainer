import { createWorld, step, TICK_MS } from './sim.mjs'
import { BOSSES } from './registry.mjs'
const explorers = BOSSES.find(b => b.key === 'explorers')
const D=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)

function play(label, dodge, seconds=150){
  let s=987654321; Math.random=()=>(s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff
  const w=createWorld(explorers,'tank')
  let linkedTicks=0, wavesSeen=0, prevBW=0, tauntedAt=null, held=null
  const ticks=Math.round(seconds*1000/TICK_MS)
  for(let i=0;i<ticks;i++){
    if(!w.player.alive) break
    const bw=w.instances.find(x=>x.def.id==='blastwave'&&!x.resolved)
    if(bw&&!prevBW) wavesSeen++
    prevBW=bw?1:0
    const inp={up:false,down:false,left:false,right:false,pressed:[],aim:null,firing:true}
    // Taunt at 2s and hold for the whole pull — the claim's "cannot opt out".
    if(w.elapsedMs>2000 && !w.bosses.some(b=>b.targetId===0) && !w.player.cooldowns.taunt){
      inp.pressed.push('taunt'); if(tauntedAt===null) tauntedAt=w.elapsedMs
    }
    let want=null
    if(bw) want=dodge(w,bw)
    else { const h=w.bosses.find(b=>b.targetId===0); if(h) want={...h.pos} } // stay in melee otherwise
    if(want){const dx=want.x-w.player.pos.x,dy=want.y-w.player.pos.y
      if(Math.hypot(dx,dy)>0.6){inp.right=dx>0.5;inp.left=dx<-0.5;inp.down=dy>0.5;inp.up=dy<-0.5}}
    step(w,inp,TICK_MS)
    const h=w.bosses.find(b=>b.targetId===0); if(h) held=h.def.id
    if(w.bossesLinked) linkedTicks++
  }
  console.log(`\n== ${label} ==`)
  console.log('  player held:',held,' waves:',wavesSeen,' survived',(w.elapsedMs/1000).toFixed(0)+'s')
  console.log('  linked ticks %',(linkedTicks/ticks*100).toFixed(1))
  console.log('  United Defense failures:',w.failures.get('united')?.count??0)
  console.log('  Blast Wave failures:',w.failures.get('blastwave')?.count??0,' death:',w.deathCause??'alive')
}
const gp=w=>w.bosses.find(b=>b.def.id==='gebbo').pos
play("INWARD — tank drags its explorer into Gebbo's 16yd bubble", w=>({...gp(w)}))
play('OUTWARD — tank walks its explorer to the far crescent (>60yd from Gebbo)', w=>{
  const g=gp(w),l=Math.hypot(g.x,g.y)||1; return {x:-(g.x/l)*45,y:-(g.y/l)*45}})
