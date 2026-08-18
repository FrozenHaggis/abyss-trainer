/**
 * Is the boss art on disk?
 *
 * Its own module, with nothing imported into it, and that emptiness is the
 * point. The answer decides whether the app ever touches three.js at all, so it
 * has to be answerable from the main bundle — if this lived next to the loader
 * it would drag WebGL, the M2 parser and a BLP decoder into the first script
 * every visitor downloads, on a deployed site that never has the models and can
 * never use any of it. Roughly seven hundred kilobytes to ask a yes/no
 * question.
 *
 * `BossBarrel` imports the barrel dynamically once this says yes.
 */

/** Vite serves `public/` at the root, under whatever base the build was given. */
export const MODEL_ROOT = `${import.meta.env.BASE_URL}models/`.replace(/\/{2,}/g, '/')

/**
 * Which bosses have art, or null when none do.
 *
 * One request rather than eight probes. Null rather than an empty set because
 * the caller's question is "barrel or cards", and "the index is missing" and
 * "the index is empty" are the same answer to it.
 */
export async function loadModelIndex(): Promise<Set<string> | null> {
  try {
    const res = await fetch(`${MODEL_ROOT}manifest.json`)
    if (!res.ok) return null
    const json = await res.json() as { bosses: { key: string }[] }
    const keys = new Set(json.bosses.map(b => b.key))
    return keys.size > 0 ? keys : null
  } catch {
    // A missing manifest is the normal case on a fresh clone, not an incident.
    return null
  }
}
