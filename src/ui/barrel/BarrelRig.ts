import {
  AdditiveBlending, AmbientLight, BufferGeometry, CanvasTexture, Clock, Color,
  CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, Fog,
  Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  Object3D, PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial,
  Raycaster, Scene, SpotLight, Texture, Vector2, WebGLRenderer,
} from 'three'
import { loadBossScene } from './loadBossScene'

/**
 * The tag barrel.
 *
 * Eight bosses stood on a slowly turning drum, one of them facing you. Rotating
 * is the whole interaction: there is no list, no grid, and no way to see all
 * eight at once, which is the trade the shape makes — a grid answers "what are
 * my options" at a glance and this answers "what am I about to pull" with a
 * creature the size of the screen.
 *
 * CONTINUOUS, and that word is doing work. The barrel has no first or last
 * boss. Rotation is tracked as an unbounded angle that only ever grows or
 * shrinks, so pressing right at Ula'tek walks on to Nek'zali without a rewind,
 * and a flick can carry through several bosses and settle wherever it runs out.
 * Nothing here ever clamps an index into a range; the index is read back out of
 * the angle instead.
 *
 * Framework-free on purpose. React owns which boss is selected and everything
 * printed next to it; this owns a canvas and a clock. The two talk through
 * `select()` going in and `onSelect` coming out, and neither re-renders the
 * other — a spring settling over 400ms must not be 24 React renders.
 */

/** Slots, in raid order. The barrel is built from whatever it is handed. */
export interface BarrelOptions {
  keys: string[]
  /**
   * Which slot faces the player on the first frame, jumped to rather than
   * sprung to. Also where the download queue starts, which is the part that
   * matters: the boss being looked at should not wait behind seven others.
   */
  initial?: number
  /** Fired when the barrel settles on a different boss, by any input. */
  onSelect: (index: number) => void
  /** Fired once per boss as its art arrives, so the UI can stop saying LOADING. */
  onLoaded?: (key: string, ok: boolean) => void
}

/** How far out the slots sit. Sized so neighbours do not overlap at `FIT`. */
const RADIUS = 6.2
/** Where the drum's top face is. Models stand on it. */
const DECK_Y = 0
/** Slot the camera looks at, in barrel-local radians. Zero is nearest the lens. */
const FRONT = 0

/**
 * Spring constants for the settle, in the usual stiffness/damping pair.
 *
 * Tuned to land just short of critical damping: `2 * sqrt(stiffness)` is the
 * critical value at unit mass, which for 90 is about 19, and 15 leaves a single
 * shallow overshoot. That overshoot is the point. A critically damped carousel
 * arrives correctly and reads as mechanical; the one bounce is what makes a
 * heavy drum feel like it has mass, and it is the thing the DK64 barrel is
 * remembered for.
 */
const STIFFNESS = 90
const DAMPING = 15

/** Motes drifting in the beam. Enough to read as air, few enough to ignore. */
const DUST_COUNT = 260
/** How high a mote climbs before it is recycled at the floor. */
const DUST_CEILING = 3.6
/** Half-width and half-depth of the volume motes occupy, in world units. */
const DUST_SPREAD = 1.9

/** Radians of drag per pixel of pointer travel. */
const DRAG_RATE = 0.006
/**
 * Seconds of coasting assumed when deciding where a flick was aimed.
 *
 * Not a physical glide — the spring does the actual travelling. It is how far
 * ahead of the release point to look before rounding to a slot, which is what
 * makes a hard flick commit to a boss three along instead of the next one.
 */
const FLICK_LOOKAHEAD = 0.28

export class BarrelRig {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera: PerspectiveCamera
  private readonly drum = new Group()
  private readonly clock = new Clock()
  private readonly raycaster = new Raycaster()

  /** One entry per boss, in the order given. Index is the slot number. */
  private readonly slots: Slot[] = []
  private readonly keys: string[]
  private readonly onSelect: (index: number) => void
  private readonly onLoaded?: (key: string, ok: boolean) => void

  /** Unbounded, and never reduced into a range. See the class comment. */
  private angle = 0
  private target = 0
  private velocity = 0
  /** The slot the barrel last told React about. */
  private announced = 0

  private dragging = false
  private dragLast = 0
  /** Total pixels travelled since pointerdown. Separates a click from a flick. */
  private dragTravel = 0
  /** Timestamp of the last pointermove, for the release velocity. */
  private dragAt = 0
  private frame = 0
  private disposed = false

  /** Shared soft brush for the light pool and every mote of dust. */
  private readonly disc: Texture = BarrelRig.softDisc()
  /** Vertical falloff for the beam. */
  private readonly beam: Texture = BarrelRig.beamGradient()
  private dust: Points | null = null
  private readonly driftX = new Float32Array(DUST_COUNT)
  private readonly driftZ = new Float32Array(DUST_COUNT)
  private readonly rise = new Float32Array(DUST_COUNT)

  constructor(private readonly canvas: HTMLCanvasElement, opts: BarrelOptions) {
    this.keys = opts.keys
    this.onSelect = opts.onSelect
    this.onLoaded = opts.onLoaded

    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    // Low and close. The barrel is looked at from a raider's own eye level
    // rather than from above: a high camera turns the drum into a plan view of
    // a circle of models, and the one fact this screen exists to deliver is
    // what the boss in front looks like at full height.
    this.camera = new PerspectiveCamera(34, 1, 0.1, 100)
    this.camera.position.set(0, 2.4, RADIUS + 7.2)
    // Aimed low, at roughly a creature's waist, which tips the lens down far
    // enough to keep the lit disc under its feet in frame — that disc is the one
    // piece of furniture saying what is selected, and losing it off the bottom
    // edge costs more than the headroom it buys. The distance then has to cover
    // the tallest thing staged: two golems side by side are wider than any
    // single boss, and Vexhul and Ithraz are the full three units to the crown.
    this.camera.lookAt(0, 1.25, RADIUS * 0.45)

    // Fog in the page's own background colour, starting just past the front
    // slot. It is the only thing separating the boss you are looking at from
    // the one directly behind it on the far side of the drum, which would
    // otherwise render at the same brightness through its head.
    this.scene.fog = new Fog(new Color('#0a0714'), RADIUS + 3.5, RADIUS + 15)

    this.buildLights()
    this.buildStage()
    this.buildDust()
    this.scene.add(this.drum)

    for (let i = 0; i < this.keys.length; i++) this.slots.push(this.buildSlot(i))

    const initial = Math.max(0, Math.min(this.keys.length - 1, opts.initial ?? 0))
    this.angle = this.target = initial * ((Math.PI * 2) / this.keys.length)
    this.announced = initial

    this.bindInput()
    this.resize()
    this.frame = requestAnimationFrame(this.tick)

    // Loaded outward from the front so the boss being looked at is the first to
    // arrive, rather than whichever one happens to be first in raid order.
    void this.loadOutwards(initial)
  }

  // ── public surface ──────────────────────────────────────────────────────

  /**
   * Turn to a slot by index, the short way round.
   *
   * "The short way" is the only reason this is not `target = i * step`. The
   * angle is unbounded, so the index it currently represents can be reached
   * from any number of equivalent angles; picking the nearest one is what stops
   * a click on the neighbouring boss unwinding six slots backwards.
   */
  select(index: number, immediate = false): void {
    const n = this.keys.length
    const step = (Math.PI * 2) / n
    const current = this.target / step
    let delta = (index - current) % n
    if (delta > n / 2) delta -= n
    if (delta < -n / 2) delta += n
    this.target += delta * step
    if (immediate) {
      this.angle = this.target
      this.velocity = 0
    }
  }

  /** One slot left or right. The barrel never runs out of either. */
  nudge(slots: number): void {
    this.target += slots * ((Math.PI * 2) / this.keys.length)
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.unbindInput()
    this.scene.traverse(o => {
      const mesh = o as Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        const withMap = m as MeshLambertMaterial
        withMap.map?.dispose()
        m.dispose()
      }
    })
    // Shared by several materials, so the traverse above disposes them once per
    // user rather than once — harmless, but they are not reached at all if the
    // last user was removed, hence disposing them by hand.
    this.disc.dispose()
    this.beam.dispose()
    this.renderer.dispose()
  }

  // ── scene construction ──────────────────────────────────────────────────

  private buildLights(): void {
    // Low, because the point of the room is that it is dark. Everything the
    // player is meant to look at is lit by the one spot at the front; the
    // ambient is here only so the bosses waiting their turn are shapes rather
    // than holes.
    this.scene.add(new AmbientLight(0xb9c6ff, 0.26))

    // Keyed on the FRONT slot rather than on the drum, and it does not turn with
    // it. Whichever boss rotates into the front is the one that gets lit, which
    // is the whole selection cue now that nothing is drawn on the floor — no
    // per-model material change, no highlight state to keep in sync.
    const key = new SpotLight(0xfff2dc, 62, 26, Math.PI / 5.4, 0.42, 1.25)
    key.position.set(1.2, 6.4, RADIUS + 4.2)
    key.target.position.set(0, 1.1, RADIUS)
    this.scene.add(key, key.target)

    // The palette's own two colours as rim lights, so a silhouette still reads
    // against a dark page. Turned down with the ambient: they are edges, and at
    // the old strength they filled in the shadow the spot is supposed to leave.
    const venom = new DirectionalLight(0x9bff6a, 0.42)
    venom.position.set(-7, 3.5, 3)
    this.scene.add(venom)

    const violet = new DirectionalLight(0x9a7cff, 0.34)
    violet.position.set(7, 2.5, -2)
    this.scene.add(violet)

    // A green wash from under the middle of the ring. It used to be inside the
    // drum; with the drum gone it is the only thing separating the bosses on the
    // far side from the background, so it stays — dimmer, and doing a different
    // job than it was built for.
    const core = new PointLight(0x2fe3a0, 5, 13, 2)
    core.position.set(0, DECK_Y - 1.1, 0)
    this.scene.add(core)
  }

  /**
   * A soft round brush, drawn once and shared.
   *
   * Two things need the same shape — the pool of light on the floor and each
   * mote of dust — and both need it to fade to nothing at the edge. A canvas
   * gradient is the cheapest source of one that carries no external file, which
   * the page's CSP would refuse anyway.
   */
  private static softDisc(): CanvasTexture {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.45, 'rgba(255,255,255,0.42)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, size, size)
    }
    return new CanvasTexture(canvas)
  }

  /**
   * The beam's own gradient, running bottom to top of the shaft.
   *
   * Zero at the floor so the cone does not stamp a hard circle where it lands —
   * the pool underneath is what the light hitting the ground looks like — and
   * zero again at the very top, where the shaft would otherwise end in a disc
   * hanging in mid-air above the boss.
   */
  private static beamGradient(): CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (ctx) {
      // Canvas y runs down and the cylinder's v runs up, so this gradient is
      // written top-of-shaft first.
      const g = ctx.createLinearGradient(0, 0, 0, 128)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.22, 'rgba(255,255,255,0.85)')
      g.addColorStop(0.7, 'rgba(255,255,255,0.5)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 4, 128)
    }
    return new CanvasTexture(canvas)
  }

  /**
   * The spotlight, as something you can see rather than only something that
   * lights a model.
   *
   * There is no floor any more. The drum, its deck and the lit disc under each
   * boss are all gone, so nothing in the scene says where the ground is or which
   * slot is chosen — the shaft and the pool have to do both jobs at once. Both
   * are additive and both live on the SCENE rather than on the drum, so they
   * stay put at the front while the bosses turn through them.
   */
  private buildStage(): void {
    const pool = new Mesh(
      new PlaneGeometry(6.6, 4.4),
      new MeshBasicMaterial({
        map: this.disc, color: 0xffe6bd, transparent: true,
        blending: AdditiveBlending, depthWrite: false, opacity: 0.42,
      }))
    pool.rotation.x = -Math.PI / 2
    pool.position.set(0, DECK_Y + 0.02, RADIUS)
    this.scene.add(pool)

    // Open-ended and double-sided: it is a volume of lit air, so the far wall
    // has to show through the near one or the shaft reads as a solid horn.
    const beam = new Mesh(
      new CylinderGeometry(0.55, 2.5, 7, 28, 1, true),
      new MeshBasicMaterial({
        map: this.beam, color: 0xfff2dc, transparent: true, side: DoubleSide,
        blending: AdditiveBlending, depthWrite: false, opacity: 0.075,
      }))
    beam.position.set(0, DECK_Y + 3.5, RADIUS)
    this.scene.add(beam)
  }

  /**
   * Motes drifting up through the beam.
   *
   * One buffer of points, recycled forever: a mote that climbs out of the top is
   * dropped back to the floor somewhere new rather than destroyed, so the count
   * is fixed and nothing allocates after startup.
   *
   * Brightness is per-point, through vertex colours, because that is the only
   * way to fade an individual mote — a `PointsMaterial` has one opacity for the
   * whole cloud. Each one fades up out of the floor and back out near the
   * ceiling, so none of them pops.
   */
  private buildDust(): void {
    const positions = new Float32Array(DUST_COUNT * 3)
    const colours = new Float32Array(DUST_COUNT * 3)

    for (let i = 0; i < DUST_COUNT; i++) {
      this.seedMote(positions, i, Math.random() * DUST_CEILING)
      this.driftX[i] = (Math.random() - 0.5) * 0.09
      this.driftZ[i] = (Math.random() - 0.5) * 0.09
      // A spread of climb rates. All motes at one speed reads as a texture
      // scrolling rather than as air.
      this.rise[i] = 0.05 + Math.random() * 0.16
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colours, 3))

    this.dust = new Points(geometry, new PointsMaterial({
      size: 0.058, map: this.disc, transparent: true, vertexColors: true,
      blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }))
    // On the scene, not the drum: the dust belongs to the beam, and the beam
    // does not turn.
    this.dust.position.set(0, 0, RADIUS)
    this.scene.add(this.dust)
  }

  /** Drop one mote at a fresh spot on the floor, or at `atHeight` on startup. */
  private seedMote(positions: Float32Array, i: number, atHeight: number): void {
    positions[i * 3] = (Math.random() - 0.5) * 2 * DUST_SPREAD
    positions[i * 3 + 1] = atHeight
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2 * DUST_SPREAD * 0.7
  }

  /** Climb, drift, recycle, and fade every mote. */
  private updateDust(dt: number): void {
    if (!this.dust) return
    const position = this.dust.geometry.getAttribute('position') as Float32BufferAttribute
    const colour = this.dust.geometry.getAttribute('color') as Float32BufferAttribute
    const positions = position.array as Float32Array
    const colours = colour.array as Float32Array

    for (let i = 0; i < DUST_COUNT; i++) {
      const y = positions[i * 3 + 1] + this.rise[i] * dt
      if (y > DUST_CEILING) {
        this.seedMote(positions, i, 0)
      } else {
        positions[i * 3] += this.driftX[i] * dt
        positions[i * 3 + 1] = y
        positions[i * 3 + 2] += this.driftZ[i] * dt
      }

      // Up from nothing over the first fifth of the climb, back down to nothing
      // over the last third, and warm rather than white so the motes read as
      // the beam's own light catching them.
      const h = positions[i * 3 + 1] / DUST_CEILING
      const fade = Math.min(1, h / 0.2) * Math.min(1, (1 - h) / 0.33)
      colours[i * 3] = fade
      colours[i * 3 + 1] = fade * 0.93
      colours[i * 3 + 2] = fade * 0.78
    }

    position.needsUpdate = true
    colour.needsUpdate = true
  }

  private buildSlot(index: number): Slot {
    const step = (Math.PI * 2) / this.keys.length
    const at = index * step

    const pivot = new Group()
    pivot.position.set(Math.sin(at) * RADIUS, DECK_Y, Math.cos(at) * RADIUS)
    // Each slot faces outward, away from the drum's axis, so that when its own
    // angle brings it round to the front it is looking straight at the camera.
    pivot.rotation.y = at
    this.drum.add(pivot)

    // Something in the slot from the first frame. The models are tens of
    // megabytes each and arrive over seconds; an empty barrel that fills in as
    // you watch reads as broken, and a spinning shard reads as loading.
    const pending = new Mesh(
      new IcosahedronGeometry(0.55, 0),
      new MeshBasicMaterial({ color: 0x7c4dff, wireframe: true, transparent: true, opacity: 0.5 }))
    pending.position.y = 1.25
    pivot.add(pending)

    return { index, pivot, pending, model: null, sequences: [] }
  }

  // ── loading ─────────────────────────────────────────────────────────────

  /**
   * Fetch the models nearest the front first, then work outwards in both
   * directions, one at a time.
   *
   * Serial rather than parallel, and that is a deliberate slowdown. Eight
   * concurrent fetches of ten-to-thirty megabytes each saturate the connection
   * and every boss arrives late together; one at a time means the boss being
   * looked at is on screen while the rest are still coming, which is the only
   * one that matters at that moment.
   */
  private async loadOutwards(from: number): Promise<void> {
    const n = this.keys.length
    const order = [from]
    for (let d = 1; d <= n; d++) {
      if (order.length >= n) break
      order.push((from + d) % n)
      if (order.length < n) order.push(((from - d) % n + n) % n)
    }

    for (const i of order) {
      if (this.disposed) return
      const key = this.keys[i]
      try {
        const scene = await loadBossScene(key)
        if (this.disposed) return
        this.attach(this.slots[i], scene)
        this.onLoaded?.(key, true)
      } catch (err) {
        // One boss whose art is missing or malformed must not cost the other
        // seven their barrel. The slot keeps its shard and says so.
        console.warn(`[barrel] ${key} did not load`, err)
        this.onLoaded?.(key, false)
      }
    }
  }

  private attach(slot: Slot, scene: { group: Group; sequences: SequenceManagerLike[] }): void {
    slot.pivot.remove(slot.pending)
    slot.pending.geometry.dispose()
    ;(slot.pending.material as MeshBasicMaterial).dispose()

    slot.pivot.add(scene.group)
    slot.model = scene.group
    // Every creature on the slot is already playing its idle and already posed
    // onto frame 0 of it — see `loadBossScene`, which has to do that before it
    // can measure anything. All the barrel adds is the clock, and only for the
    // slots facing forward.
    slot.sequences = scene.sequences
  }

  // ── input ───────────────────────────────────────────────────────────────

  private bindInput(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerUp)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
  }

  private unbindInput(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true
    this.dragLast = e.clientX
    this.dragTravel = 0
    this.dragAt = e.timeStamp
    this.velocity = 0
    this.canvas.setPointerCapture(e.pointerId)
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return
    const dx = e.clientX - this.dragLast
    this.dragLast = e.clientX
    this.dragTravel += Math.abs(dx)
    // Both the live angle and the spring's goal move together, so releasing
    // mid-drag does not snap back to where the drag started.
    this.angle += dx * DRAG_RATE
    this.target = this.angle

    // Speed carried into the release, so a flick keeps travelling. It has to be
    // measured off the POINTER's own clock: the spring is switched off while
    // dragging, so nothing else in the rig knows how fast the drum is moving,
    // and the render loop's delta is the wrong interval — several pointermove
    // events can arrive between two frames.
    const now = e.timeStamp
    const elapsed = Math.max((now - this.dragAt) / 1000, 1 / 240)
    this.dragAt = now
    this.velocity = (dx * DRAG_RATE) / elapsed
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging) return
    this.dragging = false
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)

    // A press that never really moved is a pick, not a flick. The threshold is
    // in pixels rather than zero because a mouse click drifts a pixel or two
    // and a touch drifts more, and neither is an attempt to spin the barrel.
    const picked = this.dragTravel < 6 ? this.pick(e) : null
    if (picked !== null) this.select(picked)
    else this.snap()
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.nudge(e.deltaY > 0 ? -1 : 1)
  }

  /** Which boss is under the cursor, or null if it is over empty space. */
  private pick(e: PointerEvent): number | null {
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)

    for (const hit of this.raycaster.intersectObjects(this.drum.children, true)) {
      // Walk up to whichever slot pivot owns the thing that was hit. The beam
      // and its pool are on the scene rather than on the drum, so they are not
      // in this list at all and a click through them still finds the boss.
      for (const slot of this.slots) {
        let o: Object3D | null = hit.object
        while (o) {
          if (o === slot.pivot) return slot.index
          o = o.parent
        }
      }
    }
    return null
  }

  /** End of a flick: keep the momentum but commit to the slot it lands on. */
  private snap(): void {
    const step = (Math.PI * 2) / this.keys.length
    // Where the drum would coast to if the spring were switched off, from the
    // speed it is already carrying. Rounding THAT rather than the current angle
    // is what lets a hard flick travel several bosses instead of one.
    const coast = this.angle + this.velocity * FLICK_LOOKAHEAD
    this.target = Math.round(coast / step) * step
  }

  // ── frame ───────────────────────────────────────────────────────────────

  private tick = (): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.tick)

    // Clamped because a backgrounded tab hands back a delta of several seconds
    // on return, and a spring integrated over that in one step explodes.
    const dt = Math.min(this.clock.getDelta(), 0.05)

    if (!this.dragging) {
      this.velocity += (this.target - this.angle) * STIFFNESS * dt - this.velocity * DAMPING * dt
      this.angle += this.velocity * dt
    }
    this.drum.rotation.y = -this.angle

    const step = (Math.PI * 2) / this.keys.length
    const nearest = ((Math.round(this.angle / step) % this.keys.length) + this.keys.length) % this.keys.length
    if (nearest !== this.announced) {
      this.announced = nearest
      this.onSelect(nearest)
    }

    for (const slot of this.slots) {
      // The slot's own angle to the camera, wrapped into (-π, π]. Everything
      // per-slot below is a function of this one number.
      let off = slot.index * step - this.angle - FRONT
      off = Math.atan2(Math.sin(off), Math.cos(off))
      const facing = Math.max(0, Math.cos(off))

      if (!slot.model) {
        slot.pending.rotation.y += dt * 1.2
        slot.pending.rotation.x += dt * 0.7
      }

      // Only the slots facing forward are animated. Idle animation across a
      // dozen skeletons at three-hundred-odd bones each is most of the frame
      // budget on an integrated GPU, and the ones round the back are small,
      // fogged and facing away — nobody can tell they are holding frame 0.
      if (facing > 0.3) for (const seq of slot.sequences) seq.update(dt)
    }

    this.updateDust(dt)
    this.renderer.render(this.scene, this.camera)
  }
}

interface Slot {
  index: number
  pivot: Group
  pending: Mesh
  model: Group | null
  /**
   * One per creature on this slot, because four of these encounters stage two
   * bodies and each carries its own skeleton and its own idle.
   */
  sequences: SequenceManagerLike[]
}

/**
 * The slice of three-m2loader's SequenceManager this file uses.
 *
 * Written out rather than imported because the package ships no types, and a
 * structural three-method interface is a smaller lie than `any` — it says which
 * three calls the barrel depends on, so a loader upgrade that moves one of them
 * is a compile error here rather than a silent T-pose in the browser.
 */
interface SequenceManagerLike {
  listSequences?: () => { id: number; name: string }[]
  playSequence: (id: number, variation?: number) => void
  update: (delta: number) => void
}
