import type { Instance, Role, Vec } from './types'
import type { World } from './sim'
import { ROLE_COLOUR, ROLE_PATH_2D } from '../ui/RoleIcon'
import { BOSS_SIGILS, sigilPath } from '../assets/bossSigils'

// Canvas rendering. One layer, drawn back-to-front every frame.
//
// Colour encodes the VERB, not the ability: red = get out, green = get in,
// violet = go here. You can read a telegraph before you read its name, which is
// what makes the arena legible at speed.

const RED = '248, 81, 73'      // avoid
const GREEN = '47, 227, 160'   // be inside
const VIOLET = '124, 77, 255'  // marker / carry
const LIME = '182, 255, 92'    // player

export interface Camera {
  cx: number
  cy: number
  scale: number // pixels per yard
}

export function makeCamera(w: number, h: number, arenaRadius: number): Camera {
  // Fit the arena with a small margin, so the edge is always visible — you
  // cannot judge a knockback you cannot see the edge of.
  const scale = (Math.min(w, h) / 2 - 24) / arenaRadius
  return { cx: w / 2, cy: h / 2, scale }
}

const toPx = (cam: Camera, v: Vec) => ({ x: cam.cx + v.x * cam.scale, y: cam.cy + v.y * cam.scale })

function ruleColour(inst: Instance): string {
  switch (inst.def.rule.type) {
    case 'beInside': return GREEN
    case 'collect': return GREEN
    case 'carryOut': return VIOLET
    case 'press': return VIOLET
    case 'survive': return VIOLET
    default: return RED
  }
}

/** 0 at spawn, 1 at resolve — telegraphs fill as they approach. */
function progress(inst: Instance): number {
  if (inst.resolved) return 1
  const total = Math.max(1, inst.def.telegraphMs)
  return Math.min(1, 1 - inst.timer / total)
}

function pathShape(ctx: CanvasRenderingContext2D, cam: Camera, inst: Instance) {
  const p = toPx(cam, inst.pos)
  const s = inst.def.shape!
  ctx.beginPath()
  switch (s.kind) {
    case 'circle':
      ctx.arc(p.x, p.y, s.radius * cam.scale, 0, Math.PI * 2)
      break
    case 'annulus':
      ctx.arc(p.x, p.y, s.outer * cam.scale, 0, Math.PI * 2)
      ctx.arc(p.x, p.y, s.inner * cam.scale, 0, Math.PI * 2, true)
      break
    case 'cone': {
      const half = (s.arcDeg * Math.PI) / 360
      ctx.moveTo(p.x, p.y)
      ctx.arc(p.x, p.y, s.radius * cam.scale, inst.angle - half, inst.angle + half)
      ctx.closePath()
      break
    }
    case 'line': {
      const ca = Math.cos(inst.angle), sa = Math.sin(inst.angle)
      const hw = (s.width / 2) * cam.scale
      const L = s.length * cam.scale
      ctx.moveTo(p.x - sa * hw, p.y + ca * hw)
      ctx.lineTo(p.x + ca * L - sa * hw, p.y + sa * L + ca * hw)
      ctx.lineTo(p.x + ca * L + sa * hw, p.y + sa * L - ca * hw)
      ctx.lineTo(p.x + sa * hw, p.y - ca * hw)
      ctx.closePath()
      break
    }
  }
}

/**
 * Draw a role silhouette centred on (cx, cy) at the given pixel size. The 24x24
 * viewBox of the icon paths is scaled and translated into place; `health` fades
 * the glyph so a hurt raider is visibly hurt.
 */
function drawGlyph(
  ctx: CanvasRenderingContext2D, role: Role, cx: number, cy: number,
  size: number, health: number, presence = 1,
) {
  const k = size / 24
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(k, k)
  ctx.globalAlpha = (0.35 + 0.65 * Math.max(0, Math.min(1, health))) * presence
  ctx.fill(ROLE_PATH_2D[role])
  ctx.restore()
  ctx.globalAlpha = 1
}

export function render(ctx: CanvasRenderingContext2D, w: World, cam: Camera, width: number, height: number) {
  ctx.save()
  if (w.shake > 0.01) {
    ctx.translate((Math.random() - 0.5) * w.shake * 10, (Math.random() - 0.5) * w.shake * 10)
  }

  ctx.clearRect(-20, -20, width + 40, height + 40)

  // ── arena floor and edge ──
  const c = { x: cam.cx, y: cam.cy }
  const R = w.boss.arenaRadius * cam.scale
  const grad = ctx.createRadialGradient(c.x, c.y, R * 0.1, c.x, c.y, R)
  grad.addColorStop(0, '#16102a')
  grad.addColorStop(1, '#0a0714')
  ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, Math.PI * 2)
  ctx.fillStyle = grad; ctx.fill()

  // The edge is drawn hot because falling off it is the main way to die.
  ctx.lineWidth = 3
  ctx.strokeStyle = `rgba(${RED}, 0.55)`
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(120, 220, 160, 0.10)'
  for (const r of [0.33, 0.66]) {
    ctx.beginPath(); ctx.arc(c.x, c.y, R * r, 0, Math.PI * 2); ctx.stroke()
  }

  // ── lingering hazards (resolved, still dangerous) ──
  // Drawn hot. These were at 16% alpha and effectively invisible, which made
  // "the debuff drops a pool" a rule you could only learn by dying to it. A
  // pool you cannot see is not a mechanic, it is a trap.
  const pulse = 0.5 + 0.5 * Math.sin(w.elapsedMs / 260)
  for (const inst of w.instances) {
    if (!inst.resolved || !inst.def.lingerMs || !inst.def.shape) continue
    // Fade over the last second of its life so you can see it expiring.
    const left = inst.def.lingerMs + inst.timer
    const dying = Math.max(0.25, Math.min(1, left / 1200))
    pathShape(ctx, cam, inst)
    ctx.fillStyle = `rgba(${RED}, ${0.30 * dying})`
    ctx.fill()
    ctx.strokeStyle = `rgba(${RED}, ${(0.7 + 0.3 * pulse) * dying})`
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.lineWidth = 1
    // A second, inset ring so a pool is unmistakably a pool and not a telegraph.
    ctx.save()
    ctx.globalAlpha = 0.4 * dying
    ctx.setLineDash([5, 5])
    ctx.strokeStyle = `rgba(${RED}, 0.9)`
    pathShape(ctx, cam, inst)
    ctx.stroke()
    ctx.restore()
    ctx.setLineDash([])
  }

  // ── pickups ──
  // Drawn as small solid globs with a collection ring, deliberately unlike a
  // ground hazard. Rendering these as a big filled circle read as "do not stand
  // here", which is the exact opposite of the mechanic.
  for (const inst of w.instances) {
    if (inst.resolved || inst.answered || inst.def.rule.type !== 'collect') continue
    const p = toPx(cam, inst.pos)
    const r = (inst.def.shape?.kind === 'circle' ? inst.def.shape.radius : 2.5) * cam.scale
    const t = progress(inst)
    // Tightens as it nears rupture, so an untouched globule visibly runs out.
    const ring = r * (1.9 - 0.7 * t)
    ctx.beginPath(); ctx.arc(p.x, p.y, ring, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${GREEN}, ${0.35 + 0.45 * t})`
    ctx.setLineDash([3, 4]); ctx.lineWidth = 2; ctx.stroke()
    ctx.setLineDash([]); ctx.lineWidth = 1
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${GREEN}, 0.55)`; ctx.fill()
    ctx.strokeStyle = `rgba(${GREEN}, 0.95)`; ctx.lineWidth = 2; ctx.stroke()
    ctx.lineWidth = 1
  }

  // ── active telegraphs ──
  for (const inst of w.instances) {
    if (inst.resolved || !inst.def.shape) continue
    if (inst.def.rule.type === 'collect') continue   // drawn above as pickups
    const col = ruleColour(inst)
    const t = progress(inst)
    pathShape(ctx, cam, inst)
    ctx.fillStyle = `rgba(${col}, ${0.10 + t * 0.28})`
    ctx.fill()
    ctx.strokeStyle = `rgba(${col}, ${0.5 + t * 0.5})`
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.lineWidth = 1
  }

  // ── the raid ──
  // Shield / cross / sword, so you can read a raider's role at a glance without
  // relying on colour alone. Drawn from the same paths as the UI icons.
  // Faded in only while there is group work — see allyMove(). A soak with
  // bodies converging on it reads as a group mechanic; the same soak with
  // nineteen idle glyphs permanently on screen reads as clutter.
  for (const role of ['dps', 'healer', 'tank'] as Role[]) {
    ctx.fillStyle = ROLE_COLOUR[role]
    for (const a of w.allies) {
      if (!a.alive || a.role !== role || a.presence < 0.03) continue
      const p = toPx(cam, a.pos)
      drawGlyph(ctx, role, p.x, p.y, 15, a.health, a.presence)
    }
  }
  // Debuffed allies get a ring — that is the healer's target list.
  ctx.beginPath()
  for (const a of w.allies) {
    if (!a.alive || !a.debuff || a.presence < 0.03) continue
    const p = toPx(cam, a.pos)
    ctx.moveTo(p.x + 9, p.y)
    ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
  }
  ctx.strokeStyle = `rgba(${VIOLET}, 0.95)`
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.lineWidth = 1

  // ── the link between two golems held too close ──
  // Drawn before the bosses so the bar reads as ground between them. A number
  // ticking somewhere would not communicate "your damage is doing nothing".
  if (w.bossesLinked && w.bosses.length > 1) {
    const held = w.bosses.filter(b => b.targetId >= 0)
    if (held.length > 1) {
      const a = toPx(cam, held[0].pos)
      const b = toPx(cam, held[1].pos)
      ctx.save()
      ctx.setLineDash([9, 6])
      ctx.lineWidth = 4
      ctx.strokeStyle = `rgba(${RED}, ${0.55 + 0.35 * pulse})`
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.restore()
      ctx.font = '700 13px Rajdhani, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = `rgba(${RED}, 0.95)`
      ctx.fillText('99% DAMAGE REDUCTION', (a.x + b.x) / 2, (a.y + b.y) / 2 - 10)
      ctx.textAlign = 'start'
    }
  }

  // ── boss entities ──
  // Every entity is drawn and named. Four fights in this tier field two or more,
  // and a single dot in the middle made "the other one is casting" invisible.
  const sig = sigilPath(w.boss.key)
  const meta = BOSS_SIGILS[w.boss.key]
  const multi = w.bosses.length > 1
  for (const b of w.bosses) {
    const bp = toPx(cam, b.pos)
    // Secondary entities are drawn slightly smaller so the primary — the one
    // your tank holds — stays readable at a glance.
    const isPrimary = b === w.bosses[0]
    const size = isPrimary ? 34 : 27
    ctx.beginPath(); ctx.arc(bp.x, bp.y, size * 0.65, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(124, 77, 255, 0.18)'
    ctx.fill()
    ctx.shadowBlur = 18; ctx.shadowColor = `rgba(${VIOLET}, 0.8)`
    if (sig && meta) {
      // The boss is its sigil — a serpent, a golem, a tornado — rather than an
      // anonymous circle, so each fight reads as its own encounter.
      const vb = meta.viewBox.split(' ').map(Number)
      const span = Math.max(vb[2] || 512, vb[3] || 512)
      const k = size / span
      ctx.save()
      ctx.translate(bp.x - size / 2, bp.y - size / 2)
      ctx.scale(k, k)
      ctx.fillStyle = isPrimary ? '#b79bff' : '#9a86e0'
      ctx.fill(sig)
      ctx.restore()
    } else {
      ctx.beginPath(); ctx.arc(bp.x, bp.y, size * 0.4, 0, Math.PI * 2)
      ctx.fillStyle = '#7c4dff'
      ctx.fill()
    }
    ctx.shadowBlur = 0

    // Facing pip — a tank needs to see which way it is pointed.
    ctx.beginPath()
    ctx.moveTo(bp.x, bp.y)
    ctx.lineTo(bp.x + Math.cos(b.angle) * 26, bp.y + Math.sin(b.angle) * 26)
    ctx.strokeStyle = '#c9b6ff'; ctx.lineWidth = 3; ctx.stroke()
    ctx.lineWidth = 1

    // Threat line to whoever holds it. An untanked entity has none.
    if (b.targetId >= 0) {
      const tankEnt = b.targetId === 0
        ? w.player.pos
        : (w.allies.find(a => a.id === b.targetId)?.pos ?? b.pos)
      const tp = toPx(cam, tankEnt)
      ctx.beginPath()
      ctx.moveTo(bp.x, bp.y); ctx.lineTo(tp.x, tp.y)
      ctx.strokeStyle = 'rgba(198, 155, 58, 0.5)'
      ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([])
    }

    // Name them, but only when there is more than one — on a single-boss fight
    // the name is already in the HUD and a floating label is just clutter.
    if (multi) {
      ctx.font = '600 11px Rajdhani, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(201, 182, 255, 0.92)'
      ctx.fillText(b.def.name, bp.x, bp.y + size * 0.65 + 14)
      ctx.textAlign = 'start'
    }
  }

  // ── adds ──
  // Shape encodes the job the same way telegraph colour encodes the verb:
  // red hexagon = kill it, violet ring = block it, gold = kicking target,
  // and a hazard-striped circle = do not shoot this under any circumstances.
  for (const add of w.adds) {
    if (!add.alive) continue
    const p = toPx(cam, add.pos)
    const d = add.def
    const R = d.job === 'leave' ? 11 : 13

    if (d.job === 'leave') {
      // Deliberately drawn like a hazard, not like a target.
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(210, 153, 34, 0.20)'; ctx.fill()
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = 'rgba(210, 153, 34, 0.95)'; ctx.lineWidth = 2; ctx.stroke()
      ctx.setLineDash([]); ctx.lineWidth = 1
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(210, 153, 34, 0.95)'; ctx.fill()
    } else {
      const col = d.job === 'kick' ? '198, 155, 58' : d.job === 'intercept' ? VIOLET : RED
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2
        const x = p.x + Math.cos(a) * R, y = p.y + Math.sin(a) * R
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = `rgba(${col}, 0.22)`; ctx.fill()
      ctx.strokeStyle = `rgba(${col}, 0.95)`; ctx.lineWidth = 2; ctx.stroke()
      ctx.lineWidth = 1

      // Health, and the shield above it. An add whose shield is still up shows
      // a second bar so "your damage is doing nothing yet" is visible rather
      // than something you have to infer.
      const bw = 26
      const frac = Math.max(0, add.hp / Math.max(1, d.hp))
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(p.x - bw / 2, p.y + R + 4, bw, 3)
      ctx.fillStyle = `rgba(${col}, 0.95)`
      ctx.fillRect(p.x - bw / 2, p.y + R + 4, bw * frac, 3)
      if (add.shield > 0 && d.shieldHp) {
        const sf = Math.max(0, add.shield / d.shieldHp)
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.fillRect(p.x - bw / 2, p.y + R + 8, bw, 3)
        ctx.fillStyle = 'rgba(160, 200, 255, 0.95)'
        ctx.fillRect(p.x - bw / 2, p.y + R + 8, bw * sf, 3)
      }

      // A kicking add winds up visibly, so the kick has a target to read.
      if (d.job === 'kick' && add.castMs >= 0 && !add.kicked) {
        const t = 1 - add.castMs / ((d.castEverySec ?? 8) * 1000)
        ctx.beginPath()
        ctx.arc(p.x, p.y, R + 6, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2)
        ctx.strokeStyle = 'rgba(248, 81, 73, 0.95)'; ctx.lineWidth = 3; ctx.stroke()
        ctx.lineWidth = 1
      }
    }
  }

  // ── your shots ──
  // Drawn in the player's own lime so it is obvious they are yours, and as a
  // short streak rather than a dot so you can see where a volley is going.
  ctx.strokeStyle = `rgba(${LIME}, 0.85)`
  ctx.lineWidth = 2.5
  ctx.beginPath()
  for (const s of w.shots) {
    const p = toPx(cam, s.pos)
    const back = 0.035
    ctx.moveTo(p.x - s.vel.x * back * cam.scale, p.y - s.vel.y * back * cam.scale)
    ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
  ctx.lineWidth = 1

  // ── player ──
  // Same glyph as the allies so you read as one of the raid, but lime and
  // haloed so you never lose yourself in a crowd of twenty.
  const pp = toPx(cam, w.player.pos)
  ctx.beginPath()
  ctx.arc(pp.x, pp.y, w.player.aloft > 0 ? 15 : 13, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(182, 255, 92, 0.16)'
  ctx.fill()
  ctx.fillStyle = w.player.alive ? LIME : '#555'
  ctx.shadowBlur = 14; ctx.shadowColor = `rgba(${LIME}, 0.9)`
  drawGlyph(ctx, w.player.role, pp.x, pp.y, 22, w.player.health)
  ctx.shadowBlur = 0
  if (w.player.aloft > 0) {
    // Airborne: ringed, so it is obvious you have lost steering.
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 18, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${VIOLET}, 0.8)`; ctx.stroke()
  }
  // Carrying something you must take away from the group.
  if (Object.keys(w.player.carrying).length) {
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 15, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${VIOLET}, 0.95)`; ctx.lineWidth = 2; ctx.stroke()
    ctx.lineWidth = 1
  }

  ctx.restore()
}
