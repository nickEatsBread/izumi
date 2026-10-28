<script lang="ts">
  import { navigating } from '$app/state'
  import { afterNavigate, onNavigate } from '$app/navigation'

  // A page change that takes a moment (its code loading, a heavy page building) would otherwise
  // leave the old screen standing as if the press did nothing: a bar sweeps along the top until the
  // new page is in. Quick changes never show it.
  const DELAY_MS = 150
  let shown = $state(false)
  $effect(() => {
    if (!navigating.to) {
      shown = false
      return
    }
    const timer = setTimeout(() => (shown = true), DELAY_MS)
    return () => clearTimeout(timer)
  })

  // Building a heavy page blocks the main thread, so the timer above cannot fire until it is done
  // (Back to Home on the Deck: one 0.37 s frame). A page whose last change was slow shows the bar at
  // once instead, and the change waits for it to be painted first.
  const slowPages = new Set<string>()
  let startedAt = 0
  onNavigate((navigation) => {
    startedAt = performance.now()
    const page = navigation.to?.route.id
    if (!page || !slowPages.has(page)) return
    shown = true
    return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  afterNavigate((navigation) => {
    const page = navigation.to?.route.id
    if (!page || navigation.type === 'enter' || !startedAt) return
    if (performance.now() - startedAt > DELAY_MS) slowPages.add(page)
    else slowPages.delete(page)
  })
</script>

{#if shown}
  <div data-part="nav.pending" role="progressbar" aria-label="Loading" class="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[3px] overflow-hidden">
    <div data-part="nav.pending.bar" class="indeterminate h-full w-1/3 bg-primary"></div>
  </div>
{/if}
