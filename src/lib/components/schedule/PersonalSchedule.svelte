<script lang="ts">
  import { untrack } from 'svelte'
  import { groupByDay, weekRange, type Airing } from '$lib/anilist/schedule'
  import { durableHistory } from '$lib/player/history'
  import { loadPersonalSchedule } from '$lib/schedule/personal'
  import { traktToken } from '$lib/trakt/config'
  import {
    loadTraktCalendar,
    mergeCalendarAirings,
    type TraktCalendarFeed,
  } from '$lib/trakt/calendar'
  import { gameMode } from '$lib/player/session'
  import { controllerMode } from '$lib/nav/input'
  import { scheduleLayout } from '$lib/settings/ui'
  import { isMobile } from '$lib/platform'
  import { bumperTabs } from '$lib/nav/bumpers'
  import { onPadButton } from '$lib/nav/pad-events'
  import { topNavLayer } from '$lib/nav/layers'
  import * as h from '$lib/haptics'
  import DayColumn from './DayColumn.svelte'
  import AgendaWeek from './AgendaWeek.svelte'

  let { start, end, headerOffset = 0 }:
    { start: number; end: number; headerOffset?: number } = $props()

  const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const gm = $derived($gameMode || $controllerMode)
  const layout = $derived($scheduleLayout)
  const connected = $derived(Boolean($traktToken))

  const feeds: Array<{ value: TraktCalendarFeed; label: string }> = [
    { value: 'for-you', label: 'For you' },
    { value: 'streaming', label: 'Streaming' },
    { value: 'premieres', label: 'Premieres' },
    { value: 'finales', label: 'Finales' },
    { value: 'hot', label: 'Hot' },
  ]
  const feedCopy: Record<TraktCalendarFeed, { title: string; description: string }> = {
    'for-you': {
      title: 'Your release calendar',
      description: 'Upcoming movies and episodes from your Trakt calendar and local TMDB or Stremio history.',
    },
    streaming: {
      title: 'Streaming releases',
      description: 'Movies becoming available to stream this week across Trakt’s global calendar.',
    },
    premieres: {
      title: 'Season premieres',
      description: 'New and returning seasons beginning this week across the global TV calendar.',
    },
    finales: {
      title: 'Finales',
      description: 'Mid-season, season and series finales airing this week.',
    },
    hot: {
      title: 'Hot releases',
      description: 'Upcoming movies and episodes that are trending or highly anticipated on Trakt.',
    },
  }

  let feed = $state<TraktCalendarFeed>('for-you')

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
    const selectedFeed = feed
    const hasTrakt = Boolean($traktToken)
    if (!hasTrakt && selectedFeed !== 'for-you') {
      feed = 'for-you'
      return
    }
    const controller = new AbortController()
    let cancelled = false
    loading = true
    error = ''
    warning = ''
    const local = selectedFeed === 'for-you'
      ? loadPersonalSchedule(history, rangeStart, rangeEnd, controller.signal)
      : Promise.resolve(null)
    const trakt = hasTrakt
      ? loadTraktCalendar(selectedFeed, rangeStart, rangeEnd, controller.signal)
      : Promise.resolve(null)
    Promise.allSettled([local, trakt])
      .then(([localResult, traktResult]) => {
        if (cancelled) return
        const localValue = localResult.status === 'fulfilled' ? localResult.value : null
        const traktValue = traktResult.status === 'fulfilled' ? traktResult.value : null
        airings = selectedFeed === 'for-you'
          ? mergeCalendarAirings(traktValue ?? [], localValue?.airings ?? [])
          : traktValue ?? []
        historyCount = localValue?.historyCount ?? 0
        movieSeedCount = localValue?.movieSeedCount ?? 0
        const warnings = [localValue?.warning]
        if (localResult.status === 'rejected') warnings.push('Your local history calendar is temporarily unavailable.')
        if (traktResult.status === 'rejected') {
          warnings.push(traktResult.reason instanceof Error ? traktResult.reason.message : String(traktResult.reason))
        }
        warning = warnings.filter(Boolean).join(' ')
        if (localResult.status === 'rejected' && traktResult.status === 'rejected') {
          error = 'Neither the local nor Trakt release calendar could load.'
        }
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
  // Game mode only: the bumpers step the selected day (wrapping): L1/R1, or L2/R2 when a theme's
  // bumper tabs own L1/R1.
  $effect(() => {
    if (!gm) return
    const [prev, next] = $bumperTabs ? ['l2', 'r2'] : ['l1', 'r1']
    return onPadButton(({ name, pressed }) => {
      if (!pressed) return
      // An open nav layer (chooser, dropdown, sheet) owns the pad: the day behind it stays put.
      if (topNavLayer()) return
      if (name === prev) selected = (selected + 6) % 7
      else if (name === next) selected = (selected + 1) % 7
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
  {#if showHint}<p class="mb-3 text-xs text-muted-foreground">{$bumperTabs ? 'L2 / R2' : 'L1 / R1'} to switch days</p>{/if}
{/snippet}

<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h2 class="text-lg font-black">{feedCopy[feed].title}</h2>
    <p class="mt-1 max-w-2xl text-sm text-muted-foreground">
      {feedCopy[feed].description}
    </p>
  </div>
  {#if feed === 'for-you' && historyCount > 0}
    <p class="rounded-full bg-secondary px-3 py-1.5 text-xs font-bold text-muted-foreground">
      {historyCount} {historyCount === 1 ? 'title' : 'titles'} used
    </p>
  {/if}
</div>

<div class="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0" aria-label="Release calendar feed">
  {#each feeds as option (option.value)}
    <button
      type="button"
      data-focusable
      aria-pressed={feed === option.value}
      disabled={!connected && option.value !== 'for-you'}
      title={!connected && option.value !== 'for-you' ? 'Connect Trakt to unlock this calendar' : undefined}
      onclick={() => { if (feed !== option.value) h.tap(); feed = option.value }}
      class="min-h-10 shrink-0 rounded-full border px-4 text-xs font-black transition-colors
        {feed === option.value
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border/70 bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45'}"
    >{option.label}</button>
  {/each}
</div>

{#if !connected}
  <div class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-secondary/50 px-4 py-3">
    <p class="max-w-2xl text-sm text-muted-foreground">Connect Trakt to add your personal calendar plus streaming releases, premieres, finales and hot releases.</p>
    <a data-focusable href="/app/settings/accounts" class="inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-xs font-black text-primary-foreground">Connect Trakt</a>
  </div>
{/if}

{#if warning}
  <div class="mb-5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
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
    <p class="font-bold">The release calendar could not load</p>
    <p class="mt-1 text-sm text-muted-foreground">{error}</p>
  </div>
{:else if feed === 'for-you' && !connected && historyCount === 0}
  {@render dayTabs(false)}
  <div class="rounded-lg border border-border/50 bg-secondary/40 p-8 text-center">
    <p class="text-sm font-bold">No calendar signals yet</p>
    <p class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">Watch a movie or series from TMDB or Stremio, or connect Trakt to bring in your personal release calendar.</p>
  </div>
{:else if airings.length === 0}
  {@render dayTabs(false)}
  <div class="rounded-lg border border-border/50 bg-secondary/40 p-8 text-center">
    <p class="text-sm font-bold">Nothing lands this week</p>
    <p class="mx-auto mt-1 max-w-md text-xs text-muted-foreground">Try another week or choose a different release feed.</p>
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
