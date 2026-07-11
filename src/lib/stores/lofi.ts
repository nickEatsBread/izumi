import { persisted } from 'svelte-persisted-store'

// Lo-fi background music. Tracks live on the first-party quack.si CDN (same infra
// as the updater endpoint). Kept as pure helpers + one persisted store so the
// component stays thin and the logic is unit-testable.

/** Base CDN for the lo-fi tracks. */
export const LOFI_BASE = 'https://lofmu-prod-pubdist.quack.si'
/** Number of tracks: lof1.ogg … lof4.ogg. */
export const LOFI_COUNT = 4

/** Absolute URL for a 0-based track index. */
export const lofiUrl = (i: number) => `${LOFI_BASE}/lof${i + 1}.ogg`

/** Next track index, wrapping across [0, LOFI_COUNT). */
export const nextTrack = (i: number) => (i + 1) % LOFI_COUNT
/** Previous track index, wrapping across [0, LOFI_COUNT). */
export const prevTrack = (i: number) => (i - 1 + LOFI_COUNT) % LOFI_COUNT

/** Persisted last-selected track (0-based). The ON/OFF playback state is
 *  deliberately NOT persisted — playback always starts OFF and never auto-plays. */
export const lofiTrack = persisted<number>('lofi-track', 0)
