/**
 * Pull the Venomous Abyss boss models out of Wowhead's model-viewer CDN.
 *
 * Not vendored into git: the eight models are ~100MB of Blizzard-owned art, so
 * `public/models/` is ignored and this script is how a fresh checkout gets it.
 * Run `node scripts/fetch-boss-models.mjs` once; it is idempotent and skips
 * anything already on disk.
 *
 * Three kinds of file per boss, all keyed by FileDataID because that is how
 * modern M2s reference their own dependencies:
 *
 *   <fdid>.m2    the model: vertices, bones, animation tracks, and the chunks
 *                naming the other two kinds.
 *   <fdid>.skin  submesh + triangle index data. An M2 carries none of its own
 *                geometry indices; up to four skin profiles (LODs) sit beside
 *                it, named by the M2's SFID chunk.
 *   <fdid>.blp   textures, named by the M2's TXID chunk, in Blizzard's own BLP2
 *                container. Wowhead also serves these pre-transcoded to webp,
 *                which would download smaller — but BLP is what three-m2loader
 *                asks for by name, and the DXT payload inside one goes to the
 *                GPU still compressed, so the webp would cost more VRAM to save
 *                disk. Wowhead's CDN has no BLPs, hence the second host.
 *
 * A zero in TXID is not a missing texture, it is a DEFERRED one: the slot is
 * filled from CreatureDisplayInfo at spawn time, which is how one model serves
 * several creatures. Two of these eight are built that way — the Sentinels golem
 * has three deferred slots and Vexhul one — and the display's own metadata is
 * the only place those FileDataIDs exist, so `Textures` is downloaded alongside
 * TXID and recorded under `skinTextures` for the loader to inject. Skipping it
 * is not a cosmetic loss: the loader treats an unresolvable slot as fatal and
 * the model does not load at all.
 *
 * ONE FLAT DIRECTORY, `public/models/files/`, named by FileDataID.
 *
 * three-m2loader resolves a model's skins and textures as siblings of the .m2,
 * so everything a model needs has to share a directory with it. The first cut
 * of this gave every creature its own, on the theory that two creatures in one
 * folder could collide on a FileDataID — which is exactly backwards. A
 * FileDataID is unique across Blizzard's whole filesystem, so two files with
 * the same id ARE the same file, and a collision is a match rather than a
 * conflict. The per-creature layout was therefore storing 6.7MB of byte-
 * identical duplicates: Breath and Blood of Ula'tek are one model in two
 * skins and had two copies of it, as did Vexhul and Ithraz.
 *
 * Flat, those duplicates cannot exist. Which creature owns which file is
 * recorded in `index.json` instead of being implied by the directory tree.
 *
 * The implication only runs one way, and about 1MB survives because of it: the
 * same id is always the same bytes, but the same bytes can be shipped under
 * several ids, and nine textures here are byte-identical pairs with different
 * FileDataIDs. Deduplicating those would mean rewriting the ids inside each M2
 * to point at a shared name, which is real surgery on the format for a megabyte
 * — so they stay.
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CDN = 'https://wow.zamimg.com/modelviewer/live'
/** Raw CASC files by FileDataID. The only public source of untranscoded BLPs. */
const CASC = 'https://wago.tools/api/casc'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models')

/**
 * The eight encounters, in raid order, and the creatures each one puts on stage.
 *
 * `displayId` is the CreatureDisplayInfo row, which is the level Wowhead's CDN
 * is addressed at, and it is NOT the same thing as the NPC id — a display id
 * knows which model and which texture variant, an NPC id knows a name and a
 * health pool. Both are recorded so the mapping can be re-checked by hand.
 *
 * WHERE A FIGHT NAMES ITS BODIES, THESE ARE THE BODIES IT NAMES. The four
 * multi-creature encounters below declare an `entities` array in
 * `src/bosses/*.ts`, because the sim has to place more than one thing on the
 * floor, and every id staged from them was read out of that array rather than
 * looked up — so the barrel and the sim cannot disagree about who is in an
 * encounter. `test/barrel.test.js` fails if they drift. Where a boss file and
 * Wowhead disagree the boss file wins: the zone page lists a Zul'jan at 259447
 * and the encounter uses 257911, so 257911 is what is downloaded.
 *
 * The other four are single bosses. Their files declare no entity at all — the
 * engine synthesises one at the centre — so their display ids come from
 * Wowhead's own encounter journal and nothing in the repository can confirm
 * them. They are the four the test cannot cover.
 *
 * Four encounters are more than one body and the selector shows all of them —
 * both Sentinel golems, both Twin Fangs, and Hex Lord Malacrass behind Zul'jan.
 * Where the cast is too big to stage, the creature chosen is the one the fight
 * turns on: First Mate Nama for the Lost Explorers.
 */
const BOSSES = [
  { key: 'nekzali', creatures: [
    { id: 'nekzali', name: "Nek'zali the Soulcoiler", npc: 253563, displayId: 137923 },
  ] },
  { key: 'sentinels', creatures: [
    { id: 'breath', name: "Breath of Ula'tek", npc: 258557, displayId: 143437 },
    { id: 'blood', name: "Blood of Ula'tek", npc: 258558, displayId: 143436 },
  ] },
  { key: 'vashnik', creatures: [
    { id: 'vashnik', name: 'Vashnik the Malignant', npc: 266403, displayId: 141675 },
  ] },
  { key: 'explorers', creatures: [
    { id: 'nama', name: 'First Mate Nama', npc: 261835, displayId: 144893 },
  ] },
  { key: 'sszorak', creatures: [
    { id: 'sszorak', name: 'Sszorak', npc: 257347, displayId: 142788 },
  ] },
  { key: 'twinfangs', creatures: [
    { id: 'vexhul', name: 'Vexhul', npc: 257361, displayId: 140993 },
    { id: 'ithraz', name: 'Ithraz', npc: 257368, displayId: 141309 },
  ] },
  { key: 'coiledaltar', creatures: [
    { id: 'zuljan', name: "Zul'jan", npc: 257911, displayId: 142472 },
    { id: 'malacrass', name: 'Hex Lord Malacrass', npc: 259854, displayId: 142140 },
  ] },
  { key: 'ulatek', creatures: [
    { id: 'ulatek', name: "Ula'tek", npc: 268956, displayId: 140369 },
  ] },
]

/** Wowhead 403s a bare fetch; it wants to look like a browser. */
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }

async function get(url) {
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Already-on-disk files are left alone, so a re-run costs one meta request. */
async function have(path) {
  try { return (await stat(path)).size > 0 } catch { return false }
}

async function save(path, buf) {
  await writeFile(path, buf)
  return buf.length
}

/**
 * Read the top-level chunks of a chunked (MD21) M2.
 *
 * Everything since Legion is a flat sequence of `magic:uint32, size:uint32,
 * payload` records, with the pre-Legion model itself sitting inside the first
 * one. Only two of the chunks matter here — SFID and TXID, both plain arrays of
 * FileDataID — so the parse deliberately stops at "where does each chunk start".
 */
function chunks(buf) {
  const found = {}
  let off = 0
  while (off + 8 <= buf.length) {
    const magic = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    found[magic] = { off: off + 8, size }
    off += 8 + size
  }
  return found
}

function fdids(buf, chunk) {
  if (!chunk) return []
  const out = []
  for (let i = 0; i < chunk.size; i += 4) out.push(buf.readUInt32LE(chunk.off + i))
  // 0 is the null FileDataID and shows up in TXID for slots a creature does not
  // use (hardcoded-blank texture units). Requesting it 404s.
  return out.filter(id => id !== 0)
}

let grand = 0

/** Everything lands here, named by FileDataID. See the note at the top. */
const FILES = join(OUT, 'files')

/** Vertex count, read straight out of the MD20 header inside the MD21 chunk. */
function vertexCount(m2) {
  // 0x3C is the vertices M2Array and everything before it is fixed-width, so
  // this needs no real parse. The app reads the same header properly, to find
  // the attachment table — see `readAttachments` in loadBossScene.ts.
  return m2.readUInt32LE(8 + 0x3C)
}

/**
 * Pull one model and everything it references — its skin profiles and its
 * textures — into the flat store.
 *
 * Shared between creatures and the attachment models a display bolts onto them,
 * and idempotent, so the second creature behind a shared model and the wisp
 * emitter repeated across eight limbs both cost nothing the second time.
 */
async function fetchModelFiles(model) {
  let bytes = 0
  const m2Path = join(FILES, `${model}.m2`)
  if (!await have(m2Path)) bytes += await save(m2Path, await get(`${CDN}/m2/${model}.m2`))
  const m2 = await readFile(m2Path)
  const c = chunks(m2)

  for (const id of fdids(m2, c.SFID)) {
    const p = join(FILES, `${id}.skin`)
    if (await have(p)) continue
    bytes += await save(p, await get(`${CDN}/skin/${id}.skin`))
  }
  // A missing texture is survivable — the model renders that unit blank — so a
  // 404 is skipped rather than allowed to abandon the rest of the raid.
  for (const id of fdids(m2, c.TXID)) {
    const p = join(FILES, `${id}.blp`)
    if (await have(p)) continue
    try { bytes += await save(p, await get(`${CASC}/${id}`)) } catch { /* blank unit */ }
  }
  return bytes
}

/**
 * Everything a creature's DISPLAY bolts onto its model, which is not in the
 * model itself.
 *
 * Hex Lord Malacrass is why this exists. His model is a bare troll body; the
 * teal-crested mask he is known for is a separate M2 hung on his face
 * attachment, and the teal itself is a colour treatment on the display rather
 * than anything in a texture. Render the model alone and you get an undressed
 * troll in the wrong colour, which is exactly what shipped.
 *
 * Emitter-only attachments are dropped rather than downloaded. Several carry no
 * geometry at all — they are particle and ribbon emitters, which three-m2loader
 * does not simulate — so keeping them would cost requests to draw nothing.
 */
async function fetchDisplayEffects(meta) {
  const attachments = []
  let bytes = 0
  for (const kit of meta.StateKits ?? []) {
    for (const effect of kit.modelAttachEffects ?? []) {
      if (!effect.Model) continue
      if (attachments.some(a => a.model === effect.Model && a.attachmentId === effect.AttachmentID)) continue
      bytes += await fetchModelFiles(effect.Model)
      if (vertexCount(await readFile(join(FILES, `${effect.Model}.m2`))) === 0) continue
      attachments.push({
        attachmentId: effect.AttachmentID,
        model: effect.Model,
        scale: effect.Scale1 ?? 1,
      })
    }
  }

  const kit = (meta.StateKits ?? [])[0]
  const edge = kit?.edgeGlowEffects?.[0]
  const glow = edge ? { edge: [edge.GlowRed, edge.GlowGreen, edge.GlowBlue] } : null

  return { attachments, glow, bytes }
}

/**
 * Pull one creature's files, and describe it for the index.
 *
 * Nothing is written twice: `have()` skips anything already on disk, which also
 * covers the second creature behind a shared model and the handful of small
 * textures several creatures have in common.
 */
async function fetchCreature(creature) {
  const meta = JSON.parse((await get(`${CDN}/meta/npc/${creature.displayId}.json`)).toString())
  const model = meta.Model
  if (!model) throw new Error(`${creature.id}: display ${creature.displayId} has no Model fdid`)

  let bytes = await fetchModelFiles(model)
  const m2 = await readFile(join(FILES, `${model}.m2`))
  const c = chunks(m2)
  const skins = fdids(m2, c.SFID)

  // Keyed by M2 texture-component type: 11, 12, 13 are the three monster skin
  // slots, and they are the whole reason one model can be two creatures. They
  // are not in TXID, so they are fetched here rather than by `fetchModelFiles`.
  const skinTextures = Object.fromEntries(
    Object.entries(meta.Textures ?? {}).map(([type, id]) => [type, Number(id)]))
  const missing = []
  for (const id of Object.values(skinTextures)) {
    const p = join(FILES, `${id}.blp`)
    if (await have(p)) continue
    try { bytes += await save(p, await get(`${CASC}/${id}`)) }
    catch { missing.push(id) }
  }

  const effects = await fetchDisplayEffects(meta)
  bytes += effects.bytes

  const textures = [...fdids(m2, c.TXID), ...Object.values(skinTextures)]
  const mb = n => (n / 1024 / 1024).toFixed(1)
  console.log(
    `  ${creature.id.padEnd(10)} model ${model}  ${skins.length} skins  ` +
    `${textures.length - missing.length}/${textures.length} textures  +${mb(bytes)}MB` +
    (effects.attachments.length ? `  ${effects.attachments.length} attachments` : '') +
    (missing.length ? `  (no blp: ${missing.join(',')})` : ''))

  grand += bytes
  return {
    id: creature.id, name: creature.name, npc: creature.npc,
    displayId: creature.displayId, model, skinTextures, scale: meta.Scale ?? 1,
    attachments: effects.attachments, glow: effects.glow,
  }
}

await mkdir(FILES, { recursive: true })

/**
 * One index for the whole raid, rather than a manifest per creature.
 *
 * The app needs two answers before it can draw anything — is the art here, and
 * who is on each slot — and with the files flattened there is no directory tree
 * left to read them off. One document answers both in one request, where the
 * old layout cost twenty.
 */
const index = { bosses: [] }
for (const boss of BOSSES) {
  console.log(boss.key)
  const creatures = []
  for (const creature of boss.creatures) creatures.push(await fetchCreature(creature))
  index.bosses.push({ key: boss.key, creatures })
}

// Written last so a half-finished download leaves no index behind, and the app
// falls back to its cards rather than trying to load a model that is not there.
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n')

console.log(`\ntotal ${(grand / 1024 / 1024).toFixed(1)}MB downloaded into public/models/`)
