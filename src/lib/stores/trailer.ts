import { writable } from 'svelte/store'

// Session-only shared mute state for hover-preview trailers: unmuting one applies
// to every trailer you hover afterwards, for this run only. Deliberately NOT
// persisted — a fresh app launch starts muted again.
export const trailerMuted = writable(true)
