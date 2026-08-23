<script lang="ts">
  // AnimeSchedule overlay for the detail badge row: whether the show is on a cour break or has
  // slipped, and the sub/dub release slots in the viewer's local time — none of which AniList has a
  // field for. Renders NOTHING until the lookup lands, so a title AnimeSchedule doesn't carry, an
  // offline session, or an outage all leave the AniList badges exactly as they were.
  import { getScheduleInfo, delayLines, slotLines, scheduleTitles, type ScheduleInfo } from '$lib/anime/animeschedule'
  import type { Media } from '$lib/anilist/types'
  import { offlineMode } from '$lib/stores/offline'
  import CalendarClock from '@lucide/svelte/icons/calendar-clock'

  let { media, compact = false, quiet = false, toolbar = false }: {
    media: Media
    compact?: boolean
    quiet?: boolean
    toolbar?: boolean
  } = $props()

  let info = $state<ScheduleInfo | null>(null)
  $effect(() => {
    if ($offlineMode) return
    const id = media.id
    const titles = scheduleTitles(media.title)
    let cancelled = false
    getScheduleInfo(id, titles).then((i) => { if (!cancelled) info = i })
    return () => { cancelled = true }
  })

  const delays = $derived(delayLines(info))
  const slots = $derived(slotLines(info))
  // Default sizing follows a metadata badge row. `quiet` instead groups SUB/DUB into one muted
  // schedule summary for supporting chrome, where two outlined badges would read like actions.
  const pill = $derived(compact ? 'h-6 px-2.5 text-[0.72rem]' : 'h-6 px-3 text-xs')
  const quietHeight = $derived(toolbar ? 'h-9' : 'h-8')
  const slotParts = (line: string) => {
    const match = /^(Sub|Dub) airs (.+)$/.exec(line)
    return match ? { kind: match[1], when: match[2] } : { kind: 'Release', when: line }
  }
  const slotTone = (kind: string) => kind === 'Dub'
    ? 'bg-violet-400/15 text-violet-200 ring-violet-300/15'
    : 'bg-sky-400/15 text-sky-200 ring-sky-300/15'
</script>

{#if quiet}
  {#each delays as line (line)}
    <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-amber-500/10 px-2.5 text-[0.7rem] font-bold text-amber-200 {quietHeight}" title={line}>
      <CalendarClock size={12} />{line}
    </span>
  {/each}
  {#if slots.length}
    <span class="inline-flex items-stretch overflow-hidden rounded-lg border border-border/70 bg-secondary/45 shadow-sm {quietHeight}"
          aria-label={slots.join('; ')}>
      <span class="grid w-8 shrink-0 place-items-center border-r border-border/60 text-muted-foreground" aria-hidden="true">
        <CalendarClock size={13} />
      </span>
      {#each slots as line, index (line)}
        {@const slot = slotParts(line)}
        <span class="inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 {index ? 'border-l border-border/60' : ''}">
          <span class="rounded px-1.5 py-0.5 text-[0.58rem] font-black uppercase leading-none tracking-[0.08em] ring-1 {slotTone(slot.kind)}">{slot.kind}</span>
          <span class="text-[0.72rem] font-semibold tabular-nums text-foreground/85">{slot.when}</span>
        </span>
      {/each}
    </span>
  {/if}
{:else}
  {#each delays as line (line)}
    <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-300/25 bg-amber-500/20 font-black text-amber-100 shadow-sm {pill}">
      <CalendarClock size={compact ? 11 : 13} />{line}
    </span>
  {/each}
  {#each slots as line (line)}
    {@const slot = slotParts(line)}
    <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-sky-300/20 bg-sky-500/15 font-bold shadow-sm {pill}"
          aria-label={line}>
      <CalendarClock size={compact ? 11 : 13} class="shrink-0 text-sky-300" />
      <span class="font-black uppercase tracking-wide text-sky-300">{slot.kind}</span>
      <span class="text-foreground">{slot.when}</span>
    </span>
  {/each}
{/if}
