import type { BossDef } from '../engine/types'
import { nekzali } from './nekzali'
import { sentinels } from './sentinels'
import { vashnik } from './vashnik'
import { explorers } from './explorers'
import { sszorak } from './sszorak'
import { twinfangs } from './twinfangs'
import { coiledaltar } from './coiledaltar'
import { ulatek } from './ulatek'

// The raid, in encounter order. Adding a boss is a data edit: author the file,
// import it, add it here. A test fails if a boss file exists but is not wired.
export const BOSSES: BossDef[] = [
  nekzali,
  sentinels,
  vashnik,
  explorers,
  sszorak,
  twinfangs,
  coiledaltar,
  ulatek,
]

export function bossByKey(key: string): BossDef | undefined {
  return BOSSES.find(b => b.key === key)
}

/**
 * Which of a boss's mechanics are worth a drill button.
 *
 * Here rather than in App.tsx, where it used to be an inline `.filter`, for two
 * reasons: it is a fact about the boss DATA rather than about the picker's
 * layout, and the picker cannot be imported by a test without dragging React in
 * behind it. The rule below is load-bearing enough on the Twin Fangs to want
 * pinning, so it lives somewhere a test can call it.
 *
 * Three clauses, and the last two need their arguments written down.
 *
 * The first is the old one: a mechanic with no `shape` has nothing to stand in
 * or out of, and a `raidDamage` mechanic is a healing check rather than a thing
 * you practise with your feet. Neither of them makes a rep on its own.
 *
 * The second is the exception to it, and without the exception the Twin Fangs
 * loses two of its six mechanics off the drill row entirely. A shapeless
 * `raidDamage` parent that CHANNELS something you dodge is not a healing check
 * — it is the whole mechanic, and the cast bar is the only part of it that
 * isn't. Caustic Deluge and Stir the Depths are both exactly that: nothing to
 * dodge about the channel, ten circles and six waves respectively coming out of
 * it. Drilling the parent runs the real thing; drilling the child, which the
 * third clause forbids anyway, runs one beat of it.
 *
 * Nek'zali's Soulcoil Ignition is the only other channel in the raid and its
 * four Rites are shapeless too, so this clause adds nothing anywhere else — it
 * asks whether the CHILD is something you play, not whether a channel exists.
 *
 * The third drops any def that ANOTHER def already owns — anything named by a
 * `channel.defId`, a `spawns.defId`, or a `tankSoak`'s `missFires`. Those are
 * not mechanics in their own right, they are the pieces a mechanic is made of,
 * and firing one on its own strips it of the only thing it means:
 *
 *   • a beat of a channel arrives out of nothing. One Caustic Deluge splash is
 *     not Caustic Deluge — the mechanic is ten circles landing faster than they
 *     leave, and one pair of them is a sidestep. Same for a single Stir the
 *     Depths wave, a lone Stone Breaker slam, one Sanguine Storm glob.
 *   • a `spawns` child arrives with no parent to have dropped it. A Congealed
 *     Gore pool on empty floor teaches nothing about carrying an ichor to the
 *     rim, which is the part that is hard.
 *   • a `missFires` child is a PUNISHMENT. Stone Breaker's pushoff throws the
 *     whole raid off the platform and kills the player on every rep, with
 *     nothing to practise, because the mistake it answers happened two seconds
 *     earlier in a mechanic that is not on screen.
 *
 * `missFires` was not in the rule as first written and has to be: `pushoff` is
 * named by nothing else, so without it the one def in the raid that kills you
 * for free ships as a drill button.
 *
 * BLAST RADIUS, because this is not a Twin Fangs change even though the Twin
 * Fangs is what forced it. Seven of the eight bosses lose buttons: Sszorak's
 * residue and cyst, Nek'zali's cultist and cremation, Vashnik's caustic, wave
 * and venom, the Altar's noxious and orb, the Explorers' aftershock and
 * concussive, the Sentinels' livingvenom, Ula'tek's purge. Every one of those is
 * a pool or an add left behind by a parent that still has its own button, so
 * none of that practice is lost — you drill the cast, and the child arrives the
 * way it arrives in the fight.
 */
export function drillableMechanics(boss: BossDef) {
  const owned = new Set<string>()
  for (const m of boss.mechanics) {
    if (m.channel) owned.add(m.channel.defId)
    if (m.spawns) owned.add(m.spawns.defId)
    if (m.rule.type === 'tankSoak') owned.add(m.rule.missFires)
  }
  const byId = new Map(boss.mechanics.map(m => [m.id, m]))
  /** Something you answer with your feet, as opposed to with a cooldown. */
  const played = (m?: BossDef['mechanics'][number]) =>
    !!m && !!m.shape && m.rule.type !== 'raidDamage'

  return boss.mechanics.filter(m =>
    !owned.has(m.id) && (played(m) || (!!m.channel && played(byId.get(m.channel.defId)))))
}
