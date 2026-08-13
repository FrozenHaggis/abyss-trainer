import type { BossDef } from '../engine/types'
import { nekzali } from './nekzali'
import { sentinels } from './sentinels'
import { vashnik } from './vashnik'
import { explorers } from './explorers'
import { sszorak } from './sszorak'
import { twinfangs } from './twinfangs'
import { coiledaltar } from './coiledaltar'
import { ulatek } from './ulatek'

// The raid, in encounter order. Adding a boss is a data edit: author the file,
// import it, add it here. A test fails if a boss file exists but is not wired.
export const BOSSES: BossDef[] = [
  nekzali,
  sentinels,
  vashnik,
  explorers,
  sszorak,
  twinfangs,
  coiledaltar,
  ulatek,
]

export function bossByKey(key: string): BossDef | undefined {
  return BOSSES.find(b => b.key === key)
}
