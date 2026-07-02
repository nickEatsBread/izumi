import { persisted } from 'svelte-persisted-store'

/** Persisted map of `${mediaId}:${episode}` -> last playback position (seconds). */
export const positions = persisted<Record<string, number>>('player-positions', {})

/** Storage key for a given media + episode. */
export const progressKey = (mediaId: number, episode: number) => `${mediaId}:${episode}`

/** True once at least 85% of a known-duration file has been played. */
export const watched = (pos: number, duration: number) => duration > 0 && pos / duration >= 0.85

/** Persist the current playback position for a media + episode. */
export function savePosition(mediaId: number, episode: number, pos: number) {
  positions.update((p) => ({ ...p, [progressKey(mediaId, episode)]: pos }))
}

/** Read the saved playback position (seconds), or 0 if none. */
export function getPosition(mediaId: number, episode: number): number {
  let v = 0
  positions.subscribe((p) => (v = p[progressKey(mediaId, episode)] ?? 0))()
  return v
}

/** Forget the saved position for a media + episode (e.g. once finished). */
export function clearPosition(mediaId: number, episode: number) {
  positions.update((p) => {
    const n = { ...p }
    delete n[progressKey(mediaId, episode)]
    return n
  })
}
