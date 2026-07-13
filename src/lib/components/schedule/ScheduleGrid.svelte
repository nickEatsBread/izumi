<script lang="ts">
  // Fetches the WHOLE week's airing schedule (paginated) and renders it three ways:
  //  - Game mode (Deck): one scaled day at a time, L1/R1 step between days.
  //  - Desktop 'days':   the same day-at-a-time view, mouse-clickable tabs, no hint.
  //  - Desktop 'agenda': a full-width vertical list of day sections (AgendaWeek).
  // On top of the global feed sits a personalized layer: a My Shows / All toggle that filters the
  // week to the viewer's tracked/watched titles (AniList list + MAL list + local history), a "Next
  // up" countdown strip, and a Watching/Planning badge on your shows even in the All view.
  import { getContextClient } from '@urql/svelte'
  import { listen } from '@tauri-apps/api/event'
  import { SCHEDULE_QUERY } from '$lib/anilist/detail-queries'
  import { groupByDay, weekRange, type Airing } from '$lib/anilist/schedule'
  import {
    loadMySets, classifyMine, isMine, hasMySources, emptyMySets, type MySets, type MineKind,
  } from '$lib/anilist/my-shows'
  import { anilistUserName, malToken } from '$lib/trackers/config'
  import { anilistUser } from '$lib/anilist/account'
  import { localHistory } from '$lib/player/history'
  import { gameMode } from '$lib/player/session'
  import { scheduleLayout } from '$lib/settings/ui'
  import type { Media } from '$lib/anilist/types'
  import DayColumn from './DayColumn.svelte'
  import AgendaWeek from './AgendaWeek.svelte'
  import ScheduleNextUp from './ScheduleNextUp.svelte'

  let { start, end }: { start: number; end: number } = $props()

  const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const client = getContextClient()
  const gm = $derived($gameMode)
  const layout = $derived($scheduleLayout)

  let airings = $state<Airing[]>([])
  let loading = $state(true)
  let error = $state('')

  type PageData = { Page?: { airingSchedules?: Airing[]; pageInfo?: { hasNextPage?: boolean } } }

  // Page through EVERY result for the week (cap is a safety net — a week is ~3–6 pages).
  $effect(() => {
    const s = start, e = end
    let cancelled = false
    ;(async () => {
      loading = true; error = ''
      const all: Airing[] = []
      try {
        for (let page = 1; page <= 12; page++) {
          const r = await client.query(SCHEDULE_QUERY, { start: s, end: e, page }).toPromise()
          if (cancelled) return
          if (r.error) throw new Error(r.error.message)
          const p = (r.data as PageData | undefined)?.Page
          if (p?.airingSchedules?.length) all.push(...p.airingSchedules)
          if (!p?.pageInfo?.hasNextPage) break
        }
        if (!cancelled) airings = all
      } catch (err) {
        if (!cancelled) error = err instanceof Error ? err.message : String(err)
      }
      if (!cancelled) loading = false
    })()
    return () => { cancelled = true }
  })

  // ── Personalization ──────────────────────────────────────────────────────────
  // AniList + MAL sets come from the network (reload when the linked account changes); the local set
  // is folded in reactively so a fresh play shows up without a refetch.
  const listUser = $derived($anilistUserName || $anilistUser)
  let netSets = $state<MySets>(emptyMySets())
  $effect(() => {
    const u = listUser
    void $malToken // re-run when MAL connects/disconnects
    let cancelled = false
    loadMySets(u).then((s) => { if (!cancelled) netSets = s })
    return () => { cancelled = true }
  })
  const sets = $derived<MySets>({ ...netSets, local: new Set(Object.keys($localHistory).map(Number)) })
  const badgeOf = (m: Media): MineKind | null => classifyMine(m, sets)

  // View: My Shows vs All. Default to My Shows once we know the viewer has any source; flips to All
  // for a user with nothing tracked. Sticks once the user picks a side.
  let view = $state<'mine' | 'all'>('all')
  let viewTouched = $state(false)
  $effect(() => { if (!viewTouched) view = hasMySources(sets) ? 'mine' : 'all' })
  const pick = (v: 'mine' | 'all') => { view = v; viewTouched = true }

  const days = $derived(groupByDay(airings, start))
  const mineDays = $derived(days.map((d) => d.filter((a) => isMine(a.media, sets))))
  const shownDays = $derived(view === 'mine' ? mineDays : days)
  const mineCount = $derived(mineDays.reduce((n, d) => n + d.length, 0))

  // Today's column (local weekday) — only when the shown week IS the current week.
  const todayIdx = $derived(start === weekRange(new Date()).start ? (new Date().getDay() + 6) % 7 : -1)
  const isCurrentWeek = $derived(todayIdx >= 0)
  const dayDate = (i: number) =>
    new Date((start + i * 24 * 3600) * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const hasUnaired = (i: number) => shownDays[i]?.some((a) => a.airingAt * 1000 > Date.now()) ?? false

  // Measured height of the sticky header (toggle + Next-up) so the agenda's auto-scroll-to-today
  // lands BELOW it instead of under it.
  let headerH = $state(0)

  // Live-ish clock so the "Next up" countdowns tick without each card owning a timer.
  let now = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000)
    return () => clearInterval(t)
  })

  // Day-view selected day, defaulting to today.
  let selected = $state(-1)
  $effect(() => { if (selected < 0) selected = todayIdx >= 0 ? todayIdx : 0 })

  // Game mode only: L1/R1 (bumpers) step the selected day (wrapping). Bumpers are clean
  // digital buttons — one press = one step — unlike the analog triggers.
  $effect(() => {
    if (!gm) return
    let un: (() => void) | null = null
    listen<{ name: string; pressed: boolean }>('gamepad-input', (ev) => {
      if (!ev.payload.pressed) return
      if (ev.payload.name === 'l1') selected = (selected + 6) % 7
      else if (ev.payload.name === 'r1') selected = (selected + 1) % 7
    }).then((u) => { un = u })
    return () => un?.()
  })
</script>

{#snippet toggle()}
  <div class="mb-4 flex items-center gap-3">
    <div class="inline-flex rounded-lg bg-secondary p-0.5">
      <button data-focusable onclick={() => pick('mine')}
        class="rounded-md px-3 py-1 text-sm font-bold transition-colors
               {view === 'mine' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
        My Shows{#if mineCount}<span class="opacity-70"> · {mineCount}</span>{/if}
      </button>
      <button data-focusable onclick={() => pick('all')}
        class="rounded-md px-3 py-1 text-sm font-bold transition-colors
               {view === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}">
        All
      </button>
    </div>
  </div>
{/snippet}

{#snippet dayView(showHint: boolean)}
  <div class="mb-4 flex gap-1.5">
    {#each SHORT as d, i (d)}
      <button data-focusable onclick={() => (selected = i)}
        class="relative flex-1 rounded-lg py-2 text-center text-sm font-black transition-colors
               {i === selected ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent'}">
        {d}
        <span class="block text-[0.65rem] font-normal opacity-70">{dayDate(i)}</span>
        {#if i === todayIdx}<span class="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-sky-400" title="Today"></span>{/if}
        {#if hasUnaired(i)}<span class="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" title="Episodes still to air"></span>{/if}
      </button>
    {/each}
  </div>
  {#if showHint}
    <p class="mb-3 text-xs text-muted-foreground">L1 / R1 to switch days · <span class="text-sky-400">●</span> today · <span class="text-emerald-400">●</span> still to air</p>
  {/if}
  <DayColumn label={`${FULL[selected]} · ${dayDate(selected)}`} airings={shownDays[selected]} {badgeOf} big />
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
    <button data-focusable onclick={() => pick('all')}
      class="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">See all airing</button>
  </div>
{/snippet}

{#if loading}
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
    {#each Array.from({ length: 7 }) as _}
      <div class="h-64 animate-pulse rounded-md bg-muted"></div>
    {/each}
  </div>
{:else if error}
  <p class="text-muted-foreground">Failed to load schedule: {error}</p>
{:else}
  <!-- Sticky header: the My Shows/All toggle + Next-up stay pinned so switching view or glancing at
       what's next never means scrolling back up past the auto-scrolled agenda. -->
  <div class="sticky top-0 z-20 bg-background pb-1" bind:clientHeight={headerH}>
    {@render toggle()}
    {#if isCurrentWeek}
      <ScheduleNextUp airings={shownDays.flat()} {sets} {now} />
    {/if}
  </div>
  {#if view === 'mine' && mineCount === 0}
    {@render mineEmpty()}
  {:else if gm}
    {@render dayView(true)}
  {:else if layout === 'days'}
    {@render dayView(false)}
  {:else}
    <AgendaWeek days={shownDays} {start} {todayIdx} {badgeOf} headerOffset={headerH} />
  {/if}
{/if}
