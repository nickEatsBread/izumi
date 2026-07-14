<script lang="ts">
  // The unified "Continue Watching" row: the viewer's in-progress shows from AniList
  // (status CURRENT), MyAnimeList (status 'watching'), AND on-device local history —
  // merged into one resume-aware carousel. De-duped by media id so each show appears
  // once; when it's in more than one source, the further-along watched count wins. Local
  // history is what makes this row work with NO tracker linked.
  import { onMount } from 'svelte'
  import { getContextClient } from '@urql/svelte'
  import { LIST_QUERY, MEDIA_BY_IDS_QUERY, MEDIA_BY_MAL_QUERY, flattenEntries } from '$lib/anilist/lists'
  import { getMalListProgress } from '$lib/trackers'
  import { localHistory, sessionProgress, historyEntries } from '$lib/player/history'
  import { hasAiredEpisodeToWatch } from '$lib/anilist/media'
  import type { Media } from '$lib/anilist/types'
  import Carousel from './Carousel.svelte'
  import ContinueCard from './ContinueCard.svelte'

  let { title, userName, malActive }: { title: string; userName?: string; malActive: boolean } = $props()
  const client = getContextClient()

  // Local history is synchronous (persisted store), most-recently-watched first. Its media snapshot
  // is refreshed below so the aired count is current: caught-up shows disappear, then return when
  // the next episode airs. The card still resumes a partially-opened episode via episode - 1.
  let refreshedLocal = $state(new Map<number, Media>())
  const local = $derived(
    historyEntries($localHistory)
      .map((e) => ({ ...e, media: refreshedLocal.get(e.media.id) ?? e.media }))
      .filter((e) => hasAiredEpisodeToWatch(e.media, e.progress))
      .map((e) => ({ media: e.media, progress: Math.max(e.progress, e.episode - 1) })),
  )

  interface Item { media: Media; progress: number }
  let ani = $state<Item[]>([])
  let mal = $state<Item[]>([])
  let loading = $state(true)

  // AniList CURRENT: one MediaListCollection query. `progress` comes off the list entry
  // (falling back to the media's own mediaListEntry). Empty username → skip (MAL-only user).
  async function loadAni(): Promise<Item[]> {
    if (!userName) return []
    try {
      const res = await client.query(LIST_QUERY, { userName, status: 'CURRENT' }).toPromise()
      return flattenEntries(res.data).map((e) => ({ media: e.media, progress: e.progress ?? e.media.mediaListEntry?.progress ?? 0 }))
    }
    catch { return [] }
  }

  // MAL watching: one list request (keeps the watched count), then one AniList
  // idMal_in query to get renderable media. Preserve MAL recency order.
  async function loadMal(): Promise<Item[]> {
    if (!malActive) return []
    try {
      const list = await getMalListProgress('watching')
      if (!list.length) return []
      const res = await client.query(MEDIA_BY_MAL_QUERY, { ids: list.map((e) => e.idMal) }).toPromise()
      const byMal = new Map(((res.data?.Page?.media ?? []) as Media[]).map((m) => [m.idMal, m]))
      return list
        .map((e) => ({ media: byMal.get(e.idMal), progress: e.progress }))
        .filter((e): e is Item => !!e.media)
    }
    catch { return [] }
  }

  // Local-only users have no tracker list query to refresh their saved Media snapshot. Resolve the
  // current AniList records in batches so nextAiringEpisode advances as releases become available.
  async function refreshLocal(): Promise<void> {
    const ids = [...new Set(historyEntries($localHistory).map((e) => e.media.id))]
    if (!ids.length) return
    try {
      const current = new Map<number, Media>()
      for (let i = 0; i < ids.length; i += 50) {
        const res = await client.query(MEDIA_BY_IDS_QUERY, { ids: ids.slice(i, i + 50) }).toPromise()
        for (const media of (res.data?.Page?.media ?? []) as Media[]) current.set(media.id, media)
      }
      refreshedLocal = current
    }
    catch { /* Keep the offline snapshot. */ }
  }

  onMount(async () => {
    const [a, m] = await Promise.all([loadAni(), loadMal(), refreshLocal()])
    ani = a
    mal = m
    loading = false
  })

  const items = $derived.by(() => {
    const map = new Map<number, Item>()
    // Tracker sources first (their own recency order), then local-only shows appended.
    for (const e of [...ani, ...mal, ...local]) {
      const progress = Math.max(e.progress, $sessionProgress[e.media.id] ?? 0)
      const cur = map.get(e.media.id)
      if (cur) cur.progress = Math.max(cur.progress, progress)
      else map.set(e.media.id, { ...e, progress })
    }
    return [...map.values()].filter((e) => hasAiredEpisodeToWatch(e.media, e.progress))
  })
</script>

{#if loading && !items.length && (userName || malActive)}
  <Carousel {title}>
    {#each Array.from({ length: 5 }) as _}
      <div class="aspect-video w-[264px] shrink-0 animate-pulse rounded-lg bg-muted"></div>
    {/each}
  </Carousel>
{:else if items.length}
  <Carousel {title}>
    {#each items as item (item.media.id)}
      <ContinueCard media={item.media} progress={item.progress} />
    {/each}
  </Carousel>
{/if}
