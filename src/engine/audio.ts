// Fight music.
//
// One fixed track, `public/music/boss-music.mp3`, plays on every pull. There is
// no picker: the track is part of the fight, not a preference. If the file is
// absent the game runs in silence rather than erroring.
//
// See ATTRIBUTION.md.

// Resolved against Vite's base URL: a project GitHub Pages site is served from
// /<repo>/, so an absolute '/music/...' would look at the domain root and 404.
const TRACK_URL = `${import.meta.env.BASE_URL}music/boss-music.mp3`
const VOLUME = 0.45

let el: HTMLAudioElement | null = null
let available: boolean | null = null
/** In-flight fade, so a restart can cancel it. */
let fadeRaf = 0
/** Ducked while a callout is speaking, so the voice is not fighting the track. */
let ducked = false
let duckRaf = 0
const DUCK_VOLUME = 0.10

export function initMusic(): void {
  if (el || available === false) return
  const a = new Audio(TRACK_URL)
  a.loop = true
  a.volume = VOLUME
  a.preload = 'auto'
  a.addEventListener('canplaythrough', () => { available = true }, { once: true })
  a.addEventListener('error', () => { available = false; el = null }, { once: true })
  el = a
}

export function startMusic(): void {
  if (!el) initMusic()
  const a = el
  if (!a) return

  // Cancel any fade still running. Without this, React StrictMode's
  // mount -> unmount -> remount in development fires stopMusic() immediately
  // after startMusic(), and the old fade then drags the volume to zero and
  // pauses the track a beat after it starts.
  if (fadeRaf) { cancelAnimationFrame(fadeRaf); fadeRaf = 0 }
  a.volume = VOLUME

  if (!a.paused) return   // already playing: leave it alone
  a.currentTime = 0
  // Browsers block autoplay until the user has interacted with the page. By the
  // time a pull starts they have clicked "Pull", so this resolves — but a
  // rejection must never take the game down with it.
  void a.play().catch(() => { available = false })
}

/**
 * Pull the music down under a spoken callout and bring it back after.
 * A trainer that talks over its own soundtrack teaches nothing.
 */
export function duckMusic(on: boolean): void {
  const a = el
  if (!a || ducked === on) return
  ducked = on
  if (duckRaf) { cancelAnimationFrame(duckRaf); duckRaf = 0 }
  const from = a.volume
  const to = on ? DUCK_VOLUME : VOLUME
  const ms = on ? 120 : 420          // duck fast, return gently
  const t0 = performance.now()
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / ms)
    a.volume = from + (to - from) * k
    if (k < 1) duckRaf = requestAnimationFrame(tick)
    else duckRaf = 0
  }
  duckRaf = requestAnimationFrame(tick)
}

export function stopMusic(fadeMs = 900): void {
  const a = el
  if (!a || a.paused) return
  if (fadeRaf) { cancelAnimationFrame(fadeRaf); fadeRaf = 0 }

  const from = VOLUME
  const t0 = performance.now()
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / fadeMs)
    a.volume = from * (1 - k)
    if (k < 1) {
      fadeRaf = requestAnimationFrame(tick)
    } else {
      fadeRaf = 0
      a.pause()
      a.volume = from
    }
  }
  fadeRaf = requestAnimationFrame(tick)
}

/** null until we know; true/false once the track has loaded or failed. */
export function musicAvailable(): boolean | null {
  return available
}
