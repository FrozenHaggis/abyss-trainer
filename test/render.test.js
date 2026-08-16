import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'

// Does the renderer survive a real pull?
//
// It is the only layer with no coverage at all, and it is the layer that reaches
// deepest into `World` — every field the sim grows, the renderer eventually
// reads, usually without a type between them saying whether it is there yet. A
// stub canvas cannot tell you the arena LOOKS right. It can tell you that eight
// bosses in three roles do not throw, which is the failure mode that actually
// ships: the sim runs, the tests pass, and the canvas is blank because one draw
// call read a field off an object that does not exist on this boss.
//
// Bundled here rather than imported, because the renderer is TypeScript and
// pulls in the React icon module for its role glyphs.

const OUT = '.probe'

function bundle() {
  // esbuild's own API rather than the CLI. Shelling out to npx is a different
  // executable on Windows and a different PATH under CI, and a test that cannot
  // build its own input reports a spawn error instead of a rendering one.
  for (const [src, out] of [
    ['src/engine/render.ts', `${OUT}/render.mjs`],
    ['src/engine/sim.ts', `${OUT}/sim.mjs`],
    ['src/bosses/registry.ts', `${OUT}/registry.mjs`],
  ]) {
    buildSync({ entryPoints: [src], bundle: true, format: 'esm', outfile: out, logLevel: 'error' })
  }
}

test('the renderer draws every boss in every role without throwing', async () => {
  bundle()
  // Path2D is a browser global the role glyphs are built from at module load.
  globalThis.Path2D = class { constructor() {} }

  const { createWorld, step, seedRng, TICK_MS } = await import(`../${OUT}/sim.mjs`)
  const { BOSSES } = await import(`../${OUT}/registry.mjs`)
  const { render, makeCamera } = await import(`../${OUT}/render.mjs`)

  const noop = () => {}
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'measureText') return () => ({ width: 20 })
      if (k === 'createRadialGradient' || k === 'createLinearGradient') {
        return () => ({ addColorStop: noop })
      }
      if (k === 'canvas') return { width: 1280, height: 720 }
      return noop
    },
    set() { return true },
  })

  let frames = 0
  for (const boss of BOSSES) {
    for (const role of ['tank', 'healer', 'dps']) {
      seedRng(1337)
      const w = createWorld(boss, role, 'green')
      const cam = makeCamera(1280, 720, boss)
      const input = {
        up: false, down: false, left: false, right: false,
        pressed: [], aim: null, firing: true,
      }
      // Long enough to reach every stage the fight has. A renderer that only
      // ever sees the opening thirty seconds has not seen an intermission, and
      // the intermissions are where the new drawing lives.
      for (let i = 0; i < 60 * 240 && w.player.alive && !w.killed; i++) {
        step(w, input, TICK_MS)
        if (i % 7 === 0) { render(ctx, w, cam, 1280, 720); frames++ }
      }
    }
  }
  assert.ok(frames > 5000, `only ${frames} frames drawn — the sweep is not reaching the fights`)
})

// The acid is drawn, and it is drawn where the floor is not.
//
// It is placed by one rule — bubble anywhere a point is not on the floor — and
// that rule has a silent failure mode: get the test backwards, or hand it a
// shape it reads as all-floor, and it draws nothing at all while still passing
// the sweep above. Nothing throws when a loop `continue`s every iteration.
// So this checks the two places the acid has to reach: the sea around the
// platform, and the venom pocket bitten out of its bottom edge.
test('the acid bubbles around the platform and in the pocket', async () => {
  bundle()
  globalThis.Path2D = class { constructor() {} }

  const { createWorld, step, seedRng, TICK_MS, inArena } = await import(`../${OUT}/sim.mjs`)
  const { BOSSES } = await import(`../${OUT}/registry.mjs`)
  const { render, makeCamera } = await import(`../${OUT}/render.mjs`)

  const boss = BOSSES.find(b => b.key === 'twinfangs')
  assert.ok(boss.acid, 'the Twin Fangs room is no longer flagged as acid')

  const arcs = []
  const noop = () => {}
  const ctx = new Proxy({}, {
    get(_, k) {
      if (k === 'arc') return (x, y, r) => arcs.push({ x, y, r })
      if (k === 'measureText') return () => ({ width: 20 })
      if (k === 'createRadialGradient' || k === 'createLinearGradient') {
        return () => ({ addColorStop: noop })
      }
      if (k === 'canvas') return { width: 1280, height: 720 }
      return noop
    },
    set() { return true },
  })

  seedRng(1337)
  const w = createWorld(boss, 'dps', 'green')
  const cam = makeCamera(1280, 720, boss)
  const input = { up: false, down: false, left: false, right: false, pressed: [], aim: null, firing: false }
  step(w, input, TICK_MS)
  render(ctx, w, cam, 1280, 720)

  // Back to yards, so the assertions are about the room rather than the canvas.
  const inYards = arcs.map(a => ({ x: (a.x - cam.cx) / cam.scale, y: (a.y - cam.cy) / cam.scale }))
  const offFloor = inYards.filter(p => !inArena(boss, p))
  assert.ok(offFloor.length >= 20,
    `only ${offFloor.length} bubbles drawn off the floor — the acid is not being drawn, ` +
    'and a room that floats in acid with none of it visible reads as a room with a void round it')

  // The pocket specifically. It is the one piece of "not floor" that sits inside
  // the platform's outline, and it is the piece that has to read as lethal —
  // an unmarked gap in a dark floor is something players walk into.
  const pts = boss.arena.points
  const bottom = Math.max(...pts.map(p => p.y))
  const inPocket = offFloor.filter(p => p.y > 8 && p.y < bottom + 2 && Math.abs(p.x) < 8)
  assert.ok(inPocket.length >= 1,
    'no acid drawn in the venom pocket — the hole the Spawn of Vexhul surface in ' +
    'looks identical to solid floor, and walking into it kills')
})

// Two circles of orange ground, opposite meanings, and no colour vision.
//
// Frostfire Volley's patches are the CURE — stand in the opposite one and the
// debuff comes off — while Concussive Blast is a twelve-yard fire pool that
// damages. Both are round, both are hot-coloured, and the polarity pass has just
// finished separating their NAMES (Fire Patch is the cure; the hazard may never
// borrow that name). Names are not enough at speed, and hue is not enough at
// all: a player reads the floor in a glance, under a red telegraph, and some of
// them cannot see the difference between amber and red in the first place.
//
// So this measures the separation in the DRAW DATA, on channels that survive a
// greyscale screenshot:
//
//   value    the hazard is darkest in the middle (a burnt-out crater) and the
//            cure is brightest in the middle (a glow). They are inverses, so
//            they stay opposites with every colour stripped out.
//   texture  the hazard is hatched and the cure is a smooth wash, so the two
//            differ by an order of magnitude in line work inside their own
//            footprint.
//   words    the hazard says what it does to you and never wears the cure's
//            name.
//
// Nothing here is keyed on a boss or an id — the renderer chooses by
// `isBurningGround`, off the mechanic's own words — so the test drives the two
// real mechanics and reads back what was drawn where they stand.
test('a burning pool and a cure pool are told apart without colour', async () => {
  bundle()
  globalThis.Path2D = class { constructor() {} }

  const { createWorld, step, seedRng, TICK_MS, fire } = await import(`../${OUT}/sim.mjs`)
  const { BOSSES } = await import(`../${OUT}/registry.mjs`)
  const { render, makeCamera } = await import(`../${OUT}/render.mjs`)

  const boss = BOSSES.find(b => b.key === 'explorers')
  const pol = boss.mechanics.find(m => m.rule.type === 'polarity')
  assert.ok(pol, 'the Lost Explorers no longer declare a polarity — this check would be vacuous')
  const cureId = pol.rule.firePoolId
  const hazard = boss.mechanics.find(m =>
    m.rule.type === 'avoid' && m.lingerMs && m.damage && m.shape?.kind === 'circle'
    && /fire|flame/i.test(`${m.name} ${m.what ?? ''}`))
  assert.ok(hazard, 'no lingering fire hazard on this fight — this check would be vacuous')
  assert.notEqual(hazard.id, cureId, 'the hazard and the cure resolved to the same mechanic')

  /** A canvas that remembers the shapes, the gradients and the words. */
  const recorder = () => {
    const rec = { grads: [], lines: [], text: [], arcs: [] }
    let pen = null
    const noop = () => {}
    const ctx = new Proxy({}, {
      get(_, k) {
        if (k === 'createRadialGradient') {
          return (x0, y0, r0, x1, y1, r1) => {
            const g = { x: x1, y: y1, r: r1, stops: [] }
            rec.grads.push(g)
            return { addColorStop: (at, colour) => g.stops.push({ at, colour }) }
          }
        }
        if (k === 'createLinearGradient') return () => ({ addColorStop: noop })
        if (k === 'moveTo') return (x, y) => { pen = { x, y } }
        if (k === 'lineTo') return (x, y) => { if (pen) rec.lines.push({ a: pen, b: { x, y } }); pen = { x, y } }
        if (k === 'arc') return (x, y, r) => { rec.arcs.push({ x, y, r }); pen = null }
        if (k === 'fillText' || k === 'strokeText') return (s, x, y) => rec.text.push({ s: String(s), x, y })
        if (k === 'measureText') return () => ({ width: 20 })
        if (k === 'canvas') return { width: 1280, height: 720 }
        return noop
      },
      set() { return true },
    })
    return { ctx, rec }
  }

  /** Perceived lightness of an `rgba(r, g, b, a)` string, alpha included. */
  const lum = (s) => {
    const n = s.match(/[\d.]+/g).map(Number)
    const [r, g, b] = n
    const a = n.length > 3 ? n[3] : 1
    return ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * a
  }

  /**
   * Fire one mechanic on a fresh pull, let it land, and record the frame.
   * Returns what was drawn plus where the instance actually stands.
   */
  const frameFor = (id, prepare) => {
    seedRng(1337)
    const w = createWorld(boss, 'dps', 'green')
    const cam = makeCamera(1280, 720, boss)
    if (prepare) prepare(w)
    fire(w, id)
    let inst = null
    for (let i = 0; i < 60 * 20; i++) {
      step(w, { up: false, down: false, left: false, right: false, pressed: [], aim: null, firing: false }, TICK_MS)
      inst = w.instances.find(x => x.def.id === id && x.resolved)
      if (inst) break
    }
    assert.ok(inst, `${id} never landed, so nothing about it was drawn`)
    const at = { x: cam.cx + inst.pos.x * cam.scale, y: cam.cy + inst.pos.y * cam.scale }
    const rr = inst.def.shape.radius * cam.scale
    const { ctx, rec } = recorder()
    render(ctx, w, cam, 1280, 720)
    return { rec, at, rr, w }
  }

  const burn = frameFor(hazard.id)
  // The cure only wears its green ring and its name when it is YOUR cure, which
  // is the state a carrier is actually looking at.
  const cure = frameFor(cureId, (w) => {
    const el = boss.mechanics.find(m => m.id === cureId).rule.element
    w.player.element = el === 'fire' ? 'frost' : 'fire'
    w.player.elementMs = 60000
  })

  /** The radial wash centred on this patch, ignoring the rest of the room. */
  const washOf = ({ rec, at, rr }, what) => {
    const near = rec.grads.filter(g =>
      Math.hypot(g.x - at.x, g.y - at.y) < rr * 0.5 && g.stops.length >= 2
      && g.stops.every(s => /rgba?\(/.test(s.colour)))
    assert.ok(near.length, `${what}: nothing painted a radial wash where the patch is standing`)
    // The one that reaches the rim, so a small inner highlight cannot answer for
    // the body of the pool.
    return near.reduce((a, b) => (b.r > a.r ? b : a))
  }

  const burnWash = washOf(burn, 'the burning pool')
  const cureWash = washOf(cure, 'the cure')
  const centre = (g) => lum(g.stops[0].colour)
  const rim = (g) => lum(g.stops[g.stops.length - 1].colour)

  // 1. VALUE, and it is the load-bearing cue because it is the one that cannot
  //    be lost. Whatever a screen or a pair of eyes does to the hue, a crater
  //    that is burnt out in the middle and a cure that glows out of the middle
  //    are still opposites.
  assert.ok(centre(burnWash) < rim(burnWash) * 0.7,
    `the burning pool is not darkest in its middle (centre ${centre(burnWash).toFixed(3)} vs rim ` +
    `${rim(burnWash).toFixed(3)}). The char core is what separates a hazard from a cure in ` +
    'greyscale, and without it the two are one orange circle and another orange circle')
  assert.ok(centre(cureWash) > rim(cureWash),
    `the cure is not brightest in its middle (centre ${centre(cureWash).toFixed(3)} vs rim ` +
    `${rim(cureWash).toFixed(3)}) — see above, the two washes have to be inverses of each other ` +
    'rather than merely different')

  // 2. TEXTURE. Hatching is used nowhere else in the renderer, so line work
  //    inside the footprint is a channel of its own — and it survives being
  //    printed in black and white just as well as the value does.
  const linesIn = ({ rec, at, rr }) => rec.lines.filter(l =>
    Math.hypot(l.a.x - at.x, l.a.y - at.y) < rr * 1.6).length
  const burnLines = linesIn(burn)
  const cureLines = linesIn(cure)
  assert.ok(burnLines > cureLines * 3,
    `the burning pool drew ${burnLines} line segments in its footprint against the cure's ` +
    `${cureLines}. The hazard is meant to be hard-hatched and the cure a smooth wash; at this ` +
    'ratio the two read as the same surface')

  // 3. WORDS, and the hard constraint on them. `Fire Patch` is the CURE's name
  //    now. A damaging pool wearing it would rebuild in text exactly the
  //    confusion the polarity pass took apart in the data.
  const near = ({ rec, at, rr }) => rec.text
    .filter(t => Math.hypot(t.x - at.x, t.y - at.y) < rr * 2.2).map(t => t.s.toUpperCase())
  const burnWords = near(burn)
  const cureWords = near(cure)
  const cureName = boss.mechanics.find(m => m.id === cureId).name.toUpperCase()
  assert.ok(burnWords.some(s => s.includes(hazard.name.toUpperCase())),
    `the burning pool is unlabelled — drawn words were ${JSON.stringify(burnWords)}. A crater ` +
    'you learn by taking a tick of it is a crater nobody has been taught')
  assert.ok(burnWords.some(s => /BURN|DAMAG|HURT|GET OFF/.test(s)),
    `nothing beside the burning pool says it hurts — ${JSON.stringify(burnWords)}`)
  assert.ok(!burnWords.some(s => s.includes(cureName)),
    `the damaging pool is labelled "${cureName}", which is the CURE's name. That id is the ` +
    'polarity cure now, and a hazard borrowing it teaches the player to run into the wrong ' +
    'orange circle')
  assert.ok(cureWords.some(s => s.includes(cureName)),
    `the cure does not say its own name — drawn words were ${JSON.stringify(cureWords)}`)
  assert.ok(cureWords.some(s => s.includes('CURE')),
    `nothing beside the cure says it is a cure — ${JSON.stringify(cureWords)}`)
})
