import type { AniStatus } from './index'

// Display metadata + cross-tracker mapping for list status, kept out of index.ts so components can
// import labels/colors without pulling the whole tracker runtime.

/** Order shown in the status picker. */
export const STATUS_ORDER: AniStatus[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED', 'REPEATING']

/** Human-readable label per status. */
export const STATUS_LABEL: Record<AniStatus, string> = {
  CURRENT: 'Watching',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  REPEATING: 'Rewatching',
}

/** Dot color per status (hex). */
export const STATUS_COLOR: Record<AniStatus, string> = {
  CURRENT: '#3db4f2',
  PLANNING: '#f79a63',
  COMPLETED: '#6cd36c',
  PAUSED: '#fbbf24',
  DROPPED: '#e85d75',
  REPEATING: '#3baeea',
}

/** MAL status string → AniStatus (reverse of malStatus in index.ts). MAL has no distinct
 *  rewatching status — it uses the is_rewatching flag — so 'watching' maps to CURRENT. */
export function malToAni(s?: string | null): AniStatus | undefined {
  switch (s) {
    case 'watching': return 'CURRENT'
    case 'plan_to_watch': return 'PLANNING'
    case 'completed': return 'COMPLETED'
    case 'on_hold': return 'PAUSED'
    case 'dropped': return 'DROPPED'
    default: return undefined
  }
}

/** Descriptive 0-10 score labels (the canonical izumi score is 0-100 → /10 here). Index 0 = unrated. */
export const SCORE_LABELS: readonly string[] = [
  'Not rated', 'Appalling', 'Horrible', 'Very Bad', 'Bad',
  'Average', 'Fine', 'Good', 'Very Good', 'Great', 'Masterpiece',
]

/** Label for a 0-10 score (rounds + clamps). */
export const scoreLabel = (n0to10: number) => SCORE_LABELS[Math.max(0, Math.min(10, Math.round(n0to10)))]
