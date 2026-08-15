import type { BossDef, Instance, Role, Side, Vec } from './types'
import { COMPASS, OPPOSITE } from './types'
import type { AltarState, BossUnit, World } from './sim'
import { inArena } from './sim'
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

/**
 * Side colours. These are IDENTITY, not instruction.
 *
 * A split raid needs "which half is that" answerable at a glance, and the
 * Sentinels name their own halves green and red. That collides head-on with the
 * verb palette above, so these are deliberately different hues — venom green
 * rather than mint, blood crimson rather than the orange-red of a telegraph —
 * and they are only ever drawn as thin unfilled boundaries, glyph haloes and
 * orbs. Never as the filled shape a telegraph uses. A side ring that read as
 * "get out" would teach the red group to leave its own golem.
 */
const SIDE_GREEN = '124, 214, 96'
const SIDE_RED = '221, 66, 90'
/** Add corpses. Neither a target nor a hazard, so neither red nor violet. */
const BONE = '226, 219, 196'

const sideColour = (s: Side) => (s === 'red' ? SIDE_RED : SIDE_GREEN)

/**
 * The altars' colours. IDENTITY again, for the same reason the sides are.
 *
 * Vashnik's raid does not call the fight by ability names, it calls it by
 * colour — "boss to red", "orange and purple are up" — so the colour coding is
 * not decoration, it is the vocabulary. That puts it in the same position as the
 * side palette above and under the same discipline: an altar colour is only ever
 * worn by a plinth, a floor wash or a drink link, and NEVER by the filled body
 * of a telegraph. The red altar is a deeper blood red than the telegraph's
 * orange-red for exactly that reason — "go to red" and "get out of red" cannot
 * be allowed to look alike.
 *
 * Keyed off `AltarDef.colour`, which is the raid's own word for it, so a boss
 * file naming a fourth colour simply falls back to the house violet rather than
 * drawing nothing.
 */
const ALTAR_COLOURS: Record<string, string> = {
  red: '226, 48, 66',
  orange: '255, 146, 40',
  purple: '172, 92, 255',
}
function altarColour(name: string): string {
  const key = name.toLowerCase()
  if (ALTAR_COLOURS[key]) return ALTAR_COLOURS[key]
  // A boss file that writes the colour inside a longer phrase still gets its
  // colour. Falling through to violet for all three would put every plinth in
  // the same hue and take the fight's entire vocabulary off the screen, which is
  // a worse failure than any wrong shade.
  for (const k of Object.keys(ALTAR_COLOURS)) if (key.includes(k)) return ALTAR_COLOURS[k]
  return VIOLET
}

export interface Camera {
  cx: number
  cy: number
  scale: number // pixels per yard
}

/** The floor's outline in yards, or null when the room is a plain circle. */
function arenaPoints(boss: BossDef): Vec[] | null {
  return boss.arena?.kind === 'polygon' && boss.arena.points.length > 2
    ? boss.arena.points
    : null
}

/**
 * Fit the arena with a small margin, so the edge is always visible — you cannot
 * judge a knockback you cannot see the edge of.
 *
 * A polygon floor is fitted by its bounding box rather than by `arenaRadius`.
 * The Sentinels' room is an octagon with an alcove at each end, and a radius fit
 * either cropped the alcoves or left the room floating off-centre on the canvas.
 *
 * Pass the whole BossDef to get that. The number form is kept because callers
 * that only ever had a radius still work with it — they simply get the circle
 * fit, which is correct for the six round rooms.
 */
export function makeCamera(w: number, h: number, fit: number | BossDef): Camera {
  const pts = typeof fit === 'number' ? null : arenaPoints(fit)
  const r = typeof fit === 'number' ? fit : fit.arenaRadius
  let minX = -r, maxX = r, minY = -r, maxY = r
  if (pts) {
    minX = Math.min(...pts.map(p => p.x)); maxX = Math.max(...pts.map(p => p.x))
    minY = Math.min(...pts.map(p => p.y)); maxY = Math.max(...pts.map(p => p.y))
  }
  const halfW = Math.max(1, (maxX - minX) / 2)
  const halfH = Math.max(1, (maxY - minY) / 2)
  const scale = Math.max(0.01, Math.min((w / 2 - 24) / halfW, (h / 2 - 24) / halfH))
  // Centred on the floor's own centre rather than on the origin, so a room whose
  // outline is not symmetric about (0,0) still sits in the middle of the canvas.
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  return { cx: w / 2 - midX * scale, cy: h / 2 - midY * scale, scale }
}

const toPx = (cam: Camera, v: Vec) => ({ x: cam.cx + v.x * cam.scale, y: cam.cy + v.y * cam.scale })

/** Path the floor outline, optionally scaled about the arena centre. */
function pathArena(ctx: CanvasRenderingContext2D, cam: Camera, boss: BossDef, k = 1) {
  const pts = arenaPoints(boss)
  ctx.beginPath()
  if (pts) {
    pts.forEach((pt, i) => {
      const p = toPx(cam, { x: pt.x * k, y: pt.y * k })
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
  } else {
    ctx.arc(cam.cx, cam.cy, boss.arenaRadius * k * cam.scale, 0, Math.PI * 2)
  }
}

/** How far the floor reaches — the gradient and the vignette need one number. */
function arenaReach(boss: BossDef): number {
  const pts = arenaPoints(boss)
  return pts ? Math.max(...pts.map(p => Math.hypot(p.x, p.y))) : boss.arenaRadius
}

/** A rounded rectangle, for the dark plates that keep small text legible. */
function roundedRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * A short label on a dark plate. The floor is busy — pools, telegraphs, a
 * sigil — and bare text on it is unreadable exactly when it matters most.
 */
function drawLabel(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  colour: string, size = 12, alpha = 1,
) {
  ctx.font = `700 ${size}px Rajdhani, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const w = ctx.measureText(text).width
  ctx.globalAlpha = alpha
  roundedRect(ctx, x - w / 2 - 6, y - size * 0.72, w + 12, size * 1.44, 4)
  ctx.fillStyle = 'rgba(6, 4, 14, 0.78)'
  ctx.fill()
  ctx.fillStyle = `rgba(${colour}, 0.98)`
  ctx.fillText(text, x, y + 0.5)
  ctx.globalAlpha = 1
  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
}

function ruleColour(inst: Instance, w?: World): string {
  switch (inst.def.rule.type) {
    case 'beInside': return GREEN
    case 'collect': return GREEN
    case 'carryOut': return VIOLET
    case 'press': return VIOLET
    case 'survive': return VIOLET
    case 'windPair': return VIOLET
    /**
     * The one telegraph in the raid whose VERB depends on who is reading it.
     *
     * Mutilate is a soak for the group it is called on and a death sentence for
     * the group that already has a Gash, and both are looking at the same cone.
     * Colour encodes the verb everywhere else in this file, so it encodes the
     * verb here too — green when it is your turn to get in, red when standing in
     * it would put a second stack on you. Painting it one colour for everybody
     * would be the one case where the palette lies.
     */
    case 'groupSoak':
      return w && w.player.group === w.calledGroup && w.player.gash <= 0 ? GREEN : RED
    default: return RED
  }
}

/** Arrowhead of length `len` at (x, y), pointing along `ang`. */
function drawArrow(
  ctx: CanvasRenderingContext2D, x: number, y: number, ang: number,
  len: number, colour: string, alpha = 1,
) {
  const dx = Math.cos(ang)
  const dy = Math.sin(ang)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = `rgba(${colour}, 0.98)`
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - dx * len * 0.5, y - dy * len * 0.5)
  ctx.lineTo(x + dx * len * 0.5, y + dy * len * 0.5)
  ctx.stroke()
  const hx = x + dx * len * 0.5
  const hy = y + dy * len * 0.5
  const wing = len * 0.32
  ctx.beginPath()
  ctx.moveTo(hx, hy)
  ctx.lineTo(hx - dx * wing - dy * wing * 0.7, hy - dy * wing + dx * wing * 0.7)
  ctx.moveTo(hx, hy)
  ctx.lineTo(hx - dx * wing + dy * wing * 0.7, hy - dy * wing - dx * wing * 0.7)
  ctx.stroke()
  ctx.restore()
  ctx.lineWidth = 1
}

/** 0 at spawn, 1 at resolve — telegraphs fill as they approach. */
function progress(inst: Instance): number {
  if (inst.resolved) return 1
  const total = Math.max(1, inst.def.telegraphMs)
  return Math.min(1, 1 - inst.timer / total)
}

/**
 * Path a mechanic's shape, optionally scaled about its own origin.
 *
 * `k > 1` draws the contracting timing ring: a copy of the shape sitting
 * outside it that shrinks onto the real edge as the cast completes. That is the
 * language WoW's own ground markers use, and without it a telegraph told you
 * where something would land but nothing at all about when.
 */
function pathShape(ctx: CanvasRenderingContext2D, cam: Camera, inst: Instance, k = 1) {
  const p = toPx(cam, inst.pos)
  const s = inst.def.shape!
  ctx.beginPath()
  switch (s.kind) {
    case 'circle':
      ctx.arc(p.x, p.y, s.radius * k * cam.scale, 0, Math.PI * 2)
      break
    case 'annulus':
      ctx.arc(p.x, p.y, s.outer * cam.scale, 0, Math.PI * 2)
      ctx.arc(p.x, p.y, s.inner * cam.scale, 0, Math.PI * 2, true)
      break
    case 'cone': {
      const half = (s.arcDeg * Math.PI) / 360
      ctx.moveTo(p.x, p.y)
      ctx.arc(p.x, p.y, s.radius * k * cam.scale, inst.angle - half, inst.angle + half)
      ctx.closePath()
      break
    }
    case 'line': {
      const ca = Math.cos(inst.angle), sa = Math.sin(inst.angle)
      const hw = (s.width / 2) * k * cam.scale
      // Per-instance reach when the shape is a beam between two points.
      const L = (inst.reach ?? s.length) * cam.scale
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

/**
 * The four Helical Toxins orbs above a head, green ones first.
 *
 * Deliberately large and plated. Reading somebody else's orbs IS the mechanic —
 * you are looking for the raider whose green count completes yours to four —
 * and four small dots lost against a violet telegraph would make that
 * unplayable rather than hard.
 *
 * Nothing here marks out a valid partner, and nothing should. Drawing a line to
 * the right person would replace the mechanic with a waypoint, which is the one
 * thing this fight is asking a raider to learn to do for themselves.
 */
function drawOrbs(
  ctx: CanvasRenderingContext2D, x: number, y: number, green: number, big = false,
) {
  const r = big ? 4.6 : 3.7
  const gap = r * 2 + (big ? 3.6 : 2.9)
  const span = gap * 3
  roundedRect(ctx, x - span / 2 - r - 3, y - r - 3, span + r * 2 + 6, r * 2 + 6, r + 3)
  ctx.fillStyle = 'rgba(6, 4, 14, 0.78)'
  ctx.fill()
  const n = Math.max(0, Math.min(4, Math.round(green)))
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.arc(x - span / 2 + i * gap, y, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${i < n ? SIDE_GREEN : SIDE_RED}, 1)`
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

/**
 * The 99% damage reduction, drawn on the entity that has it.
 *
 * A heavy shield and a label, because the honest consequence of the golems
 * being too close is that everything the raid is doing has stopped counting.
 * That has to be legible from anywhere in the room and impossible to mistake
 * for any other ring on screen.
 */
function drawShield(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number,
  elapsedMs: number, pulse: number, colour = RED,
) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(${colour}, ${0.10 + 0.06 * pulse})`
  ctx.fill()
  ctx.strokeStyle = `rgba(${colour}, ${0.55 + 0.35 * pulse})`
  ctx.lineWidth = 6
  ctx.stroke()
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((elapsedMs / 1400) % (Math.PI * 2))
  ctx.strokeStyle = 'rgba(255, 246, 244, 0.8)'
  ctx.lineWidth = 2
  for (let i = 0; i < 6; i++) {
    ctx.beginPath()
    ctx.arc(0, 0, r + 5, (i / 6) * Math.PI * 2, (i / 6) * Math.PI * 2 + 0.55)
    ctx.stroke()
  }
  ctx.restore()
  ctx.lineWidth = 1
}

/**
 * One altar: a plinth in its own colour, dim when idle and blazing when it is
 * being drained, with its Infusion stacks beside it.
 *
 * Both states are drawn. An idle altar is still a corner of the room the raid
 * calls out and walks to, so it fades rather than disappearing — what changes is
 * whether it is lit, which is the question "which two are live?" answered from
 * anywhere on the floor.
 *
 * Whether it is live comes from `World.lastDrained` rather than being worked out
 * here. The sim's note on that field is the reason: the boss walks off after
 * Imbibe, so anything that re-derives "the nearest two" a second later paints a
 * different pair from the one that actually fired.
 */
function drawAltar(
  ctx: CanvasRenderingContext2D, cam: Camera, st: AltarState,
  live: boolean, elapsedMs: number, pulse: number,
) {
  const altar = st.def
  const stacks = st.infusion
  const col = altarColour(altar.colour)
  const p = toPx(cam, altar.pos)
  const r = 13

  // The drink itself: a ring thrown off the plinth for half a second when this
  // altar is taken. The Expulsion, the venom and both debuffs all leave here at
  // once, and a fountain that simply changed brightness never showed the raid
  // where its next few seconds came from.
  const sinceDrain = st.drainedAtMs >= 0 ? elapsedMs - st.drainedAtMs : Infinity
  if (sinceDrain >= 0 && sinceDrain < 520) {
    const f = 1 - sinceDrain / 520
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 40 * (1 - f), 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${col}, ${0.9 * f})`
    ctx.lineWidth = 1 + 5 * f; ctx.stroke()
    ctx.lineWidth = 1
  }

  // Blazing: a bloom and a ring of rising motes, so a drained altar is visibly
  // pouring something out rather than merely being a brighter circle.
  if (live) {
    const bloom = ctx.createRadialGradient(p.x, p.y, r * 0.4, p.x, p.y, r * 3.4)
    bloom.addColorStop(0, `rgba(${col}, ${0.34 + 0.12 * pulse})`)
    bloom.addColorStop(1, `rgba(${col}, 0)`)
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.4, 0, Math.PI * 2)
    ctx.fillStyle = bloom; ctx.fill()
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate((elapsedMs / 1100) % (Math.PI * 2))
    ctx.strokeStyle = `rgba(${col}, ${0.7 + 0.3 * pulse})`
    ctx.lineWidth = 3
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * (r + 6), Math.sin(a) * (r + 6))
      ctx.lineTo(Math.cos(a) * (r + 13), Math.sin(a) * (r + 13))
      ctx.stroke()
    }
    ctx.restore()
    ctx.lineWidth = 1
  }

  // The plinth itself: a dark stone with a lit bowl in it.
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(10, 6, 18, ${live ? 0.9 : 0.75})`
  ctx.fill()
  ctx.strokeStyle = `rgba(${col}, ${live ? 0.95 + 0.05 * pulse : 0.42})`
  ctx.lineWidth = live ? 3.5 : 2
  ctx.stroke()
  ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.52, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(${col}, ${live ? 0.85 + 0.15 * pulse : 0.3})`
  ctx.fill()
  ctx.lineWidth = 1

  // Named OUTWARD, away from the middle of the room, so the plate never lands on
  // top of the drink links or on the Cavity the raid is fighting around.
  const len = Math.hypot(altar.pos.x, altar.pos.y) || 1
  const ox = altar.pos.x / len
  const oy = altar.pos.y / len
  const lx = p.x + ox * (r + 18)
  const ly = p.y + oy * (r + 18)
  drawLabel(
    ctx, live ? `${altar.colour.toUpperCase()} · DRAINING` : altar.colour.toUpperCase(),
    lx, ly, col, 13, live ? 1 : 0.62,
  )
  // The Infusion count, once there is one. A zero is the clean state and saying
  // so three times over is noise; a number appearing at all is the tank being
  // told they have drained the same altar twice running.
  if (stacks > 0) {
    drawLabel(ctx, `INFUSION ${stacks}`, lx, ly + 18, col, 11, 0.7 + 0.3 * pulse)
  }
}

export function render(ctx: CanvasRenderingContext2D, w: World, cam: Camera, width: number, height: number) {
  ctx.save()
  if (w.shake > 0.01) {
    ctx.translate((Math.random() - 0.5) * w.shake * 10, (Math.random() - 0.5) * w.shake * 10)
  }

  ctx.clearRect(-20, -20, width + 40, height + 40)
  const pulse = 0.5 + 0.5 * Math.sin(w.elapsedMs / 260)

  // ── arena floor and edge ──
  // The floor is whatever shape the boss declares. Six of these rooms are round
  // and `arenaRadius` says all there is to say; the Sentinels' is an octagon
  // with an alcove at each end, and that shape is load-bearing — the fight asks
  // each half of the raid to stand inside its own 40-yard bubble and outside the
  // other's, which is a question about how much floor there is and where.
  //
  // The polygon EXPLAINS the measurement rather than contradicting it. Fitting a
  // circle to 126,814 PTR position samples reported a corner/axis ratio of 0.89:
  // players reach measurably less far on the diagonals than on the axes, which
  // is exactly what an octagon looks like through a circle fit. A true circle
  // would have come back 1.0.
  // ── the acid the platform floats in ──
  //
  // Drawn BEFORE the floor, and placed by one rule: bubble wherever a point is
  // not on the floor. That gets the sea around the platform and the venom in the
  // pocket bitten out of its bottom edge from the same test, and it keeps
  // following the room if the shape ever changes again — no second list of
  // "where the acid is" to fall out of step with the polygon.
  //
  // Deterministic: every bubble's position, size and phase are hashed from its
  // index, so this animates without touching the RNG the fight is seeded on.
  // A renderer that consumed random numbers would make the playtest's fixed
  // seeds depend on how many frames had been drawn.
  if (w.boss.acid) {
    const span = arenaReach(w.boss) * 1.25
    // Two passes, because the two bodies of acid are different sizes. A scatter
    // wide enough to fill the sea around the platform hits the pocket about
    // never — it is seventy square yards inside five thousand — and the pocket
    // is the half that matters, since it is the one a player can walk into.
    // So: a wide scatter for the sea, and a fine grid over the floor's own
    // bounding box for whatever holes are cut into it.
    const seats: Vec[] = []
    for (let i = 0; i < 110; i++) {
      // Golden-angle scatter, so the sea looks sown rather than gridded.
      const a = i * 2.399963
      const rr = Math.sqrt((i % 37) / 37) * span
      seats.push({ x: Math.cos(a) * rr + ((i * 7) % 11) - 5, y: Math.sin(a) * rr + ((i * 13) % 11) - 5 })
    }
    const step = span / 11
    for (let gx = -11; gx <= 11; gx++) {
      for (let gy = -11; gy <= 11; gy++) {
        // Jittered off the lattice so a hole never fills with a visible grid.
        seats.push({
          x: gx * step + ((gx * 5 + gy * 3) % 7) * 0.35,
          y: gy * step + ((gx * 3 + gy * 7) % 7) * 0.35,
        })
      }
    }
    for (let i = 0; i < seats.length; i++) {
      const at = seats[i]
      if (Math.abs(at.x) > span || Math.abs(at.y) > span) continue
      if (inArena(w.boss, at)) continue          // that is floor, not acid
      // Rise, swell, pop, repeat — each on its own clock.
      const period = 1700 + ((i * 271) % 1900)
      const t = ((w.elapsedMs + i * 617) % period) / period
      const p = toPx(cam, { x: at.x, y: at.y - t * 3.2 })   // drifts up as it grows
      const r = (0.5 + 1.5 * t) * cam.scale
      // Fades in fast, holds, then bursts at the top.
      const alpha = (t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.75) / 0.25)) * 0.5
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(126, 224, 108, ${(alpha * 0.5).toFixed(3)})`
      ctx.fill()
      ctx.strokeStyle = `rgba(158, 240, 130, ${alpha.toFixed(3)})`
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  const c = { x: cam.cx, y: cam.cy }
  const R = arenaReach(w.boss) * cam.scale
  const grad = ctx.createRadialGradient(c.x, c.y, R * 0.1, c.x, c.y, R)
  grad.addColorStop(0, '#16102a')
  grad.addColorStop(1, '#0a0714')
  pathArena(ctx, cam, w.boss)
  ctx.fillStyle = grad; ctx.fill()

  // The edge is drawn hot because falling off it is the main way to die.
  ctx.lineWidth = 3
  ctx.strokeStyle = `rgba(${RED}, 0.55)`
  ctx.stroke()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(120, 220, 160, 0.10)'
  for (const r of [0.33, 0.66]) {
    // Scaled copies of the floor's own outline, so the guides tell you about the
    // room you are in rather than about a circle it is not.
    pathArena(ctx, cam, w.boss, r); ctx.stroke()
  }

  // ── the two stack marks ──
  //
  // Where each half of the raid stands so one Mutilate cone can take one of them
  // whole and miss the other entirely. IDENTITY first — which half am I — so
  // they wear the side palette rather than the verb palette and are drawn as
  // thin unfilled rings, under the same discipline as the split-raid bubbles.
  //
  // The CALLED one carries a second, brighter ring, because "whose turn is it"
  // is the only question this mechanic asks and it changes every cast. A raider
  // who can read it off the floor never has to work out whether the cone coming
  // at them is a soak or a death.
  if (w.groupMarks.length) {
    w.groupMarks.forEach((mark, g) => {
      const called = g === w.calledGroup
      const yours = g === w.player.group
      const col = g === 0 ? SIDE_GREEN : SIDE_RED
      const p = toPx(cam, mark)
      const rr = 7.5 * cam.scale
      ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2)
      ctx.setLineDash([9, 7])
      ctx.strokeStyle = `rgba(${col}, ${called ? 0.75 : 0.3})`
      ctx.lineWidth = called ? 3 : 1.5
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = 1
      if (called) {
        // A second ring just outside, pulsing. Never filled: a filled shape in
        // this palette means a telegraph is landing there.
        ctx.beginPath(); ctx.arc(p.x, p.y, rr + 5, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${col}, ${0.3 + 0.35 * pulse})`
        ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1
      }
      drawLabel(
        ctx,
        `GROUP ${g === 0 ? 'A' : 'B'}${yours ? ' · YOURS' : ''}${called ? ' · CALLED' : ''}`,
        p.x, p.y - rr - 10, col, 11, called || yours ? 0.95 : 0.5,
      )
      // How long this group's Gash has left. It is the whole reason the rota
      // alternates, and a countdown says "you cannot take another one yet" far
      // better than a raider discovering it by dying.
      const left = w.groupGashMs[g] ?? 0
      if (left > 0) {
        drawLabel(ctx, `GASH ${(left / 1000).toFixed(0)}s`, p.x, p.y + rr + 12, RED, 11, 0.9)
      }
    })
  }

  // ── the three sections ──
  // Vashnik's room is ONE open floor with an altar in each corner. Nothing walls
  // the sections off in the real room, so nothing walls them off here: each altar
  // washes its own part of the floor in its own colour and the washes simply meet
  // in the middle, over the Cavity. Drawn first, under every hazard, because this
  // is the room rather than something happening in it — and clipped to the arena
  // so the colour stops exactly where the floor does.
  //
  // A live section is washed harder. "Which two are up" has to be readable from
  // the floor you are standing on, not only from the plinth you are looking at.
  // The pair the last Imbibe took. Read off the world, never re-derived here —
  // the boss walks away from the altars he just drank, so "the nearest two" is
  // already a different answer by the time this frame draws.
  const altars = w.altars
  const drained = w.lastDrained
  if (altars.length) {
    ctx.save()
    pathArena(ctx, cam, w.boss)
    ctx.clip()
    const reach = arenaReach(w.boss) * cam.scale * 0.8
    for (const al of altars) {
      const ap = toPx(cam, al.def.pos)
      const col = altarColour(al.def.colour)
      const wash = ctx.createRadialGradient(ap.x, ap.y, 0, ap.x, ap.y, reach)
      wash.addColorStop(0, `rgba(${col}, ${drained.includes(al.def.id) ? 0.26 : 0.11})`)
      wash.addColorStop(1, `rgba(${col}, 0)`)
      ctx.fillStyle = wash
      ctx.fillRect(ap.x - reach, ap.y - reach, reach * 2, reach * 2)
    }
    ctx.restore()
  }

  // ── the 40-yard bubbles ──
  // A split raid is told two numbers: stay within 40 of your own golem, stay
  // outside 40 of the other. Both are places, not numbers, and drawing them as
  // places is the difference between playing the split and estimating it.
  //
  // The radius comes from the Mark's own proximityStack, so the ring is the
  // actual range the debuff applies in and not a decorative circle near it.
  const apartDef = w.boss.mechanics.find(m => m.rule.type === 'keepApart')
  const apartMin = apartDef && apartDef.rule.type === 'keepApart' ? apartDef.rule.minYards : undefined
  let insideOwn = false
  let insideOther = false
  if (w.boss.sided) {
    for (const b of w.bosses) {
      const side = b.def.side
      if (!side || !b.alive) continue
      const aura = w.boss.mechanics.find(m => m.from === b.def.id && m.proximityStack)?.proximityStack
      const yards = aura?.radius ?? apartMin
      if (!yards) continue
      const bp = toPx(cam, b.pos)
      const rr = yards * cam.scale
      const col = sideColour(side)
      const mine = side === w.player.side
      // Your own bubble is drawn brighter than the one you must stay out of.
      // Both are thin and unfilled — see the note on the side palette.
      const wash = ctx.createRadialGradient(bp.x, bp.y, rr * 0.55, bp.x, bp.y, rr)
      wash.addColorStop(0, `rgba(${col}, 0)`)
      wash.addColorStop(1, `rgba(${col}, ${mine ? 0.09 : 0.05})`)
      ctx.beginPath(); ctx.arc(bp.x, bp.y, rr, 0, Math.PI * 2)
      ctx.fillStyle = wash; ctx.fill()
      ctx.setLineDash([10, 8])
      ctx.strokeStyle = `rgba(${col}, ${mine ? 0.5 : 0.28})`
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = 1
      const d = Math.hypot(w.player.pos.x - b.pos.x, w.player.pos.y - b.pos.y)
      if (d <= yards) { if (mine) insideOwn = true; else insideOther = true }
      // Named on the boundary itself rather than beside the golem, so the label
      // belongs to the ring. The golem already carries its own name underneath.
      drawLabel(ctx, side.toUpperCase(), bp.x, bp.y - rr, col, 11, mine ? 0.85 : 0.5)
    }
  }

  // ── holes in the floor ──
  // A `lethalGround` fixture kills on contact and never expires. It shares a
  // screen with a dozen red circles a player is expected to walk out of, and if
  // it looked like them it would be read as damage to heal through — which is
  // the exact lesson its tactic file says the trainer got wrong before. So it is
  // drawn as a hole: a void with a churn in it and a kill-line at the lip.
  for (const inst of w.instances) {
    if (inst.def.rule.type !== 'lethalGround' || !inst.def.shape) continue
    const p = toPx(cam, inst.pos)
    const rr = (inst.def.shape.kind === 'circle' ? inst.def.shape.radius : 8) * cam.scale
    const hole = ctx.createRadialGradient(p.x, p.y, rr * 0.05, p.x, p.y, rr)
    hole.addColorStop(0, 'rgba(0, 0, 0, 0.98)')
    hole.addColorStop(0.65, 'rgba(7, 3, 14, 0.94)')
    hole.addColorStop(1, 'rgba(26, 8, 30, 0.72)')
    ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2)
    ctx.fillStyle = hole; ctx.fill()

    // Three arms spiralling inward. Movement is what says "this goes down"
    // rather than "this is painted on the floor".
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate((w.elapsedMs / 900) % (Math.PI * 2))
    ctx.strokeStyle = `rgba(${RED}, 0.32)`
    ctx.lineWidth = 2
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      for (let t = 0; t <= 1.001; t += 0.08) {
        const a = (i / 3) * Math.PI * 2 + t * 2.4
        const rad = rr * (0.94 - 0.82 * t)
        const x = Math.cos(a) * rad, y = Math.sin(a) * rad
        if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.restore()

    // The kill line. Thin, bright and solid: there is no version of this where
    // being a little bit inside is survivable, so there is no soft edge.
    ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255, 216, 212, ${0.72 + 0.22 * pulse})`
    ctx.lineWidth = 2; ctx.stroke()
    ctx.beginPath(); ctx.arc(p.x, p.y, rr + 3.5, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${RED}, 0.92)`
    ctx.lineWidth = 3; ctx.stroke()
    ctx.lineWidth = 1

    // And it is named. A hole with a name is a landmark — the Malignant Cavity
    // and the Soulcoil Well are both places the raid stands relative to for the
    // whole pull, and a raider who reads the name once stops reading the shape
    // as one more red circle they are meant to walk out of. Sat low in the void
    // rather than dead centre, where the boss's own sigil often sits.
    drawLabel(ctx, inst.def.name.toUpperCase(), p.x, p.y + rr * 0.55, RED, 11, 0.85)
  }

  // ── lingering hazards (resolved, still dangerous) ──
  // Drawn hot. These were at 16% alpha and effectively invisible, which made
  // "the debuff drops a pool" a rule you could only learn by dying to it. A
  // pool you cannot see is not a mechanic, it is a trap.
  for (const inst of w.instances) {
    if (!inst.resolved || !inst.def.shape) continue
    if (inst.def.rule.type === 'lethalGround') continue   // drawn above as a hole
    const permanent = !!inst.def.permanent
    if (!inst.def.lingerMs && !permanent) continue
    // Fade over the last second of its life so you can see it expiring — unless
    // it is permanent, in which case it must not fade at all. Blood Venom and
    // Essence Rend puddles are the floor for the rest of the pull, and a pool
    // that dimmed would quietly promise the floor was coming back.
    const left = (inst.def.lingerMs ?? 0) + inst.timer
    const dying = permanent ? 1 : Math.max(0.25, Math.min(1, left / 1200))
    pathShape(ctx, cam, inst)
    ctx.fillStyle = `rgba(${RED}, ${(permanent ? 0.24 : 0.30) * dying})`
    ctx.fill()
    ctx.strokeStyle = `rgba(${RED}, ${permanent ? 0.85 : (0.7 + 0.3 * pulse) * dying})`
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.lineWidth = 1
    // A second, inset ring so a pool is unmistakably a pool and not a telegraph.
    // Solid on a permanent one and dashed on a timed one: a dashed ring reads as
    // a countdown, and this one has no clock to count.
    ctx.save()
    ctx.globalAlpha = permanent ? 0.55 : 0.4 * dying
    if (!permanent) ctx.setLineDash([5, 5])
    ctx.strokeStyle = `rgba(${RED}, 0.9)`
    pathShape(ctx, cam, inst, permanent ? 0.88 : 1)
    ctx.stroke()
    ctx.restore()
    ctx.setLineDash([])
    // A hazard that is still MOVING keeps spinning after it lands.
    //
    // The spinner used to live only in the active-telegraph pass, so a Tempest
    // vortex span while it was a warning and then went perfectly still the
    // instant it became dangerous — nine roaming things drawn as nine puddles,
    // with nothing on screen to say they were still coming at you.
    if (inst.def.driftSpeed && inst.def.shape.kind === 'circle') {
      const dp = toPx(cam, inst.pos)
      const dr = inst.def.shape.radius * cam.scale
      ctx.save()
      ctx.translate(dp.x, dp.y)
      ctx.rotate((w.elapsedMs / 380) % (Math.PI * 2))
      ctx.strokeStyle = `rgba(${RED}, ${0.8 * dying})`
      ctx.lineWidth = 2
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.arc(0, 0, dr * 0.62, (i / 3) * Math.PI * 2, (i / 3) * Math.PI * 2 + 1.1)
        ctx.stroke()
      }
      ctx.restore()
      ctx.lineWidth = 1
    }
  }

  // ── corpses ──
  // They persist, so they are drawn as bodies rather than as effects: bone, not
  // a colour from the verb palette, because a corpse is neither a target nor
  // ground to avoid. The ring says it still needs burning — leave one lying
  // there when the intermission ends and it stands back up and resumes walking.
  for (const corpse of w.corpses) {
    const p = toPx(cam, corpse.pos)
    if (corpse.burned) {
      // Incineration: a quarter-second flare, then nothing. The corpse is gone
      // and the floor is clean, which is the whole reward for burning it.
      const since = w.elapsedMs - corpse.burnedAtMs
      if (since > 520 || since < 0) continue
      const f = 1 - since / 520
      ctx.beginPath(); ctx.arc(p.x, p.y, 5 + 22 * (1 - f), 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(255, 176, 96, ${0.85 * f})`
      ctx.lineWidth = 1 + 4 * f; ctx.stroke()
      ctx.beginPath(); ctx.arc(p.x, p.y, 2 + 5 * f, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 234, 196, ${0.9 * f})`; ctx.fill()
      ctx.lineWidth = 1
      continue
    }
    // A slumped body: two overlapping discs, deliberately not a hexagon, so it
    // never reads as a live add you are supposed to be shooting.
    ctx.beginPath()
    ctx.arc(p.x - 3, p.y + 1, 4.5, 0, Math.PI * 2)
    ctx.arc(p.x + 3.5, p.y - 1, 3, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${BONE}, 0.55)`; ctx.fill()
    ctx.strokeStyle = `rgba(${BONE}, 0.9)`; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.lineDashOffset = -(w.elapsedMs / 55) % 8
    ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${BONE}, ${0.35 + 0.3 * pulse})`
    ctx.lineWidth = 1.5; ctx.stroke()
    ctx.restore()
    ctx.lineWidth = 1
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
    if (inst.def.rule.type === 'lethalGround') continue // drawn above as a hole
    // A wind marker belongs on the raiders, not on the floor. It spawns at the
    // player's feet and does not follow them, so drawn here it was a purple
    // circle sitting wherever you happened to be standing eight seconds ago —
    // unreadable as a mechanic and actively misleading as a telegraph, because
    // nothing lands there. It is drawn as a ring on every affected raider at the
    // bottom of this file instead, which is what the mechanic actually is.
    if (inst.def.rule.type === 'windPair') continue
    const col = ruleColour(inst, w)
    const t = progress(inst)
    pathShape(ctx, cam, inst)
    ctx.fillStyle = `rgba(${col}, ${0.10 + t * 0.28})`
    ctx.fill()
    ctx.strokeStyle = `rgba(${col}, ${0.5 + t * 0.5})`
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.lineWidth = 1

    // The timing ring: a copy of the shape contracting onto its own edge as the
    // cast lands. Alpha alone told you where a mechanic would go off but never
    // when, so every telegraph looked equally urgent right up to the moment it
    // killed you.
    if (inst.def.telegraphMs > 400 && t < 0.995) {
      pathShape(ctx, cam, inst, 1 + 1.15 * (1 - t))
      ctx.strokeStyle = `rgba(${col}, ${0.22 + 0.5 * t})`
      ctx.lineWidth = 2
      ctx.setLineDash([7, 6])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = 1
    }

    // A drifting hazard spins, so it reads as something moving under its own
    // power rather than a puddle that happens to be sliding.
    if (inst.def.driftSpeed && inst.def.shape.kind === 'circle') {
      const p = toPx(cam, inst.pos)
      const r = inst.def.shape.radius * cam.scale
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate((w.elapsedMs / 380) % (Math.PI * 2))
      ctx.strokeStyle = `rgba(${col}, 0.85)`
      ctx.lineWidth = 2
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.arc(0, 0, r * 0.62, (i / 3) * Math.PI * 2, (i / 3) * Math.PI * 2 + 1.1)
        ctx.stroke()
      }
      ctx.restore()
      ctx.lineWidth = 1
    }
  }

  // ── impact flash ──
  // A quarter-second bloom where something just landed, so a hit is an event
  // you see rather than a number that changed.
  for (const inst of w.instances) {
    if (!inst.resolved || !inst.def.shape) continue
    // A hole in the floor did not "land"; it was always there.
    if (inst.def.rule.type === 'lethalGround') continue
    const since = -inst.timer
    if (since > 260) continue
    const f = 1 - since / 260
    pathShape(ctx, cam, inst, 1 + 0.35 * (1 - f))
    ctx.fillStyle = `rgba(255, 255, 255, ${0.30 * f})`
    ctx.fill()
    ctx.strokeStyle = `rgba(${ruleColour(inst, w)}, ${0.9 * f})`
    ctx.lineWidth = 3 * f + 1
    ctx.stroke()
    ctx.lineWidth = 1
  }

  // ── the raid ──
  // Shield / cross / sword, so you can read a raider's role at a glance without
  // relying on colour alone. Drawn from the same paths as the UI icons.
  // Faded in only while there is group work — see allyMove(). A soak with
  // bodies converging on it reads as a group mechanic; the same soak with
  // nineteen idle glyphs permanently on screen reads as clutter.
  //
  // On a split fight each raider also carries a halo in their group's colour,
  // drawn under the glyph so role stays the thing you read first. Without it the
  // split is an instruction the player was given once and can never check —
  // nineteen identical glyphs, half of them somewhere they must not be.
  if (w.boss.sided) {
    for (const a of w.allies) {
      if (!a.alive || a.presence < 0.03 || !a.side) continue
      const p = toPx(cam, a.pos)
      const col = sideColour(a.side)
      ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${col}, ${0.18 * a.presence})`
      ctx.fill()
      ctx.strokeStyle = `rgba(${col}, ${0.6 * a.presence})`
      ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1
    }
  }
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

  // ── the separation ──
  // On the Sentinels this IS the fight, so it is drawn continuously rather than
  // only once it has gone wrong: a live line between the closest pair with the
  // yardage on it, safe-coloured while they are apart and hot the moment they
  // are not. Knowing you are at 43 and closing is what lets a tank fix it; being
  // told at 39 that you have already failed is not the same lesson.
  //
  // Drawn before the entities so the line reads as ground between them.
  if (apartDef && apartMin !== undefined && w.bosses.length > 1) {
    // The closest pair of live, targetable entities — the same pair the sim
    // measures, so the number on screen is the number being scored.
    const live = w.bosses.filter(b => !b.def.untargetable && b.alive)
    let one: BossUnit | null = null
    let two: BossUnit | null = null
    let closest = Infinity
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const d = Math.hypot(live[i].pos.x - live[j].pos.x, live[i].pos.y - live[j].pos.y)
        if (d < closest) { closest = d; one = live[i]; two = live[j] }
      }
    }
    if (one && two) {
      const a = toPx(cam, one.pos)
      const b = toPx(cam, two.pos)
      const bad = closest < apartMin
      const col = bad ? RED : GREEN
      ctx.save()
      ctx.setLineDash([9, 6])
      ctx.lineWidth = bad ? 4 : 2
      ctx.strokeStyle = `rgba(${col}, ${bad ? 0.55 + 0.35 * pulse : 0.42})`
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.restore()
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      drawLabel(ctx, `${Math.round(closest)} YD  ·  HOLD ${apartMin}+`, mx, my, col, 12, bad ? 1 : 0.8)
      // And when it is broken, say what it costs. A player must be able to see
      // instantly that the pull they are in is being wasted.
      if (w.bossesLinked) {
        drawLabel(ctx, '99% DAMAGE REDUCTION', mx, my - 20, RED, 13)
        for (const unit of live) {
          const up = toPx(cam, unit.pos)
          drawShield(ctx, up.x, up.y, 30, w.elapsedMs, pulse)
          drawLabel(ctx, '99% DR', up.x, up.y - 42, RED, 11)
        }
      }
    }
  }

  // ── the altars, and the pair the boss is about to drink ──
  // The whole tank job on this fight, drawn.
  //
  // Imbibe drains the altars NEAREST the boss and the boss follows its tank, so
  // where the tank stands picks which venoms spawn and which two infections go
  // out on the raid. A tank who can only find that out once the cast has landed
  // cannot do the job at all, so the links are live: they run to the pair he
  // would drain right now and they move with him, which is what makes walking
  // him to a fresh pair a thing you can aim rather than a thing you hope for.
  //
  // How many he takes is read off the fight's own `drainNearest` rule rather
  // than assumed, so the picture and the scoring cannot disagree.
  //
  // Drawn before the entities so the links read as ground between them — the
  // same reason the Sentinels' separation line is drawn where it is.
  if (altars.length && w.bosses.length) {
    const lead = w.bosses[0]
    const drainRule = w.boss.mechanics.find(m => m.rule.type === 'drainNearest')?.rule
    const takes = drainRule && drainRule.type === 'drainNearest' ? drainRule.count : 2
    const near = [...altars].sort((a, b) =>
      Math.hypot(a.def.pos.x - lead.pos.x, a.def.pos.y - lead.pos.y) -
      Math.hypot(b.def.pos.x - lead.pos.x, b.def.pos.y - lead.pos.y))
    const bp = toPx(cam, lead.pos)

    for (const st of near.slice(0, takes)) {
      const al = st.def
      const col = altarColour(al.colour)
      const ap = toPx(cam, al.pos)
      // Already draining AND still nearest: the next Imbibe takes it a second
      // time, stacking its Infusion and empowering both its add and its debuff.
      // That is the specific mistake standing still produces, so it gets its own
      // word rather than being drawn as one more link.
      const again = drained.includes(al.id)
      ctx.save()
      ctx.setLineDash([10, 7])
      // Marching toward the boss, because he is drinking FROM the altar.
      ctx.lineDashOffset = -(w.elapsedMs / 42) % 17
      ctx.lineWidth = again ? 4 : 2.5
      ctx.strokeStyle = `rgba(${col}, ${again ? 0.55 + 0.35 * pulse : 0.62})`
      ctx.beginPath(); ctx.moveTo(ap.x, ap.y); ctx.lineTo(bp.x, bp.y); ctx.stroke()
      ctx.restore()
      ctx.lineWidth = 1
      // Called at the midpoint, in the altar's own colour, so the tank reads the
      // pair without tracing either line back to a plinth.
      drawLabel(
        ctx, `${al.colour.toUpperCase()} ${again ? 'AGAIN' : 'NEXT'}`,
        (ap.x + bp.x) / 2, (ap.y + bp.y) / 2, col, 11,
        again ? 0.7 + 0.3 * pulse : 0.88,
      )
    }

    for (const al of altars) {
      drawAltar(ctx, cam, al, drained.includes(al.def.id), w.elapsedMs, pulse)
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
    // On a split fight the golem wears its group's colour. "Which one is mine"
    // has to be answerable from across the room, and both sigils are the same
    // violet — it is the same golem model twice.
    const glow = b.def.side ? sideColour(b.def.side) : VIOLET
    // A stage that reduces damage on every entity — the Stasis intermission — is
    // scripted, not a mistake, so it wears the same shield in violet rather than
    // being accused in red. What the two states share is that your damage has
    // stopped counting, and a player who cannot see that spends the window
    // shooting something that will not move.
    if (b.alive && w.entityReduction > 0 && !w.bossesLinked) {
      drawShield(ctx, bp.x, bp.y, size * 0.95, w.elapsedMs, pulse, VIOLET)
    }
    ctx.beginPath(); ctx.arc(bp.x, bp.y, size * 0.65, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${glow}, 0.18)`
    ctx.fill()
    ctx.shadowBlur = 18; ctx.shadowColor = `rgba(${glow}, 0.8)`
    if (sig && meta) {
      // The boss is its sigil — a serpent, a golem, a tornado — rather than an
      // anonymous circle, so each fight reads as its own encounter.
      const vb = meta.viewBox.split(' ').map(Number)
      const span = Math.max(vb[2] || 512, vb[3] || 512)
      const k = size / span
      ctx.save()
      ctx.translate(bp.x - size / 2, bp.y - size / 2)
      ctx.scale(k, k)
      // Same sigil twice on the Sentinels — it is the same golem model — so a
      // sided entity is filled in its own colour rather than in the house violet.
      ctx.fillStyle = !b.alive
        ? '#4a4458'
        : b.def.side
          ? (b.def.side === 'red' ? '#ff9fae' : '#c2f294')
          : isPrimary ? '#b79bff' : '#9a86e0'
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

    // Its own health. These fights do not share a pool, so one bar in the HUD
    // cannot show you that a pair is drifting apart — which is the whole
    // synchronised-kill problem.
    if (multi) {
      const bw = 44
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(bp.x - bw / 2, bp.y + size * 0.65 + 2, bw, 4)
      ctx.fillStyle = b.alive ? 'rgba(183,155,255,0.95)' : 'rgba(120,120,120,0.7)'
      ctx.fillRect(bp.x - bw / 2, bp.y + size * 0.65 + 2, bw * Math.max(0, b.hp), 4)
    }

    // Name them, but only when there is more than one — on a single-boss fight
    // the name is already in the HUD and a floating label is just clutter.
    if (multi) {
      ctx.font = '600 11px Rajdhani, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(201, 182, 255, 0.92)'
      ctx.fillText(b.def.name, bp.x, bp.y + size * 0.65 + 20)
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

      // So does one winding up a fixated cast. Without this the only warning is
      // the frontal itself, and by then the marked player has 5 seconds to
      // solve a problem they could have been walking away from already.
      if (d.casts && add.castMs > 0) {
        const t = 1 - add.castMs / (d.casts.everySec * 1000)
        ctx.beginPath()
        ctx.arc(p.x, p.y, R + 6, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2)
        ctx.strokeStyle = 'rgba(210, 153, 34, 0.9)'; ctx.lineWidth = 3; ctx.stroke()
        ctx.lineWidth = 1
      }
    }
  }

  // ── fixate tethers ──
  //
  // A thin line from each spawn to the raider it has marked. The frontal shows
  // WHERE the line will go; this shows WHOSE it is, which is the thing a raid
  // has to sort out in the two seconds before the first cast — three marks in a
  // twenty-man raid is invisible otherwise, and the marked players are the only
  // people who can fix it.
  for (const add of w.adds) {
    if (!add.alive || !add.def.fixates || add.fixate === -2) continue
    const tgt = add.fixate === -1
      ? (w.player.alive ? w.player.pos : null)
      : (w.allies.find(a => a.id === add.fixate && a.alive)?.pos ?? null)
    if (!tgt) continue
    const a = toPx(cam, add.pos)
    const b = toPx(cam, tgt)
    // Yours is drawn brighter and solid. Somebody else's is a hint; your own is
    // an instruction.
    const yours = add.fixate === -1
    ctx.setLineDash(yours ? [] : [5, 5])
    ctx.strokeStyle = yours ? 'rgba(210, 153, 34, 0.85)' : 'rgba(210, 153, 34, 0.35)'
    ctx.lineWidth = yours ? 2 : 1
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    ctx.setLineDash([]); ctx.lineWidth = 1
    // The mark itself, sitting on the raider carrying it.
    ctx.beginPath(); ctx.arc(b.x, b.y, yours ? 15 : 11, 0, Math.PI * 2)
    ctx.strokeStyle = yours ? 'rgba(210, 153, 34, 0.95)' : 'rgba(210, 153, 34, 0.45)'
    ctx.lineWidth = yours ? 2 : 1
    ctx.stroke()
    ctx.lineWidth = 1
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
  // Your own group, ringed OUTSIDE the lime halo so lime stays the one thing on
  // the field that means "you". A side colour drawn over it would buy the split
  // at the cost of the thing the halo is there for.
  if (w.boss.sided && w.player.side) {
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 17, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${sideColour(w.player.side)}, 0.75)`
    ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1
  }
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

  // A live Mutilated Gash. The next cone that catches you kills, so it is drawn
  // on you rather than left in a debuff list nobody reads mid-flurry.
  if (w.player.gash > 0) {
    drawLabel(ctx, `GASH — STAY OUT`, pp.x, pp.y + 30, RED, 12, 0.75 + 0.25 * pulse)
  }

  // Standing in range of both golems. This is the split raid's characteristic
  // mistake — both Marks stack, forever, and the healers pay for it for the rest
  // of the pull — and it is invisible from inside it, because being in range of
  // a golem looks exactly like being in range of the right golem.
  if (insideOwn && insideOther) {
    drawLabel(ctx, 'BOTH MARKS', pp.x, pp.y + 30, RED, 12, 0.7 + 0.3 * pulse)
  }

  // ── Helical Toxins orbs ──
  // Last, over everything, because during the intermission this is the only
  // thing on screen worth looking at: you are hunting the raider whose green
  // count completes yours to four, and a partner obscured by a pool is a partner
  // you cannot find. Colliding with the wrong one kills you outright.
  for (const a of w.allies) {
    if (!a.alive || !a.marked || a.presence < 0.03) continue
    const p = toPx(cam, a.pos)
    drawOrbs(ctx, p.x, p.y - 19, a.green)
  }
  if (w.player.marked) drawOrbs(ctx, pp.x, pp.y - 26, w.player.green, true)

  // ── Raging Crosswinds ──
  //
  // Last, over everything, for the same reason the orbs are: while this is up it
  // is the only thing on screen worth looking at. You are hunting the raider
  // whose arrow points back at yours, and one obscured by a vortex is one you
  // cannot find.
  //
  // Every raider's bearing is drawn, not just yours. Reading somebody else's
  // arrow IS the mechanic — this is the same call the orbs make, and it is why
  // the raid has to be on the floor during a spread rather than faded out.
  if (w.windUp || w.player.wind) {
    // The countdown, drawn as a ring on each body that is carrying a bearing.
    //
    // This is what the mechanic IS: a circle around a raider, with an arrow, and
    // a clock. Everything you need to line up is somebody else's ring and
    // somebody else's arrow, so both are drawn on all of them rather than on the
    // floor — a marker sitting where you used to be standing tells you nothing
    // about where anybody is going.
    const windInst = w.instances.find(i => !i.resolved && i.def.rule.type === 'windPair')
    const t = windInst ? progress(windInst) : 0
    const ringYd = windInst?.def.shape?.kind === 'circle' ? windInst.def.shape.radius : 6
    const ringOf = (x: number, y: number, alpha: number, mine: boolean) => {
      const r = ringYd * cam.scale
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${mine ? LIME : VIOLET}, ${(mine ? 0.9 : 0.55) * alpha})`
      ctx.lineWidth = mine ? 2.5 : 1.5
      ctx.stroke()
      // Contracting onto its own edge, the same language every other telegraph
      // in this file uses for "when".
      ctx.beginPath(); ctx.arc(x, y, r * (1 + 0.9 * (1 - t)), 0, Math.PI * 2)
      ctx.setLineDash([6, 6])
      ctx.strokeStyle = `rgba(${mine ? LIME : VIOLET}, ${(0.2 + 0.5 * t) * alpha})`
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = 1
    }
    for (const a of w.allies) {
      if (!a.alive || !a.wind || a.presence < 0.03) continue
      const p = toPx(cam, a.pos)
      ringOf(p.x, p.y, a.presence, false)
      const ang = Math.atan2(COMPASS[a.wind].y, COMPASS[a.wind].x)
      drawArrow(ctx, p.x, p.y - 20, ang, 20, VIOLET, 0.9 * a.presence)
    }
    if (w.player.wind) {
      ringOf(pp.x, pp.y, 1, true)
      const dir = COMPASS[w.player.wind]
      const ang = Math.atan2(dir.y, dir.x)
      drawArrow(ctx, pp.x, pp.y - 28, ang, 28, LIME)
      drawLabel(ctx, `BLOWN ${w.player.wind}`, pp.x, pp.y - 46, LIME, 11, 0.95)

      // The lane you are about to travel, and whether anybody is standing in it.
      //
      // Drawn as the actual test the engine runs rather than as a hint: the pair
      // of rails is the tolerance, the length is the reach, and it turns green
      // the instant a body with the opposite arrow is inside it. Without this,
      // "line up" is an instruction with no way to check your own answer — you
      // find out whether you were on the line by falling off the platform.
      const want = OPPOSITE[w.player.wind]
      const mate = w.allies.find(a => {
        if (!a.alive || a.wind !== want) return false
        const dx = a.pos.x - w.player.pos.x
        const dy = a.pos.y - w.player.pos.y
        const along = dx * dir.x + dy * dir.y
        const across = Math.abs(dx * -dir.y + dy * dir.x)
        return along > 0 && along <= 26 && across <= 6
      })
      const col = mate ? GREEN : RED
      ctx.save()
      ctx.setLineDash([6, 6])
      ctx.lineDashOffset = -(w.elapsedMs / 40) % 12
      ctx.strokeStyle = `rgba(${col}, ${mate ? 0.75 : 0.4 + 0.3 * pulse})`
      ctx.lineWidth = 2
      for (const side of [-1, 1]) {
        const ox = -dir.y * 6 * side * cam.scale
        const oy = dir.x * 6 * side * cam.scale
        ctx.beginPath()
        ctx.moveTo(pp.x + ox, pp.y + oy)
        ctx.lineTo(pp.x + dir.x * 26 * cam.scale + ox, pp.y + dir.y * 26 * cam.scale + oy)
        ctx.stroke()
      }
      ctx.restore()
      ctx.lineWidth = 1
      if (mate) {
        const mp = toPx(cam, mate.pos)
        ctx.beginPath()
        ctx.moveTo(pp.x, pp.y); ctx.lineTo(mp.x, mp.y)
        ctx.strokeStyle = `rgba(${GREEN}, 0.9)`; ctx.lineWidth = 3; ctx.stroke()
        ctx.lineWidth = 1
        drawLabel(ctx, 'LINED UP', (pp.x + mp.x) / 2, (pp.y + mp.y) / 2 - 14, GREEN, 11, 0.95)
      }
    }
  }

  // ── the gales ──
  //
  // A wind has no shape to draw, so it is drawn as what it does: streaks running
  // the way it is pushing, and a ring on the glob at the end of it. Both are
  // necessary. Without the streaks the stage is a mysterious loss of control;
  // without the ring the one thing that ends it is a four-yard circle somewhere
  // out at the rim, indistinguishable from every other puddle on the floor.
  const galeTarget = w.instances.find(i => i.uid === w.galeTargetUid && !i.answered)
  const braced = w.galeImmuneMs > 0
  if (galeTarget || braced) {
    // The direction is read off the world rather than re-derived from the glob,
    // because for five seconds after a burst there IS no glob — you are planted
    // at his feet and the wind is still screaming past you. A wind that stopped
    // being drawn the moment it stopped moving you would make the safe window
    // look like the stage ending.
    const dir = w.galeDir
    ctx.save()
    pathArena(ctx, cam, w.boss)
    ctx.clip()
    ctx.strokeStyle = `rgba(${VIOLET}, 0.32)`
    ctx.lineWidth = 2
    const span = arenaReach(w.boss) * cam.scale
    const drift = ((w.elapsedMs / 8) % 60)
    for (let i = -14; i <= 14; i++) {
      // Laid across the wind and swept along it, so the whole floor visibly
      // moves one way.
      const ox = -dir.y * i * 9 * cam.scale
      const oy = dir.x * i * 9 * cam.scale
      for (let k = -2; k <= 2; k++) {
        const t = k * 60 + drift
        const sx = cam.cx + ox + dir.x * (t - span)
        const sy = cam.cy + oy + dir.y * (t - span)
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx + dir.x * 34, sy + dir.y * 34)
        ctx.stroke()
      }
    }
    ctx.restore()
    ctx.lineWidth = 1

    if (galeTarget) {
      const gp = toPx(cam, galeTarget.pos)
      const gr = (galeTarget.def.shape?.kind === 'circle' ? galeTarget.def.shape.radius : 4) * cam.scale
      ctx.beginPath(); ctx.arc(gp.x, gp.y, gr + 8 + 4 * pulse, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${GREEN}, ${0.6 + 0.35 * pulse})`
      ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1
      drawLabel(ctx, 'RIDE IT IN', gp.x, gp.y - gr - 20, GREEN, 12, 0.95)
    }
    // Braced: the wind cannot move you, so say so on the one body it matters
    // for. Without it the five seconds read as the gale having stopped, and a
    // player spends them walking somewhere instead of hitting him.
    if (braced) {
      ctx.beginPath(); ctx.arc(pp.x, pp.y, 22, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${GREEN}, ${0.55 + 0.35 * pulse})`
      ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1
      drawLabel(ctx, `BRACED ${(w.galeImmuneMs / 1000).toFixed(1)}s`, pp.x, pp.y - 40, GREEN, 12, 0.95)
    }
  }

  ctx.restore()
}
