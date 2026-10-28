<script lang="ts">
  import { navigating } from '$app/state'

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
</script>

{#if shown}
  <div data-part="nav.pending" role="progressbar" aria-label="Loading" class="pointer-events-none fixed inset-x-0 top-0 z-[80] h-[3px] overflow-hidden">
    <div data-part="nav.pending.bar" class="indeterminate h-full w-1/3 bg-primary"></div>
  </div>
{/if}
