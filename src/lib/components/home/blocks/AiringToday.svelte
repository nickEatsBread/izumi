<script lang="ts">
  import CircleCheck from '@lucide/svelte/icons/circle-check'
  import Clock from '@lucide/svelte/icons/clock-3'
  import { anilist } from '$lib/anilist/client'
  import { cover, mediaHref, title as mediaTitle } from '$lib/anilist/media'
  import { airTime, weekRange, type Airing } from '$lib/anilist/schedule'
  import { cachedScheduleWeek, loadScheduleWeek } from '$lib/anilist/schedule-cache'
  import type { AiringTodayBlock } from '$lib/home/blocks'
  import { nearViewport } from '$lib/util/near-viewport'

  // Today's airings in time order, the "today's releases" panel of streaming sites: the poster, the
  // title and the local airing time, ticked once it has aired. `clock` adds the date and a live clock
  // under the heading; `more` links to the schedule.
  let { block }: { block: AiringTodayBlock } = $props()

  // The local day, fixed when the block mounts: a Home left open past midnight keeps the day it
  // showed. The week comes from the Schedule page's session cache, so either one warms the other.
  const week = weekRange(new Date())
  const dayStart = (() => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return Math.floor(date.getTime() / 1000)
  })()
  const today = (all: Airing[]) => all.filter((airing) => airing.media && airing.airingAt >= dayStart && airing.airingAt < dayStart + 24 * 3600)
  let visible = $state(false)
  let items = $state.raw<Airing[]>(today(cachedScheduleWeek(week.start, week.end) ?? []))
  let loading = $state(false)
  let error = $state('')
  let retry = $state(0)
  let now = $state(Date.now())
  const shown = $derived(items.slice(0, block.limit))

  $effect(() => {
    if (!visible) return
    void retry
    const controller = new AbortController()
    loading = true
    error = ''
    loadScheduleWeek(anilist, week.start, week.end, controller.signal)
      .then((all) => { items = today(all) })
      .catch((reason) => { if (!controller.signal.aborted) error = reason instanceof Error ? reason.message : String(reason) })
      .finally(() => { if (!controller.signal.aborted) loading = false })
    return () => controller.abort()
  })

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), block.clock ? 1000 : 30_000)
    return () => clearInterval(timer)
  })

  const ordinal = (day: number) => {
    const tens = day % 100
    if (tens >= 11 && tens <= 13) return `${day}th`
    return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`
  }
  const dateLine = $derived.by(() => {
    const date = new Date(now)
    return `${date.toLocaleDateString([], { weekday: 'long' })} ${date.toLocaleDateString([], { month: 'long' })} ${ordinal(date.getDate())},`
  })
  const clockLine = $derived(new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
</script>

<section data-block data-slot="block.airing-today" use:nearViewport={{ onEnter: () => (visible = true) }} class="mb-8 px-4 sm:px-8">
  <div class="mb-3 flex items-baseline justify-between gap-3">
    <h2 data-part="block.title" class="text-lg font-black">{block.title || 'Airing today'}</h2>
    {#if block.more}
      <a data-part="block.more" data-focusable href="/app/schedule" class="text-xs font-bold uppercase tracking-wider text-theme hover:underline">More</a>
    {/if}
  </div>
  {#if block.clock}
    <div data-part="block.clock" class="mb-3 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground">
      <div data-part="block.clock.date">{dateLine}</div>
      <div data-part="block.clock.time">{clockLine}</div>
    </div>
  {/if}
  {#if error}
    <p role="alert" class="mb-2 text-sm text-muted-foreground">{error}</p>
    <button type="button" data-part="button" data-variant="secondary" data-focusable onclick={() => retry++}
      class="mb-3 min-h-9 rounded-md bg-secondary px-4 text-sm font-bold transition hover:bg-accent">Retry</button>
  {:else if !visible || (loading && !items.length)}
    <ul class="flex flex-col gap-2">
      {#each Array.from({ length: Math.min(block.limit, 6) }) as _, index (index)}<li class="h-[3.75rem] rounded-md skeloader"></li>{/each}
    </ul>
  {:else if !shown.length}
    <p class="text-sm text-muted-foreground">Nothing airs today.</p>
  {:else}
    <ul data-nav-row class="flex flex-col gap-1">
      {#each shown as airing (`${airing.media.id}-${airing.episode}-${airing.airingAt}`)}
        {@const aired = airing.airingAt * 1000 <= now}
        <li>
          <a data-part="block.item" data-aired={aired || undefined} data-focusable href={mediaHref(airing.media)} title={`Episode ${airing.episode}`}
             class="flex items-center gap-3 rounded-md p-1.5 transition-colors hover:bg-accent">
            <img data-part="airing.poster" src={cover(airing.media)} alt="" loading="lazy" class="h-14 w-10 shrink-0 rounded object-cover" />
            <div class="min-w-0 flex-1">
              <p data-part="airing.title" class="line-clamp-1 text-sm font-medium">{mediaTitle(airing.media)}</p>
              <p data-part="airing.time" class="mt-1 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                {#if aired}<CircleCheck size={16} class="text-theme" />{:else}<Clock size={16} />{/if}{airTime(airing.airingAt)}
              </p>
            </div>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>
