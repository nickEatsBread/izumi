import { get, writable } from 'svelte/store'
import { isMobile, isTv } from '$lib/platform'
import { gameMode } from '$lib/player/session'
import { controllerMode } from '$lib/nav/input'
import { trailerOpenMode, type TrailerOpenMode } from '$lib/settings/ui'

// Session-only shared mute state for hover-preview trailers: unmuting one applies
// to every trailer you hover afterwards, for this run only. Deliberately NOT
// persisted — a fresh app launch starts muted again.
export const trailerMuted = writable(true)
// The same for hero and series backdrop trailers, kept apart so neither surface unmutes the other.
export const backdropTrailerMuted = writable(true)
/** Hover-preview trailers currently mounted; backdrop trailers hold while any is, so two never play at once. */
export const hoverTrailers = writable(0)

/** Where a trailer opens. TV, Game mode and a controller always get the full-window player and
 *  phones the popup; a desktop with mouse and keyboard follows the setting. */
export function trailerOpensIn(input: { setting: TrailerOpenMode; tv: boolean; gameMode: boolean; controller: boolean; mobile: boolean }): TrailerOpenMode {
  if (input.tv || input.gameMode) return 'player'
  if (input.mobile) return 'popup'
  return input.controller ? 'player' : input.setting
}

/** `mode` is decided when it opens: TrailerDialog shows a `popup`, TrailerPlayer a `player`. */
export interface TrailerPopupState { id: string; title: string; mode: TrailerOpenMode }
/** App-level dialog state. It cannot live inside a hover card: opening a fullscreen overlay causes
 * pointerleave, which unmounts that card and would immediately destroy its own dialog. */
export const trailerPopup = writable<TrailerPopupState | null>(null)
export function openTrailerPopup(id: string, title = 'Trailer') {
  const mode = trailerOpensIn({
    setting: get(trailerOpenMode), tv: get(isTv), gameMode: get(gameMode), controller: get(controllerMode), mobile: get(isMobile),
  })
  trailerPopup.set({ id, title, mode })
}
export function closeTrailerPopup() { trailerPopup.set(null) }
