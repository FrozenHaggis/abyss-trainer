import { createWorld, step, buildResult, seedRng, TICK_MS } from '../.playtest/sim.mjs'
import { BOSSES } from '../.playtest/registry.mjs'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

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

/**
 * Every `Rule` variant, and what this bot does about it.
 *
 * The instrument's own blind spots, written down. The bot is a measuring device,
 * so a rule it has never heard of does not read as "the bot ignored it" — it
 * reads as the FIGHT being too hard, and the README records four cells that
 * printed exactly that way. The last pass shipped four new primitives and the
 * bot knew about none of them; the verifier then mistook three instrument gaps
 * for difficulty before finding the cause.
 *
 * `invariants.test.js` asserts these keys are exactly the `Rule` union in
 * types.ts, so a 27th variant breaks the build here until somebody has decided
 * what a competent player does about it. Deciding "nothing" is allowed and is
 * why several entries below say so out loud — what is not allowed is nobody
 * having looked. That test reads this table as TEXT rather than importing it,
 * because importing this file runs the whole sweep.
 */
const BOT_KNOWS = {
  avoid: 'flees the shape; a fanned lane is left sideways, everything else radially',
  beInside: 'walks into the soak unless carrying something',
  collect: 'runs over the nearest pickup unless anchored as a tank',
  keepApart: 'nothing to press — the anchored-tank leash below is what answers it',
  holdMelee: 'nothing of its own: the `tankedApart` anchor below already welds the '
    + 'tank to the entity it is holding, and that anchor is what satisfies the '
    + 'leash. It stands down while the entity is relocated off the floor — a '
    + 'Submerge suspends the leash in the engine and the bot has to stop holding '
    + 'a station on a serpent that is not there. Measured: zero Concentrated '
    + 'Spittle and zero Clotted Bolt failures across every seed and role',
  lethalGround: 'absolute exclusion, and a hard constraint on the movement resolver',
  pairUp: 'walks at the partner whose orbs complete its own, steering round the rest',
  drainNearest: 'deliberately nothing: where the boss stands is the AI tank\'s call',
  trail: 'keeps moving so the ground it paves is behind it',
  burnWindow: 'holds `burst` for the window instead of spending it on cooldown',
  // This used to read "no fight declares one any more", which was already
  // wrong before this merge — the Explorers dropped theirs for `killSpread`,
  // but the Coiled Altar has carried a `syncKill` throughout. It is corrected
  // here because that stale sentence is the reason nobody noticed the Coiled
  // Altar has no target-discipline model at all: the council-evening block
  // below is gated on `alliesChipOffTarget`, which only the Explorers declare.
  syncKill: 'NOTHING on the one fight that declares it. The Coiled Altar\'s '
    + 'window is a hard wipe and the bot picks targets by proximity there, so '
    + 'the pools drift apart on their own; the council-evening block below '
    + 'would answer it but is gated on a flag that fight does not set',
  faceAway: 'points the boss away from the raid while holding it',
  aimAway: 'deliberately nothing: the beam re-aims at the player while it telegraphs, '
    + 'so there is no pre-position a bot could make',
  press: 'presses interrupt/dispel on a cadence and taunt off the engine\'s prompt',
  raidDamage: 'deliberately nothing to dodge — it presses raidcd when the bar drops',
  carryOut: 'walks it to the distance THIS mechanic asks for, not to a literal',
  survive: 'deliberately nothing: the knockback is answered by not being at the rim, '
    + 'which the movement resolver already enforces',
  tankSwap: 'takes the swap where the fight trips on every cast',
  // A GAP, WRITTEN DOWN AS ONE. This entry is not "deliberately nothing" and
  // must not be read as one.
  //
  // The engine scores a missed pool only against the tank holding the caster
  // (`sim.ts` `case 'tankSoak'`), and on the Twin Fangs the player tank is
  // seated on Vexhul from the pull while Stone Breaker is cast by Ithraz — so
  // for most of a pull these pools genuinely belong to the AI tank, who does
  // walk them (`allyThink`, `rt === 'tankSoak'`). But `handOff` TRADES
  // serpents: when the co-tank taunts Vexhul off an over-stacked player, the
  // player is handed Ithraz and the pools become theirs. The bot has no model
  // of that at all — no force pulls it onto a `tankSoak` instance it owns.
  //
  // It costs nothing measurable today only because the tank cell dies to
  // Uncoiled Wrath at 46s, before enough Caustic Deluges have stacked to drive
  // a second trade: zero Stone Breaker failures on any seed. That is the pull
  // ending early, not the bot playing well, and the moment Twin Fangs pacing is
  // fixed this becomes a live blind spot. Left unimplemented here because this
  // is a merge and teaching the instrument a new behaviour would move cells on
  // a fight neither side of the merge changed in this pass.
  tankSoak: 'nothing yet, and that is a known gap rather than a decision — the '
    + 'pools are the caster-holder\'s, the AI tank walks them while it holds '
    + 'Ithraz, and the bot does not take them over when a swap hands it Ithraz',
  combo: 'deliberately nothing: a container that fires its parts, each handled on its own',
  groupSoak: 'into the cone when its group is called, well clear of it when not',
  shedStack: 'the one mechanic whose right answer depends on what the player is '
    + 'carrying, and all three states are modelled at the Ravenous Feast block '
    + 'below: holding stacks and not yet bitten → get in, it is the only way '
    + 'they come off; already bitten by this cast → get out, the second bite '
    + 'kills; carrying nothing → stay out and let somebody who needs it have '
    + 'the bite. Tanks skip it — one is exempt and welded inside it anyway, the '
    + 'other is welded to a serpent of its own and cannot come',
  stackingDot: 'deliberately nothing: the two in the raid are consequences of another '
    + 'mechanic being failed, not casts with an answer of their own',
  windPair: 'lines up on the partner blown the other way',
  feed: 'fetches the fish and holds it until the bar is nearly full',
  polarity: 'deliberately nothing at cast time — the cure is chased off `player.element`',
  elementPool: 'runs into the OPPOSITE element, outranking a pickup',
  launchPad: 'gets airborne when a wave is on the floor',
  wave: 'not dodged — it is answered by being on a mushroom, above',
}

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
  // What a wave is going to come OUT of.
  //
  // A Blast Wave's own telegraph is 2.5 seconds and its only answer is being on
  // a mushroom, which scatter within 35 yards of the arena centre — so a bot
  // that waited for the front to appear was starting a thirty-yard sprint with
  // two and a half seconds to run it, and arrived a stride short. That is not
  // the fight being hard: the bomb is planted ten seconds before the wave and
  // any player who has seen this once is standing on a mushroom the whole time.
  // The bot cannot pre-position for a cast that has not happened, but it can
  // read a chain that has already started, which is what this is.
  const waveIds = new Set(boss.mechanics.filter(m => m.rule.type === 'wave').map(m => m.id))
  const bringsWave = new Set(boss.mechanics
    .filter(m => m.spawns && waveIds.has(m.spawns.defId)).map(m => m.id))
  const COMPASS = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } }
  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' }
  let ticks = 0
  // Highest instance uid seen, so TRACE can name each cast at the moment it
  // appears. A timeline fight is judged on WHEN things fire, and the per-second
  // position dump below cannot answer that question at all — it was written for
  // a fight whose cadence was one number in the boss file.
  let lastUid = -1
  // Mor'zahi's bar as it stood on the tick BEFORE a feed emptied it. The whole
  // tuning target for `energyPerSec` is "roughly 70% at the moment of a feed",
  // and that number exists for exactly one tick.
  let lastEnergy = 0
  while (w.player.alive && !w.killed && w.elapsedMs / 1000 < boss.pullLengthSec && ticks < 40000) {
    if (!smart) {
      // A careless PLAYER, not a statue.
      //
      // Everything below used to sit inside `if (smart)`, so the careless pass
      // never set a key and never pulled a trigger — `firing` stayed false from
      // its initialiser. That is why every careless row printed `acc 0%` and
      // `boss 100%`: it was attrition killing a mannequin, and it would have
      // printed the same 27 deaths with every mechanic in the raid deleted.
      // Half of the README's bar — "a careless player dies" — was not being
      // measured at all, and it is the half that matters for a trainer.
      //
      // Careless means: shoots constantly, wanders, dodges nothing, presses
      // nothing. It still avoids the two things that are not carelessness but
      // suicide — walking off the platform, and standing in a hole in the floor
      // — because a player who falls off at four seconds measures nothing
      // either. The heading comes off the tick count, so runs stay reproducible.
      input.firing = true
      input.aim = null
      const base = (Math.floor(ticks / 100) * 2.399963) % (Math.PI * 2)
      // Turn AWAY from a wall or a hole rather than heading for the middle of
      // the room. "Back to the centre" was the obvious fallback and it is
      // suicide on the two fights that put a hole in the centre: on Vashnik it
      // walked into the Malignant Cavity at five seconds every time, in every
      // role, having measured nothing at all. Sweep for a heading that is
      // survivable and take the first one.
      let cx = Math.cos(base)
      let cy = Math.sin(base)
      for (let t = 0; t < 8; t++) {
        const a = base + t * (Math.PI / 4)
        const dx = Math.cos(a)
        const dy = Math.sin(a)
        const ahead = { x: w.player.pos.x + dx * 8, y: w.player.pos.y + dy * 8 }
        if (!onFloor(boss, ahead.x, ahead.y)) continue
        const intoHole = w.instances.some(i =>
          i.def.rule.type === 'lethalGround' && i.def.shape &&
          Math.hypot(ahead.x - i.pos.x, ahead.y - i.pos.y) < (i.def.shape.radius ?? 10) + 4)
        if (intoHole) continue
        cx = dx
        cy = dy
        break
      }
      input.right = cx > 0.3; input.left = cx < -0.3
      input.down = cy > 0.3; input.up = cy < -0.3
    }
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
        // ── a lane is left SIDEWAYS ──
        //
        // A `line` is anchored at its caster and measured forward, so the
        // radial "run away from `pos`" below points straight DOWN it. On a
        // fanned travelling lane — Shell Spin is three of them off Nama's
        // shoulders every thirty seconds — that is the one heading that keeps
        // you in the shell's path for its whole flight, and the shells move at
        // 9 yd/s against a 14 yd/s run, so the bot outran nothing and was
        // clipped by lanes it was obediently fleeing. It also read `radius`
        // off a shape that has none and fell back to 8, so the trigger
        // distance was a fiction as well.
        //
        // The projection is the same `along`/`across` the engine's own hit test
        // uses, so the bot and the sim cannot disagree about what "in the lane"
        // means. Escape is perpendicular, toward whichever edge is nearer.
        if (i.def.shape.kind === 'line' && i.def.fanDeg !== undefined) {
          const ca = Math.cos(i.angle), sa = Math.sin(i.angle)
          const rx = w.player.pos.x - i.pos.x, ry = w.player.pos.y - i.pos.y
          const along = rx * ca + ry * sa
          const across = -rx * sa + ry * ca
          const len = i.reach ?? i.def.shape.length
          // Behind the shell, or well past its reach: not your problem.
          if (along < -4 || along > len + 6) continue
          const need = i.def.shape.width / 2 + 5
          const off = Math.abs(across)
          if (off < need) {
            const sgn = across >= 0 ? 1 : -1
            tx += -sa * sgn * (need - off) * 3 * weight
            ty += ca * sgn * (need - off) * 3 * weight
          }
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

      // ── the fish ──
      //
      // Fetch it, then walk it into a body. Weighted above an ordinary pickup
      // because it is not one: a junk box left on the floor costs the raid a
      // slice of its bar, and a fish left on the floor costs the only thing that
      // empties Mor'zahi's. Deliberately NOT suppressed while carrying something
      // else — the errand IS the answer to the enrage, and a bot that put it down
      // to run a bomb out simply watched the bar fill instead.
      //
      // Delivery WAITS for the boxes, though. A carried fish has no timer at all
      // — `fishCarried` is a flag, and the only cost of holding it is the bar
      // ticking up — while the crates it came out of have a ten-second window and
      // charge the raid a third of its health for each one left standing. A bot
      // that found the fish mid-window and walked fifty yards south to deliver it
      // abandoned three crates to do so and wiped the raid at forty-eight seconds
      // holding the thing that would have saved it. Finish the window, then walk.
      if (!anchoredTank) {
        const windowOpen = w.instances.some(i =>
          !i.resolved && !i.answered && i.def.rule.type === 'collect')
        // And a fish is SPENT deliberately, not reflexively.
        //
        // Feeding empties the bar, so feeding at 18% throws away four fifths of
        // the reset — which is exactly what the bot used to do, three times a
        // pull, burning about eighty seconds of bar it had been handed for free
        // and then dying to an enrage that its own haste had brought forward.
        // The boss file says as much: "a raid cooldown lands on every fish,
        // because every fish is planned."
        //
        // So hold it until the bar is nearly full — unless another fish is
        // already lying on the floor, in which case this one has to be spent
        // now or that one rots where it fell and a reset is lost outright.
        const fishWaiting = w.instances.some(i =>
          !i.resolved && !i.answered && i.def.rule.type === 'feed')
        const spendIt = w.bossEnergy >= 70 || fishWaiting
        if (w.fishCarried && !windowOpen && spendIt) {
          // A destination, not a distance. Nearest body that has not eaten, and
          // only those: the renderer draws the link to exactly this set, and
          // walking into an empowered explorer is a rejected feed and a wasted
          // walk.
          let mouth = null, md = Infinity
          for (const b of w.bosses) {
            if (b.def.untargetable || !b.alive || b.empowered) continue
            const d = Math.hypot(b.pos.x - w.player.pos.x, b.pos.y - w.player.pos.y)
            if (d < md) { md = d; mouth = b }
          }
          if (mouth) {
            tx += (mouth.pos.x - w.player.pos.x) / (md || 1) * 16
            ty += (mouth.pos.y - w.player.pos.y) / (md || 1) * 16
          }
        } else if (!w.fishCarried) {
          let fish = null, fd = Infinity
          for (const i of w.instances) {
            if (i.resolved || i.answered || i.def.rule.type !== 'feed') continue
            const d = Math.hypot(i.pos.x - w.player.pos.x, i.pos.y - w.player.pos.y)
            if (d < fd) { fd = d; fish = i }
          }
          if (fish) {
            tx += (fish.pos.x - w.player.pos.x) / (fd || 1) * 14
            ty += (fish.pos.y - w.player.pos.y) / (fd || 1) * 14
          }
        }
      }

      // ── the polarity trade ──
      //
      // The debuff comes off in the OPPOSITE element's pool and nowhere else, and
      // a second volley on a carrier who never traded kills them outright. So
      // this outranks a pickup: the box costs the raid a fraction of a bar, this
      // costs the pull. The pools are never `avoid`, so nothing is fleeing them
      // and no suppression is needed.
      if (w.player.element) {
        let cure = null, cd = Infinity
        for (const i of w.instances) {
          if (i.def.rule.type !== 'elementPool') continue
          if (i.def.rule.element === w.player.element) continue
          const d = Math.hypot(i.pos.x - w.player.pos.x, i.pos.y - w.player.pos.y)
          if (d < cd) { cd = d; cure = i }
        }
        if (cure) {
          tx += (cure.pos.x - w.player.pos.x) / (cd || 1) * 18
          ty += (cure.pos.y - w.player.pos.y) / (cd || 1) * 18
        }
      }

      // ── getting off the floor ──
      //
      // A Blast Wave is deliberately too wide to outrun, and the only answer is
      // to be airborne on a mushroom when it passes. It is not an `avoid`, so the
      // flee pass above never sees it — a bot without this walks around inside a
      // front it has no idea is lethal. Highest weight in the file: nothing else
      // on screen is worth being on the ground for.
      //
      // Two behaviours, not one, and the difference is the whole thing. A
      // mushroom is CONSUMED on contact and the launch lasts three seconds, so
      // stepping on one early spends the only answer and lands you back on the
      // floor before the front arrives — the bot did exactly that when it was
      // first taught to read the bomb, and it cost two cells that had been
      // clearing. So: while the chain is merely running, WALK OVER AND WAIT a
      // few yards off the nearest mushroom; once the front is actually on the
      // floor, step on it. Waiting beside it is what a player who has seen this
      // fight once does, and it is the only part of it the bot was missing.
      const waveLive = w.instances.some(i => !i.resolved && i.def.rule.type === 'wave')
      const chained = w.instances.some(i => !i.resolved && bringsWave.has(i.def.id))
      if ((waveLive || chained) && w.player.aloft <= 0) {
        let pad = null, pd = Infinity
        for (const i of w.instances) {
          if (i.resolved || i.answered || i.def.rule.type !== 'launchPad') continue
          const d = Math.hypot(i.pos.x - w.player.pos.x, i.pos.y - w.player.pos.y)
          if (d < pd) { pd = d; pad = i }
        }
        if (pad) {
          // Loiter radius: outside the pad's own trigger so it is not eaten by
          // accident, inside a stride of it so the last step is instant.
          const hold = waveLive ? 0 : (pad.def.shape?.radius ?? 4) + 3
          const push = waveLive ? 24 : 11
          if (pd > hold) {
            tx += (pad.pos.x - w.player.pos.x) / (pd || 1) * push
            ty += (pad.pos.y - w.player.pos.y) / (pd || 1) * push
          }
        }
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

      // ── Ravenous Feast ──
      // The only mechanic in the raid whose right answer depends on a number the
      // player is carrying, and the bot has to model all three states or the
      // Twin Fangs rows stop measuring the fight.
      //
      // Without this the harness had NO model of it at all — the mechanic left
      // `beInside` when it became the venom shedder, and with it went the only
      // reason the bot ever walked into the circle. A competent healer then took
      // ten stacks in eighty seconds with the one thing that removes them going
      // off three times a rotation in front of them, and the row read as a fight
      // that cannot be played rather than a bot that does not know how.
      //
      //   carrying stacks, not yet fed → get in, it is the only way out
      //   already fed by this cast     → get out, the second bite kills
      //   carrying nothing             → stay out, a bite spent at zero buys
      //                                  nothing and costs you the cast
      //
      // Tanks skip it entirely, which is right on both serpents: the one holding
      // the caster is exempt from the mechanic and welded inside it anyway, and
      // the other is welded to a serpent of their own and cannot come.
      for (const i of w.instances) {
        if (i.resolved || i.def.rule.type !== 'shedStack') continue
        if (anchoredTank || Object.keys(w.player.carrying).length) continue
        const fed = !!i.fed?.includes(-1)
        const dx = i.pos.x - w.player.pos.x, dy = i.pos.y - w.player.pos.y
        const d = Math.hypot(dx, dy) || 1
        const reach = (i.def.shape?.radius ?? 10) + 6
        if (!fed && (w.player.venom ?? 0) > 0) {
          tx += (dx / d) * 12; ty += (dy / d) * 12
        } else if (d < reach) {
          // Fed already outranks a puddle — a second bite is not damage, it is
          // death. Wasting the cast is worth walking for, but not worth dying
          // for, so the empty-handed weight sits below the avoid forces.
          const weight = fed ? 12 : 4
          tx -= (dx / d) * weight; ty -= (dy / d) * weight
        }
      }

      const carrying = Object.keys(w.player.carrying).length > 0
      const r = Math.hypot(w.player.pos.x, w.player.pos.y) || 1

      // ── corpse duty ──
      // A carried debuff normally goes AWAY from the raid, but during an
      // intermission that resurrects corpses the same debuff has the opposite
      // job: walk it onto the pile so the detonation burns them. Running it out
      // to an empty corner is a clean-looking failure — the Amani all stand back
      // up and the bot never learns why the next phase was unwinnable.
      //
      // Gated on the stage that actually RAISES the bodies, matching the engine's
      // own `burnsCorpses`. Ungated it fired in Stage One too, where nothing can
      // burn and the errand is pure loss.
      const raises = !!boss.phases?.[w.phaseIndex]?.resurrectCorpsesAs
      // And only corpses that can be burned from ground you survive. A marching
      // add is only retired at `lenOf(add.pos) < 4`, so an Amani dies well inside
      // the Soulcoil Well and leaves its body there — for a corpse at radius rc
      // the nearest safe standing point is 13 - rc away, so anything inside rc=7
      // is unburnable by ANY player. The bot used to walk at the nearest corpse
      // regardless, get shoved back out by the well's weight-60 exclusion, and
      // sit in a two-tick limit cycle at r=22 until the flame killed it at 24.
      const holes = w.instances.filter(i => i.def.rule.type === 'lethalGround' && i.def.shape)
      const blast = 6
      // Reachable means reachable FROM WHERE THE BOT WILL STAND, which is the
      // hazard's radius plus the 9-yard berth it keeps below — not merely from
      // the hazard's edge. That difference is the whole bug: a corpse ten yards
      // out is burnable in principle from the Well's lip and completely
      // unreachable to something that refuses to come within twenty-two, so the
      // bot walked at it, got shoved back out, and sat in a two-tick limit cycle
      // at r=21.6 until the flame it was carrying killed it at 24.
      //
      // A human might well take the risk. The bot deliberately does not, and it
      // is the more honest instrument for it: an errand that can only be run by
      // standing on the edge of instant death is a fight problem, and papering
      // over it with a suicidal bot would hide exactly the geometry defect that
      // needs deciding.
      const reachable = c => holes.every(h => {
        const d = Math.hypot(c.pos.x - h.pos.x, c.pos.y - h.pos.y)
        return d >= (h.def.shape.radius ?? 10) + 9 - blast
      })
      const burning = carrying && raises && (w.corpses ?? []).some(c => !c.burned && reachable(c))
      if (burning) {
        let corpse = null, cd = Infinity
        for (const c of w.corpses) {
          if (c.burned || !reachable(c)) continue
          const d = Math.hypot(c.pos.x - w.player.pos.x, c.pos.y - w.player.pos.y)
          if (d < cd) { cd = d; corpse = c }
        }
        if (corpse) {
          tx += (corpse.pos.x - w.player.pos.x) / (cd || 1) * 10
          ty += (corpse.pos.y - w.player.pos.y) / (cd || 1) * 10
        }
      } else if (carrying) {
        // Run it out to the distance THIS mechanic asks for, not to a literal.
        // The 26 that used to be here is some other fight's number: Nek'zali's
        // Essence Rend wants 30 and its Slithering Flame 24, so the carrier
        // parked at exactly 26.0 every time and failed the first 100% of the
        // time. Weighted by how far short it is, so it is not out-voted by the
        // repulsion from the puddles it has been dropping.
        let need = 0
        for (const i of w.instances) {
          if (i.resolved || i.def.rule.type !== 'carryOut') continue
          if (!i.carriedByPlayer) continue
          need = Math.max(need, i.def.rule.minDistance)
        }
        if (need > 0 && r < need + 2) {
          const push = Math.min(20, 4 + (need + 2 - r) * 2)
          tx += (w.player.pos.x / r) * push
          ty += (w.player.pos.y / r) * push
        }
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
      //
      // ...and it stops the moment the thing being held leaves the floor. A Twin
      // Fangs Submerge takes both serpents into the acid and suspends both melee
      // leashes, and the engine's own ally tanks drop their stations and rejoin
      // the raid for the duration. Without the same rule here the bot spent
      // every intermission pinned to a corner of the tanks' ledge that Vile
      // Flood sweeps across, holding position on a boss that was not there — so
      // the row measured the harness's ignorance of the stage rather than
      // anything the stage does.
      const submerged = new Set(
        (boss.phases?.[w.phaseIndex]?.relocate ?? []).map(r => r.id))
      const mine = w.bosses?.find(b => b.targetId === 0 && !submerged.has(b.def.id))
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

      // ── a knock the edge does not catch ──
      //
      // Stone Breaker throws every body ten yards straight away from Ithraz and
      // does not stop them at the rim: 46% of the Twin Fangs floor is a landing
      // in the venom, and the tank mark for Vexhul is one of the fatal squares.
      // A bot with no model of this stood exactly where it was told to stand and
      // died at twenty-seven seconds on every seed and all three roles — so the
      // harness measured nothing this fight does after its first minute. Reading
      // the push is not optional play here, it is the mechanic, and a "competent
      // player" who cannot read it is not modelling one.
      //
      // Toward the caster, because the push is radial: every yard closer to it
      // is a yard more floor left on the far side of you. Weighted above the
      // tankedApart anchor (capped at 18) on purpose — holding the mark is the
      // tank's job right up until the mark is the thing about to kill them.
      const thrower = w.instances.find(i =>
        !i.resolved && i.def.offPlatform && i.def.knockbackYards)
      // `extra` is margin past the stated push, and the two callers want
      // different amounts of it. The resolver below is choosing between headings
      // and only needs the lip covered. The force needs MORE, or it switches
      // itself off the instant the landing is barely on the floor and the
      // tankedApart anchor — which is pulling the tank back at up to 18 — drags
      // them straight back over the line. The bot oscillated on exactly that
      // boundary and died on it, holding a mark that was a fatal square.
      const landsOnFloor = (x, y, extra = 2) => {
        if (!thrower) return true
        const a = Math.atan2(y - thrower.pos.y, x - thrower.pos.x)
        const p = thrower.def.knockbackYards + extra
        return onFloor(boss, x + Math.cos(a) * p, y + Math.sin(a) * p)
      }
      if (thrower && !landsOnFloor(w.player.pos.x, w.player.pos.y, 6)) {
        const dx = thrower.pos.x - w.player.pos.x
        const dy = thrower.pos.y - w.player.pos.y
        const d = Math.hypot(dx, dy) || 1
        tx += (dx / d) * 26
        ty += (dy / d) * 26
      }

      // ── body-blocking ──
      //
      // An `intercept` add is stopped by standing in its way; killing it is not
      // the job and for some of them is not even possible. This lived in the
      // targeting loop below, where it added to tx/ty a hundred lines AFTER
      // those were read into the movement input and one tick before they were
      // reset — so it has never moved the bot an inch, and every Coiled Altar
      // cell has carried `Fragment of Malacrass` failures for the life of the
      // project as a result.
      //
      // Nearest one only. A summed attraction to two of them steers to the
      // midpoint and blocks neither, which is the defining failure of a
      // force-field controller and the reason this has to be a choice.
      if (!anchoredTank) {
        let block = null
        for (const a of w.adds) {
          if (!a.alive || a.def.job !== 'intercept') continue
          const d = Math.hypot(a.pos.x - w.player.pos.x, a.pos.y - w.player.pos.y)
          if (!block || d < block.d) block = { a, d }
        }
        if (block) {
          const d = block.d || 1
          tx += ((block.a.pos.x - w.player.pos.x) / d) * 10
          ty += ((block.a.pos.y - w.player.pos.y) / d) * 10
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
          // A heading whose LANDING is on the floor beats one that merely ends
          // on it. Ranked rather than vetoed: when a knock is in the air and no
          // heading saves you, standing still is worse than walking the best of
          // a bad set — and `dot` never exceeds 1, so any survivable heading
          // outranks every doomed one whatever direction the forces wanted.
          const dot = dx * wx + dy * wy + (landsOnFloor(nx, ny) ? 2 : 0)
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
        //
        // Handled with the other movement forces, well above — see the body
        // block there. Adding to tx/ty from HERE was the defect: they have
        // already been read into input.right/left/up/down by this point and are
        // reset to 0 next tick, so the force was computed and discarded on every
        // tick since it was written.
        if (a.def.job === 'intercept') continue
        // Only URGENT adds pull damage off the boss: one whose fuse is running
        // out, or one that still has a shield to break. A bot that shot every
        // add on sight never touched the boss at all on the add-heavy fights —
        // 98% accuracy and 98% boss health, because every shot went into crates.
        //
        // Urgency is TIME TO LEAK, not time on the fuse. An add with a march
        // leaks by ARRIVING — `lenOf(add.pos) < 4` in the engine — and Vashnik
        // says so in as many words: "fuseSec is set clear of the crawl ... so it
        // is ARRIVING that leaks, not a timer running out somewhere else." Read
        // off the fuse alone, a Clotting Venom crawling 40 yards at 1.6 yd/s
        // arrives at t+25 but does not look urgent until t+21, leaving a
        // four-second window to land eight shots; its splits arrive before they
        // ever qualify. The bot was watching the wrong clock on the one fight
        // where the boss file had deliberately moved it.
        const gap = Math.hypot(a.pos.x, a.pos.y) - 4
        const toArrive = a.def.marchSpeed ? Math.max(0, gap / a.def.marchSpeed) : Infinity
        const toFuse = a.def.fuseSec >= 900 ? Infinity : (a.fuse ?? 0) / 1000
        const toLeak = Math.min(toArrive, toFuse)
        const urgent = a.def.fuseSec >= 900 ? false : toLeak < 9 || a.shield > 0
        if (!urgent) continue
        // Hold the second of a pair that must not die together. "Kill it fast"
        // is the wrong reflex on the Burning Venoms — cleaving both down inside
        // the window wipes the raid — so the bot has to be able to stop, or it
        // measures the fight as impossible when it is merely disciplined.
        const w2 = a.def.noSimultaneousDeath
        if (w2 && (w.elapsedMs - (w.addDeathMs?.[a.def.id] ?? -1e9)) < w2.withinSec * 1000) continue
        // Most urgent, not nearest. With several on the floor the nearest is
        // routinely the one with the most time left, so the bot kept re-picking
        // a comfortable target while the one about to leak walked in.
        if (toLeak < td) { td = toLeak; target = a }
      }
      input.firing = true
      input.aim = target ? { x: target.pos.x, y: target.pos.y } : null

      // ── evening out a council ──
      //
      // On a fight where the raid chips whatever you are NOT shooting, your
      // target is the only lever anyone has on the balance between three health
      // pools — and the three have to die together or the survivors are handed
      // abilities that grind the raid down. Aiming at the nearest body is the
      // default and it is exactly wrong here: the nearest is usually the one you
      // have been killing, so the spread only ever widens.
      //
      // Gated on the engine's own warning rather than on a threshold of the
      // bot's, so the instrument and the fight cannot disagree about when to
      // switch. Adds still outrank it — a crate rupturing is sooner than a
      // sync-kill window closing.
      //
      // With no aim the engine fires at the NEAREST body, and on a council that
      // is the one target discipline no competent player has. It is also the one
      // the fight is built to punish: the raid only chips a body down to
      // `focus.hp + chipLag`, so your focus sets the floor everything else is
      // dragged toward. Smeared across three bodies by proximity, that floor
      // never falls, the raid stops helping, and you personally have to deliver
      // three health bars — which is why every role sat on a quarter of the
      // council's health at the enrage regardless of how the numbers were tuned.
      //
      // So: hold the LOWEST, because that is what pulls the floor down and takes
      // the other two with it...
      if (!target && w.boss.alliesChipOffTarget) {
        const live = w.bosses.filter(b => !b.def.untargetable && b.alive)
        const lo = live.length ? Math.min(...live.map(b => b.hp)) : 1
        // ...right down to the bone, and only THEN even them out.
        //
        // Switching away the moment the warning appears looks like obedience and
        // is the most expensive thing the bot can do. The raid only ever drags a
        // body to `focus.hp + chipLag`, so the leader's health IS the floor under
        // the other two: abandon it at 10% and the raid stops chipping at 24%,
        // and the last two health bars are yours alone. Hold the leader at the
        // bone instead and the raid delivers the other two to within a chipLag
        // of it, which is less than half the work and is what "they have to die
        // together" means in practice.
        const evenOut = lo <= 0.04
        let pick = null
        for (const b of live) {
          if (!pick || (evenOut ? b.hp > pick.hp : b.hp < pick.hp)) pick = b
        }
        if (pick) input.aim = { x: pick.pos.x, y: pick.pos.y }
      }

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
      // Spend the damage cooldown. The bot has owned `burst` on the tank and dps
      // bars for the life of the project and has never once pressed it, while
      // the engine TRIPLES its damage for ten seconds and records a scored
      // failure against it for letting a burn window pass unspent. Held for the
      // burn window where the fight declares one, otherwise spent on cooldown.
      if (!w.player.cooldowns.burst) {
        const burn = boss.mechanics.some(m => m.rule.type === 'burnWindow')
        if (!burn || w.burnMs > 0) input.pressed.push('burst')
      }
      if (w.elapsedMs % 900 < TICK_MS) input.pressed.push('dispel', 'interrupt')
    }
    step(w, input, TICK_MS)
    input.pressed.length = 0
    ticks++
    // CASTS=1 names every instance the moment it is created. The one question a
    // timeline raises — did Shell Spin actually fire at 5, 35 and 65 — has no
    // other answer, and reading it out of the per-second dump means guessing.
    if (process.env.CASTS) {
      if (w.bossEnergy < lastEnergy - 1) {
        console.log(`      FEED  t=${(w.elapsedMs / 1000).toFixed(1)}s  bar was ${lastEnergy.toFixed(0)}%`
          + `  empowered=${w.bosses.filter(b => b.empowered).map(b => b.def.id).join(',')}`
          + `  bossHp=${w.bosses.filter(b => !b.def.untargetable).map(b => Math.round(b.hp * 100)).join('/')}`)
      }
      lastEnergy = w.bossEnergy
      let top = lastUid
      for (const i of w.instances) {
        if (i.uid <= lastUid) continue
        if (i.uid > top) top = i.uid
        console.log(`      cast t=${(w.elapsedMs / 1000).toFixed(1)}s  ${i.def.id}`
          + (w.bosses ? ` [energy ${Math.round(w.bossEnergy)}]` : ''))
      }
      lastUid = top
    }
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
/** Every cell's outcome, for the golden file compared at the bottom. */
const cells = {}

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
        cells[`${label}/${boss.key}${side ? '/' + side : ''}/${role}`] = {
          wins,
          cleared,
          // The outcome, not the timing. Survival seconds and boss health drift
          // with any tuning change and would make the golden file a tripwire
          // nobody could read. What a reviewer needs to see is a cell changing
          // STATE, and which mechanic changed its mind about killing you.
          outcome: cleared ? 'KILL' : (res.deathCause || 'enrage'),
          failures: Object.fromEntries(
            res.failures.map(f => [f.name, f.count]).sort((a, b) => a[0].localeCompare(b[0]))),
        }
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

// ── the golden file ──
//
// GOLDEN=write records the current sweep; otherwise it is compared, and any cell
// that changed in EITHER direction fails the run with a non-zero exit.
//
// Until now this script had no assertion and no exit code, `npm test` did not
// match it, and CI never ran it — so nine failing cells sat alongside a green
// build for the life of the project. A number in a report nobody can fail is not
// a check, it is a mood.
//
// Per cell rather than in aggregate, because the aggregate cannot see the two
// things that matter most. A bot change once moved two cells in OPPOSITE
// directions and left the headline at exactly 18/27 — invisible. And no total
// can ever detect a fight getting EASIER, which is the failure mode a trainer
// should fear most.
const GOLD = 'test/playtest.golden.json'
if (process.env.GOLDEN === 'write') {
  writeFileSync(GOLD, JSON.stringify(cells, null, 2) + '\n')
  console.log(`\nwrote ${Object.keys(cells).length} cells to ${GOLD}`)
} else if (!ONLY_BOSS && !ONLY_ROLE && !process.env.SEED && existsSync(GOLD)) {
  const gold = JSON.parse(readFileSync(GOLD, 'utf8'))
  const diffs = []
  for (const key of new Set([...Object.keys(gold), ...Object.keys(cells)])) {
    const a = gold[key]
    const b = cells[key]
    if (!a) { diffs.push(`+ ${key} is new`); continue }
    if (!b) { diffs.push(`- ${key} has gone`); continue }
    if (a.cleared !== b.cleared || a.wins !== b.wins || a.outcome !== b.outcome) {
      diffs.push(`~ ${key}: ${a.outcome} ${a.wins}/3  ->  ${b.outcome} ${b.wins}/3`)
    }
  }
  if (diffs.length) {
    console.error(`\n${diffs.length} cell(s) changed against ${GOLD}:\n  ` + diffs.join('\n  '))
    console.error('\nIf the change is intended, re-record with:  GOLDEN=write npm run playtest')
    process.exitCode = 1
  } else {
    console.log(`\nall ${Object.keys(cells).length} cells match ${GOLD}`)
  }
}
