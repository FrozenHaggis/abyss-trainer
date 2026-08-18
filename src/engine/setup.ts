import type { AddDef, BossDef, MechanicDef, Rule } from './types'

/**
 * What a raid should bring to a boss, derived from the boss.
 *
 * The selector shows three or four of these lines under whichever model is
 * facing the player, and the temptation was to type them out: eight bosses,
 * four lines each, thirty-two sentences and an afternoon. That is exactly the
 * drift `brief.ts` already refused for the same reason — "hand-writing 294
 * instruction lines would guarantee drift between what the briefing says and
 * what the engine scores" — and a setup note is worse than a briefing line when
 * it goes stale, because it is read BEFORE the pull and decides who is in the
 * raid. A hand-typed "two kicks" outliving the mechanic it counted sends people
 * to a fight with the wrong roster.
 *
 * So every line below is counted off `boss.mechanics` and `boss.adds`, and
 * names the mechanic it counted. Retune a fight and the advice retunes with it;
 * delete a mechanic and its line disappears.
 *
 * WHAT THIS IS NOT: a comp optimiser. The sim's raid is fixed at two tanks,
 * four healers and fourteen dps (see `makeAllies` in sim.ts), so nothing here
 * argues for a different one. It answers the narrower question the fixed comp
 * still leaves open — of those twenty bodies, which ones need a button ready,
 * and how many of them have to be somewhere specific when the cast lands.
 */
export interface SetupLine {
  /** The count, as a heading. Two or three words. */
  need: string
  /** Which mechanic demands it and what it does. One sentence. */
  why: string
}

/**
 * "a", "a and b", "a, b and c". Same rule the briefing reads by, plus a dedupe
 * the briefing does not need.
 *
 * The dedupe is not tidiness. Adds are declared per WAVE, so a fight that sends
 * the same body twice declares it twice — Vashnik has two separate Clotting
 * Venom entries — and reading the list straight produced "Clotting Venom,
 * Clotting Venom, Burning Venom and Shrouded Venom", which tells a raid leader
 * there are four kinds of add when there are three.
 */
function listOf(parts: string[]): string {
  const seen = [...new Set(parts)]
  if (seen.length <= 1) return seen[0] ?? ''
  return `${seen.slice(0, -1).join(', ')} and ${seen[seen.length - 1]}`
}

/** `is`/`are` for a list that has already been deduped by `listOf`. */
function agree(parts: string[], one: string, many: string): string {
  return new Set(parts).size === 1 ? one : many
}

/** `n thing` / `n things`, because "1 interrupts" reads as a bug. */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function rulesOf<T extends Rule['type']>(boss: BossDef, type: T) {
  return boss.mechanics.filter(m => m.rule.type === type) as
    (MechanicDef & { rule: Extract<Rule, { type: T }> })[]
}

/** Mechanics that want a specific button pressed, grouped by which button. */
function pressesFor(boss: BossDef, ability: string) {
  return rulesOf(boss, 'press').filter(m => m.rule.ability === ability)
}

function addsWithJob(boss: BossDef, job: AddDef['job']) {
  return (boss.adds ?? []).filter(a => a.job === job)
}

/**
 * The whole setup, most load-bearing first.
 *
 * Order is fixed rather than scored, and it is the order a raid leader assembles
 * a roster in: who tanks it, who is on buttons, who has to stand somewhere, what
 * the floor is doing. The selector shows the first few and the fight's own
 * `blurb` carries the rest, so a fight whose defining problem is its floor must
 * not have that line pushed off the bottom by a routine tank swap — hence
 * `lethalGround` sitting above the ordinary spread note.
 */
export function suggestedSetup(boss: BossDef): SetupLine[] {
  const out: SetupLine[] = []

  // ── who tanks it ────────────────────────────────────────────────────────
  //
  // Every fight in this tier has a `tankSwap`, so the line is really about the
  // number on it: a swap at two stacks is a fight the tanks play together all
  // pull, one at five is a fight they trade twice. Reading `maxStacks` says
  // which without anybody deciding.
  const swaps = rulesOf(boss, 'tankSwap')
  const soaks = rulesOf(boss, 'tankSoak')
  if (swaps.length > 0) {
    const s = swaps[0]
    // A one-stack swap is a different sentence, not a smaller number. "Change
    // hands by 1 stack" reads as though there is slack in it; there is none —
    // the debuff is a taunt on arrival and the co-tank is already moving.
    const clause = s.rule.maxStacks === 1
      ? 'and cannot be held through a second one'
      : `and has to change hands by ${plural(s.rule.maxStacks, 'stack')}`
    out.push({
      need: '2 tanks',
      why: `${s.name} stacks on whoever is holding it ${clause}.`,
    })
  } else if (soaks.length > 0) {
    out.push({
      need: '2 tanks',
      why: `${soaks[0].name} is a tank's to soak, and it fires back at the raid when nobody is standing in it.`,
    })
  }

  // ── who is on a button ──────────────────────────────────────────────────
  //
  // Two sources and they are genuinely different jobs. A `kick` add repeats a
  // cast until somebody stops it, so what it needs is a ROTATION — bodies
  // taking turns. A `press: interrupt` mechanic is one cast on the boss's own
  // clock, which needs somebody watching rather than a rota. Counted together
  // because the roster question is the same, described apart because the
  // assignment is not.
  const kickAdds = addsWithJob(boss, 'kick')
  const kickBodies = kickAdds.reduce((n, a) => n + a.count, 0)
  const kickCasts = pressesFor(boss, 'interrupt')
  if (kickBodies > 0 || kickCasts.length > 0) {
    const parts: string[] = []
    if (kickBodies > 0) {
      const names = kickAdds.map(a => a.name)
      parts.push(`${listOf(names)} ${agree(names, 'repeats a cast', 'repeat a cast')} until kicked, ` +
        `up to ${plural(kickBodies, 'body', 'bodies')} at once`)
    }
    if (kickCasts.length > 0) {
      const names = kickCasts.map(m => m.name)
      parts.push(`${listOf(names)} ${agree(names, 'has', 'have')} to be stopped on the boss itself`)
    }
    // The heading counts CASTERS, not casts, because that is the number a raid
    // leader assigns against: four kinds of add five bodies deep plus two boss
    // casts is seven things that need somebody watching them, and the fact that
    // each will be kicked many times over a pull is the rotation, not the count.
    out.push({
      need: `${plural(kickBodies + kickCasts.length, 'kick target')} on rotation`,
      why: `${listOf(parts)}. Every role in the raid has an interrupt, so this is an assignment rather than a comp problem.`,
    })
  }

  const dispels = pressesFor(boss, 'dispel')
  if (dispels.length > 0) {
    const names = dispels.map(m => m.name)
    out.push({
      need: plural(dispels.length, 'dispel'),
      why: `${listOf(names)} ${agree(names, 'comes', 'come')} off with a dispel — healers and dps both carry one.`,
    })
  }

  const raidCds = pressesFor(boss, 'raidcd')
  if (raidCds.length > 0) {
    const names = raidCds.map(m => m.name)
    out.push({
      need: plural(raidCds.length, 'raid cooldown'),
      why: `${listOf(names)} ${agree(names, 'is', 'are')} unavoidable and wants a cooldown planned onto it rather than reacted to.`,
    })
  }

  // ── who has to be somewhere ─────────────────────────────────────────────
  //
  // Bodies, not buttons. Each of these names a headcount the fight demands at a
  // particular moment, which is the one thing a twenty-man roster can actually
  // get wrong on the way in.
  const bodyDemands: string[] = []
  for (const m of rulesOf(boss, 'groupSoak')) {
    bodyDemands.push(`${m.name} splits between exactly ${plural(m.rule.bodies, 'body', 'bodies')}`)
  }
  for (const m of rulesOf(boss, 'pairUp')) {
    bodyDemands.push(`${m.name} pairs the raid up to ${plural(m.rule.target, 'body', 'bodies')} a marker`)
  }
  for (const m of rulesOf(boss, 'collect')) {
    bodyDemands.push(`${m.name} needs ${plural(m.rule.count, 'pickup')} taken off the floor`)
  }
  if (bodyDemands.length > 0) {
    out.push({ need: 'Soak bodies', why: `${listOf(bodyDemands)}.` })
  }

  const carries = rulesOf(boss, 'carryOut')
  if (carries.length > 0) {
    const edge = carries.filter(m => m.rule.edgeWithin !== undefined)
    const names = carries.map(m => m.name)
    out.push({
      need: `${plural(carries.length, 'debuff')} to walk out`,
      why: `${listOf(names)} ${agree(names, 'has', 'have')} to be carried clear of the group` +
        (edge.length > 0 ? ' and dropped at the rim' : '') +
        '. Anyone can take one, so nobody is exempt from watching for it.',
    })
  }

  const apart = rulesOf(boss, 'keepApart')
  if (apart.length > 0) {
    const a = apart[0]
    out.push({
      need: `${a.rule.minYards} yards apart`,
      why: `${a.name} links whoever is closer than that, so the raid is spread before the pull rather than after the first one lands.`,
    })
  }

  // ── what the floor is doing ─────────────────────────────────────────────
  if (boss.sided) {
    out.push({
      need: 'Split in half',
      why: 'The raid runs as two groups, one per golem, and the two halves never share a mechanic. Decide the split before the pull, not during it.',
    })
  }

  const lethal = rulesOf(boss, 'lethalGround')
  if (lethal.length > 0) {
    out.push({
      need: 'A hole in the middle',
      why: `${listOf(lethal.map(m => m.name))} kills on contact and does not go away. The walkable floor is the ring around it.`,
    })
  } else if (!boss.walled) {
    out.push({
      need: 'No walls',
      why: `The rim of this ${boss.arenaRadius}-yard platform is a drop, and every knock in the fight is aimed at it.`,
    })
  }

  // ── what has to die ─────────────────────────────────────────────────────
  //
  // Last because it is the one thing a raid does by reflex. It earns a line
  // only when the reflex is WRONG — an add that must not be shot, or one that
  // must be blocked rather than killed — or when the waves are frequent enough
  // to be the fight's clock.
  const leave = addsWithJob(boss, 'leave')
  const intercept = addsWithJob(boss, 'intercept')
  if (leave.length > 0) {
    const names = leave.map(a => a.name)
    out.push({
      need: 'Hands off',
      why: `${listOf(names)} must not be damaged. Killing one is the mistake this fight is built around.`,
    })
  }
  if (intercept.length > 0) {
    const names = intercept.map(a => a.name)
    out.push({
      need: 'Bodies in the way',
      why: `${listOf(names)} ${agree(names, 'walks', 'walk')} somewhere they must not reach. Standing in front is the job; shooting is not.`,
    })
  }
  const killers = addsWithJob(boss, 'kill')
  if (killers.length > 0 && boss.addEverySec !== undefined) {
    const names = killers.map(a => a.name)
    out.push({
      need: 'Add control',
      why: `${listOf(names)} ${agree(names, 'arrives', 'arrive')} every ${boss.addEverySec}s and ${agree(names, 'has', 'have')} to be down before the fuse runs out.`,
    })
  }

  return out
}
