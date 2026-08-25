<script lang="ts">
  // AnimeSchedule overlay for the detail view: whether the show is on a cour break or has slipped,
  // and the sub/dub release slots in the viewer's local time — none of which AniList has a field
  // for. Renders NOTHING until the lookup lands, so a title AnimeSchedule doesn't carry, an offline
  // session, or an outage all leave the AniList badges exactly as they were.
  import { getScheduleInfo, delayLines, slotLines, scheduleTitles, type ScheduleInfo } from '$lib/anime/animeschedule'
  import type { Media } from '$lib/anilist/types'
  import { offlineMode } from '$lib/stores/offline'
  import CalendarClock from '@lucide/svelte/icons/calendar-clock'

  let { media, toolbar = false }: {
    media: Media
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
  const slotParts = (line: string) => {
    const match = /^(Sub|Dub) airs (.+)$/.exec(line)
    return match ? { kind: match[1], when: match[2] } : { kind: 'Release', when: line }
  }
  // Color is the whole sub/dub marker: a small colored word is legible at a glance without the
  // boxed chips, rings and dividers that made the old segmented box read as a pair of buttons.
  const slotTone = (kind: string) => kind === 'Dub' ? 'text-violet-300' : 'text-sky-300'
</script>

<!-- Delays are warnings and keep a soft chip so they stand out; the recurring slots are ambient
     metadata, so they render as one quiet line of text that sits comfortably inside a metadata
     row (phones) or a toolbar (desktop/Deck) without a box around it. -->
{#each delays as line (line)}
  <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-amber-500/10 px-2.5 text-[0.7rem] font-bold text-amber-200 {toolbar ? 'h-9' : 'h-8'}" title={line}>
    <CalendarClock size={12} />{line}
  </span>
{/each}
{#if slots.length}
  <span class="inline-flex items-center gap-x-2 whitespace-nowrap text-xs text-muted-foreground {toolbar ? 'h-9' : ''}"
        aria-label={slots.join('; ')}>
    <CalendarClock size={13} aria-hidden="true" />
    {#each slots as line, index (line)}
      {@const slot = slotParts(line)}
      {#if index}<span class="opacity-40" aria-hidden="true">·</span>{/if}
      <span class="inline-flex items-baseline gap-1.5">
        <span class="font-black uppercase tracking-wide {slotTone(slot.kind)}">{slot.kind}</span>
        <span class="font-semibold tabular-nums text-foreground/80">{slot.when}</span>
      </span>
    {/each}
  </span>
{/if}
