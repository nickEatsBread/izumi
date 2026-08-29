<script lang="ts">
  // Fetches the WHOLE week's airing schedule (paginated) and renders it three ways:
  //  - Game mode (Deck): one scaled day at a time, L1/R1 step between days.
  //  - Desktop 'days':   the same day-at-a-time view, mouse-clickable tabs, no hint.
  //  - Desktop 'agenda': a full-width vertical list of day sections (AgendaWeek).
  // On top of the global feed sits a personalized layer: a My Shows / All toggle that filters the
  // week to the viewer's tracked/watched titles (AniList list + MAL list + local history), a "Next
  // up" countdown strip, and a Watching/Planning badge on your shows even in the All view.
  import { getContextClient } from '@urql/svelte'
  import { untrack } from 'svelte'
  import { listenSafe } from '$lib/util/listen'
  import { groupByDay, weekRange, type Airing } from '$lib/anilist/schedule'
  import { cachedScheduleWeek, loadScheduleWeek } from '$lib/anilist/schedule-cache'
  import {
    loadMySets, classifyMine, isMine, hasMySources, emptyMySets, type MySets, type MineKind,
  } from '$lib/anilist/my-shows'
  import {
    delayPlaceholder, getScheduleInfoMany, getWeeklySchedule, mergeScheduleAirings, scheduleTitles,
    type ScheduleInfo,
  } from '$lib/anime/animeschedule'
  import { markAniListDegraded, markCatalogProvider, markJikanCatalogUnavailable } from '$lib/anilist/degraded'
  import { anilistUserName, malToken } from '$lib/trackers/config'
  import { anilistUser } from '$lib/anilist/account'
  import { localHistory } from '$lib/player/history'
  import { gameMode } from '$lib/player/session'
  import { scheduleLayout, scheduleShowNextUp } from '$lib/settings/ui'
  import { isMobile } from '$lib/platform'
  import * as h from '$lib/haptics'
  import type { Media } from '$lib/anilist/types'
  import DayColumn from './DayColumn.svelte'
  import AgendaWeek from './AgendaWeek.svelte'
  import ScheduleNextUp from './ScheduleNextUp.svelte'

  // `view`/`viewTouched` are owned by the page now — the My Shows/All toggle itself renders in the
  // page's header row, beside the Schedule/Watchlist tabs, instead of on its own row below. They
  // stay bindable rather than fully lifted because the default-view effect below needs `sets`,
  // which is loaded here (dragging the AniList/MAL list-loading logic up to the page just to own
  // two booleans would be the wrong trade). `mineCount` is an OUTPUT, not shared state — it is
  // derived here and reported up via `onMineCount` rather than made bindable, so this component
  // isn't reading back a copy of its own derivation. `headerOffset` runs the other direction: it is
  // now measured from the page's own sticky header (which the toggle is part of) and handed down,
  // since this component no longer renders a header row of its own to measure.
  let {
    start, end, headerOffset = 0, onMineCount,
    view = $bindable('mine'), viewTouched = $bindable(false),
  }: {
    start: number; end: number; headerOffset?: number; onMineCount?: (n: number) => void
    view?: 'mine' | 'all'; viewTouched?: boolean
  } = $props()

  const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const client = getContextClient()
  const gm = $derived($gameMode)
  const layout = $derived($scheduleLayout)

  let airings = $state<Airing[]>([])
  let loading = $state(true)
  let error = $state('')

  // Weeks are session-cached and in-flight deduped. Only fetch the week the user requested: an
  // automatic next-week prefetch doubled this screen's AniList page count even when Next was never
  // pressed, delaying visible work behind speculative requests on the 30/minute quota.
  $effect(() => {
    const s = start, e = end
    let cancelled = false
    const controller = new AbortController()
    ;(async () => {
      const cached = cachedScheduleWeek(s, e)
      if (cached) airings = cached
      loading = !cached; error = ''
      try {
        const all = await loadScheduleWeek(client, s, e, controller.signal)
        if (!cancelled) airings = all
      } catch (err) {
        if (!cancelled) {
          const primaryError = err instanceof Error ? err.message : String(err)
          markAniListDegraded(primaryError)
          try {
            const fallback = await getWeeklySchedule(s, e)
            if (!cancelled) {
              airings = fallback
              markCatalogProvider('AnimeSchedule')
            }
          } catch (fallbackError) {
            if (!cancelled) {
              markJikanCatalogUnavailable(fallbackError)
              const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
              error = `Backup schedule unavailable: ${message}`
            }
          }
        }
      }
      if (!cancelled) loading = false
    })()
    return () => { cancelled = true; controller.abort() }
  })

  // ── Personalization ──────────────────────────────────────────────────────────
  // AniList + MAL sets come from the network (reload when the linked account changes); the local set
  // is folded in reactively so a fresh play shows up without a refetch.
  const listUser = $derived($anilistUserName || $anilistUser)
  let netSets = $state<MySets>(emptyMySets())
  let mySetsReady = $state(false)
  $effect(() => {
    const u = listUser
    void $malToken // re-run when MAL connects/disconnects
    let cancelled = false
    mySetsReady = false
    loadMySets(u).then((s) => {
      if (!cancelled) { netSets = s; mySetsReady = true }
    })
    return () => { cancelled = true }
  })
  const sets = $derived<MySets>({ ...netSets, local: new Set(Object.keys($localHistory).map(Number)) })
  const badgeOf = (m: Media): MineKind | null => classifyMine(m, sets)

  // View: My Shows vs All. Default to My Shows once we know the viewer has any source; flips to All
  // for a user with nothing tracked. Sticks once the user picks a side. `view`/`viewTouched` are
  // bindable (owned by the page) — this effect stays here because it needs `sets`, loaded above.
  // Do not infer "no account" from the empty placeholder while AniList/MAL lists are still in
  // flight. That transient inference was why reopening Schedule through the Options sidebar
  // visibly (and sometimes persistently) selected All even though the user never chose it.
  $effect(() => {
    if (!viewTouched && (mySetsReady || sets.local.size > 0)) {
      view = hasMySources(sets) ? 'mine' : 'all'
    }
  })
  // "See all airing" below is a one-week escape hatch out of an empty My Shows view, not a
  // deliberate preference — it must NOT set viewTouched, or a single empty week would permanently
  // opt the viewer out of My Shows for the rest of the session (including weeks that do have their
  // shows). Leaving viewTouched false keeps the default free to reassert itself next week.
  const showAllThisWeek = () => { view = 'all' }

  // AnimeSchedule delay overlay, looked up ONLY for the viewer's own shows: a week of the global
  // feed lists well over a hundred titles, and a break only matters for something you're actually
  // following — so the public API sees a handful of requests instead of a hundred. Rendered in the
  // All view too, since these are the same titles that get the Watching/Planning border.
  let lookedUpDelayInfo = $state<Map<number, ScheduleInfo>>(new Map())
  const scheduledIds = $derived(new Set(airings.map((airing) => airing.media.id)))
  // AniList moves a postponed episode straight to its new week. CURRENT list media fills that gap:
  // only followed shows missing from this week's feed need to be checked for a delay placeholder.
  const missingCurrentMedia = $derived([...sets.aniCurrentMedia.values()].filter((media) =>
    !scheduledIds.has(media.id) && media.nextAiringEpisode?.episode,
  ))
  const scheduledMineMedia = $derived([...new Map(airings.filter((airing) => isMine(airing.media, sets))
    .map((airing) => [airing.media.id, airing.media])).values()])
  // Missing shows go first so the bounded public-API budget can never be consumed by ordinary
  // schedule annotations before it reaches the exact case this restoration exists for.
  const delayCandidates = $derived([...new Map([...missingCurrentMedia, ...scheduledMineMedia]
    .map((media) => [media.id, media])).values()])
  $effect(() => {
    const wanted = delayCandidates
    if (!wanted.length) { lookedUpDelayInfo = new Map(); return }
    let cancelled = false
    getScheduleInfoMany(wanted.map((m) => ({ id: m.id, titles: scheduleTitles(m.title) })))
      .then((map) => { if (!cancelled) lookedUpDelayInfo = map })
    return () => { cancelled = true }
  })
  const restoredDelays = $derived(missingCurrentMedia.flatMap((media) => {
    const airing = delayPlaceholder(media, lookedUpDelayInfo.get(media.id) ?? null, start, end)
    return airing ? [airing] : []
  }))
  const combinedAirings = $derived(mergeScheduleAirings(airings, restoredDelays))
  const days = $derived(groupByDay(combinedAirings, start))
  const mineDays = $derived(days.map((d) => d.filter((a) => isMine(a.media, sets))))
  const shownDays = $derived(view === 'mine' ? mineDays : days)
  // mineCount is an OUTPUT, not shared state: making it bindable meant this component would read a
  // one-flush-stale copy of its own derivation back (an $effect writing a bindable runs AFTER the
  // DOM update), which flashed the mineEmpty state below on every load. Keep it a plain $derived for
  // the local read here, and report it up separately for the page's header badge.
  const mineCount = $derived(mineDays.reduce((n, d) => n + d.length, 0))
  $effect(() => { onMineCount?.(mineCount) })

  const delayInfo = $derived(lookedUpDelayInfo)
  const infoOf = (m: Media): ScheduleInfo | null => delayInfo.get(m.id) ?? null

  // Today's column (local weekday) — only when the shown week IS the current week.
  const todayIdx = $derived(start === weekRange(new Date()).start ? (new Date().getDay() + 6) % 7 : -1)
  const isCurrentWeek = $derived(todayIdx >= 0)
  const dayDate = (i: number) =>
    new Date((start + i * 24 * 3600) * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const hasUnaired = (i: number) => shownDays[i]?.some((a) => a.airingAt * 1000 > Date.now()) ?? false

  // Live-ish clock so the "Next up" countdowns tick without each card owning a timer.
  let now = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(t)
  })

  // Day-view selected day, defaulting to today.
  // Initialize synchronously. On a cached week `loading` becomes false in the first effect flush;
  // the old -1 + later correction rendered shownDays[-1] between those effects and crashed
  // DayColumn, making a quick Previous/Next return look like an endless empty load.
  let selected = $state(untrack(() =>
    start === weekRange(new Date()).start ? (new Date().getDay() + 6) % 7 : 0,
  ))

  // Keep the selected day card centered in the horizontally-scrollable day strip (mobile).
  let dayRow = $state<HTMLElement>()
  $effect(() => {
    const el = dayRow?.children[selected] as HTMLElement | undefined
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  })

  // Game mode only: L1/R1 (bumpers) step the selected day (wrapping). Bumpers are clean
  // digital buttons — one press = one step — unlike the analog triggers.
  $effect(() => {
    if (!gm) return
    return listenSafe<{ name: string; pressed: boolean }>('gamepad-input', (ev) => {
      if (!ev.payload.pressed) return
      if (ev.payload.name === 'l1') selected = (selected + 6) % 7
      else if (ev.payload.name === 'r1') selected = (selected + 1) % 7
    })
  })
</script>

{#snippet dayTabs(showHint: boolean)}
  <div bind:this={dayRow} class="-mx-4 mb-5 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] snap-x sm:mx-0 sm:overflow-visible sm:px-0">
    {#each SHORT as d, i (d)}
      <button data-focusable data-nav-down="schedule-first-airing" onclick={() => { if (i !== selected) h.tap(); selected = i }}
        class="relative h-[5.25rem] w-[7.75rem] shrink-0 snap-center rounded-2xl border text-center text-lg font-black transition-colors sm:h-auto sm:w-auto sm:flex-1 sm:shrink sm:rounded-lg sm:py-3 sm:text-sm
               {i === selected ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border/70 bg-secondary hover:bg-accent'}">
        {d}
        <span class="mt-1 block text-sm font-medium opacity-65 sm:text-[0.65rem]">{dayDate(i)}</span>
        {#if i === todayIdx}<span class="absolute left-2.5 top-2.5 size-2 rounded-full bg-sky-400" title="Today"></span>{/if}
        {#if hasUnaired(i)}<span class="absolute right-2.5 top-2.5 size-2 rounded-full bg-emerald-400" title="Episodes still to air"></span>{/if}
      </button>
    {/each}
  </div>
  {#if showHint}
    <p class="mb-3 text-xs text-muted-foreground">L1 / R1 to switch days · <span class="text-sky-400">●</span> today · <span class="text-emerald-400">●</span> still to air</p>
  {/if}
{/snippet}

{#snippet selectedDay()}
  {#key selected}
    <div class="schedule-day-in">
      <DayColumn label={`${FULL[selected]} · ${dayDate(selected)}`} airings={shownDays[selected]} {badgeOf} {infoOf} big navFirst="schedule-first-airing" />
    </div>
  {/key}
{/snippet}

{#snippet mineEmpty()}
  <div class="rounded-lg border border-border/50 bg-secondary/40 p-8 text-center">
    {#if !hasMySources(sets)}
      <p class="text-sm font-bold">No shows tracked yet</p>
      <p class="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">Link AniList or MyAnimeList in Settings, or start watching something — your airing shows will appear here.</p>
    {:else}
      <p class="text-sm font-bold">None of your shows air this week</p>
      <p class="mt-1 text-xs text-muted-foreground">Try another week, or browse everything airing.</p>
    {/if}
    <button data-focusable onclick={showAllThisWeek}
      class="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">See all airing</button>
  </div>
{/snippet}

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
  <p class="text-muted-foreground">Failed to load schedule: {error}</p>
{:else}
  <div class="schedule-panel-in">
    {#if view === 'mine' && mineCount === 0}
      {@render dayTabs(false)}
      {@render mineEmpty()}
    {:else if gm}
      {@render dayTabs(true)}
      {@render selectedDay()}
    {:else if layout === 'days' || $isMobile}
      {@render dayTabs(false)}
      {#if isCurrentWeek && $scheduleShowNextUp}<ScheduleNextUp airings={shownDays.flat()} {sets} {now} />{/if}
      {@render selectedDay()}
    {:else}
      {#if isCurrentWeek && $scheduleShowNextUp}<ScheduleNextUp airings={shownDays.flat()} {sets} {now} />{/if}
      <AgendaWeek days={shownDays} {start} {todayIdx} {badgeOf} {infoOf} {headerOffset} />
    {/if}
  </div>
{/if}
