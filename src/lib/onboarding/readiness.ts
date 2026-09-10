import { persisted } from 'svelte-persisted-store'

export type RemainderItem = 'sources' | 'playback' | 'tracker' | 'metadata'

/** Most consequential first: without a source nothing else in the list matters. */
export const REMAINDER_ORDER: RemainderItem[] = ['sources', 'playback', 'tracker', 'metadata']

export interface SetupReadiness {
  sources: boolean
  playback: boolean
  tracker: boolean
  metadata: boolean
}

export function remainderFrom(readiness: SetupReadiness): RemainderItem[] {
  return REMAINDER_ORDER.filter((item) => !readiness[item])
}

/** What setup left undone, so the home screen can offer to finish it. */
export const setupRemainder = persisted<RemainderItem[]>('setup-remainder-v1', [])
/** Set when the user dismisses the whole home card rather than an individual row. */
export const setupChecklistDismissed = persisted<boolean>('setup-checklist-dismissed-v1', false)
