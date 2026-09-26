// App chrome claims. A surface that brings its own bottom bar (a series page's bottom tabs) claims
// the bottom navigation's place while it is shown; the app bar returns when every claim is released.
import { derived, writable } from 'svelte/store'

const claims = writable(0)
export const bottomNavSuppressed = derived(claims, (count) => count > 0)

/** Hide the bottom navigation until the returned release function runs (safe to call twice). */
export function suppressBottomNav(): () => void {
  claims.update((count) => count + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    claims.update((count) => Math.max(0, count - 1))
  }
}
