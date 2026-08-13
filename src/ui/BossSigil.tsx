import { BOSS_SIGILS } from '../assets/bossSigils'

// The boss's sigil as an inline <svg>, sharing geometry with the canvas so the
// picker shows exactly the shape you will be fighting.

export default function BossSigil({ bossKey, size = 28, colour = '#b79bff' }: {
  bossKey: string; size?: number; colour?: string
}) {
  const s = BOSS_SIGILS[bossKey]
  if (!s) return null
  return (
    <svg
      width={size} height={size} viewBox={s.viewBox}
      aria-hidden="true" focusable="false" className="boss-sigil"
    >
      <path d={s.d} fill={colour} />
    </svg>
  )
}
