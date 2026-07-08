import { derived, writable, get } from 'svelte/store'

export type ScrubSource = 'touch' | 'pad'
export interface ScrubState {
  active: boolean
  time: number
  source: ScrubSource | null
}

export const scrub = writable<ScrubState>({ active: false, time: 0, source: null })
export const scrubActive = derived(scrub, ($scrub) => $scrub.active)

let commit: (t: number) => void = () => {}
let raf = 0
let pendingTime: number | null = null

function applyMove(time: number): void {
  scrub.update((s) => (s.active && s.time !== time ? { ...s, time } : s))
}

function cancelPending(): void {
  pendingTime = null
  if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
  raf = 0
}

function flushPending(): void {
  if (pendingTime == null) return
  const time = pendingTime
  cancelPending()
  applyMove(time)
}

// Wire the commit once (the player's mpv seek). Kept out of the store so the store has no
// Tauri coupling and stays unit-testable.
export function initScrub(seek: (t: number) => void): void {
  commit = seek
}

export function beginScrub(time: number, source: ScrubSource): void {
  cancelPending()
  scrub.set({ active: true, time, source })
}

export function moveScrub(time: number): void {
  if (!get(scrub).active) return
  if (typeof requestAnimationFrame === 'function') {
    pendingTime = time
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      flushPending()
    })
    return
  }
  applyMove(time)
}

// Commit the current preview time and deactivate. No-op commit if it was not active.
export function endScrub(): void {
  flushPending()
  const s = get(scrub)
  scrub.set({ active: false, time: s.time, source: null })
  if (s.active) commit(s.time)
}
