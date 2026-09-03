<script lang="ts">
  import { untrack } from 'svelte'
  import { groupByDay, weekRange, type Airing } from '$lib/anilist/schedule'
  import { durableHistory } from '$lib/player/history'
  import { loadPersonalSchedule } from '$lib/schedule/personal'
  import { gameMode } from '$lib/player/session'
  import { controllerMode } from '$lib/nav/input'
  import { scheduleLayout } from '$lib/settings/ui'
  import { isMobile } from '$lib/platform'
  import { listenSafe } from '$lib/util/listen'
  import * as h from '$lib/haptics'
  import DayColumn from './DayColumn.svelte'
  import AgendaWeek from './AgendaWeek.svelte'

  let { start, end, headerOffset = 0 }:
    { start: number; end: number; headerOffset?: number } = $props()

  const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const gm = $derived($gameMode || $controllerMode)
  const layout = $derived($scheduleLayout)

  let airings = $state<Airing[]>([])
  let loading = $state(true)
  let error = $state('')
  let warning = $state('')
  let historyCount = $state(0)
  let movieSeedCount = $state(0)

  $effect(() => {
    const history = $durableHistory
    const rangeStart = start
    const rangeEnd = end
    const controller = new AbortController()
    let cancelled = false
    loading = true
    error = ''
    warning = ''
    loadPersonalSchedule(history, rangeStart, rangeEnd, controller.signal)
      .then((result) => {
        if (cancelled) return
        airings = result.airings
        historyCount = result.historyCount
        movieSeedCount = result.movieSeedCount
        warning = result.warning
      })
      .catch((reason) => {
        if (!cancelled) error = reason instanceof Error ? reason.message : String(reason)
      })
      .finally(() => { if (!cancelled) loading = false })
    return () => { cancelled = true; controller.abort() }
  })

  const days = $derived(groupByDay(airings, start))
  const todayIdx = $derived(start === weekRange(new Date()).start ? (new Date().getDay() + 6) % 7 : -1)
  const dayDate = (index: number) =>
    new Date((start + index * 24 * 3600) * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })

  let selected = $state(untrack(() =>
    start === weekRange(new Date()).start ? (new Date().getDay() + 6) % 7 : 0,
  ))
  let dayRow = $state<HTMLElement>()
  $effect(() => {
    const element = dayRow?.children[selected] as HTMLElement | undefined
    element?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  })
  $effect(() => {
    if (!gm) return
    return listenSafe<{ name: string; pressed: boolean }>('gamepad-input', (event) => {
      if (!event.payload.pressed) return
      if (event.payload.name === 'l1') selected = (selected + 6) % 7
      else if (event.payload.name === 'r1') selected = (selected + 1) % 7
    })
  })
</script>

{#snippet dayTabs(showHint: boolean)}
  <div bind:this={dayRow} class="-mx-4 mb-5 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] snap-x sm:mx-0 sm:overflow-visible sm:px-0">
    {#each SHORT as day, index (day)}
      <button
        data-focusable
        data-nav-down="schedule-first-airing"
        onclick={() => { if (index !== selected) h.tap(); selected = index }}
        class="relative h-[5.25rem] w-[7.75rem] shrink-0 snap-center rounded-2xl border text-center text-lg font-black transition-colors sm:h-auto sm:w-auto sm:flex-1 sm:shrink sm:rounded-lg sm:py-3 sm:text-sm
          {index === selected ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border/70 bg-secondary hover:bg-accent'}"
      >
        {day}
        <span class="mt-1 block text-sm font-medium opacity-65 sm:text-[0.65rem]">{dayDate(index)}</span>
        {#if index === todayIdx}<span class="absolute left-2.5 top-2.5 size-2 rounded-full bg-sky-400" title="Today"></span>{/if}
      </button>
    {/each}
  </div>
  {#if showHint}<p class="mb-3 text-xs text-muted-foreground">L1 / R1 to switch days</p>{/if}
{/snippet}

<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h2 class="text-lg font-black">From your watch history</h2>
    <p class="mt-1 max-w-2xl text-sm text-muted-foreground">
      New episodes from watched TMDB and Stremio series, plus regional movie premieres matched to your genres.
    </p>
  </div>
  {#if historyCount > 0}
    <p class="rounded-full bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground">
      {historyCount} {historyCount === 1 ? 'title' : 'titles'} used
    </p>
  {/if}
</div>

{#if warning}
  <div class="mb-5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
    {warning}
    {#if movieSeedCount > 0}<a data-focusable href="/app/settings/catalog" class="ml-1 font-black underline underline-offset-4">Open settings</a>{/if}
  </div>
{/if}

{#if loading}
  <div class="-mx-4 flex gap-3 overflow-hidden px-4 sm:mx-0 sm:px-0">
    {#each Array.from({ length: 4 }) as _}
      <div class="skeloader h-[5.25rem] w-[7.75rem] shrink-0 rounded-2xl sm:flex-1"></div>
    {/each}
  </div>
  <div class="mt-6 space-y-4">
    {#each Array.from({ length: 4 }) as _}
      <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3"><div class="skeloader mt-2 h-4 rounded"></div><div class="skeloader h-28 rounded-xl"></div></div>
    {/each}
  </div>
{:else if error}
  <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-5">
    <p class="font-bold">The personal schedule could not load</p>
    <p class="mt-1 text-sm text-muted-foreground">{error}</p>
  </div>
{:else if historyCount === 0}
  {@render dayTabs(false)}
  <div class="rounded-lg border border-border/50 bg-secondary/40 p-8 text-center">
    <p class="text-sm font-bold">No TMDB or Stremio history yet</p>
    <p class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">Watch a movie or series from either catalog. Its future episodes and matching movie premieres will appear here.</p>
  </div>
{:else if airings.length === 0}
  {@render dayTabs(false)}
  <div class="rounded-lg border border-border/50 bg-secondary/40 p-8 text-center">
    <p class="text-sm font-bold">Nothing lands this week</p>
    <p class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">Try another week. The calendar refreshes from your saved watch history each time it opens.</p>
  </div>
{:else}
  <div class="schedule-panel-in">
    {#if gm}
      {@render dayTabs(true)}
      {#key selected}
        <div class="schedule-day-in">
          <DayColumn label={`${FULL[selected]} · ${dayDate(selected)}`} airings={days[selected]} big navFirst="schedule-first-airing" />
        </div>
      {/key}
    {:else if layout === 'days' || $isMobile}
      {@render dayTabs(false)}
      {#key selected}
        <div class="schedule-day-in">
          <DayColumn label={`${FULL[selected]} · ${dayDate(selected)}`} airings={days[selected]} big navFirst="schedule-first-airing" />
        </div>
      {/key}
    {:else}
      <AgendaWeek {days} {start} {todayIdx} {headerOffset} />
    {/if}
  </div>
{/if}
