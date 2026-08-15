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
