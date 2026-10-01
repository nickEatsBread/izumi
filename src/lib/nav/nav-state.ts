import { writable, type Writable } from 'svelte/store'

// Navigation state for nav modules, which never import $app/* (they must stay importable in unit
// tests and from gamepad.ts). The app layout writes it from beforeNavigate/afterNavigate.

/** Bumped by the app layout's beforeNavigate for every navigation it does not cancel. A closing
 *  layer that sees a different epoch leaves focus alone: the page it would return to is going. */
export const navEpoch: Writable<number> = writable(0)
/** True from the app layout's beforeNavigate until the navigation completes, fails or lands. */
export const navInFlight: Writable<boolean> = writable(false)

export function resetNavStateForTests(): void {
  navEpoch.set(0)
  navInFlight.set(false)
  clearBackPending()
}

// --- Back pipeline guard (commit 10, spec §3.8 step 0) -----------------------------------------
// Set when the layered Back starts a history step or a goto (settings/back.ts goUp/leaveSettings,
// the Profiles page's leave()); cleared by the app layout's afterNavigate, or after BACK_PENDING_MS
// when no navigation lands (history.back() with nothing behind it). While it is set, B and the
// system Back are consumed without being evaluated against a page that is about to be replaced.
export const BACK_PENDING_MS = 1500
let backPendingFlag = false
let backPendingTimer: ReturnType<typeof setTimeout> | null = null

export function markBackPending(): void {
  backPendingFlag = true
  if (backPendingTimer !== null) clearTimeout(backPendingTimer)
  backPendingTimer = setTimeout(clearBackPending, BACK_PENDING_MS)
}

export function backPending(): boolean {
  return backPendingFlag
}

export function clearBackPending(): void {
  backPendingFlag = false
  if (backPendingTimer !== null) clearTimeout(backPendingTimer)
  backPendingTimer = null
}
