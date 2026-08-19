import {
  AdditiveBlending, Box3, BufferAttribute, Color, Group, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, Object3D, SkinnedMesh, Vector3,
} from 'three'
import { M2Loader, M2Options, type SequenceManager } from 'three-m2loader'
import { FILE_ROOT, type CreatureEntry, type ModelIndex } from './modelIndex'
import { STAGING, type CreatureStaging } from './staging'

/**
 * Getting one encounter's creatures onto a slot of the barrel.
 *
 * The art is not in the repository. `scripts/fetch-boss-models.mjs` pulls it
 * from Wowhead's model-viewer CDN into `public/models/`, which `.gitignore`
 * drops — a hundred megabytes of Blizzard-owned creature art has no business in
 * a git history, and the deployed build does not ship it either. So every entry
 * point here is allowed to come back empty and the selector falls back to the
 * cards it has always drawn. A checkout that never runs the script is not
 * broken, it is the trainer it was before.
 *
 * A slot holds a CAST rather than a creature. Half this file is the arithmetic
 * of standing two golems side by side, or a Hex Lord behind a Soulcoiler, while
 * keeping the whole group the same visual weight as the single serpent in the
 * next slot along.
 */

/**
 * How tall one creature is drawn, in world units, before the group is fitted.
 *
 * Height rather than longest-axis, and the difference shows on exactly the
 * models whose width and height disagree. Measured posed, in model units,
 * Ula'tek is 73 wide against 29 tall and Vexhul is 3.6 against 10. Fitting the
 * longest axis renders the first at a third the size of its neighbours and the
 * second at three times. Fitting height puts every creature in the raid at the
 * same eye level, which is the only thing that makes eight silhouettes
 * comparable at a glance.
 */
const CREATURE_HEIGHT = 3.0

/** Daylight between two bodies in the same rank, in world units. */
const RANK_GAP = 0.3

/**
 * The widest a whole slot may be. Slots sit 4.87 units apart on the drum, so
 * this overlaps slightly into the neighbours — deliberately, because they are
 * dimmed and fogged by then, and a pair of golems confined strictly to their
 * own slot would each be too small to read.
 */
const MAX_GROUP_WIDTH = 5.8

/**
 * Vertices sampled per mesh when measuring a posed model.
 *
 * `Box3.setFromObject` cannot do this job: it takes a skinned mesh's stored
 * bounding box and transforms it by the object's matrix, which describes the
 * bind pose and nothing else. Sszorak is stored stretched flat and stands
 * reared up, so the bind box put its base a metre below where it draws and it
 * hung in the air above its own highlight. The real silhouette has to be read a
 * vertex at a time through the skeleton.
 *
 * That is 745,000 vertices on the heaviest model, so it is sampled. A stride
 * across the buffer cannot miss a limb — the extremes of a creature are
 * hundreds of vertices wide, not one.
 */
const BOUNDS_SAMPLES = 3000

/**
 * How much of an additive effect mesh's brightness to keep.
 *
 * Glows, wisps and flame cards are drawn with additive blending, which means
 * overlapping ones sum. WoW keeps that in check with the per-material colour
 * and texture-weight animation tracks — the things that make a spirit flame
 * pulse — and three-m2loader does not read them ("TODO Honor remaining material
 * flags"), so every card renders at full strength all the time. On a model with
 * a handful of them it looks fine; on Zul'jan, whose head effect is 1,251
 * triangles of overlapping quads, the sum saturates and he wears a slab of
 * white.
 *
 * Scaling the opacity is a flat approximation of the tracks we cannot read. It
 * is a judgement, not a derivation, and it was set by looking: high enough that
 * Nek'zali's headdress still burns, low enough that Zul'jan has a face.
 */
const EFFECT_OPACITY = 0.35

/**
 * How much of a back-rank creature's colour survives.
 *
 * Depth, first: somebody standing behind somebody else is further from the key
 * light and should read that way, and on a dark stage that separation is what
 * makes the pair legible as two ranks rather than one crowd.
 *
 * It also covers for a limitation, and the number is set by that rather than by
 * the depth. Hex Lord Malacrass's display is a base troll body — his gear is
 * item equipment composed at runtime from tables this loader cannot assemble —
 * so at anything near full brightness he is a conspicuously undressed troll.
 * Taken almost to black he is a looming silhouette, which is both what the
 * encounter wants and what the model can actually deliver. Not all the way to
 * black: at zero he is a flat cut-out that reads as a rendering fault, and the
 * twelve per cent left is what lets the two rim lights find his edge.
 */
const BACK_RANK_SHADE = 0.12

/**
 * How hard to burn a display's edge colour into the model that wears one, lit
 * in the front rank and shaded at the back.
 *
 * An approximation, and it is worth being clear which one. The game applies
 * these as a fresnel term — brightest where the surface turns away from the eye,
 * which is what makes a spectral creature read as lit from within. This puts the
 * colour on uniformly as emissive instead, because a fresnel needs a custom
 * shader for a treatment only two creatures in the raid carry.
 *
 * TWO VALUES, because a uniform emissive is not a rim light and cannot be tuned
 * once for both. The front figure is standing in a spotlight, so anything above
 * a whisper stops tinting it and becomes it — Nek'zali at 0.14 rendered as a
 * flat turquoise cut-out with none of her own colour left, and the numbers here
 * are linear, so 0.14 leaves the shader as roughly 0.4 on screen. The back rank
 * has the opposite problem: `shade` has already taken its diffuse to a tenth, so
 * the glow is most of what is left to see it by, and it is what turns Malacrass
 * from an unlit shape into a spectral one.
 */
const GLOW_FRONT = 0.035
const GLOW_BACK = 0.4

/** The box a model actually draws in, with its skeleton in its current pose. */
function posedBounds(root: Object3D): Box3 {
  const box = new Box3()
  const v = new Vector3()

  root.traverse(node => {
    const mesh = node as Mesh
    // `visible` is false only on submeshes a trim emptied. Measuring one would
    // put the creature's bounds back where the trim just took them from.
    if (!mesh.isMesh || !mesh.visible) return
    const positions = mesh.geometry?.getAttribute('position')
    if (!positions) return

    // Submeshes SHARE one vertex buffer and differ only in their index range,
    // so walking `position` would measure the whole creature once per submesh —
    // and would count triangles a trim has just discarded.
    const index = mesh.geometry.index
    const count = index ? index.count : positions.count
    const stride = Math.max(1, Math.ceil(count / BOUNDS_SAMPLES))
    for (let i = 0; i < count; i += stride) {
      // `getVertexPosition` is overridden on SkinnedMesh to run the vertex
      // through the bones, and is a plain buffer read on everything else, so
      // this one call covers both kinds of mesh.
      mesh.getVertexPosition(index ? index.getX(i) : i, v)
      box.expandByPoint(mesh.localToWorld(v))
    }
  })

  return box
}

/**
 * Drop every triangle whose posed centre sits further than `halfWidth` from the
 * model's centre line.
 *
 * Rebuilds each submesh's index rather than its vertices: the vertex buffer is
 * shared between submeshes, so deleting from it would corrupt the others, and
 * leaving a few thousand unreferenced vertices behind costs memory rather than
 * correctness.
 *
 * Judged on each triangle's CENTRE, not on all three corners. A wing joins the
 * body somewhere, and whatever rule is used there will cut some triangle in
 * half; the centroid leaves the seam at roughly the cut plane, where taking any
 * corner leaves a fringe of wing and requiring all three bites into the body.
 */
function trimToCentre(root: Object3D, halfWidth: number): void {
  const v = new Vector3()

  root.traverse(node => {
    const mesh = node as Mesh
    const index = mesh.isMesh ? mesh.geometry?.index : null
    if (!index) return

    const kept: number[] = []
    for (let t = 0; t + 2 < index.count; t += 3) {
      let centre = 0
      for (let k = 0; k < 3; k++) {
        mesh.getVertexPosition(index.getX(t + k), v)
        centre += mesh.localToWorld(v).x / 3
      }
      if (Math.abs(centre) <= halfWidth) {
        kept.push(index.getX(t), index.getX(t + 1), index.getX(t + 2))
      }
    }

    if (kept.length === 0) {
      // EVERY triangle was outside the cut, so the whole submesh was. Leaving it
      // visible — which is what this did at first — is what knocked Ula'tek off
      // centre: three of her eleven submeshes are wing detail sitting twenty
      // units out on one side, they kept none of their triangles, and surviving
      // whole they dragged the measured bounds right and shoved the body left of
      // its own slot. Hidden rather than emptied, so a mis-set threshold shows up
      // as a missing part instead of a zero-length draw call.
      mesh.visible = false
    } else if (kept.length < index.count) {
      mesh.geometry.setIndex(new BufferAttribute(new Uint32Array(kept), 1))
    }
  })
}

/** Bytes in one M2Attachment: id, bone, pad, a C3Vector, and an animation track. */
const M2_ATTACHMENT_SIZE = 40

/**
 * Where a model's attachment points are, as `id -> { bone, position }`.
 *
 * three-m2loader does not read these — it has no attachment support at all —
 * so the header is walked here for the one array that matters. The offsets
 * below are fixed-width fields in the MD20 header wrapped inside the MD21
 * chunk, counted from the start of that header rather than of the file, which
 * is why every read is `8 + n`.
 *
 * The M2 is fetched a second time and that is free: the loader has already
 * pulled the same URL, so this is a cache hit rather than a download.
 */
async function readAttachments(url: string): Promise<Map<number, { bone: number; position: Vector3 }>> {
  const out = new Map<number, { bone: number; position: Vector3 }>()
  const res = await fetch(url)
  if (!res.ok) return out
  const view = new DataView(await res.arrayBuffer())

  // 0xF0 is the attachments M2Array. Its offset is relative to the MD20 header.
  const count = view.getUint32(8 + 0xF0, true)
  const offset = view.getUint32(8 + 0xF4, true)
  for (let i = 0; i < count; i++) {
    const at = 8 + offset + i * M2_ATTACHMENT_SIZE
    if (at + M2_ATTACHMENT_SIZE > view.byteLength) break
    out.set(view.getUint32(at, true), {
      bone: view.getUint16(at + 4, true),
      position: new Vector3(
        view.getFloat32(at + 8, true),
        view.getFloat32(at + 12, true),
        view.getFloat32(at + 16, true)),
    })
  }
  return out
}

/** The model's bones, in M2 order, or null if it has no skeleton. */
function bonesOf(root: Object3D) {
  let bones: Object3D[] | null = null
  root.traverse(node => {
    const skinned = node as SkinnedMesh
    if (!bones && skinned.isSkinnedMesh && skinned.skeleton) bones = skinned.skeleton.bones
  })
  return bones as Object3D[] | null
}

/** Walk every material on a model, whatever its mesh nesting. */
function eachMaterial(root: Object3D, fn: (m: MeshBasicMaterial) => void): void {
  root.traverse(node => {
    const mesh = node as Mesh
    if (!mesh.isMesh) return
    const mat = mesh.material
    for (const m of Array.isArray(mat) ? mat : [mat]) fn(m as MeshBasicMaterial)
  })
}

/** Hold the additive effect cards down to something a face can be seen through. */
function dampenEffects(root: Object3D): void {
  eachMaterial(root, m => {
    if (m.blending !== AdditiveBlending) return
    m.transparent = true
    m.opacity *= EFFECT_OPACITY
  })
}

/**
 * Burn the display's edge colour into the model as emissive.
 *
 * Only the lit materials take it. The additive effect cards have no emissive
 * channel and are already the colour they are meant to be.
 */
function applyGlow(root: Object3D, edge: [number, number, number], amount: number): void {
  const colour = new Color(edge[0], edge[1], edge[2])
  eachMaterial(root, m => {
    const lit = m as unknown as MeshLambertMaterial
    if (!lit.emissive) return
    lit.emissive.copy(colour).multiplyScalar(amount)
  })
}

/** Push a creature into shadow, for a body standing behind the front rank. */
function shade(root: Object3D, amount: number): void {
  eachMaterial(root, m => {
    // Safe to mutate in place: every creature is its own load, so even the two
    // pairs built from a single M2 — Breath and Blood, Vexhul and Ithraz — hold
    // separate materials. Nothing here is shared with another slot.
    m.color?.multiplyScalar(amount)
  })
}

/**
 * Load one creature, orient it, pose it, and scale it to `CREATURE_HEIGHT`.
 *
 * Comes back with its feet at y = 0 and its centre line on x = 0, so the caller
 * places a body rather than negotiating with a creature's own pivot — which on
 * these models sits anywhere from between the feet to the middle of a coil.
 */
async function loadCreature(entry: CreatureEntry, staging: CreatureStaging): Promise<Group> {
  const skins = entry.skinTextures ?? {}
  const options = new M2Options().setSkin(
    skins['11'] ?? null, skins['12'] ?? null, skins['13'] ?? null)

  // Every binary lives in one flat directory named by FileDataID, which is what
  // lets the two creatures behind a shared model share its files rather than
  // each carrying a copy. The loader resolves skins and textures as siblings of
  // the .m2, so a flat store is not just smaller, it is the only layout in
  // which the sharing is possible at all.
  const loaded = await new M2Loader().loadAsync(`${FILE_ROOT}${entry.model}.m2`, undefined, options)

  // Three nested objects, and each is doing a job the others cannot.
  //
  //   axis   the Z-up → Y-up quarter turn. Never touched again.
  //   facing the yaw that turns the creature towards the camera, plus the scale
  //          and recentring that follow from measuring it in that pose.
  //   root   what the caller positions. Left at identity so a rank can set a
  //          position without fighting anything underneath it.
  //
  // Collapsing them is possible and was tried. It does not survive three's
  // Euler order: setting `rotation.x` and `rotation.y` on one object composes
  // as Rx·Ry, so the yaw happens in the model's own tilted frame and turns the
  // creature through the floor instead of about the vertical.
  const axis = new Object3D()
  axis.rotation.x = -Math.PI / 2
  axis.add(loaded)

  const facing = new Object3D()
  // The axis fix leaves a creature facing along +X while the camera sits on +Z.
  facing.rotation.y = -Math.PI / 2
  facing.add(axis)

  const root = new Group()
  root.add(facing)
  root.name = entry.id
  root.userData.entry = entry

  /** Managers belonging to attachment models rather than to the creature. */
  const extraSequences: SequenceManager[] = []

  // Posed onto the first frame of its idle BEFORE anything is measured or cut,
  // and that order is the whole reason the animation starts here rather than in
  // the barrel that will drive it. A skinned model has two silhouettes — the
  // bind pose its vertices are stored in, and whatever the skeleton is doing to
  // them — and every measurement below wants the second.
  const sequences = loaded.userData.sequenceManager as SequenceManager | undefined
  if (sequences) {
    // "Stand" is id 0 on every creature Blizzard ships, but reading it out of
    // the list rather than hardcoding 0 costs one lookup and means a model that
    // somehow lacks an idle gets its first sequence instead of a bind pose.
    const list = sequences.listSequences?.() ?? []
    const stand = list.find(s => s.name === 'Stand') ?? list[0]
    if (stand) {
      sequences.playSequence(stand.id)
      sequences.update(0)
    }
  }
  root.userData.sequenceManager = sequences
  root.updateMatrixWorld(true)

  // Anything the display bolts on, hung off the bone its attachment point names.
  //
  // Parented to the BONE rather than to the model, so the mask rides the head
  // through the idle instead of hanging in the air where the head used to be.
  // No axis fix and no yaw on the way in: a bone is already in the model's own
  // space, so the attachment arrives in the same frame its offset is expressed
  // in and needs no correction.
  const attachments = entry.attachments ?? []
  if (attachments.length > 0) {
    const points = await readAttachments(`${FILE_ROOT}${entry.model}.m2`)
    const bones = bonesOf(root)
    for (const attachment of attachments) {
      const hung = await new M2Loader().loadAsync(`${FILE_ROOT}${attachment.model}.m2`)
      hung.scale.setScalar(attachment.scale)

      // -1 means the effect has no attachment point and rides the model itself.
      const point = attachment.attachmentId >= 0 ? points.get(attachment.attachmentId) : undefined
      const parent = point && bones ? bones[point.bone] : undefined
      if (parent && point) {
        hung.position.copy(point.position)
        parent.add(hung)
      } else {
        loaded.add(hung)
      }

      // Attachment models carry their own idles — a mask breathes with its
      // wearer's crest — so their managers join the list the barrel ticks.
      const seq = hung.userData.sequenceManager as SequenceManager | undefined
      const first = seq?.listSequences?.()[0]
      if (seq && first) {
        seq.playSequence(first.id)
        seq.update(0)
        extraSequences.push(seq)
      }
    }
  }

  if (staging.trimHalfWidth !== undefined) trimToCentre(root, staging.trimHalfWidth)
  dampenEffects(root)
  const atBack = staging.back !== undefined
  if (entry.glow?.edge) applyGlow(root, entry.glow.edge, atBack ? GLOW_BACK : GLOW_FRONT)
  if (atBack) shade(root, BACK_RANK_SHADE)

  const box = posedBounds(root)
  const size = box.getSize(new Vector3())

  // A model that measures nothing has failed to produce geometry — every mesh
  // culled, or a skin that resolved to no submeshes. Dividing by it would put
  // NaN into the scene graph and take the whole canvas down with it, so it is
  // left at 1:1 and the caller gets an honestly empty body.
  if (size.y > 0 && Number.isFinite(size.y)) {
    const scale = CREATURE_HEIGHT / size.y
    facing.scale.setScalar(scale)
    facing.position.set(
      -((box.min.x + box.max.x) / 2) * scale,
      -box.min.y * scale,
      -((box.min.z + box.max.z) / 2) * scale)
  }

  root.userData.extraSequences = extraSequences
  return root
}

/** A staged slot: the creatures, and the managers the barrel has to tick. */
export interface BossScene {
  group: Group
  sequences: SequenceManager[]
}

/**
 * Load and stage every creature this encounter puts on its slot.
 *
 * Two ranks. The front is laid out left to right by each body's own fitted
 * width, so two broad golems take more room than two narrow serpents without
 * anybody typing an offset; anyone carrying a `back` is placed behind that rank
 * and is expected to be partly hidden by it, which is what standing behind
 * somebody looks like. The assembly is then scaled down if it comes out wider
 * than a slot can hold, which keeps a pair at the same visual weight as the
 * single boss beside them instead of twice it.
 */
export async function loadBossScene(bossKey: string, index: ModelIndex): Promise<BossScene> {
  const listed = index.bosses.find(b => b.key === bossKey)
  if (!listed) throw new Error(`no creatures indexed for ${bossKey}`)

  // Staging is optional. A boss with no entry stages whatever it downloaded,
  // which is the single-creature case and needs nobody to say so.
  const cast: CreatureStaging[] = STAGING[bossKey] ?? listed.creatures.map(c => ({ id: c.id }))

  // Serial, because these are megabytes each and running a slot's two creatures
  // concurrently only makes them both arrive later.
  const bodies: { staging: CreatureStaging; root: Group }[] = []
  for (const staging of cast) {
    const entry = listed.creatures.find(c => c.id === staging.id)
    if (!entry) throw new Error(`${bossKey} stages '${staging.id}', which was never downloaded`)
    bodies.push({ staging, root: await loadCreature(entry, staging) })
  }

  const group = new Group()
  const measure = (o: Object3D) => {
    o.updateMatrixWorld(true)
    return posedBounds(o).getSize(new Vector3())
  }

  const front = bodies.filter(b => b.staging.back === undefined)
  const behind = bodies.filter(b => b.staging.back !== undefined)

  // Front rank, left to right, each body given exactly its own width.
  const widths = front.map(b => measure(b.root).x)
  const rankWidth = widths.reduce((a, w) => a + w, 0) + RANK_GAP * Math.max(0, front.length - 1)
  let cursor = -rankWidth / 2
  front.forEach((b, i) => {
    b.root.position.x = cursor + widths[i] / 2 + (b.staging.x ?? 0) * CREATURE_HEIGHT
    cursor += widths[i] + RANK_GAP
    group.add(b.root)
  })

  // Behind the rank, by however many fitted heights the staging asked for.
  for (const b of behind) {
    b.root.position.set(
      (b.staging.x ?? 0) * CREATURE_HEIGHT,
      0,
      -(b.staging.back ?? 1) * CREATURE_HEIGHT)
    group.add(b.root)
  }

  const size = measure(group)
  if (size.x > MAX_GROUP_WIDTH && size.x > 0) group.scale.setScalar(MAX_GROUP_WIDTH / size.x)

  return {
    group,
    sequences: bodies.flatMap(b => [
      b.root.userData.sequenceManager as SequenceManager | undefined,
      ...(b.root.userData.extraSequences as SequenceManager[] | undefined ?? []),
    ]).filter((s): s is SequenceManager => !!s),
  }
}
