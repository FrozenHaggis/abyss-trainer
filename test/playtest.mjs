import { createWorld, step, buildResult, seedRng, TICK_MS } from '../.playtest/sim.mjs'
import { BOSSES } from '../.playtest/registry.mjs'

// Headless playtest across every boss and every role.
//
// The bar: a careless player dies, a competent one kills it, dps fastest and
// healer slowest. Check balance changes against this rather than by eye — it
// has already caught an annulus being fled outward off the platform, pools
// detonating on the carrier who dropped them, and a tank dying to a dispel they
// cannot cast.
//
// It previously ran Sszorak alone while the README claimed eight bosses. Now it
// runs the registry, so a boss that cannot be cleared cannot hide.

// Fixed seeds, so the clear count is reproducible and a regression cannot hide
// inside run-to-run noise. Several seeds rather than one, so a single unlucky
// spawn sequence does not masquerade as a balance problem.
const SEEDS = [1337, 2024, 90210]

/** The eight headings WASD can produce, normalised. */
const S = Math.SQRT1_2
const DIRS = [
  [1, 0], [S, S], [0, 1], [-S, S],
  [-1, 0], [-S, -S], [0, -1], [S, -S],
]

/**
 * Is this point on the floor? The bot used to test `r < arenaRadius * 0.66`,
 * which is meaningless in a room that is not round — on the Sentinels' octagon
 * it either fenced the bot into the middle or walked it through a wall.
 */
/**
 * A unit vector pointing from `from` to `at`, with a deterministic fallback when
 * the two coincide.
 *
 * This matters more than it looks. A hazard that spawns ON the player — the
 * Latent Cultist pool Essence Rend leaves at your feet — gives dx = dy = 0, so
 * the obvious `(dx/d, dy/d)` flee vector is zero-length and the bot politely
 * stands in a permanent pool until it dies. It did exactly that for fourteen
 * seconds. `|| 1` on the distance guards the divide but not the numerator, which
 * is why the bug survived: the arithmetic is well-formed and the answer is
 * still "don't move".
 */
function awayFrom(px, py, ox, oy, tag = 0) {
  const dx = px - ox, dy = py - oy
  const d = Math.hypot(dx, dy)
  if (d > 0.05) return { x: dx / d, y: dy / d, d }
  const a = tag * 2.399963  // golden angle, so co-located hazards fan out
  return { x: Math.cos(a), y: Math.sin(a), d: 0 }
}

function onFloor(boss, x, y) {
  const poly = boss.arena?.points
  if (!poly) return Math.hypot(x, y) <= boss.arenaRadius
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function play(boss, role, smart, seed, side = 'green') {
  seedRng(seed)
  const w = createWorld(boss, role, side)
  const input = {
    up: false, down: false, left: false, right: false, pressed: [],
    aim: null, firing: false,
  }
  // Read once: the bot has to know its own fight's numbers rather than carry a
  // hard-coded copy of them, or tuning the boss file silently stops tuning the
  // thing that measures it.
  const markDefs = boss.mechanics.filter(m => m.proximityStack)
  const pairDef = boss.mechanics.find(m => m.rule.type === 'pairUp')
  let ticks = 0
  while (w.player.alive && !w.killed && w.elapsedMs / 1000 < boss.pullLengthSec && ticks < 40000) {
    if (smart) {
      // Crude "good player": run from the nearest unresolved avoid-telegraph,
      // soak what needs soaking, run debuffs out, stay on the platform.
      let tx = 0, ty = 0

      // A tank holding one of a keep-apart pair has exactly one job, and every
      // step away from their mark drags 99% damage reduction across the room.
      // The tactic files agree: "Toxic Droplet Clearers" and "Venom Kill Squads"
      // are assignments given to other people. Letting the bot help with them
      // was worth thirty separation failures a pull.
      const anchoredTank = !!w.bosses?.find(b => b.targetId === 0)?.def.tankedApart
      for (const i of w.instances) {
        if (!i.def.shape || i.def.rule.type !== 'avoid') continue
        // A one-shot outranks everything else on screen. A player who knows the
        // fight drops whatever they are doing for it, so the bot must too —
        // otherwise the clear rate measures the bot's indifference to lethality
        // rather than whether the fight is survivable.
        const weight = i.def.lethal ? 6 : 1
        const f = awayFrom(w.player.pos.x, w.player.pos.y, i.pos.x, i.pos.y, i.uid)
        const d = f.d || 1
        if (i.def.shape.kind === 'annulus') {
          // Safety is inward for a ring.
          if (d >= i.def.shape.inner - 2) { tx -= f.x * 4 * weight; ty -= f.y * 4 * weight }
          continue
        }
        const reach = (i.def.shape.radius ?? 8) + 6
        if (d < reach) { tx += f.x * (reach / d) * weight; ty += f.y * (reach / d) * weight }
      }
      // Run over pickups — a globule nobody eats ruptures on the whole raid.
      let near = null, nd = Infinity
      for (const i of w.instances) {
        if (i.resolved || i.answered || i.def.rule.type !== 'collect') continue
        const d = Math.hypot(i.pos.x - w.player.pos.x, i.pos.y - w.player.pos.y)
        if (d < nd) { nd = d; near = i }
      }
      // Weighted to actually arrive. A Toxic Droplet is a 3-yard circle you have
      // to physically stand on, and at weight 4 the side-bubble forces simply
      // out-voted it — the bot drifted past thirteen of them a pull while
      // looking like it was trying. Suppressed while carrying, for the same
      // reason soaks are: you cannot run an errand with a bomb on you.
      if (near && !anchoredTank && !Object.keys(w.player.carrying).length) {
        tx += (near.pos.x - w.player.pos.x) / (nd || 1) * 12
        ty += (near.pos.y - w.player.pos.y) / (nd || 1) * 12
      }

      for (const i of w.instances) {
        if (i.resolved || i.def.rule.type !== 'beInside') continue
        // A Deadly soak is as urgent as a Deadly puddle. Weighting only the
        // fleeing made the bot run away from soaks it had to be standing in.
        // Never while carrying. A split mechanic hands half the raid a soak and
        // the other half a debuff to take somewhere, and the two jobs are
        // mutually exclusive: chasing a Hungering Pyre with a live Slithering
        // Flame on you kills you and everyone in the circle. Weighting soaks up
        // to fix missed droplets made the bot do precisely that.
        if (anchoredTank || Object.keys(w.player.carrying).length) continue
        // Otherwise weighted above the side-bubble forces — a soak the raid
        // needs beats shaving a few yards off a Mark you will take anyway.
        const weight = i.def.lethal ? 12 : 9
        const dx = i.pos.x - w.player.pos.x, dy = i.pos.y - w.player.pos.y
        const d = Math.hypot(dx, dy) || 1
        tx += (dx / d) * weight; ty += (dy / d) * weight
      }
      const carrying = Object.keys(w.player.carrying).length > 0
      const r = Math.hypot(w.player.pos.x, w.player.pos.y) || 1

      // ── corpse duty ──
      // A carried debuff normally goes AWAY from the raid, but during an
      // intermission that resurrects corpses the same debuff has the opposite
      // job: walk it onto the pile so the detonation burns them. Running it out
      // to an empty corner is a clean-looking failure — the Amani all stand back
      // up and the bot never learns why the next phase was unwinnable.
      const burning = carrying && (w.corpses ?? []).some(c => !c.burned)
      if (burning) {
        let corpse = null, cd = Infinity
        for (const c of w.corpses) {
          if (c.burned) continue
          const d = Math.hypot(c.pos.x - w.player.pos.x, c.pos.y - w.player.pos.y)
          if (d < cd) { cd = d; corpse = c }
        }
        if (corpse) {
          tx += (corpse.pos.x - w.player.pos.x) / (cd || 1) * 10
          ty += (corpse.pos.y - w.player.pos.y) / (cd || 1) * 10
        }
      } else if (carrying && r < 26) {
        tx += w.player.pos.x / r * 3; ty += w.player.pos.y / r * 3
      }

      // ── ground that kills on contact ──
      // Above everything. A lethalGround fixture is a hole in the floor, not a
      // mechanic to trade against: no soak, no add and no boss uptime is worth
      // standing in one, and weighting it merely "high" let the bot get talked
      // into the Soulcoil Well by a nearby soak.
      for (const i of w.instances) {
        if (i.def.rule.type !== 'lethalGround' || !i.def.shape) continue
        const f = awayFrom(w.player.pos.x, w.player.pos.y, i.pos.x, i.pos.y, i.uid)
        const keep = (i.def.shape.radius ?? 10) + 9
        if ((f.d || 0) < keep) { tx += f.x * 60; ty += f.y * 60 }
      }

      // ── permanent pools ──
      // They never expire, so by late pull the floor is mostly them. The bot has
      // to route around rather than treat each one as a transient telegraph, or
      // it dies to accumulated ground it has been standing in for a minute.
      for (const i of w.instances) {
        if (!i.def.permanent || !i.def.shape || i.def.rule.type !== 'avoid') continue
        const f = awayFrom(w.player.pos.x, w.player.pos.y, i.pos.x, i.pos.y, i.uid)
        const keep = (i.def.shape.radius ?? 8) + 4
        if (f.d < keep) { tx += f.x * (keep - f.d) * 3.5; ty += f.y * (keep - f.d) * 3.5 }
      }

      // ── tank discipline on a keep-apart fight ──
      //
      // A tanked golem walks to its tank, so wherever the tank goes the golem
      // goes. A tank who wanders off to help with a soak drags 99% damage
      // reduction across the room behind them — which is exactly what the bot
      // was doing, and why it was eating twenty-six Dominance failures a pull
      // while believing it was being helpful.
      //
      // Anchoring at the entity's own corner outranks every other pull except
      // ground that kills. Holding the boss still IS the tank's contribution.
      // A leash, not a clamp. Damping every other urge to nothing did stop the
      // golem wandering — and also stopped the tank dodging a Blood Venom pool
      // or running the orb puzzle, so they died on the spot holding perfect
      // position. A real tank steps off their mark to survive and walks back.
      // The pull scales with how far they have strayed and is capped below the
      // life-critical forces, so the ordering is: never die, then hold station,
      // then everything else.
      const mine = w.bosses?.find(b => b.targetId === 0)
      if (mine?.def.tankedApart) {
        const ax = mine.def.start.x, ay = mine.def.start.y
        const d = Math.hypot(ax - w.player.pos.x, ay - w.player.pos.y)
        if (d > 3) {
          const pull = Math.min(18, d * 1.6)
          tx += (ax - w.player.pos.x) / d * pull
          ty += (ay - w.player.pos.y) / d * pull
        }
      }

      // ── the split raid ──
      // Stay inside your own golem's Mark radius and outside the other's.
      // Standing in both is the specific mistake this fight punishes, and it is
      // what was killing the bot at 32 seconds.
      if (boss.sided && markDefs.length) {
        for (const md of markDefs) {
          const unit = w.bosses.find(b => b.def.id === md.from)
          if (!unit) continue
          const mine = unit.def.side === w.player.side
          const dx = w.player.pos.x - unit.pos.x, dy = w.player.pos.y - unit.pos.y
          const d = Math.hypot(dx, dy) || 1
          const R = md.proximityStack.radius
          if (mine) {
            // Hug the outer edge of your own bubble: in range to fight, as far
            // from theirs as the room allows.
            if (d > R - 6) { tx -= (dx / d) * 6; ty -= (dy / d) * 6 }
          } else if (d < R + 8) {
            tx += (dx / d) * 22; ty += (dy / d) * 22
          }
        }
      }

      // ── the orb puzzle ──
      // Walk at the partner whose orbs complete yours. Anyone else is fatal, so
      // this outweighs everything except ground that kills faster.
      if (pairDef && w.player.marked) {
        const target = pairDef.rule.target
        // Prefer the partner the fight actually reserved for you. Picking the
        // nearest arithmetically-valid body instead sent the bot across the room
        // past three wrong ones, and brushing any of those is instant death.
        let partner = w.allies.find(a => a.id === w.pairPartnerId && a.alive && a.marked)
        if (!partner || partner.green + w.player.green !== target) {
          partner = null
          let pd = Infinity
          for (const a of w.allies) {
            if (!a.alive || !a.marked) continue
            if (a.green + w.player.green !== target) continue
            const d = Math.hypot(a.pos.x - w.player.pos.x, a.pos.y - w.player.pos.y)
            if (d < pd) { pd = d; partner = a }
          }
        }
        // Wrong bodies first, and hard. Steering round them has to outrank
        // reaching the right one, or the approach itself kills you.
        for (const a of w.allies) {
          if (!a.alive || !a.marked || a === partner) continue
          if (a.green + w.player.green === target) continue
          const f = awayFrom(w.player.pos.x, w.player.pos.y, a.pos.x, a.pos.y, a.id)
          if (f.d < 9) { tx += f.x * (9 - f.d) * 12; ty += f.y * (9 - f.d) * 12 }
        }
        if (partner) {
          const pd = Math.hypot(partner.pos.x - w.player.pos.x, partner.pos.y - w.player.pos.y) || 1
          tx += (partner.pos.x - w.player.pos.x) / pd * 34
          ty += (partner.pos.y - w.player.pos.y) / pd * 34
        }
      }

      // ── resolve the desired direction against hard constraints ──
      //
      // Summed forces cannot express "never", only "strongly prefer", and every
      // hard constraint here is a death: the floor edge, and ground that kills on
      // contact. Weighting them merely high is why the bot walked off the east
      // wall fleeing the far golem's Mark radius, and why it got squeezed to a
      // standstill between Nek'zali's well, its pools and the rim.
      //
      // So the want-vector is a preference, and the resolver picks the closest
      // heading to it that is actually survivable — sliding along a wall rather
      // than being pushed back off it.
      const mag = Math.hypot(tx, ty)
      if (mag > 0.1) {
        // The eight headings WASD can actually produce. Resolving against a
        // continuous angle was wrong: the input is quantised, so the direction
        // the sim moves you can differ from the one that was checked by up to
        // 22 degrees — which is the whole margin, and it is why the bot kept
        // walking off a rim it had just verified was safe.
        const LOOK = 5
        const wx = tx / mag, wy = ty / mag
        let best = null, bestDot = -Infinity
        for (const [dx, dy] of DIRS) {
          const nx = w.player.pos.x + dx * LOOK
          const ny = w.player.pos.y + dy * LOOK
          if (!onFloor(boss, nx, ny)) continue
          let bad = false
          for (const i of w.instances) {
            if (i.def.rule.type !== 'lethalGround' || !i.def.shape) continue
            if (Math.hypot(nx - i.pos.x, ny - i.pos.y) < (i.def.shape.radius ?? 10) + 3) { bad = true; break }
          }
          if (bad) continue
          const dot = dx * wx + dy * wy
          if (dot > bestDot) { bestDot = dot; best = [dx, dy] }
        }
        // Boxed in on every heading: stand still rather than pick a lethal one.
        if (best) { tx = best[0]; ty = best[1] } else { tx = 0; ty = 0 }
      }
      input.right = tx > 0.3; input.left = tx < -0.3
      input.down = ty > 0.3; input.up = ty < -0.3

      // Adds come first. A real player swaps to them the moment they land, and
      // a bot that ignores them measures nothing except how fast the raid bar
      // empties — which is what it did when adds were first switched on.
      let target = null
      let td = Infinity
      for (const a of w.adds) {
        if (!a.alive || a.def.job === 'leave') continue   // never shoot an orb
        const d = Math.hypot(a.pos.x - w.player.pos.x, a.pos.y - w.player.pos.y)
        // Intercept adds are blocked with your body, not shot.
        if (a.def.job === 'intercept') {
          if (d < td) { td = d; tx += (a.pos.x - w.player.pos.x) / (d || 1) * 3; ty += (a.pos.y - w.player.pos.y) / (d || 1) * 3 }
          continue
        }
        // Only URGENT adds pull damage off the boss: one whose fuse is running
        // out, or one that still has a shield to break. A bot that shot every
        // add on sight never touched the boss at all on the add-heavy fights —
        // 98% accuracy and 98% boss health, because every shot went into crates.
        const urgent = a.def.fuseSec >= 900 ? false : (a.fuse ?? 0) < 9000 || a.shield > 0
        if (!urgent) continue
        if (d < td) { td = d; target = a }
      }
      input.firing = true
      input.aim = target ? { x: target.pos.x, y: target.pos.y } : null

      // Kick on sight when an add is winding up, otherwise tick over.
      const casting = w.adds.some(a => a.alive && a.def.job === 'kick' && a.castMs >= 0 && !a.kicked)
      if (casting) input.pressed.push('interrupt')
      if (w.elapsedMs % 900 < TICK_MS) input.pressed.push('dispel', 'interrupt')
    }
    step(w, input, TICK_MS)
    input.pressed.length = 0
    ticks++
    // TRACE=1 prints a per-second dump. Kept in the harness rather than in a
    // throwaway probe because every balance question so far has been answered by
    // watching one pull second by second, and rebuilding the bot in a probe just
    // measures the probe.
    if (process.env.TRACE && ticks % 60 === 0) {
      const inPool = w.instances.filter(i => i.resolved && i.def.shape?.kind === 'circle'
        && Math.hypot(w.player.pos.x - i.pos.x, w.player.pos.y - i.pos.y) <= i.def.shape.radius)
      console.log(`  t=${String(Math.round(w.elapsedMs / 1000)).padStart(3)}s hp=${w.player.health.toFixed(2)}`
        + ` raid=${w.raidHealth.toFixed(2)} pos=(${w.player.pos.x.toFixed(0)},${w.player.pos.y.toFixed(0)})`
        + ` phase=${w.phaseIndex ?? '-'} bossHp=${w.bossHp.toFixed(2)}`
        + ` marks=${JSON.stringify(w.player.marks ?? {})}`
        + (inPool.length ? ` STANDING-IN:${inPool.map(i => i.def.id).join(',')}` : ''))
    }
  }
  return buildResult(w)
}

const pad = (s, n) => String(s).padEnd(n)
let clears = 0, expected = 0

for (const [label, smart] of [['careless', false], ['competent', true]]) {
  console.log(`\n── ${label} player ──`)
  for (const boss of BOSSES) {
    // A split fight is two different fights. Running only one half would leave
    // the other completely unmeasured, which is exactly how a boss "passes"
    // while half its content is unplayable.
    const sides = boss.sided ? ['green', 'red'] : [null]
    for (const side of sides) {
      for (const role of ['tank', 'healer', 'dps']) {
        // Run every seed and report the median-ish outcome: cleared if it cleared
        // on most seeds, which is the question we actually care about.
        const runs = SEEDS.map(sd => play(boss, role, smart, sd, side ?? 'green'))
        const wins = runs.filter(r => r.cleared).length
        const res = runs[0]
        const fails = Math.round(runs.reduce((n, r) => n + r.failures.reduce((m, f) => m + f.count, 0), 0) / runs.length)
        const acc = res.shotsFired ? Math.round((res.shotsHit / res.shotsFired) * 100) : 0
        const cleared = wins > SEEDS.length / 2
        if (smart) { expected++; if (cleared) clears++ }
        console.log(
          `  ${pad(boss.key + (side ? '/' + side : ''), 18)} ${pad(role, 7)} ` +
          `${String(res.survivedSec).padStart(3)}s  ` +
          `boss ${String(Math.round(res.bossHpLeft * 100)).padStart(3)}%  ` +
          `acc ${String(acc).padStart(3)}%  ` +
          `mech ${String(res.mechanicsResolved).padStart(3)}  ` +
          `fails ${String(fails).padStart(3)}  ` +
          `${cleared ? 'KILL' : (res.deathCause || 'enrage')} ${wins}/${SEEDS.length}`
          // FAILS=1 breaks the count down by mechanic. A single large number
          // tells you a fight is going wrong; only the breakdown tells you
          // whether that is difficulty or a defect.
          + (process.env.FAILS
            ? '\n      ' + res.failures.map(f => `${f.name}×${f.count}`).join(', ')
            : ''))
      }
    }
  }
}

console.log(`\ncompetent clears: ${clears}/${expected}`)
