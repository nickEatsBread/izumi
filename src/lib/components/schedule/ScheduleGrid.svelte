<script lang="ts">
  // Fetches the WHOLE week's airing schedule (paginated — a week is far more than one 50-item
  // page, which is why the later days used to be empty) and renders it two ways: the 7-column
  // grid on Desktop, and a scaled one-day-at-a-time view on the Steam Deck (Game mode) where
  // L2/R2 step between days and the current day is highlighted.
  import { getContextClient } from '@urql/svelte'
  import { listen } from '@tauri-apps/api/event'
  import { SCHEDULE_QUERY } from '$lib/anilist/detail-queries'
  import { groupByDay, weekRange, type Airing } from '$lib/anilist/schedule'
  import { gameMode } from '$lib/player/session'
  import DayColumn from './DayColumn.svelte'

  let { start, end }: { start: number; end: number } = $props()

  const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const client = getContextClient()
  const gm = $derived($gameMode)

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

  const days = $derived(groupByDay(airings, start))
  // Today's column (local weekday) — only when the shown week IS the current week.
  const todayIdx = $derived(start === weekRange(new Date()).start ? (new Date().getDay() + 6) % 7 : -1)
  const dayDate = (i: number) =>
    new Date((start + i * 24 * 3600) * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })
  const hasUnaired = (i: number) => days[i]?.some((a) => a.airingAt * 1000 > Date.now()) ?? false

  // Deck day-view: show one day at a time, defaulting to today.
  let selected = $state(-1)
  $effect(() => { if (selected < 0) selected = todayIdx >= 0 ? todayIdx : 0 })

  // Game mode: L1/R1 (bumpers) step the selected day (wrapping). Bumpers are clean digital
  // buttons — one press = one step — unlike the analog triggers, which fire on every value tick.
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

{#if loading}
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
    {#each Array.from({ length: 7 }) as _}
      <div class="h-64 animate-pulse rounded-md bg-muted"></div>
    {/each}
  </div>
{:else if error}
  <p class="text-muted-foreground">Failed to load schedule: {error}</p>
{:else if gm}
  <!-- Steam Deck: day tabs + one scaled day. -->
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
  <p class="mb-3 text-xs text-muted-foreground">L1 / R1 to switch days · <span class="text-sky-400">●</span> today · <span class="text-emerald-400">●</span> still to air</p>
  <DayColumn label={`${FULL[selected]} · ${dayDate(selected)}`} airings={days[selected]} big />
{:else}
  <!-- Desktop: the full week grid. -->
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
    {#each FULL as label, i (label)}
      <DayColumn {label} airings={days[i]} today={i === todayIdx} />
    {/each}
  </div>
{/if}
