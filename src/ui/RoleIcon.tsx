import type { Role } from '../engine/types'

// The three role glyphs, drawn rather than imported: shield for tank, cross for
// healer, sword for dps — the shapes every WoW player already reads instantly.
//
// Vector paths rather than image assets because the same silhouettes are also
// drawn into the canvas at 6-10px for allies, where a detailed icon is mush,
// and because they need to recolour per role.

export const ROLE_COLOUR: Record<Role, string> = {
  tank: '#c69b3a',   // shield gold
  healer: '#3fb950', // cross green
  dps: '#58a6ff',    // blade blue
}

const PATHS: Record<Role, string> = {
  // Shield: flat top, tapering to a point.
  tank: 'M12 2 L21 5.5 V12 C21 17 17 20.8 12 22.5 C7 20.8 3 17 3 12 V5.5 Z',
  // Cross: equal-armed, the universal healer mark.
  healer: 'M9.6 2 H14.4 V9.6 H22 V14.4 H14.4 V22 H9.6 V14.4 H2 V9.6 H9.6 Z',
  // Sword: blade up, crossguard, grip and pommel.
  dps: 'M12 1.5 L14.2 6 V13 H9.8 V6 Z M6.6 13.6 H17.4 V16 H13.3 V20 H15.2 V22 H8.8 V20 H10.7 V16 H6.6 Z',
}

export default function RoleIcon({ role, size = 22, colour }: {
  role: Role; size?: number; colour?: string
}) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      aria-hidden="true" focusable="false" className="role-icon"
    >
      <path d={PATHS[role]} fill={colour ?? ROLE_COLOUR[role]} />
    </svg>
  )
}

/** The same silhouettes as canvas paths, for drawing entities in the arena. */
export const ROLE_PATH_2D: Record<Role, Path2D> = {
  tank: new Path2D(PATHS.tank),
  healer: new Path2D(PATHS.healer),
  dps: new Path2D(PATHS.dps),
}
