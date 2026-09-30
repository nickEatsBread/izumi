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
}
