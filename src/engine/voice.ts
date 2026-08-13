// Spoken callouts, using the browser's built-in speech synthesis.
//
// This is the closest thing to having a raid leader on comms: when a mechanic
// first appears you hear its name and what good execution looks like, and when
// you are about to fail one you hear the instruction — so you can keep your eyes
// on the arena instead of reading a banner.
//
// No dependency and no API key: SpeechSynthesis ships in every current browser.
//
// The hard part is restraint. A trainer that narrates everything is worse than
// silence, so there are three rules:
//   1. One thing at a time. An urgent instruction cancels a leisurely one.
//   2. Never repeat the same line inside a cooldown window.
//   3. Verbs are barked, teaching lines are spoken. Different rate and pitch.

import { duckMusic } from './audio'

let enabled = true
let lastSaid = ''
let lastAt = 0
let ready = false
/** How many utterances are in flight, so the duck lifts only when all are done. */
let speaking = 0
/** performance.now() until which a teaching line is being delivered. */
let teachingUntil = 0

/**
 * True while a teaching callout is being spoken. The arena slows down for this
 * so you can actually hear what a mechanic is before it lands on you — the
 * information is useless if it arrives while you are already dodging.
 */
export function isTeaching(): boolean {
  return enabled && performance.now() < teachingUntil
}

export function voiceSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function setVoiceEnabled(on: boolean): void {
  enabled = on
  if (!on && voiceSupported()) {
    window.speechSynthesis.cancel()
    speaking = 0
    teachingUntil = 0
    duckMusic(false)
  }
}

export function voiceEnabled(): boolean {
  return enabled
}

/**
 * Warm the engine up. Some browsers load voices asynchronously and drop the
 * first utterance, which is exactly the one that matters.
 */
export function initVoice(): void {
  if (!voiceSupported() || ready) return
  ready = true
  window.speechSynthesis.getVoices()
}

function pickVoice(): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis.getVoices()
  if (!all.length) return null
  // Prefer a British English voice for the raid-leader feel, then any English.
  return all.find(v => /en[-_]GB/i.test(v.lang))
    ?? all.find(v => /^en/i.test(v.lang))
    ?? all[0]
}

interface SayOpts {
  /** Cancels whatever is speaking. Use for instructions, not for teaching. */
  urgent?: boolean
  /** Minimum ms before this exact line may be spoken again. */
  cooldownMs?: number
  rate?: number
  pitch?: number
}

export function say(text: string, opts: SayOpts = {}): void {
  if (!enabled || !voiceSupported() || !text) return
  const now = performance.now()
  const { urgent = false, cooldownMs = 4000, rate = 1, pitch = 1 } = opts

  if (text === lastSaid && now - lastAt < cooldownMs) return
  // Don't stack chatter on top of chatter unless this is urgent.
  if (!urgent && window.speechSynthesis.speaking) return

  if (urgent) window.speechSynthesis.cancel()
  lastSaid = text
  lastAt = now

  const u = new SpeechSynthesisUtterance(text)
  const v = pickVoice()
  if (v) u.voice = v
  u.rate = rate
  u.pitch = pitch
  u.volume = 1
  speaking++
  duckMusic(true)
  const done = () => {
    speaking = Math.max(0, speaking - 1)
    if (speaking === 0) duckMusic(false)
  }
  u.onend = done
  u.onerror = done
  window.speechSynthesis.speak(u)
}

/** A mechanic just appeared for the first time: name it and teach it. */
export function sayMechanic(name: string, good: string): void {
  // Trim the trailing detail — spoken, a long sentence arrives too late to help.
  const short = good.split(/[.;]/)[0]
  const line = `${name}. ${short}`
  // Hold the arena for roughly as long as the line takes to say. Speech APIs do
  // not report duration up front, so estimate from length and cap it — a long
  // teaching line must never freeze the fight for an unreasonable stretch.
  const estMs = Math.min(4200, 700 + line.length * 55)
  teachingUntil = performance.now() + estMs
  say(line, { rate: 1.02, cooldownMs: 30000 })
}

/** An instruction, barked. Interrupts anything else. */
export function sayVerb(verb: string): void {
  say(verb, { urgent: true, cooldownMs: 2600, rate: 1.18, pitch: 1.1 })
}

export function stopVoice(): void {
  if (voiceSupported()) window.speechSynthesis.cancel()
  speaking = 0
  teachingUntil = 0
  duckMusic(false)
}
