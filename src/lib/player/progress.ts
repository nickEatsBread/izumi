import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'

/** Saved playback state for a media + episode: last position + known duration (seconds). */
export interface Pos { pos: number; dur: number }

/** Persisted map of `${mediaId}:${episode}` -> `{ pos, dur }`. */
export const positions = persisted<Record<string, Pos>>('player-positions', {})

/** Storage key for a given media + episode. */
export const progressKey = (mediaId: number, episode: number) => `${mediaId}:${episode}`

/** True once at least 85% of a known-duration file has been played. */
export const watched = (pos: number, duration: number) => duration > 0 && pos / duration >= 0.85

/** Normalized fraction for one saved position, clamped for safe progress-bar rendering. */
export function positionPercent(position?: Pos): number {
  if (!position || position.dur <= 0) return 0
  return Math.min(1, Math.max(0, position.pos / position.dur))
}

/** Persist the current playback position (and duration, when known) for a media + episode. */
export function savePosition(mediaId: number, episode: number, pos: number, dur = 0) {
  positions.update((p) => {
    const k = progressKey(mediaId, episode)
    return { ...p, [k]: { pos, dur: dur || p[k]?.dur || 0 } }
  })
}

/** Read the saved playback position (seconds), or 0 if none. */
export function getPosition(mediaId: number, episode: number): number {
  return get(positions)[progressKey(mediaId, episode)]?.pos ?? 0
}

/** Fraction watched (0..1) for a media + episode, from position/duration; 0 if unknown. */
export function episodePercent(mediaId: number, episode: number): number {
  return positionPercent(get(positions)[progressKey(mediaId, episode)])
}

/** Forget the saved position for a media + episode (e.g. once finished). */
export function clearPosition(mediaId: number, episode: number) {
  positions.update((p) => {
    const n = { ...p }
    delete n[progressKey(mediaId, episode)]
    return n
  })
}
