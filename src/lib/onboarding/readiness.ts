export type RemainderItem = 'sources' | 'playback' | 'tracker' | 'metadata'

/** Most consequential first: without a source nothing else in the list matters. */
export const REMAINDER_ORDER: RemainderItem[] = ['sources', 'playback', 'tracker', 'metadata']

export interface SetupReadiness {
  sources: boolean
  playback: boolean
  tracker: boolean
  metadata: boolean
}

