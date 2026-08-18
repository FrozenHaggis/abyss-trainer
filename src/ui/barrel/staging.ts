/**
 * Who stands where on each slot of the barrel.
 *
 * Separate from `scripts/fetch-boss-models.mjs`, which knows only which
 * creatures to download. This is the other half of the same decision and it
 * belongs next to the camera rather than next to the downloader: an encounter's
 * cast is a fact about the fight, but how many of them fit in one slot and
 * which one stands at the back is a fact about a 3.0-unit-tall stage seen from
 * six metres away.
 *
 * Four encounters are more than one body. Three of those stage the pair,
 * because the pairing IS the fight — two golems 40 yards apart, two serpents
 * that must be tanked apart, a Soulcoiler with a Hex Lord behind him. The
 * fourth, the Lost Explorers, has a cast of four and stages one: three bodies
 * side by side at a third the height each would teach nothing, so the slot
 * shows First Mate Nama and the name plate carries the rest.
 */
export interface CreatureStaging {
  /** Directory name under `public/models/<boss>/`. */
  id: string
  /**
   * Discard triangles further than this from the model's own centre line,
   * measured in model units on the posed idle.
   *
   * One creature needs it. Ula'tek's wings span 73 units against a 29-unit
   * height, all of it a single submesh with no geoset to switch off, so any
   * rule that fits her whole silhouette into a slot renders the goddess herself
   * at a third the size of the trolls either side. Cutting at 9 keeps the body,
   * the necks and the five heads — 13,940 of her 18,096 triangles — and drops
   * the wings, after which she fits by height like everybody else.
   *
   * A blunt instrument, and only reachable because the cut plane happens to
   * miss everything that matters. It is not a general feature; if a second
   * creature ever needs one, that is the point to go looking for geosets.
   */
  trimHalfWidth?: number
  /**
   * Ranks back from the front, in fitted heights. Omitted means the front rank.
   * Anyone with a `back` is placed behind the rank and is expected to be partly
   * hidden by it — that is what standing behind somebody looks like.
   */
  back?: number
  /** Sideways nudge in fitted heights, for a body that should not be centred. */
  x?: number
}

/**
 * Encounter key to its cast. Order is left to right within a rank.
 *
 * A boss missing from here stages the single creature named by its own
 * `creatures.json`, which is the common case and needs no entry.
 */
export const STAGING: Record<string, CreatureStaging[]> = {
  // Both golems, green on the left and red on the right, which is the order the
  // side picker lists them in and the order they sit in on the boss's own
  // `entities` array. A raid that has only ever seen one of them has not
  // practised this fight, and a slot showing one of them says otherwise.
  sentinels: [
    { id: 'breath' },
    { id: 'blood' },
  ],

  // Both serpents. `tankedApart` on each of them in the boss file is the whole
  // encounter, and it cannot be read off a single snake.
  twinfangs: [
    { id: 'vexhul' },
    { id: 'ithraz' },
  ],

  // The Hex Lord looms behind the Soulcoiler rather than beside him. Nudged off
  // centre so he is not a silhouette directly behind a head, and left at full
  // height so the overlap reads as depth rather than as a smaller creature.
  coiledaltar: [
    { id: 'zuljan' },
    { id: 'malacrass', back: 0.85, x: 0.5 },
  ],

  ulatek: [
    { id: 'ulatek', trimHalfWidth: 9 },
  ],
}
