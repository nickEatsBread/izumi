export type RemainderItem = 'sources' | 'playback'

/** Most consequential first: without a source nothing else in the list matters. */
export const REMAINDER_ORDER: RemainderItem[] = ['sources', 'playback']

export interface SetupReadiness {
  sources: boolean
  playback: boolean
}

