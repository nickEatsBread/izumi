<script lang="ts">
  import ChevronLeft from 'lucide-svelte/icons/chevron-left'
  import ChevronRight from 'lucide-svelte/icons/chevron-right'
  import { weekRange } from '$lib/anilist/schedule'
  import ScheduleGrid from '$lib/components/schedule/ScheduleGrid.svelte'
  import { heroMedia } from '$lib/stores/hero'
  import { offlineMode } from '$lib/stores/offline'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'

  // No hero on this page — clear the shared banner so it doesn't persist.
  heroMedia.set(null)

  const WEEK = 7 * 24 * 3600

  // Offset in whole weeks from the current week (0 = this week).
  let offset = $state(0)

  // Ticking base so the week rolls over if the page is left open across a boundary
  // (Deck parked on the schedule overnight) — a one-shot weekRange would pin last week.
  let nowMs = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => (nowMs = Date.now()), 60_000)
    return () => clearInterval(t)
  })
  const base = $derived(weekRange(new Date(nowMs)))
  const start = $derived(base.start + offset * WEEK)
  const end = $derived(base.end + offset * WEEK)

  const rangeLabel = $derived.by(() => {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    const from = new Date(start * 1000).toLocaleDateString([], opts)
    const to = new Date((end - 1) * 1000).toLocaleDateString([], opts)
    return `${from} – ${to}`
  })
</script>

{#if $offlineMode}
  <OfflineUnavailable title="Schedule is unavailable offline" subtitle="The airing schedule needs a connection. Your downloads are available on the Downloads page." />
{:else}
<div class="px-4 pb-8 pt-5 sm:p-8">
  <div class="mb-6 sm:flex sm:items-center sm:gap-4">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-black sm:text-lg">Schedule</h1>
      {#if offset !== 0}
        <button data-focusable onclick={() => (offset = 0)}
          class="rounded-lg bg-secondary px-3 py-2 text-xs font-bold hover:bg-accent sm:hidden">Today</button>
      {/if}
    </div>
    <div class="mt-4 grid grid-cols-[3rem_1fr_3rem] items-center gap-2 sm:mt-0 sm:flex sm:gap-1">
      <button data-focusable onclick={() => (offset -= 1)} title="Previous week"
        class="grid size-12 place-items-center rounded-xl bg-secondary hover:bg-accent sm:size-8 sm:rounded-md">
        <ChevronLeft size={22} />
      </button>
      <span class="min-w-[9rem] text-center text-base font-semibold text-muted-foreground sm:text-sm sm:font-normal">{rangeLabel}</span>
      <button data-focusable onclick={() => (offset += 1)} title="Next week"
        class="grid size-12 place-items-center rounded-xl bg-secondary hover:bg-accent sm:size-8 sm:rounded-md">
        <ChevronRight size={22} />
      </button>
    </div>
    {#if offset !== 0}
      <button data-focusable onclick={() => (offset = 0)}
        class="hidden rounded-md bg-secondary px-3 py-1 text-xs font-bold hover:bg-accent sm:block">Today</button>
    {/if}
  </div>

  {#key offset}
    <ScheduleGrid {start} {end} />
  {/key}
</div>
{/if}
