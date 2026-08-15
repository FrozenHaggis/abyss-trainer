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
// SEED= runs one of them alone, so a single bad cell can be looked at rather
// than averaged away.
const SEEDS = process.env.SEED ? [Number(process.env.SEED)] : [1337, 2024, 90210]

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
  const windDef = boss.mechanics.find(m => m.rule.type === 'windPair')
  const soakDef = boss.mechanics.find(m => m.rule.type === 'groupSoak')
  // A swap driver that trips on EVERY cast. Ravage is the only one in the raid:
  // one application is already too many, so an off-tank who does not taunt eats
  // a recorded failure every single flurry.
  const swapEveryCast = boss.mechanics.some(m =>
    m.rule.type === 'tankSwap' && m.rule.maxStacks <= 1)
  const COMPASS = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } }
  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' }
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
      // Where a tank aiming a frontal has to be standing, filled in below.
      let tankAnchor = null
      for (const i of w.instances) {
        if (!i.def.shape || i.def.rule.type !== 'avoid') continue
        // The glob a gale is aimed at is the way OUT of the stage, not a puddle.
        // Fleeing it is how the raid gets blown off the far rim.
        if (i.uid === w.galeTargetUid) continue
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
        if (i.uid === w.galeTargetUid) continue
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

      // ── carrying a trail ──
      // Nothing to press and nowhere to be: the whole instruction is "do not
      // stand still", because the ground you leave behind is the mechanic. A
      // stationary carrier paves their own feet and dies to a puddle they made.
      const trailing = w.instances.some(i =>
        !i.resolved && i.def.rule.type === 'trail' && i.carriedByPlayer)
      if (trailing) {
        const ang = w.elapsedMs / 700
        tx += Math.cos(ang) * 8; ty += Math.sin(ang) * 8
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

      // ── the two stack groups ──
      //
      // A cone that has to find one group and miss the other asks the bot for
      // the one thing a flee-everything bot cannot do: stand in a telegraph on
      // purpose, on exactly half the casts. Without this it fled both Mutilates,
      // the soak went unsplit twice a flurry, and the raid bar emptied — which
      // measures the bot's reflexes rather than whether the fight is survivable.
      if (soakDef) {
        for (const i of w.instances) {
          if (i.resolved || i.def.rule.type !== 'groupSoak') continue
          const called = w.player.group === w.calledGroup && w.player.gash <= 0
          const dx = i.pos.x - w.player.pos.x, dy = i.pos.y - w.player.pos.y
          const d = Math.hypot(dx, dy) || 1
          if (called) {
            // Into the body of the cone rather than at its apex, which is the
            // boss. Aiming at `pos` walks you into melee and out the far side.
            const half = ((i.def.shape?.arcDeg ?? 60) * Math.PI) / 360
            const reach = (i.def.shape?.radius ?? 20) * 0.55
            const px = i.pos.x + Math.cos(i.angle) * reach
            const py = i.pos.y + Math.sin(i.angle) * reach
            const pd = Math.hypot(px - w.player.pos.x, py - w.player.pos.y) || 1
            tx += ((px - w.player.pos.x) / pd) * 26
            ty += ((py - w.player.pos.y) / pd) * 26
            void half
          } else {
            // Your group is already carrying a Gash. A second one kills, so this
            // cone is as lethal to you as any hole in the floor.
            const f = awayFrom(w.player.pos.x, w.player.pos.y, i.pos.x, i.pos.y, i.uid)
            const keep = (i.def.shape?.radius ?? 20) + 5
            if (d < keep) { tx += f.x * 30; ty += f.y * 30 }
          }
        }
      }

      // ── aiming the boss, as the tank ──
      //
      // Two opposite jobs out of one face, under two seconds apart: Ravage must
      // point away from everybody and Mutilate must point straight at one of the
      // two stacks. The boss faces whoever holds him, so both are answered with
      // your feet — you aim for whichever cone lands FIRST. Without this the bot
      // held a fixed spot and swept the raid with four Ravages a pull while
      // never once putting a Mutilate on a group.
      const heldByMe = w.bosses?.find(b => b.targetId === 0)
      // Only on a fight that actually runs the two-group rota. Applied to every
      // boss with a tank cone it cost Nek'zali two clears out of three: her tank
      // has one job — hold her still, away from the Well — and a rule written
      // for a fight where the cone has somewhere it must point sent them walking
      // to a mark that fight does not have.
      if (heldByMe && soakDef) {
        let next = null
        for (const i of w.instances) {
          if (i.resolved || i.fromId !== heldByMe.def.id) continue
          if (i.def.rule.type !== 'faceAway' && i.def.rule.type !== 'groupSoak') continue
          if (!next || i.timer < next.timer) next = i
        }
        let sx = null, sy = null
        if (next && next.def.rule.type === 'faceAway') {
          // Directly opposite the raid, so the cone sweeps empty floor.
          let rx = 0, ry = 0, n = 0
          for (const a of w.allies) { if (a.alive) { rx += a.pos.x; ry += a.pos.y; n++ } }
          if (n) {
            // Directly opposite the raid FROM THE MIDDLE OF THE ROOM. Measured
            // from him instead, it walks off the platform: he follows you away
            // from the raid, which moves the answer further out every tick.
            const d = Math.hypot(rx / n, ry / n) || 1
            sx = (-(rx / n) / d) * 22
            sy = (-(ry / n) / d) * 22
          }
        } else if (w.groupMarks?.length) {
          // Stand ON the called group's mark. He faces his tank, so being in the
          // middle of the stack is what puts the cone on the stack — and unlike
          // a spot measured from him, it cannot walk away with him.
          const gm = w.groupMarks[w.calledGroup % w.groupMarks.length]
          sx = gm.x
          sy = gm.y
        }
        if (sx !== null) {
          const d = Math.hypot(sx - w.player.pos.x, sy - w.player.pos.y)
          if (d > 1.5) { tx += ((sx - w.player.pos.x) / d) * 20; ty += ((sy - w.player.pos.y) / d) * 20 }
          tankAnchor = { x: sx, y: sy, d }
        }
      }

      // ── stand somewhere on purpose ──
      //
      // Between mechanics the bot had NO force acting on it at all, so it simply
      // stopped wherever the last one left it — which on Sszorak meant three
      // yards from the rim for twelve seconds, until Raging Crosswinds came
      // round and posted it into the abyss. It was not making a mistake; it had
      // nowhere it was trying to be. A real raider stands on their mark, and so
      // does the raid AI this bot is supposed to be a stand-in for.
      //
      // Deliberately weak: it loses to every telegraph, every soak and every
      // debuff. It only decides where you idle.
      if (w.groupMarks?.length) {
        const gm = w.groupMarks[w.player.group % w.groupMarks.length]
        const d = Math.hypot(gm.x - w.player.pos.x, gm.y - w.player.pos.y)
        if (d > 4) {
          tx += ((gm.x - w.player.pos.x) / d) * 5
          ty += ((gm.y - w.player.pos.y) / d) * 5
        }
      }

      // ── the wind ──
      //
      // Line up with the raider whose arrow points back at yours, on their axis,
      // on the side they will be thrown from. Anything else is a 22-yard throw
      // and, on a 56-yard floor, usually the abyss.
      if (windDef && w.player.wind) {
        const dir = COMPASS[w.player.wind]
        const want = OPPOSITE[w.player.wind]
        let mate = w.allies.find(a => a.id === w.windPartnerId && a.alive && a.wind === want)
        if (!mate) {
          let md = Infinity
          for (const a of w.allies) {
            if (!a.alive || a.wind !== want) continue
            const d = Math.hypot(a.pos.x - w.player.pos.x, a.pos.y - w.player.pos.y)
            if (d < md) { md = d; mate = a }
          }
        }
        if (mate) {
          // Stand a comfortable way back down your own axis from them, so the
          // throw carries you together rather than past each other. Across the
          // axis first: being on their line matters more than the distance.
          const gx = mate.pos.x - dir.x * 12
          const gy = mate.pos.y - dir.y * 12
          const d = Math.hypot(gx - w.player.pos.x, gy - w.player.pos.y) || 1
          tx += ((gx - w.player.pos.x) / d) * 40
          ty += ((gy - w.player.pos.y) / d) * 40
        } else {
          // Nobody to meet: get to the middle so the throw crosses the floor
          // instead of leaving it.
          const r = Math.hypot(w.player.pos.x, w.player.pos.y) || 1
          tx -= (w.player.pos.x / r) * 20
          ty -= (w.player.pos.y / r) * 20
        }
      }

      // ── the gales ──
      //
      // Ride the wind into the glob. The tactic file's own Good line is "raid
      // moves WITH the wind, stays off the edge", and a bot that treated the
      // cyst as ground to avoid was blown straight past it and off the far rim —
      // which is precisely the mistake the stage exists to punish.
      const gale = w.instances.find(i => i.uid === w.galeTargetUid)
      if (gale) {
        const d = Math.hypot(gale.pos.x - w.player.pos.x, gale.pos.y - w.player.pos.y) || 1
        tx += ((gale.pos.x - w.player.pos.x) / d) * 50
        ty += ((gale.pos.y - w.player.pos.y) / d) * 50
      }

      // ── a tank aiming a cone is leashed to their mark ──
      //
      // Summed forces cannot say "never", and nine Tempest vortices spiralling
      // out of a boss standing next to you say "run" nine times at once. The bot
      // obeyed, the boss followed it, and the pair walked from the mark out to
      // fifty-two yards on a fifty-six yard floor — with the cone pointing at
      // open ground the whole way and both Mutilates landing on nobody.
      //
      // So it is a constraint rather than a preference, exactly like the arena
      // edge below: past the leash, going back is the only heading considered.
      // Sidestepping a vortex is still allowed. Leaving the mark is not.
      // Unless they are standing in something. A leash, not a clamp: a real tank
      // steps off their mark to survive and walks back, and a hard constraint
      // that outranked "get out of the acid" killed them at twenty-four seconds
      // holding perfect position.
      const standingInIt = w.instances.some(i =>
        i.resolved && i.def.shape?.kind === 'circle' && (i.def.lingerMs || i.def.permanent)
        && i.def.rule.type === 'avoid' && !i.def.raidKnockRoom
        && Math.hypot(i.pos.x - w.player.pos.x, i.pos.y - w.player.pos.y) < i.def.shape.radius)
      if (tankAnchor && tankAnchor.d > 8 && !standingInIt) {
        tx = (tankAnchor.x - w.player.pos.x) / tankAnchor.d
        ty = (tankAnchor.y - w.player.pos.y) / tankAnchor.d
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
          // Sample the whole step, not just where it ends.
          //
          // Checking only the far end quietly assumes the floor is convex: if
          // both ends are on it, so is everything between. Every room in this
          // tier was convex until the Twin Fangs' wedge grew a venom pocket
          // bitten out of its bottom edge, and then the bot began certifying
          // headings that stepped clean over the hole and died on the far side
          // of ground it had just verified. Half-yard steps because the gap can
          // be narrower than a yard near its inner edge.
          let crosses = false
          for (let s = 0.5; s < LOOK; s += 0.5) {
            if (!onFloor(boss, w.player.pos.x + dx * s, w.player.pos.y + dy * s)) { crosses = true; break }
          }
          if (crosses) continue
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
        // Hold the second of a pair that must not die together. "Kill it fast"
        // is the wrong reflex on the Burning Venoms — cleaving both down inside
        // the window wipes the raid — so the bot has to be able to stop, or it
        // measures the fight as impossible when it is merely disciplined.
        const w2 = a.def.noSimultaneousDeath
        if (w2 && (w.elapsedMs - (w.addDeathMs?.[a.def.id] ?? -1e9)) < w2.withinSec * 1000) continue
        if (d < td) { td = d; target = a }
      }
      input.firing = true
      input.aim = target ? { x: target.pos.x, y: target.pos.y } : null

      // Kick on sight when an add is winding up, otherwise tick over.
      const casting = w.adds.some(a => a.alive && a.def.job === 'kick' && a.castMs >= 0 && !a.kicked)
      if (casting) input.pressed.push('interrupt')
      // Take the swap when the fight asks for it. The bot never pressed taunt at
      // all, which on a boss whose swap driver trips on every single cast meant
      // it ate a recorded failure every flurry for a button it was holding.
      //
      // Only where the swap trips every cast, and never while carrying.
      //
      // Pressing it on every fight with a tank debuff cost Nek'zali two clears
      // out of three: her tank took her back every cycle and then had no window
      // to walk a Slithering Flame anywhere, and a boss the bot used to kill
      // stopped being winnable at all. Where the threshold is a real stack count
      // the co-tank AI already trades correctly on its own — the button only has
      // to be pressed where not pressing it is an automatic failure.
      if (swapEveryCast && !carrying && w.prompt?.verb === 'TAUNT') input.pressed.push('taunt')
      // Press the buttons a competent player presses.
      //
      // The bot had a ninety-second defensive and a raid cooldown on its bar for
      // the whole project and never touched either, which is not a careful
      // player being measured — it is a careless one wearing the label. A tank
      // eating two Ravages a flurry with an unused defensive is not evidence
      // that the flurry is too hard.
      if (w.player.health < 0.55 && !w.player.cooldowns.defensive) input.pressed.push('defensive')
      if (w.raidHealth < 0.5 && !w.player.cooldowns.raidcd) input.pressed.push('raidcd')
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
        + (w.player.wind ? ` wind=${w.player.wind} mate=${w.windPartnerId}` : '')
        + (w.galeTargetUid >= 0 ? ` gale=${w.galeTargetUid}` : '')
        + (w.galeImmuneMs > 0 ? ` braced=${(w.galeImmuneMs / 1000).toFixed(1)}` : '')
        + ` cysts=${w.instances.filter(i => i.def.raidKnockRoom && !i.answered).length}`
        + (inPool.length ? ` STANDING-IN:${inPool.map(i => i.def.id).join(',')}` : ''))
    }
  }
  return buildResult(w)
}

const pad = (s, n) => String(s).padEnd(n)
let clears = 0, expected = 0

// BOSS= and ROLE= narrow the sweep to one cell. Tuning a single fight meant
// waiting out twenty-six others every time, which is long enough that you stop
// re-running it and start guessing.
const ONLY_BOSS = process.env.BOSS
const ONLY_ROLE = process.env.ROLE

for (const [label, smart] of [['careless', false], ['competent', true]]) {
  console.log(`\n── ${label} player ──`)
  for (const boss of BOSSES) {
    if (ONLY_BOSS && boss.key !== ONLY_BOSS) continue
    // A split fight is two different fights. Running only one half would leave
    // the other completely unmeasured, which is exactly how a boss "passes"
    // while half its content is unplayable.
    const sides = boss.sided ? ['green', 'red'] : [null]
    for (const side of sides) {
      for (const role of ['tank', 'healer', 'dps']) {
        if (ONLY_ROLE && role !== ONLY_ROLE) continue
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
