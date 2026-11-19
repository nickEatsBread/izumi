import { untrack } from 'svelte'
import { replaceState } from '$app/navigation'
import { page } from '$app/state'

/** Show a view's state in the address bar without navigating, so Back and a reload keep it. Safe to
 *  call from an effect: SvelteKit's shallow replaceState leaves `page.url` as it was and hands
 *  `page.state` back as a fresh copy every time, so an effect that compared against `page.url` or
 *  passed `page.state` along re-ran on its own write, forever, and froze the page. The address bar
 *  is compared here instead, and the state is read untracked. */
export function mirrorUrl(next: string): void {
  if (next === location.pathname + location.search) return
  const state = untrack(() => page.state)
  // Rejects while the router is still starting; the view works the same either way.
  replaceState(next, state).catch(() => {})
}
