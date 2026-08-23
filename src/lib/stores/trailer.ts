import { writable } from 'svelte/store'

// Session-only shared mute state for hover-preview trailers: unmuting one applies
// to every trailer you hover afterwards, for this run only. Deliberately NOT
// persisted — a fresh app launch starts muted again.
export const trailerMuted = writable(true)

export interface TrailerPopupState { id: string; title: string }
/** App-level dialog state. It cannot live inside a hover card: opening a fullscreen overlay causes
 * pointerleave, which unmounts that card and would immediately destroy its own dialog. */
export const trailerPopup = writable<TrailerPopupState | null>(null)
export function openTrailerPopup(id: string, title = 'Trailer') {
  trailerPopup.set({ id, title })
}
export function closeTrailerPopup() { trailerPopup.set(null) }
