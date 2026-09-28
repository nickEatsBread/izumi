// App chrome claims. A surface that brings its own bottom bar (a series page's bottom tabs) claims
// the bottom navigation's place while it is shown, and the page keeps the room at the bottom for that
// bar. A page that only covers the navigation (`detail.nav: "hidden"`) claims it without a bar, and
// the room goes too. The app bar returns when every claim is released.
import { derived, writable } from 'svelte/store'

interface Claim { bar: boolean }

const claims = writable<Claim[]>([])
export const bottomNavSuppressed = derived(claims, (list) => list.length > 0)
/** Whether the page keeps room at the bottom for a bar: the app's navigation, or one in its place. */
export const bottomBarRoom = derived(claims, (list) => !list.length || list.some((claim) => claim.bar))

/** Hide the bottom navigation until the returned release function runs (safe to call twice).
 *  `bar`: the caller draws its own bar in the navigation's place, so the page keeps the room for it. */
export function suppressBottomNav(options: { bar?: boolean } = {}): () => void {
  const claim: Claim = { bar: options.bar ?? false }
  claims.update((list) => [...list, claim])
  let released = false
  return () => {
    if (released) return
    released = true
    claims.update((list) => list.filter((entry) => entry !== claim))
  }
}
