import type { AddDef, MechanicDef, Role } from './types'
import { abilitiesFor } from './sim'

// What a given role is actually supposed to DO about a given mechanic.
//
// Derived rather than authored. There are 98 mechanics and three roles, and
// hand-writing 294 instruction lines would guarantee drift between what the
// briefing says and what the engine scores. The engine already holds every fact
// needed to answer the question — the rule, whose job it is, and whether that
// role even has the button — so the instruction is computed from the same data
// the failure is computed from. They cannot disagree.

/**
 * Compile-time exhaustiveness, deliberately inert at runtime.
 *
 * The dispatch below is the whole reason this file exists: a rule type is
 * mapped to the sentence a raider reads on a paused screen. A 27th `Rule`
 * variant that fell through it would either crash the panel or, worse, inherit
 * somebody else's instruction — and a briefing that confidently tells you the
 * wrong thing is the one failure mode a trainer cannot afford. It fails the
 * build here instead.
 *
 * It does not throw. The briefing is on screen mid-pull with the fight held
 * behind it, so the fallback is a sentence that is never wrong rather than a
 * blank panel.
 */
function exhaustive(_never: never): void {}

/** The imperative a role should hear for this mechanic, and whether it is theirs. */
export interface RoleBrief {
  /** Two or three words: the thing to do. Also what the voice says. */
  verb: string
  /** One sentence of instruction, specific to this role. */
  line: string
  /** False when this mechanic is not scored against this role. */
  yours: boolean
}

/**
 * The same question for an add.
 *
 * Adds announce through the same channel as mechanics, and without this they
 * inherited a generic "MOVE OUT" — which is wrong for all four of their jobs
 * and actively dangerous for the one where shooting it is the failure.
 */
export function briefForAdd(def: AddDef, role: Role): RoleBrief {
  const canKick = abilitiesFor(role).includes('interrupt')
  switch (def.job) {
    case 'kill': {
      // An add that walks somewhere is racing a distance, not a timer, and
      // saying "before its timer runs out" to somebody watching one cross the
      // room describes a clock they cannot see. What they can see is how far it
      // has left to go.
      const marching = def.marchSpeed !== undefined
      const deadline = marching ? 'before it reaches the middle' : 'before its timer runs out'

      // Two that must not die together. "Kill it fast" is the WRONG reflex, so
      // the briefing has to say so out loud — this is the same failure as the
      // Restless Amani being told to block, inverted.
      if (def.noSimultaneousDeath) {
        return {
          verb: 'STAGGER THE KILL',
          line: `There are two, and killing them within ${def.noSimultaneousDeath.withinSec} seconds of each other wipes the raid. Bring one down, hold the second deliberately, and kill them away from the group.`,
          yours: true,
        }
      }

      // One that becomes several. Where it dies matters more than how fast.
      if (def.splits) {
        return {
          verb: 'KILL IT EARLY',
          line: `It splits into ${def.splits.count} on death and both halves carry on walking, so kill it early and far out. Finishing it near the middle just puts the pieces there instead.`,
          yours: true,
        }
      }

      return {
        verb: def.shieldHp ? 'BREAK THE SHIELD' : 'KILL IT',
        line: def.shieldHp
          ? `It carries an absorb and your damage does nothing at all until that shield breaks. Keep firing through it, then kill the add ${deadline}.`
          : `Shoot it down ${deadline}. Leaving it alive is what hurts the raid here, not standing in the wrong place.`,
        yours: true,
      }
    }
    case 'kick':
      return canKick
        ? { verb: 'KICK IT', line: 'It casts on a cycle. Interrupt every cast — watch the ring closing around it and press your kick before it completes.', yours: true }
        : { verb: 'STAY CLEAR', line: 'Someone with an interrupt covers this one. Keep doing your own job through the casts.', yours: false }
    case 'intercept':
      return {
        verb: 'BLOCK IT',
        line: 'It is walking somewhere it must not reach. Stand in its path to stop it — killing it is not the job here.',
        yours: true,
      }
    case 'leave':
      return {
        verb: 'DO NOT TOUCH',
        line: 'Leave it completely alone. Do not shoot it, and keep it out of the path of anything else that lands — destroying one is the failure, not a kill.',
        yours: true,
      }
  }
}

export function briefFor(def: MechanicDef, role: Role): RoleBrief {
  const kit = abilitiesFor(role)
  const mine = def.roles.includes(role) && !def.collective
  // How many copies a narrow fan throws. Zero on everything that is not one,
  // including Tempest's nine vortices — a fan that goes all the way round has
  // no gaps to aim for and no front to be behind, so it is not this shape.
  //
  // Gated on `line` as well as on `fanDeg`, so this and the renderer's lane
  // pass agree about what a lane is. A briefing that promised gaps the canvas
  // was not drawing would be the two halves of the same mechanic disagreeing,
  // which is the failure this whole file exists to prevent.
  const fanned = def.fanDeg !== undefined && def.shape?.kind === 'line' ? (def.count ?? 0) : 0

  // An authored line wins over the derived one, but only the line — the verb
  // still comes from the rule so the spoken vocabulary stays the same across
  // every fight. See MechanicDef.brief for when this is justified.
  const override = (b: RoleBrief): RoleBrief =>
    def.brief ? { ...b, line: def.brief } : b

  // Something you cannot be blamed for still needs an answer, because "is this
  // my problem?" is the first thing a raider asks.
  const notYours = (line: string): RoleBrief => ({ verb: 'STAY CLEAR', line, yours: false })

  switch (def.rule.type) {
    case 'avoid':
      // "Before it lands" describes a telegraph resolving. A permanent pool has
      // already landed and is never going anywhere — several of these spawn on
      // top of you and then stay for the rest of the pull, so promising the
      // floor will clear itself is the opposite of the lesson.
      if (def.permanent) {
        return {
          verb: 'MOVE OUT',
          line: 'Get off it and stay off it. This ground does not expire — it is part of the floor for the rest of the pull, and the room only gets smaller from here.',
          yours: mine,
        }
      }
      // A fanned `line` is not one shape to step out of.
      //
      // `count` copies leave the caster at once inside `fanDeg`, they keep
      // travelling, and the floor between two of them is safe — so WHICH WAY
      // you move is the entire mechanic, and "move out" is true of every
      // direction including the one that kills you. Backing away is along the
      // lane and the lane is quicker than a player; across is two yards.
      if (fanned > 1 && def.fanDeg !== undefined) {
        return {
          verb: 'MIND THE LANES',
          line: `${fanned} of them leave at once, fanned across the ${Math.round(def.fanDeg)} degrees in front of the caster, and they keep going. Step SIDEWAYS into the gap between two lanes — backing away leaves you in one, and it is faster than you are. Behind the caster is the safest floor in the room.${def.lethal ? ' This one kills outright.' : ''}`,
          yours: mine,
        }
      }
      return {
        verb: 'MOVE OUT',
        line: def.lethal
          ? 'This one kills outright. Get out of the marked ground before it lands — you will not be healed through it.'
          : 'Step out of the marked ground before it lands. Taking it is survivable, but it is damage your healers have to make up.',
        yours: mine,
      }

    case 'lethalGround':
      return {
        verb: 'STAY OFF IT',
        line: 'This ground kills on contact and it never goes away. Treat it as a hole in the floor rather than damage to survive — do not clip the edge of it, and do not let a knockback put you in it.',
        yours: mine,
      }

    case 'beInside': {
      // An annulus is a RANGE BAND, not a soak. "GET IN" sends a tank sprinting
      // toward the thing they are supposed to be running away from: Possession
      // Barrage is scored on being outside an inner ring, and its outer edge is
      // wider than the room, so the only reachable failure is standing close.
      if (def.shape?.kind === 'annulus') {
        return {
          verb: 'RUN OUT',
          line: `Get more than ${def.shape.inner} yards away before it fires. It hits harder the less distance it has to travel, and there is no such thing as too far.`,
          yours: mine,
        }
      }
      return override({
        verb: 'GET IN',
        line: def.collective
          ? 'Get into it. The damage is split between everyone struck, so bodies in the shape is what makes it survivable — nobody is blamed individually for this one.'
          : 'Get into the marked shape before it resolves. Being outside it is the failure here, not being inside.',
        // `collective` means "never name an individual in the debrief", NOT
        // "not your job". Conflating the two headed the panel "Not your job"
        // directly above an instruction to get into it — on the one mechanic in
        // the fight that is cleared by bodies turning up. The line already
        // carries the no-blame clause; the header should not contradict it.
        yours: def.roles.includes(role),
      })
    }

    case 'collect': {
      // What a miss actually costs, taken from the fight's own number rather
      // than described in one sentence for every fight that has this shape.
      // "Goes off on the whole raid" is true of a droplet that chips the bar
      // and of a crate where three left standing end the pull, and on the
      // second one it is useless — a raider cannot tell an errand from the
      // thing that decides the night.
      const miss = def.missCost ?? 0
      const fatal = miss > 0 ? Math.max(1, Math.ceil(1 / miss)) : 0
      const cost = fatal > 0 && fatal <= 4
        ? `Every one still standing when the window closes takes a hard bite out of the raid bar, and ${fatal} of them is the pull.`
        : 'Anything still on the floor when the timer runs out goes off on the whole raid.'
      // Not everybody can leave to sweep. Where a fight says so, "not your job"
      // printed directly above an instruction to run over them is the same
      // contradiction `beInside` records below, pointing the other way.
      if (!def.roles.includes(role)) {
        return notYours(
          `${role === 'tank'
            ? 'You are holding a boss and never leave it, so the sweep belongs to everybody else'
            : 'This half is assigned to somebody else'}. ${cost} Watch the window close rather than the floor — it is the one thing here you can lose without ever having been able to touch it.`,
        )
      }
      return {
        verb: 'RUN OVER IT',
        line: `Run over them to clear them. Picking one up is the job and it is never scored against you. ${cost}`,
        yours: mine,
      }
    }

    case 'carryOut':
      // A carry with a destination is a tool, not a liability.
      if (def.carryTarget) {
        return {
          verb: 'RUN IT OUT',
          line: `You are carrying it. Walk it onto ${def.carryTarget} and let it expire there — that is what it is for, not simply getting it away from people.`,
          yours: mine,
        }
      }
      // Measured from the MIDDLE OF THE ROOM, not from the raid. The engine
      // checks distance from the arena centre, and on the fights that have a
      // lethal pool in the middle "away from the group" and "away from the
      // centre" can point in opposite directions — so the old wording could
      // send a carrier straight at the thing that kills on contact.
      return {
        verb: 'RUN IT OUT',
        line: `You are carrying it. Get at least ${def.rule.minDistance} yards out from the middle of the room before it expires, drop it there, and come back.`,
        yours: mine,
      }

    case 'press': {
      const ab = def.rule.ability
      if (!kit.includes(ab)) {
        return notYours(`Someone else covers this — ${ab} is not on your bar. Keep doing your own job through it.`)
      }
      if (ab === 'interrupt') {
        return { verb: 'KICK IT', line: 'Interrupt the cast. Press your kick before the cast bar finishes.', yours: mine }
      }
      if (ab === 'dispel') {
        return { verb: 'DISPEL', line: 'Dispel it. Clear the debuff before it expires on whoever has it.', yours: mine }
      }
      return { verb: ab.toUpperCase(), line: `Press ${ab} inside the window.`, yours: mine }
    }

    case 'faceAway':
      return role === 'tank'
        ? { verb: 'POINT IT AWAY', line: 'You are holding it. Keep the cone pointed away from the raid — turn the boss, do not move the raid.', yours: mine }
        : notYours('A tank cone. Stay out of the front of the boss and let the tank aim it.')

    case 'aimAway':
      // Both halves in one line, because which half you get is decided at cast
      // time and a raider needs to know both before it lands. A tank only ever
      // gets the second half — a fixate never picks them — so they are told the
      // dodge and nothing else, rather than an instruction they cannot be given.
      return role === 'tank'
        ? {
            verb: 'MOVE OUT',
            line: 'It never marks a tank. Somebody else is aiming this one — read which way the line is pointing and keep yourself and your serpent out of it.',
            yours: mine,
          }
        : {
            verb: 'POINT IT AWAY',
            line: 'If it marks you, the line fires from the caster straight through you — so where you stand is where it goes. Walk out to the edge of the group and put it over empty floor, and keep walking, because it follows you until it fires. Nobody blames you for being marked; they blame you for what was standing behind you. If it marks someone else, just get off the line.',
            yours: mine,
          }

    case 'tankSwap':
      if (role !== 'tank') return notYours('A tank swap. Nothing for you here beyond healing the pair through it.')
      // "Watch the stacks" is wrong advice when the answer is one. A tank told
      // to watch a count climb will hold through a second application, which on
      // a swap-on-every-cast mechanic is precisely the failure.
      return def.rule.maxStacks <= 1
        ? { verb: 'TAUNT', line: 'Taunt on every application. There is no stack count to sit on here — one is already too many, so the pair trade it back and forth all pull.', yours: mine }
        : { verb: 'TAUNT', line: `Watch the stacks. Take it off the other tank at ${def.rule.maxStacks} before what it does to their healing gets away from them, and expect it straight back.`, yours: mine }

    case 'drainNearest':
      // The only mechanic in the raid where a tank's footwork picks what
      // everybody else has to deal with, so the tank's line names the choice and
      // everyone else's names the tell. "Not yours" here does not mean "ignore
      // it" — the pair the boss is standing between IS the raid's next two
      // debuffs, and reading it early is how the raid gets ahead of them.
      return role === 'tank'
        ? {
            verb: 'WALK HIM ROUND',
            line: `He drinks from the ${def.rule.count} altars nearest him, so where you park him picks which adds spawn and which debuffs land. Keep walking him to a fresh pair — draining the same altar twice running stacks its Infusion and empowers both.`,
            yours: mine,
          }
        : notYours('The tank picks the pair by where he stands. Watch which two altars he is nearest — those are the two infections about to go out.')

    case 'trail':
      return role === 'healer'
        ? {
            verb: 'KEEP MOVING',
            line: 'It drops a pool under whoever is carrying it. Keep walking when it is on you, and put a heal on anyone else who has it — a heal ends it early, which is the only thing that shortens it.',
            yours: mine,
          }
        : {
            verb: 'KEEP MOVING',
            line: `It drops a pool under you every ${Math.round(def.rule.everyMs / 1000)} seconds until it falls off. The ground you leave behind is the problem, not the damage — keep walking so the trail lands where nobody needs to stand, and expect a healer to cut it short.`,
            yours: mine,
          }

    case 'keepApart':
      return role === 'tank'
        ? { verb: 'PULL THEM APART', line: `Hold them at least ${def.rule.minYards} yards apart. Let them close and both gain 99% damage reduction — your damage stops mattering.`, yours: mine }
        : notYours('The tanks hold these apart. If they close, your damage does nothing until they are split again.')

    case 'pairUp':
      return {
        verb: 'FIND YOUR PARTNER',
        line: `Your orbs and theirs have to add up to exactly ${def.rule.target} green between you. Run into the player whose count completes yours — the wrong one kills you where you stand, and so does letting it expire.`,
        yours: mine,
      }

    case 'burnWindow':
      return kit.includes('burst')
        ? { verb: 'BURN IT', line: 'This is the burn window. Press your cooldown now — it is the only stretch where your damage counts double.', yours: mine }
        : notYours('A burn window for the damage dealers. Keep the raid up so they can use it.')

    case 'survive':
      return {
        verb: 'BRACE',
        line: 'You are going to be knocked. Position so the push carries you across the floor rather than off the edge.',
        yours: mine,
      }

    case 'syncKill':
      return {
        verb: 'EVEN THEM OUT',
        line: 'They do not share a health pool. Keep the bars level and kill them together — leaving one behind enrages it.',
        yours: mine,
      }

    case 'combo':
      return {
        verb: 'BRACE — FLURRY',
        line: `${def.rule.parts.length} attacks back to back, in an order that changes every time. Nothing here is dodged on reflex — read which one is winding up and answer that one, because the next is already on its way.`,
        // A window marker. The ability data says outright that it "never
        // produces a failure", so nobody is ever scored on the container — only
        // on the five real abilities it deals out.
        yours: false,
      }

    case 'groupSoak':
      if (role === 'tank') {
        return {
          verb: 'AIM IT AT A GROUP',
          line: `The cone comes out of his face and his face follows you, so where you stand is which group eats it. Put it on the group that is NOT carrying a Gash — the same crowd twice takes a second one and dies where they stand.`,
          yours: true,
        }
      }
      return override({
        verb: 'IN OR OUT — CHECK YOUR GROUP',
        line: `It needs ${def.rule.bodies} bodies to split between, so get in when it is called on your group. When it is not, get well clear: everyone struck takes a Gash, and a second Gash on top of a live one kills. Nobody is named for the soak count — it is measured per cast.`,
        yours: def.roles.includes(role),
      })

    case 'stackingDot':
      return {
        verb: 'ONE AT A TIME',
        line: `It lasts long enough that a second application lands on top of the first, and ${def.rule.maxStacks} kills. This is why the two groups alternate — not politeness, arithmetic.`,
        yours: mine,
      }

    case 'windPair':
      return {
        verb: 'LINE UP WITH YOUR OPPOSITE',
        line: `Everyone is given an arrow. When it expires you are thrown that way ${def.rule.pushYards} yards, and two raiders thrown into each other cancel out and neither moves. Find the raider whose arrow points back at yours and stand on their line — anyone left unpaired goes over the edge.`,
        yours: mine,
      }

    case 'feed':
      // A destination, not a distance. Every part of the decision is WHICH boss,
      // so the line has to say that the choice is permanent and that a boss which
      // has already eaten will refuse it — a raider who does not know that reads
      // a rejected feed as a bug and stops trying.
      //
      // Whoever is not searching never carries one, and what they lose by that
      // is the CHOICE rather than the reset: an ally that finds it feeds by a
      // fixed order and the bar empties either way. Saying so is the difference
      // between a mechanic happening to you and a mechanic you are watching.
      if (!def.roles.includes(role)) {
        return notYours('You will not be the one carrying it. Whoever finds it feeds a boss on a fixed order and the bar empties just the same — what you lose is the pick, not the reset. Watch which one lights up, because its extra ability is what you are about to be playing against for the rest of the pull.')
      }
      return {
        verb: 'FEED A BOSS',
        line: role === 'healer'
          ? 'Walk the fish into a boss that has not eaten one. It empties the bar — that reset is your entire reprieve, and there are only three of them in the pull — and permanently empowers whatever it feeds, so pick deliberately.'
          : 'Walk the fish into a boss that has not eaten one. It resets the bar and empowers what it feeds — pick deliberately. One that is already empowered simply refuses it and you keep carrying it.',
        yours: mine,
      }

    case 'polarity':
      // Tanks are never handed an element, and the pools are not damage, so the
      // honest tank instruction is "stay off both" rather than any version of
      // dodge. Everyone else gets the trade, because the trade is the mechanic.
      if (role === 'tank') {
        return notYours('Tanks are never given an element. Stay out of both pools — standing in the wrong one does nothing for you and takes the cure off the raider who needed it.')
      }
      return {
        verb: 'OPPOSITE POOL',
        line: 'You are given Fire or Frost and you drip a pool of your OWN element wherever you walk. The only thing that takes it off you is standing in a pool of the OTHER one, so find the raider carrying the opposite and trade ground. Still carrying it when the next volley lands detonates on you, and that one kills.',
        // Same call as `beInside`: `collective` means "never name an individual
        // in the debrief", not "not your job". The volley is disclaimed; being
        // told it is not yours directly above an instruction to trade pools would
        // contradict the line it sits on.
        yours: def.roles.includes(role),
      }

    case 'elementPool':
      if (role === 'tank') {
        return notYours('Tanks are never given an element, so neither pool has anything to say to you. Keep out of both and hold your boss where the carriers can meet.')
      }
      return {
        verb: 'OPPOSITE POOL',
        line: `This is a pool of ${def.rule.element === 'fire' ? 'Fire' : 'Frost'}. It cures the raider carrying ${def.rule.element === 'fire' ? 'Frost' : 'Fire'} and does nothing whatever for anybody else — your cure is the pool of the element you are NOT carrying, and standing in your own is a wasted run.`,
        yours: def.roles.includes(role),
      }

    case 'launchPad':
      // Touching one is always correct play and can never be scored. Saying so
      // matters: every other contact hazard in this raid punishes you, and a
      // raider who reads a mushroom as one more circle stays on the floor and
      // dies to the wave.
      return {
        verb: 'GET AIRBORNE',
        line: `Run over a mushroom. It throws you into the air for ${(def.rule.launchMs / 1000).toFixed(0)} seconds, and being airborne is the only thing Blast Wave passes under — touching one is never a mistake, so take one early rather than late.`,
        yours: mine,
      }

    case 'wave':
      return {
        verb: 'GET AIRBORNE',
        line: 'A ground-level front that crosses the whole room from the bomb. You do not outrun it and there is nowhere on the floor to stand — be off the floor on a Bouncy Mushroom when it arrives.',
        yours: mine,
      }

    case 'raidDamage': {
      // The one raidDamage anybody has a dial on. Nothing about it can be
      // failed — the target is not at fault for being chosen — but how far they
      // are standing decides how big it lands on everybody else, and a mechanic
      // with a dial nobody is told about is a mechanic nobody plays.
      //
      // The distance is measured from the RAID, not from the caster. That is
      // the mechanic: she blinks onto the marked player and the arrival catches
      // whoever is standing near them, so the job is to be away from PEOPLE.
      // Written as distance from the boss, the line quietly endorsed running
      // straight through the melee stack to get behind him — which does not
      // reduce the hit by a single point and drops it on everybody.
      if (def.rule.falloff) {
        const f = def.rule.falloff
        return {
          verb: 'RUN FAR',
          line: `The marked player gets landed on and the raid eats the arrival — and the distance that counts is from the GROUP, not from the boss. The further the marked player is from everybody else, the smaller it lands, down to ${Math.round(f.farMultiplier * 100)}% of it at ${f.farYards} yards. Running around the boss while staying inside the raid changes nothing. If it is on you, take it to empty floor; if it is not, watch that whoever has it does.`,
          yours: def.roles.includes(role),
        }
      }
      // A proximity aura is the one raidDamage that IS positional. Both Marks
      // carry a radius, stack forever, and stack from EACH golem you are inside
      // — so "nothing to dodge and nothing you can do wrong" was the exact
      // opposite of the fight's central lesson, printed on the panel that
      // teaches it.
      const prox = def.proximityStack
      if (prox) {
        return {
          verb: 'MIND THE RANGE',
          line: `You collect a stack every ${Math.round(prox.everySec)} seconds from every source you are within ${prox.radius} yards of, and they never fall off. Stay inside your own and outside the other — carrying both costs exactly double for the rest of the pull.`,
          yours: true,
        }
      }
      // A cast that summons is not a cast you answer — it is a cast you read.
      // Nothing about it can be failed, so "nothing you can do wrong here" is
      // technically true and completely useless: what it leaves on the floor is
      // the entire mechanic, and the raider needs to be looking at the spawn
      // point before the bodies are there rather than after.
      if (def.summons) {
        return {
          verb: 'ADDS INCOMING',
          line: 'The cast itself cannot be dodged or stopped — what matters is what it leaves behind. Watch where they surface and get on them immediately: every one still alive keeps casting, so a slow kill is not a slow kill, it is another mechanic on the raid.',
          yours: true,
        }
      }
      // A counter with no damage of its own. Saying "heal through it" invites a
      // healer to spend a cooldown on something that does nothing by itself.
      if (def.rule.dps === 0) {
        return {
          verb: 'WATCH THE STACKS',
          line: 'This does no damage on its own — it multiplies everything else the fight does to you, and it never falls off. The count only climbs when something the raid was supposed to stop gets through.',
          yours: false,
        }
      }
      return role === 'healer'
        ? { verb: 'HEAL THROUGH', line: 'Unavoidable raid damage. There is nothing to dodge — cover it with cooldowns.', yours: false }
        : notYours('Unavoidable raid damage. Nothing to dodge and nothing you can do wrong here.')
    }

    default:
      exhaustive(def.rule)
      // Unreachable while every variant above is named, and a sentence rather
      // than a throw for the reason given on `exhaustive`. It is also the only
      // line in this file that is safe to be wrong about: it claims nothing.
      return notYours('Nothing here is scored against you. Keep doing your own job through it.')
  }
}
