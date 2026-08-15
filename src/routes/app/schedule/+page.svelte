<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import { get } from 'svelte/store'
  import { weekRange } from '$lib/anilist/schedule'
  import ScheduleGrid from '$lib/components/schedule/ScheduleGrid.svelte'
  import WatchlistView from '$lib/components/schedule/WatchlistView.svelte'
  import { scheduleDefaultTab, scheduleStickyHeader, type ScheduleTab } from '$lib/settings/ui'
  import { heroMedia } from '$lib/stores/hero'
  import { offlineMode } from '$lib/stores/offline'
  import { gameMode } from '$lib/player/session'
  import { isMobile } from '$lib/platform'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import { anilistDegraded } from '$lib/anilist/degraded'

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

  // My Shows/All toggle — used to live on its own row inside ScheduleGrid, which cost a phone a
  // whole row of vertical space for one binary choice. It now renders here, beside the
  // Schedule/Watchlist tabs, and its filtering state is bound down into ScheduleGrid instead of
  // owned there, so this header can render it without also owning the AniList/MAL list-loading
  // logic that used to size it.
  let view = $state<'mine' | 'all'>('all')
  let viewTouched = $state(false)
  let mineCount = $state(0)
  const pick = (v: 'mine' | 'all') => { view = v; viewTouched = true }

  // The desktop window titlebar is a 32px `fixed` bar whose drag region spans the FULL width, so a
  // `top-0` sticky header pinned underneath it would sit behind the window controls and swallow
  // clicks. Park it just below instead. Mobile has no titlebar, only the status-bar inset.
  const TITLEBAR_H = 32
  let headerH = $state(0)
  // Game mode never pinned this header: gamescope repaints a backdrop-blur bar every scroll frame
  // (app.css forces will-change:auto under .gamemode, so the layer is never promoted), and the
  // controller UI has no need for a sticky filter it can reach with one D-pad press.
  const stickyActive = $derived(tab === 'schedule' && $scheduleStickyHeader && !$gameMode)
  const stickyTop = $derived($isMobile
    ? ($anilistDegraded ? 'top-[calc(env(safe-area-inset-top)+1.75rem)]' : 'top-[env(safe-area-inset-top)]')
    : ($anilistDegraded ? 'top-[3.75rem]' : 'top-8'))
  // What the header actually occludes at the top of the viewport: itself plus the titlebar above
  // it. Handed down to ScheduleGrid, which forwards it to the agenda view's scroll-to-today gate.
  const headerOffset = $derived(stickyActive
    ? headerH + ($isMobile ? 0 : TITLEBAR_H) + ($anilistDegraded ? 28 : 0)
    : 0)
</script>

{#if $offlineMode}
  <OfflineUnavailable title="Schedule is unavailable offline" subtitle="The airing schedule needs a connection. Your downloads are available on the Downloads page." />
{:else}
<!-- Extra desktop top padding: `p-8` put the title flush against the bottom edge of the 32px window
     titlebar, so the page's top-left content read as a continuation of the window-control row. -->
<div class="px-4 pb-8 pt-5 sm:px-8 sm:pb-8 sm:pt-10
            {$anilistDegraded ? 'pt-[3rem] sm:pt-[4.25rem]' : ''}">
  <!-- The global desktop titlebar is transparent so hero artwork can extend to the window edge.
       Schedule has no hero, though, and its rows would remain visible through that strip once this
       page's toolbar became sticky. Paint only that reserved 32px titlebar area while pinned; the
       real titlebar stays above it at z-50, so the window controls and drag region are unchanged. -->
  {#if stickyActive && !$isMobile}
    <div data-schedule-titlebar-shield aria-hidden="true" class="pointer-events-none fixed inset-x-0 top-0 z-20 h-8 bg-background"></div>
  {/if}

  <!-- Schedule/Watchlist tabs, week nav, and (schedule tab only) the My Shows/All filter all share
       one header row so a phone spends a single row on controls instead of two. Wraps on narrow
       widths rather than squashing — this row already carried week nav before the filter joined
       it. Gets the sticky toolbar treatment only while actually pinned, so the plain tab row isn't
       boxed in when the "Pin schedule header" setting is off. -->
  <div bind:clientHeight={headerH}
       class="flex flex-wrap items-center gap-2 sm:gap-4 {stickyActive
         ? `sticky ${stickyTop} z-20 -mx-4 mb-4 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:mb-7 sm:px-8`
         : 'mb-4 sm:mb-7'}">
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
      <div class="inline-flex rounded-lg bg-secondary p-0.5">
        <button data-focusable onclick={() => pick('mine')}
          class="flex items-center rounded-md px-3 py-1.5 text-sm font-bold transition-colors
                 {view === 'mine' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
          <span>My Shows</span>{#if mineCount}<span class="ml-1.5 opacity-70">· {mineCount}</span>{/if}
        </button>
        <button data-focusable onclick={() => pick('all')}
          class="rounded-md px-3 py-1.5 text-sm font-bold transition-colors
                 {view === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
          All
        </button>
      </div>
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
      <ScheduleGrid {start} {end} {headerOffset} bind:view bind:viewTouched onMineCount={(n) => (mineCount = n)} />
    {/key}
  {:else}
    <WatchlistView />
  {/if}
</div>
{/if}
