<script lang="ts">
  // AnimeSchedule overlay for the detail badge row: whether the show is on a cour break or has
  // slipped, and the sub/dub release slots in the viewer's local time — none of which AniList has a
  // field for. Renders NOTHING until the lookup lands, so a title AnimeSchedule doesn't carry, an
  // offline session, or an outage all leave the AniList badges exactly as they were.
  import { getScheduleInfo, delayLines, slotLines, scheduleTitles, type ScheduleInfo } from '$lib/anime/animeschedule'
  import type { Media } from '$lib/anilist/types'
  import { offlineMode } from '$lib/stores/offline'
  import CalendarClock from '@lucide/svelte/icons/calendar-clock'

  let { media, compact = false }: { media: Media; compact?: boolean } = $props()

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
  // Sizing follows the badge row this sits in — the mobile header uses the tighter pill.
  const pill = $derived(compact ? 'px-2 py-0.5 text-[0.7rem]' : 'px-3 py-1 text-xs')
</script>

{#each delays as line (line)}
  <span class="inline-flex items-center gap-1 rounded-full bg-amber-500/15 font-bold text-amber-400 {pill}">
    <CalendarClock size={compact ? 11 : 13} />{line}
  </span>
{/each}
{#each slots as line (line)}
  <span class="rounded-full bg-secondary font-bold text-muted-foreground {pill}">{line}</span>
{/each}
