import type { BossDef, Instance, Role, Side, Vec } from './types'
import { COMPASS, OPPOSITE } from './types'
import type { AltarState, BossUnit, World } from './sim'
import { VENOM_FLASH_MS, WIND_TOUCH_YARDS, bossUnitFor, inArena } from './sim'
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

/**
 * Frostfire Volley's two elements. IDENTITY again, and under the same
 * discipline as the sides and the altars.
 *
 * It matters more here than anywhere else in this file, because both pools carry
 * the SAME verb — green, run into the one you are not carrying. Painted in the
 * verb palette the two would be indistinguishable from each other and a mechanic
 * whose entire content is "which of these two is which" would become a coin
 * flip. So a pool is drawn in its own element's colour, and green appears only
 * as a ring around the one pool that is YOUR cure.
 */
const FIRE = '255, 138, 62'
const FROST = '126, 196, 255'
const elementColour = (e: 'fire' | 'frost') => (e === 'fire' ? FIRE : FROST)
/** What the debuff is called on the raider carrying it, for the label. */
const ELEMENT_NAME: Record<'fire' | 'frost', string> = {
  fire: 'BURNING FLAMES',
  frost: 'PIERCING FROST',
}
/** An empowered explorer. Gold, the file's existing "do not misread this" hue. */
const GOLD = '210, 153, 34'

/**
 * How long a landed kick is announced on the floor.
 *
 * `World.interruptFlash` is deliberately never cleared by the sim — it stamps
 * `atMs` and leaves consumers to age it — so the duration lives here, where the
 * drawing is. Long enough to be unmissable if you were looking somewhere else
 * when you pressed it, short enough that two kicks in a row are two events.
 */
const KICK_FLASH_MS = 1400

/**
 * Daylight beyond the link radius before the pair is called "closing".
 *
 * The engine's own default (STACK_KITE_MARGIN in sim.ts) is the distance the AI
 * tanks walk the stacked pair to, so a pair inside it is a pair that has drifted
 * off the walk rather than one that has already lost the pull. A fight that
 * overrides `tankStackKite.marginYards` moves this readout with it.
 */
const STACK_MARGIN = 8

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

/**
 * The gap a `tankedStacked` pair has to hold, and the body it is measured to.
 *
 * THE READOUT THIS REPLACES WAS TEACHING THE FIGHT BACKWARDS. It drew a line
 * between the two tanked explorers with the yardage on it — "37 YD · HOLD 30+"
 * — and the two of them standing together is not a mistake, it is the answer.
 * `keepApart` links when the WIDEST pair of live entities is under `minYards`,
 * which on a three-body council is literally "all three within 30 of each
 * other"; a pair on top of each other with the third across the room links
 * nothing at all. What loses the pull is the pair drifting within 30 of the
 * body nobody is holding, so that is the only distance worth drawing.
 *
 * Measured as the FURTHEST of the pair from the threat, and that is exactly the
 * quantity the engine scores: with the two held a few yards apart,
 * max(d(threat, a), d(threat, b)) IS the widest of the three gaps. Reading it
 * from the pair rather than re-deriving the widest pair is also what makes it
 * structurally impossible for this line to end up drawn between the two bodies
 * the tanks are deliberately standing together.
 *
 * Null on every fight with no `tankedStacked` entity — which is all of them but
 * one — so the Sentinels keep the generic widest-pair readout untouched.
 *
 * Exported because the HUD asks the same question. Two answers computed in two
 * files is two things to keep in step, and the one thing the HUD must never do
 * is disagree with the canvas about a number the fight is scored on.
 */
export interface StackGap {
  /** The middle of the stacked pair, in yards — where the readout hangs from. */
  at: Vec
  /** The body they must stay clear of, and how far the furthest of them is. */
  threat: BossUnit
  yards: number
  /** The separation the fight's own rule demands. */
  minYards: number
  /** Inside the walk's margin: drifting toward the link, not yet in it. */
  closing: boolean
}

export function stackGap(w: World): StackGap | null {
  const def = w.boss.mechanics.find(m => m.rule.type === 'keepApart')
  if (!def || def.rule.type !== 'keepApart') return null
  const live = w.bosses.filter(b => !b.def.untargetable && b.alive)
  const pair = live.filter(b => b.def.tankedStacked)
  const threats = live.filter(b => !b.def.tankedStacked)
  if (pair.length < 2 || !threats.length) return null
  const at = {
    x: pair.reduce((s, b) => s + b.pos.x, 0) / pair.length,
    y: pair.reduce((s, b) => s + b.pos.y, 0) / pair.length,
  }
  // Whichever threat is closest to linking the council, not whichever is
  // nearest: a body two yards from one of the pair and fifty from the other
  // links nothing, and pointing the readout at it would cry wolf all pull.
  let threat = threats[0]
  let yards = Infinity
  for (const t of threats) {
    let gap = 0
    for (const b of pair) gap = Math.max(gap, Math.hypot(t.pos.x - b.pos.x, t.pos.y - b.pos.y))
    if (gap < yards) { yards = gap; threat = t }
  }
  const margin = w.boss.tankStackKite?.marginYards ?? STACK_MARGIN
  return { at, threat, yards, minYards: def.rule.minYards, closing: yards < def.rule.minYards + margin }
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

/**
 * Compile-time exhaustiveness, deliberately inert at runtime.
 *
 * Every `Rule` variant has to be NAMED in the dispatch below rather than swept
 * up by a `default`, because the default in this file is RED — "do not stand
 * here" — and a new verb that quietly inherited it would paint a cure, a
 * mushroom or a fish as a hazard. That is not hypothetical: the note a few
 * lines down records this file having made exactly that mistake once already,
 * and a type error is a cheaper way of catching the next one than a playtest.
 *
 * It does not throw. This runs inside the frame loop, and a renderer that took
 * the whole fight down over a colour would be a worse failure than a wrong
 * colour is.
 */
function exhaustive(_never: never): void {}

function ruleColour(inst: Instance, w?: World): string {
  /**
   * A fight that colour-codes by CASTER beats the verb palette.
   *
   * The Twin Fangs do: everything Vexhul casts is green, everything Ithraz casts
   * is red, and the raid reads green as "this puts Eternal Venom on me". On a
   * fight that is entirely a stack counter that is the more useful glance, so it
   * wins — see BossEntityDef.hue.
   *
   * TWO MECHANICS PAY FOR IT, and both are Ithraz's, and both are places you are
   * supposed to STAND:
   *   - Ravenous Feast, the only thing in the fight that gives a stack back
   *   - a Stone Breaker slam, which the Ithraz tank has to walk
   * Under the verb palette those were green when they wanted you and red when
   * they did not. Under the caster palette they are red throughout, and the
   * "get in" has to come from the prompt and the briefing instead. That is the
   * raid leader's call, made knowingly; it is written here so the next person to
   * wonder why the shed circle is red does not "fix" it.
   */
  const owner = w && inst.fromId ? bossUnitFor(w, inst.fromId).def.hue : undefined
  if (owner) return owner === 'green' ? GREEN : RED

  switch (inst.def.rule.type) {
    case 'beInside': return GREEN
    case 'collect': return GREEN
    case 'carryOut': return VIOLET
    case 'press': return VIOLET
    case 'survive': return VIOLET
    case 'windPair': return VIOLET
    // The Lost Explorers' new verbs, named explicitly rather than left to fall
    // through. `default: return RED` would paint a cure, a mushroom and a fish
    // as "do not stand here" — which is the exact mistake the pickup pass below
    // records this file having already made once.
    case 'feed': return GREEN
    case 'launchPad': return GREEN
    case 'elementPool': return GREEN
    case 'polarity': return RED
    case 'wave': return RED
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
    /**
     * The second one, and the same argument.
     *
     * A Stone Breaker slam is a place the Ithraz tank must be standing and a
     * place nobody else may be. One colour for both would tell nineteen people
     * to walk into the thing that is only survivable because one person is
     * eating it — so it is green to the tank holding Ithraz and red to everybody
     * else, including the OTHER tank, who is welded to Vexhul and cannot help.
     */
    case 'tankSoak':
      return w && bossUnitFor(w, inst.fromId).targetId === 0 ? GREEN : RED
    /**
     * The third, and the same argument again — but the flip is in TIME rather
     * than between two readers.
     *
     * Ravenous Feast is a place to run into for one bite and a place that kills
     * you for the next two, and it is the same circle in the same spot the whole
     * way through. Painting it green throughout would be the palette telling a
     * raider who has already had their stack back to go and get another one,
     * which is precisely how this mechanic kills people on the real fight. So it
     * turns red the moment the cast has fed you, and stays red for the rest of
     * the cast.
     *
     * Green while you have taken nothing, whatever your count is. A raider at
     * zero loses nothing by being in it once and the colour has no business
     * second-guessing that call — the panel explains the trade and the prompt
     * stays quiet, which is the RL's ruling.
     */
    case 'shedStack':
      return inst.fed?.includes(-1) ? RED : GREEN
    // Everything answered by not being on the ground it is drawn on, plus the
    // rules that draw no shape of their own and only reach this function through
    // one somebody else handed them. All red — but all named, so that adding a
    // 30th verb fails the build here rather than inheriting "get out" from a
    // `default` and being wrong in a way only a playtest would notice.
    //
    // `holdMelee` is in this list rather than green because the leash draws its
    // OWN ring further down this file, in bone until the boundary is behind you.
    // It reaches this function only if something ever hands it a telegraph, and
    // red is what the `default` it replaces already returned for it.
    case 'holdMelee':
    case 'avoid':
    case 'keepApart':
    case 'lethalGround':
    case 'pairUp':
    case 'drainNearest':
    case 'trail':
    case 'burnWindow':
    case 'syncKill':
    case 'faceAway':
    case 'aimAway':
    case 'raidDamage':
    case 'tankSwap':
    case 'combo':
    case 'stackingDot':
      return RED
    default:
      exhaustive(inst.def.rule)
      return RED
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
  // A cast that bites more than once winds up against the CAST time for the
  // first bite and against the gap between bites for the rest. Measured against
  // the cast time throughout, a two-second gap on a four-second cast would draw
  // its timing ring already half full, so the second and third bites of a
  // Ravenous Feast would look most of the way landed from the instant they
  // re-armed — which is the one number a raider has to read off the floor here,
  // because the whole mechanic is being in it at the right moment and out of it
  // at the wrong one.
  const rule = inst.def.rule
  const total = Math.max(1,
    rule.type === 'shedStack' && inst.bitesLeft !== undefined && inst.bitesLeft < rule.bites
      ? rule.biteGapMs
      : inst.def.telegraphMs)
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
 * One lane of a fanned `line`, APPENDED to the current path instead of starting
 * a new one.
 *
 * `pathShape` opens its own path, which is right for a telegraph drawn on its
 * own and wrong for a fan. Three shells thrown off one anchor have to be filled
 * as a single union or their alphas compound wherever they cross, and the place
 * they cross is exactly the near field the player is standing in — see the fan
 * pass below for why that is the whole legibility of the mechanic.
 */
function laneQuad(ctx: CanvasRenderingContext2D, cam: Camera, inst: Instance, k = 1) {
  const s = inst.def.shape
  if (s?.kind !== 'line') return
  const p = toPx(cam, inst.pos)
  const ca = Math.cos(inst.angle), sa = Math.sin(inst.angle)
  const hw = (s.width / 2) * k * cam.scale
  const L = (inst.reach ?? s.length) * cam.scale
  ctx.moveTo(p.x - sa * hw, p.y + ca * hw)
  ctx.lineTo(p.x + ca * L - sa * hw, p.y + sa * L + ca * hw)
  ctx.lineTo(p.x + ca * L + sa * hw, p.y + sa * L - ca * hw)
  ctx.lineTo(p.x + sa * hw, p.y - ca * hw)
  ctx.closePath()
}

/** Is this instance one lane of a fanned `line` rather than a shape on its own? */
function isLane(inst: Instance): boolean {
  return inst.def.fanDeg !== undefined && inst.def.shape?.kind === 'line'
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
 * A cast bar snapping in half, over the body that was casting.
 *
 * The only success in this raid that is invisible by construction. Every other
 * thing a player does right produces something to look at — a soak splits, a
 * boss turns, a crate disappears — but an interrupt is proved by a hit that
 * never arrives, and a kick that landed and a kick that was one frame late look
 * identical if all you are shown is empty floor. Players were finishing pulls
 * genuinely unsure whether a single one of their kicks had gone through.
 *
 * So the cast is drawn AND broken: two halves thrown apart with a tear between
 * them, widening as it fades. Green, because in this palette green is correct
 * play — the same call the mushrooms and the fish make. `f` runs 1 to 0.
 */
function drawBrokenCast(
  ctx: CanvasRenderingContext2D, x: number, y: number, f: number, name: string,
) {
  const span = 96
  // The halves fly apart as it fades, so the break is a movement rather than a
  // static graphic that could be mistaken for a bar with a notch in it.
  const gap = 6 + 26 * (1 - f)
  const h = 9
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, f * 1.5))
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? x - gap / 2 - span / 2 : x + gap / 2
    roundedRect(ctx, x0, y - h / 2, span / 2, h, 2)
    ctx.fillStyle = `rgba(${GREEN}, 0.5)`
    ctx.fill()
    ctx.strokeStyle = `rgba(${GREEN}, 0.95)`
    ctx.lineWidth = 2
    ctx.stroke()
  }
  // The tear itself, in white so it reads as a break rather than as one more
  // green edge on a green bar.
  ctx.strokeStyle = 'rgba(255, 246, 244, 0.92)'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - 5, y - h)
  ctx.lineTo(x + 3, y - 1)
  ctx.lineTo(x - 3, y + 1)
  ctx.lineTo(x + 5, y + h)
  ctx.stroke()
  ctx.restore()
  ctx.lineCap = 'butt'
  ctx.lineWidth = 1
  drawLabel(ctx, `KICKED — ${name.toUpperCase()}`, x, y - 20, GREEN, 12, Math.min(1, f * 1.7))
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

  // ── the patrol lap ──
  //
  // A body walking a circle nobody can move is effectively a moving piece of the
  // room, and until the circle is drawn it reads as aimless wandering. On the
  // Lost Explorers it is the whole shape of the tank job: Trader Gebbo laps the
  // middle of the floor all pull, and the two stacked tanks have to keep their
  // pair on the far side of that lap as he goes. You cannot plan a walk against
  // a body when the only thing on screen is where it is standing this instant.
  //
  // So the lap is drawn as the route it is, and three pips are projected along
  // it — where he will be in two, four and six seconds. Where he IS comes off
  // `b.pos` and is never re-derived; the projection is the only arithmetic done
  // here, because a future position is the one thing the world does not own.
  //
  // Bone rather than a verb colour. A patrol is neither ground to avoid nor
  // somewhere to go — it is a body's route, which is exactly what bone means
  // everywhere else in this file.
  for (const b of w.bosses) {
    const lap = b.def.patrol
    if (!lap || !b.alive) continue
    const lc = toPx(cam, lap.centre)
    const lr = lap.radius * cam.scale
    ctx.save()
    ctx.setLineDash([6, 10])
    // Marching the way he walks, so the ring carries the direction as well as
    // the shape.
    ctx.lineDashOffset = (-(w.elapsedMs / 60) % 16) * Math.sign(lap.degPerSec || 1)
    ctx.strokeStyle = `rgba(${BONE}, 0.24)`
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(lc.x, lc.y, lr, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
    ctx.lineWidth = 1

    const rate = (lap.degPerSec * Math.PI) / 180
    const now = ((lap.startDeg ?? 0) * Math.PI) / 180 + rate * (w.elapsedMs / 1000)
    for (const ahead of [2, 4, 6]) {
      const a = now + rate * ahead
      const at = toPx(cam, {
        x: lap.centre.x + Math.cos(a) * lap.radius,
        y: lap.centre.y + Math.sin(a) * lap.radius,
      })
      // Fading with distance into the future, so the nearest pip is the one the
      // eye lands on and the run of them reads as a direction.
      const f = 1 - (ahead - 2) / 9
      ctx.beginPath(); ctx.arc(at.x, at.y, 3.4, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${BONE}, ${(0.42 * f).toFixed(3)})`; ctx.fill()
      if (ahead === 6) drawLabel(ctx, `${b.def.name.toUpperCase()} · 6s`, at.x, at.y - 14, BONE, 10, 0.5)
    }

    // And the heading, on the body itself — tangent to the lap, so which way
    // round he is going is readable without watching him for a second first.
    const bp = toPx(cam, b.pos)
    const head = Math.atan2(b.pos.y - lap.centre.y, b.pos.x - lap.centre.x)
      + (lap.degPerSec >= 0 ? Math.PI / 2 : -Math.PI / 2)
    drawArrow(ctx, bp.x + Math.cos(head) * 30, bp.y + Math.sin(head) * 30, head, 20, BONE, 0.5)
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
    // An element pool lingers for twenty seconds and would be caught by this
    // pass, which paints everything red. It is a CURE, and the one thing this
    // file must never do is tell a carrier to walk out of the only ground that
    // saves them. Drawn in its own colours immediately below.
    if (inst.def.rule.type === 'elementPool') continue
    // A ripple is a travelling RING and its declared `annulus` shape is only
    // there so the guards that skip shapeless instances still see one. Drawn
    // here it would be a fixed disc sitting on the bomb site for the whole
    // crossing — the wrong geometry, in the wrong place, for the wave the
    // mechanic is now. It gets its own pass below.
    if (inst.def.ripple) continue
    // A landed shell is still crossing the room. It is drawn with the rest of
    // its fan below, as a lane, rather than as one more puddle that happens to
    // be sliding — the whole point of the shape is which way it is going.
    if (isLane(inst)) continue
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

  // ── element pools ──
  //
  // The ground half of Frostfire Volley, and the only ground in the raid you are
  // supposed to run INTO while it is on fire. Two things have to be legible at
  // once and they are different questions:
  //
  //   what is it   — fire or frost, drawn in the element's own identity colour,
  //                  because telling the two apart IS the mechanic;
  //   what do I do — green, and only ever on the pool that cures what YOU are
  //                  carrying, so the verb palette answers one raider's question
  //                  rather than shouting the same thing about both.
  //
  // Filled low and rimmed solid, deliberately unlike a telegraph: nothing here
  // is landing, the pool simply is, and it does no damage to anybody at all.
  for (const inst of w.instances) {
    if (inst.def.rule.type !== 'elementPool' || !inst.def.shape) continue
    const el = inst.def.rule.element
    const col = elementColour(el)
    const p = toPx(cam, inst.pos)
    const rr = (inst.def.shape.kind === 'circle' ? inst.def.shape.radius : 6) * cam.scale
    // Fades over its last second the way every other timed pool does, so a
    // carrier can tell a cure that is about to go out from one that is not.
    const left = (inst.def.lingerMs ?? 0) + inst.timer
    const dying = Math.max(0.3, Math.min(1, left / 1200))
    const wash = ctx.createRadialGradient(p.x, p.y, rr * 0.2, p.x, p.y, rr)
    wash.addColorStop(0, `rgba(${col}, ${0.30 * dying})`)
    wash.addColorStop(1, `rgba(${col}, ${0.10 * dying})`)
    ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2)
    ctx.fillStyle = wash; ctx.fill()
    ctx.strokeStyle = `rgba(${col}, ${0.85 * dying})`
    ctx.lineWidth = 2.5; ctx.stroke(); ctx.lineWidth = 1
    // Fire licks outward, frost crystallises inward. Two shapes as well as two
    // colours, because a raid is read at a glance and under a red telegraph
    // orange and blue are closer than anybody would like.
    ctx.strokeStyle = `rgba(${col}, ${0.75 * dying})`
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (el === 'fire' ? (w.elapsedMs / 900) % (Math.PI * 2) : 0)
      const inner = el === 'fire' ? rr * 0.45 : rr * 0.15
      const outer = el === 'fire' ? rr * 0.8 + 3 * pulse : rr * 0.7
      ctx.moveTo(p.x + Math.cos(a) * inner, p.y + Math.sin(a) * inner)
      ctx.lineTo(p.x + Math.cos(a) * outer, p.y + Math.sin(a) * outer)
    }
    ctx.stroke()
    ctx.lineWidth = 1
    // Frost also gets a hard hexagon and fire does not, so the two are separated
    // by SHAPE as well as by hue and motif. Under a red telegraph on a dark
    // floor, orange and blue are closer than anybody would like — and now that
    // a volley drops exactly ONE pool per carrier there is no second copy of
    // either to check yourself against.
    if (el === 'frost') {
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2
        const x = p.x + Math.cos(a) * rr * 0.42
        const y = p.y + Math.sin(a) * rr * 0.42
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.strokeStyle = `rgba(${col}, ${0.8 * dying})`
      ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1
    }
    // YOUR cure. The green ring is the whole reason the pools are not green:
    // it appears on exactly one of the two, and it means "this one, run at it".
    //
    // Both are named in full rather than abbreviated to FIRE and FROST, because
    // the full names are the ones a carrier is wearing and the ones the HUD chip
    // and the body rim use. One vocabulary for one mechanic.
    if (w.player.element && w.player.element !== el) {
      ctx.beginPath(); ctx.arc(p.x, p.y, rr + 5 + 3 * pulse, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${GREEN}, ${0.55 + 0.4 * pulse})`
      ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1
      drawLabel(ctx, `YOUR CURE · ${ELEMENT_NAME[el]}`, p.x, p.y - rr - 14, GREEN, 11, 0.95)
      // And a line to it, while you are carrying something. There is exactly one
      // of these on the floor, it does not move, and the entire decision is
      // getting to it before the next volley — which is the same argument that
      // puts a marching line on every explorer that can still eat a fish.
      if (w.player.alive) {
        const me = toPx(cam, w.player.pos)
        ctx.save()
        ctx.setLineDash([9, 7])
        ctx.lineDashOffset = -(w.elapsedMs / 42) % 16
        ctx.strokeStyle = `rgba(${GREEN}, ${0.4 + 0.3 * pulse})`
        ctx.lineWidth = 2.5
        ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.lineTo(p.x, p.y); ctx.stroke()
        ctx.restore()
        ctx.lineWidth = 1
      }
    } else {
      drawLabel(
        ctx, ELEMENT_NAME[el], p.x, p.y - rr - 12, col, 10,
        (w.player.element ? 0.8 : 0.6) * dying,
      )
      // The pool of your OWN element. It looks exactly like the one that saves
      // you and does nothing whatever, and with one of each on the floor a run
      // at the wrong one costs the trade rather than a second or two.
      if (w.player.element === el) {
        drawLabel(ctx, 'YOUR OWN — NO CURE', p.x, p.y + rr + 12, col, 10, 0.75 * dying)
      }
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

  // ── the Disgusting Fish ──
  //
  // Drawn as its own thing rather than as one more pickup, and named on the
  // floor, because the two look identical in the fiction and mean completely
  // different things: a junk box is a chore on a ten-second clock, and the fish
  // is the only object in the encounter that empties Mor'zahi's bar. A player who
  // ran over it thinking it was another box would never learn that it was there.
  //
  // Deliberately NOT drawn on the box that hides it. Opening them is the
  // mechanic — "find the fish" — and a renderer that marked the right box in
  // advance would delete it.
  for (const inst of w.instances) {
    if (inst.resolved || inst.answered || inst.def.rule.type !== 'feed') continue
    const p = toPx(cam, inst.pos)
    const r = (inst.def.shape?.kind === 'circle' ? inst.def.shape.radius : 3) * cam.scale
    // A slow beacon rather than a contracting ring: the fish has a long life and
    // nothing about it is a countdown you have to beat, it is a thing to go and
    // get. Two rings breathing outward read as "come here".
    for (const k of [0, 0.5]) {
      const f = ((w.elapsedMs / 1300) + k) % 1
      ctx.beginPath(); ctx.arc(p.x, p.y, r * (1 + 1.6 * f), 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${GREEN}, ${0.55 * (1 - f)})`
      ctx.lineWidth = 2.5; ctx.stroke(); ctx.lineWidth = 1
    }
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${GREEN}, 0.7)`; ctx.fill()
    ctx.strokeStyle = `rgba(${GREEN}, 1)`; ctx.lineWidth = 2.5; ctx.stroke()
    ctx.lineWidth = 1
    drawLabel(ctx, 'DISGUSTING FISH', p.x, p.y - r - 14, GREEN, 12, 0.95)
  }

  // ── bouncy mushrooms ──
  //
  // Green, because running over one is always correct play and can never be
  // scored, but drawn as a stalk and a cap rather than as a glob so it does not
  // read as a fourth kind of pickup. Nothing is collected here and nothing is
  // cleared: the mushroom is a tool, and the only tool in this raid whose answer
  // is vertical.
  for (const inst of w.instances) {
    if (inst.resolved || inst.answered || inst.def.rule.type !== 'launchPad') continue
    const p = toPx(cam, inst.pos)
    const r = (inst.def.shape?.kind === 'circle' ? inst.def.shape.radius : 4) * cam.scale
    // The footprint you have to touch. Dashed and faint — the contact test is
    // generous and the cap is the thing to aim at.
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.setLineDash([4, 5])
    ctx.strokeStyle = `rgba(${GREEN}, 0.35)`
    ctx.lineWidth = 1.5; ctx.stroke()
    ctx.setLineDash([]); ctx.lineWidth = 1
    // Stalk, then cap, then a bounce arrow over it — the arrow is the whole
    // point of the object and without it a green dome is just scenery.
    const stalk = r * 0.42
    ctx.beginPath()
    ctx.moveTo(p.x - stalk * 0.35, p.y + stalk)
    ctx.lineTo(p.x + stalk * 0.35, p.y + stalk)
    ctx.lineTo(p.x + stalk * 0.22, p.y - stalk * 0.2)
    ctx.lineTo(p.x - stalk * 0.22, p.y - stalk * 0.2)
    ctx.closePath()
    ctx.fillStyle = 'rgba(236, 240, 220, 0.85)'; ctx.fill()
    ctx.beginPath()
    ctx.arc(p.x, p.y - stalk * 0.2, r * 0.55, Math.PI, 0)
    ctx.closePath()
    ctx.fillStyle = `rgba(${GREEN}, 0.8)`; ctx.fill()
    ctx.strokeStyle = `rgba(${GREEN}, 1)`; ctx.lineWidth = 2; ctx.stroke()
    ctx.lineWidth = 1
    drawArrow(ctx, p.x, p.y - r * 0.55 - 14, -Math.PI / 2, 16, GREEN, 0.5 + 0.45 * pulse)
  }

  // ── the leap rota ──
  //
  // Mighty Thud takes three raiders in order of how close they were standing
  // when Nama cast it, and the order is the mechanic: a queue you can read is a
  // rota, three simultaneous circles would be a choice. The marks that have not
  // landed yet are drawn on the bodies they are coming for, numbered, with the
  // seconds until each one arrives — nobody can see a queue that lives in the
  // engine, and the raider who is third has time to walk somewhere useful only
  // if they know they are third.
  for (let i = 0; i < w.leapQueue.length; i++) {
    const L = w.leapQueue[i]
    const at = L.raider < 0
      ? (w.player.alive ? w.player.pos : null)
      : (w.allies.find(a => a.id === L.raider && a.alive)?.pos ?? null)
    if (!at) continue
    const p = toPx(cam, at)
    const mine = L.raider < 0
    const wait = Math.max(0, L.atMs - w.elapsedMs)
    const col = mine ? LIME : GREEN
    ctx.beginPath(); ctx.arc(p.x, p.y, mine ? 20 : 15, 0, Math.PI * 2)
    ctx.setLineDash([6, 6])
    ctx.lineDashOffset = -(w.elapsedMs / 60) % 12
    ctx.strokeStyle = `rgba(${col}, ${mine ? 0.85 : 0.45})`
    ctx.lineWidth = mine ? 2.5 : 1.5
    ctx.stroke()
    ctx.setLineDash([]); ctx.lineWidth = 1
    drawLabel(
      ctx, `LEAP ${i + 1} · ${(wait / 1000).toFixed(1)}s`,
      p.x, p.y - (mine ? 32 : 25), col, 11, mine ? 0.95 : 0.55,
    )
  }

  // ── active telegraphs ──
  for (const inst of w.instances) {
    if (inst.resolved || !inst.def.shape) continue
    if (inst.def.rule.type === 'collect') continue   // drawn above as pickups
    // Each of these gets its own pass above: a fish beacon, a mushroom glyph and
    // an element pool in its own colour. Left to the generic pass they would all
    // be drawn as a filled shape with a contracting ring — the language this file
    // reserves for "something is landing here" — which is wrong for all three.
    if (inst.def.rule.type === 'feed') continue
    if (inst.def.rule.type === 'launchPad') continue
    if (inst.def.rule.type === 'elementPool') continue
    if (inst.def.rule.type === 'lethalGround') continue // drawn above as a hole
    // A ripple's geometry is its ring, not its declared shape. See the ripple
    // pass below; drawn here it would be a filled disc over the bomb site while
    // the actual danger was a line thirty yards away.
    if (inst.def.ripple) continue
    // A wind marker belongs on the raiders, not on the floor. It spawns at the
    // player's feet and does not follow them, so drawn here it was a purple
    // circle sitting wherever you happened to be standing eight seconds ago —
    // unreadable as a mechanic and actively misleading as a telegraph, because
    // nothing lands there. It is drawn as a ring on every affected raider at the
    // bottom of this file instead, which is what the mechanic actually is.
    if (inst.def.rule.type === 'windPair') continue
    // A fanned `line` is drawn as a GROUP below. Left here it would be three
    // translucent copies stacked on one anchor, compounding to a solid wedge
    // over exactly the floor whose gaps the player has to read.
    if (isLane(inst)) continue
    const col = ruleColour(inst, w)
    const t = progress(inst)

    // ── a kicked cast ──
    //
    // The telegraph is the cast bar in this renderer, so a kicked cast is a cast
    // bar that has to visibly BREAK. Drawn as the outline snapped into arcs with
    // a cross struck through it, and never filled and never with a timing ring:
    // both of those mean "this is still coming", which is the one thing a landed
    // interrupt has just made untrue.
    //
    // Green, because a kick landing is correct play. The instance itself only
    // lives for a frame or two after the press — the engine drops its timer so
    // that nothing is left behind — so this is the flicker at the point of
    // contact and `interruptFlash` below is the announcement that outlives it.
    if (inst.interrupted) {
      ctx.save()
      ctx.setLineDash([10, 7])
      ctx.strokeStyle = `rgba(${GREEN}, 0.9)`
      ctx.lineWidth = 3
      pathShape(ctx, cam, inst)
      ctx.stroke()
      ctx.restore()
      const bp = toPx(cam, inst.pos)
      const r = (inst.def.shape.kind === 'circle' ? inst.def.shape.radius : 6) * cam.scale
      ctx.strokeStyle = 'rgba(255, 246, 244, 0.9)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(bp.x - r * 0.6, bp.y - r * 0.6); ctx.lineTo(bp.x + r * 0.6, bp.y + r * 0.6)
      ctx.moveTo(bp.x + r * 0.6, bp.y - r * 0.6); ctx.lineTo(bp.x - r * 0.6, bp.y + r * 0.6)
      ctx.stroke()
      ctx.lineWidth = 1
      continue
    }

    // On the floor, but not yet live.
    //
    // Caustic Deluge throws ten 4-yard circles onto a wedge that is barely a
    // thousand square yards, five pairs of them a second apart. Drawn at full
    // strength from the frame they land, that is a carpet: every pair reads as
    // ground already killing you, the raid has nowhere it can see to go, and the
    // mechanic teaches panic instead of a route. The circles arm 1.5 seconds
    // after they appear, and drawing that window as a pale outline with no fill
    // and no timing ring is what lets a raider look at the pair, pick a side and
    // walk once — the shape is there, the danger is not, yet.
    //
    // THE ONLY READER of `armsAfterMs` in the codebase, and it has to stay that
    // way. It scores nothing: `avoid` is judged once, at resolve, so a circle
    // that armed late and one that armed on contact are worth exactly the same
    // and there is nothing for the briefing or a tooltip to say about it. Told
    // "1.5 seconds", a raider counts; shown pale-then-lit, they look at the
    // floor, which is where the answer is. Pinned by a test in trace.test.js.
    if (inst.def.armsAfterMs && inst.def.telegraphMs - inst.timer < inst.def.armsAfterMs) {
      pathShape(ctx, cam, inst)
      ctx.strokeStyle = `rgba(${col}, 0.32)`
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 6])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.lineWidth = 1
      continue
    }

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

  // ── fanned lanes ──
  //
  // A `count` narrowed by `fanDeg` throws several copies of one shape out on
  // neighbouring bearings. When that shape is a `line`, the mechanic is not a
  // frontal you step out of — it is several travelling lanes with gaps between
  // them, and the gaps are the whole answer. Shell Spin is the case: one shell
  // straight down the middle and one off each shoulder, on its own thirty-second
  // clock from the fifth second of the pull, which makes it the cast this fight
  // is read by more often than any other. Three lanes that are not separable at
  // a glance do not teach anything.
  //
  // The generic pass above cannot say it. Three translucent shapes sharing an
  // anchor compound their alpha wherever they overlap, so the near field turns
  // into one solid wedge and the boundary between one lane and the next — the
  // only part of this a player can act on — is the exact thing that disappears.
  //
  // So a fan is drawn as a group: filled ONCE as a union, so no crossing is
  // darker than any other stretch of it; then every lane railed with a dark
  // gutter under a bright edge, so a boundary survives even where two of them
  // cross; then chevrons down each axis, because these TRAVEL. A rectangle
  // sitting still argues for stepping backwards, and backwards is along the
  // lane.
  const laneGroups = new Map<string, Instance[]>()
  for (const inst of w.instances) {
    if (!isLane(inst)) continue
    // Split landed from live rather than lumping a mechanic together: two casts
    // of the same fan can share the screen, one crossing the room while the
    // next is winding up, and they have different things to say about time.
    const key = `${inst.def.id}:${inst.resolved ? 'landed' : 'live'}`
    const at = laneGroups.get(key)
    if (at) at.push(inst); else laneGroups.set(key, [inst])
  }
  for (const group of laneGroups.values()) {
    const lead = group[0]
    const col = ruleColour(lead, w)
    const t = progress(lead)
    // A shell that has landed is still crossing the floor, so it fades over its
    // last second the way every other timed hazard here does rather than
    // blinking out mid-flight.
    const left = (lead.def.lingerMs ?? 0) + lead.timer
    const dying = lead.resolved ? Math.max(0.3, Math.min(1, left / 900)) : 1

    ctx.save()
    // Clipped to the floor. A lane is thrown outward and keeps going, and a
    // rectangle running off into the void reads as floor that is not there.
    pathArena(ctx, cam, w.boss)
    ctx.clip()

    ctx.beginPath()
    for (const inst of group) laneQuad(ctx, cam, inst)
    ctx.fillStyle = `rgba(${col}, ${(0.10 + 0.26 * t) * dying})`
    ctx.fill()

    for (const inst of group) {
      ctx.beginPath(); laneQuad(ctx, cam, inst)
      // The gutter: dark, wide, and drawn UNDER the rail. Two lanes crossing
      // still have a line between them, which a coloured edge on its own cannot
      // promise against floor already washed in the same colour.
      ctx.strokeStyle = `rgba(6, 4, 14, ${0.7 * dying})`
      ctx.lineWidth = 6
      ctx.stroke()
      ctx.strokeStyle = `rgba(${col}, ${(0.55 + 0.45 * t) * dying})`
      ctx.lineWidth = 2.5
      ctx.stroke()
      // The contracting outline, the same language every other telegraph in
      // this file uses for "when" — but narrowed hard. A lane's outline grows
      // SIDEWAYS, and three of them at the usual reach would close the gaps
      // this pass exists to keep open.
      if (!inst.resolved && inst.def.telegraphMs > 400 && t < 0.995) {
        ctx.beginPath(); laneQuad(ctx, cam, inst, 1 + 0.4 * (1 - t))
        ctx.setLineDash([7, 6])
        ctx.strokeStyle = `rgba(${col}, ${(0.18 + 0.42 * t) * dying})`
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // Which way each one is going. Chevrons rather than a single arrow, because
    // a lane is long and the player is reading it from wherever they happen to
    // be standing in it.
    ctx.strokeStyle = `rgba(${col}, ${(0.4 + 0.35 * pulse) * dying})`
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    const march = (w.elapsedMs / 8) % 42
    for (const inst of group) {
      const s = inst.def.shape
      if (s?.kind !== 'line') continue
      const p = toPx(cam, inst.pos)
      const ca = Math.cos(inst.angle), sa = Math.sin(inst.angle)
      const L = Math.max(1, (inst.reach ?? s.length) * cam.scale)
      for (let k = 0; k * 42 < L; k++) {
        const along = (k * 42 + march) % L
        const bx = p.x + ca * along
        const by = p.y + sa * along
        ctx.beginPath()
        ctx.moveTo(bx - ca * 8 - sa * 6, by - sa * 8 + ca * 6)
        ctx.lineTo(bx, by)
        ctx.lineTo(bx - ca * 8 + sa * 6, by - sa * 8 - ca * 6)
        ctx.stroke()
      }
    }
    ctx.restore()
    ctx.lineCap = 'butt'
    ctx.lineWidth = 1

    // Standing in one. Which lane you are in decides which way out is shorter,
    // and the answer is always ACROSS — never back down the lane, which is
    // where a player instinctively retreats and where the shell is already
    // headed. Drawn as the arrow and not only said in words: there are three
    // seconds of this and looking is faster than reading.
    //
    // Drawn after the clip is released so the plate is never cut in half by the
    // arena edge, which is precisely where a lane pushes you.
    if (!lead.resolved && w.player.alive) {
      for (const inst of group) {
        const s = inst.def.shape
        if (s?.kind !== 'line') continue
        const dx = w.player.pos.x - inst.pos.x
        const dy = w.player.pos.y - inst.pos.y
        const ca = Math.cos(inst.angle), sa = Math.sin(inst.angle)
        const along = dx * ca + dy * sa
        const across = -dx * sa + dy * ca
        const half = s.width / 2
        if (along < 0 || along > (inst.reach ?? s.length) || Math.abs(across) > half) continue
        // Out of the nearer side, perpendicular to the lane — the shortest exit
        // rather than the prettiest one. The same projection the engine judges
        // a `line` on, so the arrow and the hit cannot disagree.
        const me = toPx(cam, w.player.pos)
        const ang = inst.angle + (across >= 0 ? Math.PI / 2 : -Math.PI / 2)
        const out = (half - Math.abs(across) + 2) * cam.scale
        // Started clear of the body rather than through it. The player glyph is
        // drawn over this pass, and an arrow buried under your own silhouette
        // is a direction nobody can read.
        drawArrow(
          ctx, me.x + Math.cos(ang) * 22, me.y + Math.sin(ang) * 22, ang,
          Math.max(28, out * 2), RED, 0.6 + 0.4 * pulse,
        )
        drawLabel(ctx, `${lead.def.name.toUpperCase()} — OUT SIDEWAYS`, me.x, me.y - 50, RED, 12, 0.95)
        break
      }
    }
  }

  // ── Blast Wave ──
  //
  // The generic pass above already draws the front itself, which is right — it
  // is a red shape landing on a piece of floor and that is what red filled
  // shapes mean here. What it cannot say is the one thing that matters: this is
  // the only telegraph in the raid you do not answer by moving. So the front
  // gets chevrons running along its axis, so it reads as something sweeping
  // rather than a rectangle sitting there, and it gets told in words.
  //
  // Held in the present tense while you are aloft, not removed. A wave that
  // stopped being drawn the moment you were safe would take the lesson with it.
  for (const inst of w.instances) {
    if (inst.resolved || inst.def.rule.type !== 'wave' || inst.def.shape?.kind !== 'line') continue
    const p = toPx(cam, inst.pos)
    const ca = Math.cos(inst.angle), sa = Math.sin(inst.angle)
    const L = (inst.reach ?? inst.def.shape.length) * cam.scale
    const hw = (inst.def.shape.width / 2) * cam.scale
    const safe = w.player.aloft > 0
    const col = safe ? GREEN : RED
    ctx.save()
    pathArena(ctx, cam, w.boss)
    ctx.clip()
    ctx.strokeStyle = `rgba(${col}, ${0.5 + 0.35 * pulse})`
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    const march = ((w.elapsedMs / 9) % 46)
    for (let lane = -2; lane <= 2; lane++) {
      const ox = -sa * (hw * lane * 0.42)
      const oy = ca * (hw * lane * 0.42)
      for (let k = 0; k < 6; k++) {
        const along = (k * 46 + march) % Math.max(1, L)
        const bx = p.x + ca * along + ox
        const by = p.y + sa * along + oy
        // A chevron pointing the way the front travels.
        ctx.beginPath()
        ctx.moveTo(bx - ca * 9 - sa * 7, by - sa * 9 + ca * 7)
        ctx.lineTo(bx, by)
        ctx.lineTo(bx - ca * 9 + sa * 7, by - sa * 9 - ca * 7)
        ctx.stroke()
      }
    }
    ctx.restore()
    ctx.lineCap = 'butt'
    ctx.lineWidth = 1
    drawLabel(
      ctx, safe ? 'BLAST WAVE — IT PASSES UNDER YOU' : 'BLAST WAVE — GET AIRBORNE',
      p.x + ca * L * 0.45, p.y + sa * L * 0.45 - hw - 14, col, 13, 0.95,
    )
  }

  // ── Blast Wave, as an expanding ring ──
  //
  // The other form of the same mechanic, and the one this fight uses. The wave
  // comes off the bomb as a LINE that travels outward, and the danger is the
  // line — not the floor inside it, which it has already crossed, and not the
  // floor outside it, which it has not reached yet. That distinction is the
  // whole mechanic: the answer is to be airborne off a mushroom at the moment
  // the line arrives, so the player is timing a jump against a moving edge and
  // the edge has to be legible enough to count in.
  //
  // So it is drawn as a band and not as a disc: a bright leading edge, a dimmer
  // trailing one, and only the strip between them filled. A filled circle would
  // say "everything in here is dangerous", which would send a raider running
  // outward ahead of a wave that is faster than the rim is far.
  //
  // The geometry is `Instance.ringRadius` — the band's INNER edge, grown by the
  // engine — rather than anything re-derived here, so the line drawn and the
  // line billed are the same line.
  for (const inst of w.instances) {
    const rip = inst.def.ripple
    if (!rip) continue
    const p = toPx(cam, inst.pos)
    // Airborne is the answer, so the whole thing turns green the moment you are
    // — the same call the aloft ring makes further down. A wave that stayed red
    // while you were safe would have a player fighting to get back to the floor.
    const safe = w.player.aloft > 0
    const col = safe ? GREEN : RED

    if (!inst.resolved) {
      // The fuse. The ring has not started and there is no band to draw yet, but
      // WHERE it will start from is the one thing worth knowing in advance — it
      // decides which way the line will come at you and therefore which mushroom
      // is the one to be standing on.
      const t = progress(inst)
      ctx.save()
      ctx.setLineDash([5, 6])
      ctx.strokeStyle = `rgba(${col}, ${0.4 + 0.5 * t})`
      ctx.lineWidth = 2.5
      ctx.beginPath(); ctx.arc(p.x, p.y, (4 + 6 * (1 - t)) * cam.scale, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      ctx.lineWidth = 1
      drawLabel(ctx, 'BLAST WAVE — RING FROM HERE', p.x, p.y - 12 * cam.scale, col, 12, 0.95)
      continue
    }

    const inner = Math.max(0, inst.ringRadius ?? 0)
    const outer = Math.max(0, (inst.ringRadius ?? -rip.thickness) + rip.thickness)
    if (outer <= 0) continue
    ctx.save()
    // Clipped to the floor, like the lanes and the gales: a ring running off
    // into the void reads as floor that is not there.
    pathArena(ctx, cam, w.boss)
    ctx.clip()

    // The band. Filled low — it is a stripe of floor, not a telegraph landing.
    ctx.beginPath()
    ctx.arc(p.x, p.y, outer * cam.scale, 0, Math.PI * 2)
    if (inner > 0) ctx.arc(p.x, p.y, inner * cam.scale, 0, Math.PI * 2, true)
    ctx.fillStyle = `rgba(${col}, 0.26)`
    ctx.fill()

    // The leading edge, brightest and thickest, because it is the thing being
    // timed. Everything else on this wave is context for this one line.
    ctx.beginPath(); ctx.arc(p.x, p.y, outer * cam.scale, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${col}, ${0.75 + 0.25 * pulse})`
    ctx.lineWidth = 4.5; ctx.stroke()
    if (inner > 0) {
      ctx.beginPath(); ctx.arc(p.x, p.y, inner * cam.scale, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${col}, 0.5)`
      ctx.lineWidth = 2; ctx.stroke()
    }

    // Where the line will be in a second. A speed cannot be read off a still
    // frame and a raider timing a jump is being asked to predict exactly this,
    // so the prediction is drawn rather than left to be estimated.
    ctx.beginPath()
    ctx.arc(p.x, p.y, (outer + rip.speed) * cam.scale, 0, Math.PI * 2)
    ctx.setLineDash([4, 9])
    ctx.strokeStyle = `rgba(${col}, 0.3)`
    ctx.lineWidth = 1.5; ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
    ctx.lineWidth = 1

    // And the countdown, on the player, because the number that matters is not
    // how big the ring is but how long until it is on YOU.
    if (!w.player.alive) continue
    const d = Math.hypot(w.player.pos.x - inst.pos.x, w.player.pos.y - inst.pos.y)
    const me = toPx(cam, w.player.pos)
    if (d < inner) {
      // Behind the line. Already crossed, and nothing else is coming from this
      // bomb — which is worth saying, or the ring stays frightening after it has
      // stopped being dangerous.
      drawLabel(ctx, 'WAVE HAS PASSED', me.x, me.y - 50, GREEN, 12, 0.8)
      continue
    }
    if (d <= outer) {
      drawLabel(
        ctx, safe ? 'IT PASSES UNDER YOU' : 'ON THE LINE — GET AIRBORNE',
        me.x, me.y - 50, col, 13, 0.95,
      )
      continue
    }
    const inSec = (d - outer) / rip.speed
    drawLabel(
      ctx,
      safe ? `SAFE — LINE IN ${inSec.toFixed(1)}s` : `BLAST LINE IN ${inSec.toFixed(1)}s`,
      me.x, me.y - 50, safe ? GREEN : inSec < 1.5 ? RED : GOLD, 13, 0.95,
    )
    // The exact point of the ring that is coming for you, ticked on the line
    // itself — on a fifty-yard circle "it is nearly here" is otherwise a
    // judgement about a curve a long way off to one side.
    const ang = Math.atan2(w.player.pos.y - inst.pos.y, w.player.pos.x - inst.pos.x)
    const tick = toPx(cam, {
      x: inst.pos.x + Math.cos(ang) * outer,
      y: inst.pos.y + Math.sin(ang) * outer,
    })
    ctx.beginPath(); ctx.arc(tick.x, tick.y, 5, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${col}, ${0.7 + 0.3 * pulse})`; ctx.fill()
  }

  // ── impact flash ──
  // A quarter-second bloom where something just landed, so a hit is an event
  // you see rather than a number that changed.
  for (const inst of w.instances) {
    if (!inst.resolved || !inst.def.shape) continue
    // A hole in the floor did not "land"; it was always there.
    if (inst.def.rule.type === 'lethalGround') continue
    // An element pool did not land either — it is dripped under a carrier every
    // second or so, and a white bloom on each one would strobe the whole trade.
    if (inst.def.rule.type === 'elementPool') continue
    // A ripple does not land either — it is the moment it STARTS travelling, and
    // a bloom in the shape of its unused annulus would be a flash over the wrong
    // floor entirely.
    if (inst.def.ripple) continue
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
  // Element carriers get a rim in their element's own colour. Reading somebody
  // else's element IS the mechanic — the cure you need is under the raider
  // holding the opposite — so this is the same call the Toxins orbs and the
  // Crosswinds arrows make: draw it on every body, not only on yours.
  for (const el of ['fire', 'frost'] as const) {
    ctx.beginPath()
    let any = false
    for (const a of w.allies) {
      if (!a.alive || a.element !== el || a.presence < 0.03) continue
      const p = toPx(cam, a.pos)
      ctx.moveTo(p.x + 11, p.y)
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2)
      any = true
    }
    if (!any) continue
    ctx.strokeStyle = `rgba(${elementColour(el)}, 0.95)`
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.lineWidth = 1
  }
  // The one holding YOUR cure is named, the way the Crosswinds partner is. The
  // trade needs two bodies and the engine reserves a specific one, so hunting a
  // second time for a raider the sim has already chosen would be a search
  // problem rather than a mechanic.
  if (w.player.element) {
    const mate = w.allies.find(a => a.id === w.polarityPartnerId && a.alive && a.element && a.element !== w.player.element)
    if (mate) {
      const mp = toPx(cam, mate.pos)
      drawLabel(ctx, 'TRADE WITH THEM', mp.x, mp.y - 24, GREEN, 11, 0.9 * Math.max(0.35, mate.presence))
    }
  }

  // ── the separation ──
  // On the Sentinels this IS the fight, so it is drawn continuously rather than
  // only once it has gone wrong: a live line between the closest pair with the
  // yardage on it, safe-coloured while they are apart and hot the moment they
  // are not. Knowing you are at 43 and closing is what lets a tank fix it; being
  // told at 39 that you have already failed is not the same lesson.
  //
  // Drawn before the entities so the line reads as ground between them.
  //
  // ── the stacked pair, and the body they are being walked away from ──
  //
  // The first readout this file draws for a fight where the tanks stand two
  // bodies TOGETHER, and it exists because the pairwise version taught the fight
  // backwards — see `stackGap` for the full argument. Nothing at all is drawn
  // between the stacked pair: they are supposed to be on top of each other, and
  // a yardage between them with "HOLD 30+" on it is an instruction to pull apart
  // the one pair that must not be. What is drawn instead is the boundary that
  // can actually lose the pull, and the pair's live distance to it.
  const stack = stackGap(w)
  if (stack) {
    const linked = stack.yards < stack.minYards
    const col = linked ? RED : stack.closing ? GOLD : GREEN
    const tp = toPx(cam, stack.threat.pos)
    const ap = toPx(cam, stack.at)
    const mid = { x: (ap.x + tp.x) / 2, y: (ap.y + tp.y) / 2 }

    // The link radius, drawn as the boundary it is: a circle around the body
    // nobody holds that the pair must stay outside of. Thin and unfilled while
    // there is daylight, hot once the pair is inside it — the same discipline
    // the split raid's bubbles use, and for the same reason. A filled ring would
    // read as ground a telegraph was landing on, and this is not damage, it is a
    // line on the floor.
    const rr = stack.minYards * cam.scale
    ctx.save()
    ctx.setLineDash([11, 8])
    ctx.lineDashOffset = -(w.elapsedMs / 90) % 19
    ctx.strokeStyle = `rgba(${col}, ${linked ? 0.85 : stack.closing ? 0.6 : 0.3})`
    ctx.lineWidth = linked ? 3.5 : 2
    ctx.beginPath(); ctx.arc(tp.x, tp.y, rr, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
    ctx.lineWidth = 1
    drawLabel(ctx, `${stack.minYards} YD LINK`, tp.x, tp.y - rr - 10, col, 11, linked ? 1 : 0.55)

    // The live distance, hung off the MIDDLE of the pair rather than off either
    // body, so it is visibly the pair's number and not one tank's.
    ctx.save()
    ctx.setLineDash([9, 6])
    ctx.lineWidth = linked ? 4 : 2
    ctx.strokeStyle = `rgba(${col}, ${linked ? 0.55 + 0.35 * pulse : 0.45})`
    ctx.beginPath(); ctx.moveTo(ap.x, ap.y); ctx.lineTo(tp.x, tp.y); ctx.stroke()
    ctx.restore()
    ctx.lineWidth = 1
    drawLabel(
      ctx,
      `${Math.round(stack.yards)} YD TO ${stack.threat.def.name.toUpperCase()}  ·  HOLD ${stack.minYards}+`,
      mid.x, mid.y, col, 12, linked || stack.closing ? 1 : 0.8,
    )
    // Drifting in is the state worth catching, because by the time it is a link
    // the damage has already stopped counting. Gold rather than red: nothing is
    // wrong yet, and spending the loudest colour on screen on a pair that is
    // still legal would leave nothing louder for the pair that is not.
    if (!linked) {
      if (stack.closing) {
        drawLabel(ctx, 'CLOSING — WALK THEM OFF HIM', mid.x, mid.y - 20, GOLD, 12, 0.75 + 0.25 * pulse)
      }
    } else {
      // And when it is broken, say what it costs on every body it costs it on.
      // A player must be able to see instantly that the pull they are in is
      // being wasted.
      drawLabel(ctx, '99% DAMAGE REDUCTION', mid.x, mid.y - 20, RED, 13)
      for (const unit of w.bosses) {
        if (unit.def.untargetable || !unit.alive) continue
        const up = toPx(cam, unit.pos)
        drawShield(ctx, up.x, up.y, 30, w.elapsedMs, pulse)
        drawLabel(ctx, '99% DR', up.x, up.y - 42, RED, 11)
      }
    }

    // Where the pair should be standing this instant, read straight off
    // `World.tankStackMark`. VIOLET, which in this palette is "go here" — and
    // never re-derived, so the mark the AI tanks are actually walking to and the
    // mark on screen cannot disagree by a frame.
    //
    // Bright for a player who is holding one of the pair, because then it is the
    // job; faint for everybody else, because a moving pair with no visible
    // destination looks like two bosses wandering off.
    const mark = w.tankStackMark
    if (mark) {
      const mine = w.bosses.some(b => b.def.tankedStacked && b.alive && b.targetId === 0)
      const mp = toPx(cam, mark)
      ctx.save()
      ctx.setLineDash([6, 6])
      ctx.lineDashOffset = -(w.elapsedMs / 45) % 12
      ctx.strokeStyle = `rgba(${VIOLET}, ${mine ? 0.85 : 0.28})`
      ctx.lineWidth = mine ? 3 : 1.5
      ctx.beginPath(); ctx.arc(mp.x, mp.y, 6 * cam.scale, 0, Math.PI * 2); ctx.stroke()
      if (mine) { ctx.beginPath(); ctx.moveTo(ap.x, ap.y); ctx.lineTo(mp.x, mp.y); ctx.stroke() }
      ctx.restore()
      ctx.lineWidth = 1
      if (mine) drawLabel(ctx, 'WALK THEM HERE', mp.x, mp.y - 6 * cam.scale - 12, VIOLET, 12, 0.9)
    }
  } else if (apartDef && apartMin !== undefined && w.bosses.length > 1) {
    // The WIDEST pair of live, targetable entities — the same pair the sim
    // measures, so the number on screen is the number being scored.
    //
    // "All of them within 30 yards" is literally "the widest pair is under 30",
    // and on a three-body council the closest pair is the wrong number: two
    // explorers standing on top of each other while the third is across the room
    // link nothing, and a readout showing their gap would have called a fine
    // pull broken all night. On the two-entity fights the widest pair and the
    // closest pair are the same pair, so nothing there changes.
    const live = w.bosses.filter(b => !b.def.untargetable && b.alive)
    let one: BossUnit | null = null
    let two: BossUnit | null = null
    let closest = 0
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const d = Math.hypot(live[i].pos.x - live[j].pos.x, live[i].pos.y - live[j].pos.y)
        if (d > closest) { closest = d; one = live[i]; two = live[j] }
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

  // ── the melee leash ──
  //
  // Drawn for exactly the same reason the separation line above is, and it is
  // the same argument inverted: knowing you are at 10 yards and drifting is what
  // lets a tank fix it, and being told at 13 that the raid bar has already
  // started emptying is not the same lesson.
  //
  // Only ever drawn for the entity the PLAYER is holding. Both serpents carry a
  // leash and the AI tank holds the other one, so drawing both would put a line
  // across the room to a rule the player cannot act on — and the ring around
  // that serpent would read as ground to stay out of, which is the opposite of
  // what it is.
  //
  // A ring AND a tether, because they answer different questions. The ring is
  // where the boundary is, which is what you steer by; the tether carries the
  // number, which is what you check.
  for (const def of w.boss.mechanics) {
    if (def.rule.type !== 'holdMelee') continue
    const unit = bossUnitFor(w, def.from)
    if (unit.targetId !== 0 || !unit.alive || !w.player.alive) continue
    const max = def.rule.maxYards
    const d = Math.hypot(w.player.pos.x - unit.pos.x, w.player.pos.y - unit.pos.y)
    const out = d > max
    // Bone inside the boundary rather than green: standing in melee is not a
    // job well done, it is the default, and the palette's green means "get in
    // here" everywhere else in this file. What the ring says is "this is the
    // line", and it only turns hot once the line is behind you.
    const col = out ? RED : BONE
    const bp = toPx(cam, unit.pos)
    const rr = max * cam.scale
    ctx.save()
    ctx.setLineDash([7, 7])
    ctx.lineWidth = out ? 3 : 1.5
    ctx.strokeStyle = `rgba(${col}, ${out ? 0.5 + 0.35 * pulse : 0.3})`
    ctx.beginPath(); ctx.arc(bp.x, bp.y, rr, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()

    const pp = toPx(cam, w.player.pos)
    ctx.save()
    ctx.setLineDash([5, 5])
    ctx.lineWidth = out ? 3 : 1.5
    ctx.strokeStyle = `rgba(${col}, ${out ? 0.8 : 0.28})`
    ctx.beginPath(); ctx.moveTo(bp.x, bp.y); ctx.lineTo(pp.x, pp.y); ctx.stroke()
    ctx.restore()
    drawLabel(
      ctx, `${Math.round(d)} YD  ·  STAY INSIDE ${max}`,
      (bp.x + pp.x) / 2, (bp.y + pp.y) / 2, col, 12, out ? 1 : 0.75,
    )
    // And when it is broken, say what it costs — the bar is gone in about four
    // seconds and the collapse is otherwise unexplained.
    if (out) drawLabel(ctx, 'OUT OF RANGE — THE RAID IS TAKING IT', pp.x, pp.y - 34, RED, 13)
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

  // ── where the fish can go ──
  //
  // The fish has an address, and picking it is the whole decision. So while you
  // are carrying one, a marching line runs from you to every boss that can still
  // eat it — and to NONE of the ones that already have.
  //
  // That omission is the point. Feeding an explorer that has already been
  // empowered is rejected and you keep the fish, which is a mercy rather than a
  // punishment, but it costs you the seconds you spent walking there while the
  // bar filled. Drawing the refusal before the walk rather than after it is what
  // turns a rule you learn by wasting a reset into a choice you can see.
  //
  // Drawn before the entities, like the drink links above, so it reads as ground
  // between you and them rather than as something happening to them.
  if (w.fishCarried) {
    const carrier = toPx(cam, w.player.pos)
    for (const b of w.bosses) {
      if (b.def.untargetable || !b.alive || b.empowered) continue
      const bp = toPx(cam, b.pos)
      ctx.save()
      ctx.setLineDash([10, 7])
      // Marching toward the boss, because that is the way you are taking it.
      ctx.lineDashOffset = -(w.elapsedMs / 42) % 17
      ctx.lineWidth = 2.5
      ctx.strokeStyle = `rgba(${GREEN}, ${0.45 + 0.3 * pulse})`
      ctx.beginPath(); ctx.moveTo(carrier.x, carrier.y); ctx.lineTo(bp.x, bp.y); ctx.stroke()
      ctx.restore()
      ctx.lineWidth = 1
      drawLabel(
        ctx, 'CAN EAT IT',
        (carrier.x + bp.x) / 2, (carrier.y + bp.y) / 2, GREEN, 11, 0.85,
      )
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

    // Fed a Disgusting Fish. Gold — the file's existing "read this carefully"
    // hue, and deliberately not red or violet: nothing is wrong here, the raid
    // chose it. But it is permanent, it cannot be undone, and it hands that
    // explorer an extra ability for the rest of the pull, so it has to be
    // readable from anywhere on the floor. It is also the answer to "have I
    // already fed this one?", which is the question a fish is wasted on.
    if (b.empowered && !b.def.untargetable && b.alive) {
      drawShield(ctx, bp.x, bp.y, size * 0.8, w.elapsedMs, pulse, GOLD)
      drawLabel(ctx, 'EMPOWERED', bp.x, bp.y - size * 0.65 - 12, GOLD, 11, 0.85 + 0.15 * pulse)
    }

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
    // An untargetable entity has no health to show. Mor'zahi cannot be shot at
    // all — his bar is the energy bar in the HUD — and a full purple bar under
    // him would promise a body the raid could bring down.
    if (multi && !b.def.untargetable) {
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

  // ── the kick that landed ──
  //
  // Drawn OVER the entities, on the one that was casting, because the question
  // it answers is "did my interrupt go through" and the answer has to find a
  // player who was looking at their own feet when they pressed it. The broken
  // telegraph above is the flicker at the point of contact; this outlives the
  // instance, which the engine retires almost immediately so that a kicked cast
  // leaves nothing at all behind.
  //
  // `interruptFlash` is set for the PLAYER'S kicks only — the raid's own covers
  // set `Instance.interrupted` and nothing else — so this can never congratulate
  // a healer for a kick they have no button for. The sim stamps `atMs` and never
  // clears it, so the ageing is done here.
  if (w.interruptFlash) {
    const since = w.elapsedMs - w.interruptFlash.atMs
    if (since >= 0 && since < KICK_FLASH_MS) {
      const def = w.boss.mechanics.find(m => m.id === w.interruptFlash!.id)
      const caster = bossUnitFor(w, def?.from)
      const cp = toPx(cam, caster.pos)
      drawBrokenCast(ctx, cp.x, cp.y - 56, 1 - since / KICK_FLASH_MS, w.interruptFlash.name)
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
    // On the Explorers being airborne is not a loss of steering, it is the
    // answer — the one state a Blast Wave passes under. A raider who reads the
    // violet ring as "something has gone wrong" spends the three seconds that
    // were saving them trying to get back down, so while a wave is live the ring
    // is joined by the word and both go green.
    // A slab wave is dangerous while it is winding up and gone once it has
    // resolved; a RIPPLE is the other way round — it does nothing until it
    // resolves and then spends the whole crossing live, so "is a wave up" has to
    // ask the two forms different questions. Read against `resolved` alone, the
    // ring would go green exactly as the line started moving.
    const waveUp = w.instances.some(i =>
      i.def.rule.type === 'wave' && (i.def.ripple ? true : !i.resolved))
    if (waveUp) {
      ctx.beginPath(); ctx.arc(pp.x, pp.y, 22 + 3 * pulse, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${GREEN}, ${0.6 + 0.35 * pulse})`
      ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1
    }
    drawLabel(
      ctx, waveUp ? 'SAFE — AIRBORNE' : `AIRBORNE ${(w.player.aloft / 1000).toFixed(1)}s`,
      pp.x, pp.y - 34, waveUp ? GREEN : VIOLET, 12, 0.95,
    )
  }
  // Carrying something you must take away from the group.
  if (Object.keys(w.player.carrying).length) {
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 15, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${VIOLET}, 0.95)`; ctx.lineWidth = 2; ctx.stroke()
    ctx.lineWidth = 1
  }
  // Carrying the Disgusting Fish. GREEN, not the carry violet: violet in this
  // file means "get this away from people", and the fish is the opposite — a
  // tool with an address, and the only thing in the fight that empties the bar.
  if (w.fishCarried) {
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 16, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${GREEN}, ${0.7 + 0.3 * pulse})`
    ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1
    drawLabel(ctx, 'FISH — FEED A BOSS', pp.x, pp.y + 30, GREEN, 12, 0.95)
  }
  // The element you are carrying, in the element's own colour, and named. Which
  // one you have decides which pool cures you and there is no second chance to
  // work it out — the next volley kills a carrier who still has one.
  if (w.player.element) {
    const col = elementColour(w.player.element)
    ctx.beginPath(); ctx.arc(pp.x, pp.y, 19, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${col}, ${0.8 + 0.2 * pulse})`
    ctx.lineWidth = 4; ctx.stroke(); ctx.lineWidth = 1
    drawLabel(
      ctx, `${ELEMENT_NAME[w.player.element]} — RUN INTO ${w.player.element === 'fire' ? 'FROST' : 'FIRE'}`,
      pp.x, pp.y + (w.fishCarried ? 44 : 30), col, 12, 0.95,
    )
  }

  // A live Mutilated Gash. The next cone that catches you kills, so it is drawn
  // on you rather than left in a debuff list nobody reads mid-flurry.
  if (w.player.gash > 0) {
    drawLabel(ctx, `GASH — STAY OUT`, pp.x, pp.y + 30, RED, 12, 0.75 + 0.25 * pulse)
  }

  // The stack counter, on the body carrying it.
  //
  // On the one fight in this tier that is a resource problem, this number is the
  // fight. It is also on the HUD, and it is on the floor as well for the reason
  // the Gash is: a count you have to look away from the arena to read is a count
  // you read after it has already killed you.
  //
  // Violet rather than red while there is room left on it. Violet is the marker
  // colour in this palette — a state you are carrying — and painting 1/10 the
  // same colour as "get out of this" would spend the loudest thing on screen on
  // a stack that costs nothing yet. It turns red inside the last three, where it
  // genuinely is the thing about to kill you.
  const counter = w.boss.mechanics.find(m => m.counter)
  if (counter?.counter && w.player.venom > 0) {
    const cap = counter.counter.lethalAt
    const near = w.player.venom >= cap - 3
    drawLabel(
      ctx, `VENOM ${w.player.venom}/${cap}`, pp.x, pp.y + 30,
      near ? RED : VIOLET, 12, near ? 0.75 + 0.25 * pulse : 0.85)
  }
  // And the moment of arrival, rising off your head and fading. The count says
  // where you are; this says that something just charged you, which is the half
  // that connects the number to the thing you stood in.
  if (w.venomFlash) {
    const t = Math.max(0, Math.min(1, w.venomFlash.ms / VENOM_FLASH_MS))
    drawLabel(ctx, `+${w.venomFlash.n}`, pp.x, pp.y - 34 - (1 - t) * 18, RED, 15, t)
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
      // The one holding your opposite is named.
      //
      // The orb puzzle deliberately does NOT do this — finding the right body is
      // the whole mechanic there. Here it is not: the skill is the geometry, and
      // working out WHICH of nineteen identical glyphs is carrying the arrow
      // that completes yours is a search problem the real fight solves with a
      // raid marker and a callout. So it gets one.
      if (a.id === w.windPartnerId) {
        // Drawn at the range that actually cancels, so "get inside this" is a
        // place rather than a hope. A ring at some arbitrary pixel size would be
        // decoration; this one is the test the engine runs.
        const touch = WIND_TOUCH_YARDS * cam.scale
        ctx.beginPath(); ctx.arc(p.x, p.y, touch, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${GREEN}, ${0.10 * a.presence})`
        ctx.fill()
        ctx.strokeStyle = `rgba(${GREEN}, ${(0.7 + 0.3 * pulse) * a.presence})`
        ctx.lineWidth = 2.5; ctx.stroke(); ctx.lineWidth = 1
        drawLabel(ctx, 'YOUR PARTNER', p.x, p.y + touch + 12, GREEN, 11, 0.95 * a.presence)
      }
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
