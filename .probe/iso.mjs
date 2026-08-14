import { createWorld, step, TICK_MS } from './sim.mjs'
import { BOSSES } from './registry.mjs'
const explorers=BOSSES.find(b=>b.key==='explorers')
const D=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)
function minPair(w){let m=Infinity;const h=w.bosses.filter(b=>!b.def.untargetable&&b.alive)
  for(let i=0;i<h.length;i++)for(let j=i+1;j<h.length;j++)m=Math.min(m,D(h[i].pos,h[j].pos));return m}
function play(label,dodge,seconds=200){
  let s=42; Math.random=()=>(s=(s*1103515245+12345)&0x7fffffff)/0x7fffffff
  const w=createWorld(explorers,'tank')
  let linked=0,waves=0,prev=0,minSeen=Infinity
  const ticks=Math.round(seconds*1000/TICK_MS)
  for(let i=0;i<ticks;i++){
    if(!w.player.alive){w.player.alive=true;w.player.health=1;w.deathCause=null;w.raidHealth=Math.max(w.raidHealth,.8)} // revive: isolate geometry
    const bw=w.instances.find(x=>x.def.id==='blastwave'&&!x.resolved)
    if(bw&&!prev)waves++; prev=bw?1:0
    const inp={up:false,down:false,left:false,right:false,pressed:[],aim:null,firing:false}
    if(w.elapsedMs>2000&&!w.bosses.some(b=>b.targetId===0)&&!w.player.cooldowns.taunt)inp.pressed.push('taunt')
    const h=w.bosses.find(b=>b.targetId===0)
    const want=bw?dodge(w):(h?{...h.pos}:null)
    if(want){const dx=want.x-w.player.pos.x,dy=want.y-w.player.pos.y
      if(Math.hypot(dx,dy)>0.6){inp.right=dx>0.5;inp.left=dx<-0.5;inp.down=dy>0.5;inp.up=dy<-0.5}}
    step(w,inp,TICK_MS)
    if(w.bossesLinked)linked++
    minSeen=Math.min(minSeen,minPair(w))
  }
  console.log(`\n== ${label} ==`)
  console.log('  waves',waves,' closest any pair ever:',minSeen.toFixed(1),'yd (links under 30)')
  console.log('  linked ticks %',(linked/ticks*100).toFixed(1),' United Defense failures:',w.failures.get('united')?.count??0)
  console.log('  Blast Wave failures:',w.failures.get('blastwave')?.count??0)
}
const gp=w=>w.bosses.find(b=>b.def.id==='gebbo').pos
play("INWARD — into Gebbo's bubble",w=>({...gp(w)}))
play('OUTWARD — far crescent',w=>{const g=gp(w),l=Math.hypot(g.x,g.y)||1;return{x:-(g.x/l)*45,y:-(g.y/l)*45}})
