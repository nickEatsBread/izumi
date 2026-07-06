import { writable, get } from 'svelte/store'

export type ScrubSource = 'touch' | 'pad'
export interface ScrubState {
  active: boolean
  time: number
  source: ScrubSource | null
}

export const scrub = writable<ScrubState>({ active: false, time: 0, source: null })

let commit: (t: number) => void = () => {}

// Wire the commit once (the player's mpv seek). Kept out of the store so the store has no
// Tauri coupling and stays unit-testable.
export function initScrub(seek: (t: number) => void): void {
  commit = seek
}

export function beginScrub(time: number, source: ScrubSource): void {
  scrub.set({ active: true, time, source })
}

export function moveScrub(time: number): void {
  scrub.update((s) => (s.active ? { ...s, time } : s))
}

// Commit the current preview time and deactivate. No-op commit if it was not active.
export function endScrub(): void {
  const s = get(scrub)
  scrub.set({ active: false, time: s.time, source: null })
  if (s.active) commit(s.time)
}
