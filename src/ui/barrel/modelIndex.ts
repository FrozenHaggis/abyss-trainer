/**
 * Is the boss art here, and who is on each slot?
 *
 * Its own module, with nothing imported into it, and that emptiness is the
 * point. The answer decides whether the app ever touches three.js at all, so it
 * has to be answerable from the main bundle — if this lived next to the loader
 * it would drag WebGL, the M2 parser and a BLP decoder into the first script
 * every visitor downloads, just to ask a yes/no question. `BossBarrel` imports
 * the barrel dynamically once this says yes.
 */

/** Vite serves `public/` at the root, under whatever base the build was given. */
export const MODEL_ROOT = `${import.meta.env.BASE_URL}models/`.replace(/\/{2,}/g, '/')

/**
 * Every binary is here, named by FileDataID, with no per-creature directories.
 * A FileDataID is unique across Blizzard's filesystem, so two creatures needing
 * the same file share one copy rather than colliding.
 */
export const FILE_ROOT = `${MODEL_ROOT}files/`

/** One creature, as recorded by `scripts/fetch-boss-models.mjs`. */
export interface CreatureEntry {
  id: string
  /** The creature this actually is, which is not the encounter's parody name. */
  name: string
  npc: number
  displayId: number
  /** FileDataID of the .m2, and the basename it is stored under. */
  model: number
  /**
   * Deferred texture slots, keyed by M2 texture-component type. 11, 12 and 13
   * are the creature skin slots a model leaves blank for CreatureDisplayInfo to
   * fill — which is how Breath and Blood of Ula'tek are one model in two
   * colours, and Vexhul and Ithraz likewise. Missing them is fatal rather than
   * ugly: the loader treats an unresolvable slot as an error and the model does
   * not appear at all.
   */
  skinTextures: Record<string, number>
  /** CreatureDisplayInfo's own scale. Recorded, deliberately not applied. */
  scale: number
}

export interface ModelIndex {
  bosses: { key: string; creatures: CreatureEntry[] }[]
}

/**
 * The index, or null when there is no art.
 *
 * One request for the whole raid. Null rather than an empty index because the
 * caller's question is "barrel or cards", and "the file is missing" and "the
 * file is empty" are the same answer to it.
 */
export async function loadModelIndex(): Promise<ModelIndex | null> {
  try {
    const res = await fetch(`${MODEL_ROOT}index.json`)
    if (!res.ok) return null
    const json = await res.json() as ModelIndex
    return json.bosses?.length ? json : null
  } catch {
    // A missing index is the normal case on a checkout with no art, not an
    // incident.
    return null
  }
}
