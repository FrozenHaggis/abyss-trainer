import type { AddDef, MechanicDef, Role } from './types'
import { abilitiesFor, carryOutClauses } from './sim'

/** "a", "a and b", "a, b and c" — one clause list read as a sentence. */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// What a given role is actually supposed to DO about a given mechanic.
//
// Derived rather than authored. There are 98 mechanics and three roles, and
// hand-writing 294 instruction lines would guarantee drift between what the
// briefing says and what the engine scores. The engine already holds every fact
// needed to answer the question — the rule, whose job it is, and whether that
// role even has the button — so the instruction is computed from the same data
// the failure is computed from. They cannot disagree.

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
      // Ground that TRAVELS. "Step out of the marked ground before it lands" is
      // the instruction for a circle that appears, waits and goes off, and it is
      // wrong in both halves for something that is already live and coming at
      // you: there is no moment it lands, and the ground you are standing on is
      // safe right up until it is not. Three mechanics in the raid are this —
      // the Twin Fangs' waves, Sszorak's Tempest vortices and the Coiled Altar's
      // Axegrinder — and all three were being briefed as puddles.
      //
      // What the raider needs is the one thing a still picture cannot give them:
      // read the heading, and judge the floor by where the thing is GOING.
      if (def.driftSpeed) {
        return {
          verb: 'READ THE DRIFT',
          line: def.lethal
            ? 'This one is moving, and it kills outright. Do not judge it by where it is — judge it by where it is heading, and clear the whole lane in front of it rather than sidestepping the shape.'
            : 'This one is moving. Do not judge it by where it is — judge it by where it is heading: step across its path early, or in behind one that has already gone past, and never let it walk onto you while you are looking at something else.',
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

    case 'shedStack':
      // Three sentences, and the order of them is the mechanic: it gives a
      // stack back, you may only take one, and a second one kills.
      //
      // The last clause is the one that has to be unambiguous. Every other soak
      // in the raid rewards more bodies for longer, and a raider who has learned
      // that habit will stand in this until it stops — which is the most common
      // first blood on the real fight. So the sentence says outright that the
      // right answer is to walk out and let the next group have theirs.
      //
      // And it says what to do at zero. The engine's prompt is silent there on
      // purpose, so the panel is the only place a raider can find out WHY they
      // are being told nothing: a bite spent carrying no stacks buys nothing and
      // costs them the cast, and the stack they pick up two mechanics later is
      // then theirs until the next one.
      return {
        verb: 'IN ONCE, THEN OUT',
        line: `The only thing in the fight that takes a stack back, and it takes exactly ${def.rule.amount === 1 ? 'one' : def.rule.amount}. It bites ${def.rule.bites} times without moving, so the raid splits into ${def.rule.bites} groups and each takes one bite — get in for yours, get straight out, and stay out for the other two. Being in it a second time on the same cast kills you outright. If you are carrying nothing, do not go in at all: you would burn your one bite for a stack you do not have and have no way to shed the next one.`,
        // Nobody is ever blamed for staying out of it — that is correct play for
        // two bites in three — so `roles` here is about who the fight expects to
        // be in the rota at all, and every body in the raid carries the counter.
        yours: def.roles.includes(role),
      }

    case 'collect':
      return {
        verb: 'RUN OVER IT',
        line: 'Run over them to clear them. Picking one up is the job — anything still on the floor when the timer runs out goes off on the whole raid.',
        yours: mine,
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
      //
      // The clauses are read out of the engine rather than written here, and
      // that is the whole point of `carryOutClauses`. This panel is read before
      // the pull, the prompt is shouted during it, and the resolve decides
      // whether you failed — three accounts of one rule, which on Coiling Ichor
      // had already drifted apart: the mechanic demands a rim drop and a spread
      // as well as a distance, and a briefing naming only the distance was
      // describing a different mechanic from the one being scored.
      return {
        verb: 'RUN IT OUT',
        line: `You are carrying it. Before it expires be ${listOf(carryOutClauses(def.rule).map(c => c.says))}, drop it there, and come back.`,
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

    case 'holdMelee':
      // The tank's half and everybody else's half are different sentences, and
      // the second one is not "nothing to do here". A leash nobody can help with
      // is still the fastest way this fight ends: the bar empties in about four
      // seconds, which is inside a healer's reaction time, so the only useful
      // thing the other eighteen bodies can know is what the sudden collapse
      // was — and, for the raid, not to drag their tank out of position chasing
      // a soak or a stack.
      //
      // The yardage is spoken plainly rather than dressed up as "melee range",
      // because it is not melee range and a tank told to be in melee would try
      // to stand on a serpent that is coiled in the acid.
      return role === 'tank'
        ? {
            verb: 'STAY ON IT',
            line: `Do not leave it. Anything further than about ${def.rule.maxYards} yards from the one you are holding and it stops attacking you and starts on the raid instead — there is no cast to read, no cooldown that answers it, and the raid bar is gone in seconds. Sidestep on the spot, and if something throws you, walk straight back before you do anything else.`,
            yours: mine,
          }
        : notYours(`The tanks are welded to their serpents — anything past about ${def.rule.maxYards} yards and it turns on the raid instead. Nothing here is yours except not pulling them off it: never make a tank chase you, and expect the bar to fall off a cliff rather than sag if one of them is dragged out.`)

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
      // A knock the rim catches and a knock it does not are two different
      // mechanics wearing one rule, and one line cannot serve both. "Brace" is
      // sound advice for a shove that ends on the floor and it is how you die to
      // the other kind: bracing means standing still, and standing still is the
      // failure when half the room's landings are in the acid.
      //
      // WHERE the safe half of the floor is stays in the boss file. It is a fact
      // about one polygon — this rule is also Ula'tek's Circling Prey, on a
      // completely different room — so the derived line says the band exists and
      // `MechanicDef.brief` says where it is. That is exactly the split the
      // override was added for.
      return override({
        verb: def.offPlatform ? 'GET OFF THE EDGE' : 'BRACE',
        line: def.offPlatform
          ? 'This one does not stop you at the edge. Everyone is thrown the same distance directly away from the caster, so where you are standing when it goes off decides whether you land on the floor or in what is under it — and a large part of this room has nothing under it. Move BEFORE the cast finishes: get well inside, on the caster\'s side of the room, and leave yourself the length of the push between you and the far edge.'
          : 'You are going to be knocked. Position so the push carries you across the floor rather than off the edge.',
        yours: mine,
      })

    case 'tankSoak':
      // Only one person in the raid can answer this, and the other nineteen
      // being told to stay off it is half the mechanic — an unsoaked one does not
      // merely go unhealed, it wipes the group.
      return role === 'tank'
        ? {
            verb: 'SOAK THEM ALL',
            line: 'These are yours, and only yours — you have to be standing in every one of them as it lands, in the order they appear. They are laid out around the boss so you can read the whole run off the first one: walk the line, do not chase it. Miss a single pool and nobody is struck, which is far worse than you taking all three.',
            yours: mine,
          }
        : notYours('One tank eats every one of these. Get out of them and stay out — a body in the swirly is standing where the soak has to happen, and it takes the slam for nothing.')

    case 'syncKill':
      // The window is spoken, and it is spoken as a wipe rather than as damage.
      // "Leaving one behind enrages it" is true and useless: it describes a
      // debuff on a boss, when what the raider needs to know is that the pull is
      // over. The number comes off the rule so the sentence cannot drift from
      // what the engine counts.
      return {
        verb: 'EVEN THEM OUT',
        line: `They do not share a health pool, and the survivor's rage has no cap. Keep the bars level all the way down and kill them together — more than ${def.rule.withinSec} seconds between the two deaths and the one still standing wipes you, however healthy the raid was a moment earlier.`,
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

    case 'raidDamage': {
      // The fight's stack counter. Everything else in this branch is a number a
      // healer covers; this one is a resource every raider spends the pull
      // managing, and it kills the body carrying it at a stated count.
      //
      // `yours` is true for all three roles regardless of the def's own `roles`,
      // and that is not an oversight. `roles` decides who gets BLAMED, and
      // nobody is ever blamed for a counter — but every body in the raid carries
      // one and every body dies at the cap, so a dps reading "not your job" above
      // the thing that is about to kill them would be the panel lying.
      const cap = def.counter
      if (cap) {
        return {
          verb: 'WATCH YOUR STACKS',
          line: `Permanent, and it never falls off on its own — ${cap.lethalAt} stacks kills you. Everything this fight does hands them out: standing in something, soaking a pickup, a globule nobody swept, the cast that summons the adds. Only one ability in the whole fight takes one back, and only one at a time, so treat every avoidable stack as one you cannot get rid of.`,
          yours: true,
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
      // A channel is a run of casts, not a cast.
      //
      // Caustic Deluge is the case that forced this: dps: 0 on the parent, so it
      // fell into the branch below and the panel said "this does no damage on
      // its own — it multiplies everything else", which is the Soulcoil stack
      // text and describes a completely different thing. What the cast bar
      // actually means is that five separate deliveries are coming, and the one
      // you are looking at is the first of them.
      //
      // Note what this does NOT say: nothing about how long a circle sits inert
      // before it starts to bite. That is a floor telegraph, it is drawn and
      // never written down, and this file must not learn the field's name — the
      // rule is pinned by a test that greps this file for it.
      if (def.channel) {
        const beat = def.channel.everyMs / 1000
        return {
          verb: 'IT COMES IN BEATS',
          line: `The cast bar is not the hit. It opens a channel that lands ${def.channel.count} separate times, one every ${beat === Math.round(beat) ? beat : beat.toFixed(1)}s — so plan for the whole run of them rather than for the moment the bar fills, and do not settle anywhere until the last one is down.`,
          yours: def.roles.includes(role),
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
  }
}
