<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import { get } from 'svelte/store'
  import { weekRange } from '$lib/anilist/schedule'
  import ScheduleGrid from '$lib/components/schedule/ScheduleGrid.svelte'
  import WatchlistView from '$lib/components/schedule/WatchlistView.svelte'
  import { scheduleDefaultTab, type ScheduleTab } from '$lib/settings/ui'
  import { heroMedia } from '$lib/stores/hero'
  import { offlineMode } from '$lib/stores/offline'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'

  // No hero on this page — clear the shared banner so it doesn't persist.
  heroMedia.set(null)

  const WEEK = 7 * 24 * 3600

  // Offset in whole weeks from the current week (0 = this week).
  let offset = $state(0)

  // Initial tab comes from the setting; switching here is per-visit and never writes back.
  let tab = $state<ScheduleTab>(get(scheduleDefaultTab))

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
<!-- Extra desktop top padding: `p-8` put the title flush against the bottom edge of the 32px window
     titlebar, so the page's top-left content read as a continuation of the window-control row. -->
<div class="px-4 pb-8 pt-5 sm:px-8 sm:pb-8 sm:pt-10">
  <div class="mb-4 flex flex-wrap items-center gap-2 sm:mb-7 sm:gap-4">
    <div class="mr-auto inline-flex rounded-lg bg-secondary p-1 text-sm font-black">
      <button data-focusable onclick={() => (tab = 'schedule')}
        class="rounded-md px-4 py-2 transition-colors {tab === 'schedule' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
        Schedule
      </button>
      <button data-focusable onclick={() => (tab = 'watchlist')}
        class="rounded-md px-4 py-2 transition-colors {tab === 'watchlist' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
        Watchlist
      </button>
    </div>
    {#if tab === 'schedule'}
      <div class="flex items-center gap-1">
        <button data-focusable onclick={() => (offset -= 1)} title="Previous week"
          class="grid size-9 place-items-center rounded-lg bg-secondary hover:bg-accent sm:size-8 sm:rounded-md">
          <ChevronLeft size={19} />
        </button>
        <span class="min-w-[6.8rem] text-center text-xs font-semibold text-muted-foreground sm:min-w-[9rem] sm:text-sm sm:font-normal">{rangeLabel}</span>
        <button data-focusable onclick={() => (offset += 1)} title="Next week"
          class="grid size-9 place-items-center rounded-lg bg-secondary hover:bg-accent sm:size-8 sm:rounded-md">
          <ChevronRight size={19} />
        </button>
      </div>
      {#if offset !== 0}
        <button data-focusable onclick={() => (offset = 0)}
          class="rounded-md bg-secondary px-2.5 py-1.5 text-xs font-bold hover:bg-accent">Today</button>
      {/if}
    {/if}
  </div>

  {#if tab === 'schedule'}
    {#key offset}
      <ScheduleGrid {start} {end} />
    {/key}
  {:else}
    <WatchlistView />
  {/if}
</div>
{/if}
