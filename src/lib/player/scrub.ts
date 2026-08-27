import { derived, writable, get } from 'svelte/store'

export type ScrubSource = 'touch' | 'pad' | 'dpad'
export interface ScrubState {
  active: boolean
  time: number
  source: ScrubSource | null
}

export const scrub = writable<ScrubState>({ active: false, time: 0, source: null })
export const scrubActive = derived(scrub, ($scrub) => $scrub.active)

let commit: (t: number, source: ScrubSource) => void = () => {}
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
export function initScrub(seek: (t: number, source: ScrubSource) => void): void {
  commit = seek
}

export function beginScrub(time: number, source: ScrubSource): void {
  cancelPending()
  scrub.set({ active: true, time, source })
}

export function moveScrub(time: number, immediate = false): void {
  if (!get(scrub).active) return
  // Gamescope already frame-paces touch and controller input. Adding another browser rAF here,
  // followed by the native-overlay scheduler's own turn, put the visible knob one or two frames
  // behind the user's finger. Direct-manipulation callers bypass that queue; desktop hover can
  // retain the coalescing path.
  if (immediate) {
    cancelPending()
    applyMove(time)
    return
  }
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
  if (s.active && s.source) commit(s.time, s.source)
  // Dispatch the final seek before the reactive pause effect sees an inactive scrub and resumes
  // playback. This preserves command order at release instead of briefly resuming the old frame.
  scrub.set({ active: false, time: s.time, source: null })
}
