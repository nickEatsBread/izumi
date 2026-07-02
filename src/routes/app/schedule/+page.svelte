<script lang="ts">
  import ChevronLeft from 'lucide-svelte/icons/chevron-left'
  import ChevronRight from 'lucide-svelte/icons/chevron-right'
  import { weekRange } from '$lib/anilist/schedule'
  import ScheduleGrid from '$lib/components/schedule/ScheduleGrid.svelte'
  import { heroMedia } from '$lib/stores/hero'

  // No hero on this page — clear the shared banner so it doesn't persist.
  heroMedia.set(null)

  const WEEK = 7 * 24 * 3600

  // Offset in whole weeks from the current week (0 = this week).
  let offset = $state(0)

  const base = weekRange(new Date())
  const start = $derived(base.start + offset * WEEK)
  const end = $derived(base.end + offset * WEEK)

  const rangeLabel = $derived.by(() => {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    const from = new Date(start * 1000).toLocaleDateString([], opts)
    const to = new Date((end - 1) * 1000).toLocaleDateString([], opts)
    return `${from} – ${to}`
  })
</script>

<div class="p-8">
  <div class="mb-6 flex items-center gap-3">
    <h1 class="text-lg font-black">Schedule</h1>
    <div class="flex items-center gap-1">
      <button data-focusable onclick={() => (offset -= 1)} title="Previous week"
        class="grid h-8 w-8 place-items-center rounded-md bg-secondary hover:bg-accent">
        <ChevronLeft size={18} />
      </button>
      <span class="min-w-[9rem] text-center text-sm text-muted-foreground">{rangeLabel}</span>
      <button data-focusable onclick={() => (offset += 1)} title="Next week"
        class="grid h-8 w-8 place-items-center rounded-md bg-secondary hover:bg-accent">
        <ChevronRight size={18} />
      </button>
    </div>
    {#if offset !== 0}
      <button data-focusable onclick={() => (offset = 0)}
        class="rounded-md bg-secondary px-3 py-1 text-xs font-bold hover:bg-accent">Today</button>
    {/if}
  </div>

  {#key offset}
    <ScheduleGrid {start} {end} />
  {/key}
</div>
