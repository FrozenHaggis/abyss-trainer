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
    case 'kill':
      return {
        verb: def.shieldHp ? 'BREAK THE SHIELD' : 'KILL IT',
        line: def.shieldHp
          ? 'It carries an absorb. Your damage does nothing at all until that shield breaks, so keep firing through it — then kill the add before its timer runs out.'
          : 'Shoot it down before its timer runs out. Leaving it alive is what hurts the raid here, not standing in the wrong place.',
        yours: true,
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

  // Something you cannot be blamed for still needs an answer, because "is this
  // my problem?" is the first thing a raider asks.
  const notYours = (line: string): RoleBrief => ({ verb: 'STAY CLEAR', line, yours: false })

  switch (def.rule.type) {
    case 'avoid':
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

    case 'beInside':
      return {
        verb: 'GET IN',
        line: def.collective
          ? 'Get into it. The damage is split between everyone struck, so bodies in the shape is what makes it survivable — nobody is blamed individually for this one.'
          : 'Get into the marked shape before it resolves. Being outside it is the failure here, not being inside.',
        yours: mine,
      }

    case 'collect':
      return {
        verb: 'RUN OVER IT',
        line: 'Run over them to clear them. Picking one up is the job — anything still on the floor when the timer runs out goes off on the whole raid.',
        yours: mine,
      }

    case 'carryOut':
      return {
        verb: 'RUN IT OUT',
        line: `You are carrying it. Walk at least ${def.rule.minDistance} yards clear of the group before it expires, drop it there, and come back.`,
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

    case 'tankSwap':
      return role === 'tank'
        ? { verb: 'TAUNT', line: 'Watch the stacks. Taunt it off the other tank before their stacks turn lethal, and expect it back.', yours: mine }
        : notYours('A tank swap. Nothing for you here beyond healing the pair through it.')

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

    case 'raidDamage':
      return role === 'healer'
        ? { verb: 'HEAL THROUGH', line: 'Unavoidable raid damage. There is nothing to dodge — cover it with cooldowns.', yours: false }
        : notYours('Unavoidable raid damage. Nothing to dodge and nothing you can do wrong here.')
  }
}
