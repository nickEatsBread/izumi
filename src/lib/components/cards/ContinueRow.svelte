<script lang="ts">
  // The unified "Continue Watching" row: the viewer's in-progress shows from AniList
  // (status CURRENT) and MyAnimeList (status 'watching') merged into one resume-aware
  // carousel. De-duped by media id so a dual-tracker user sees each show once; when a
  // show is on both, the further-along watched count wins. AniList order (most recently
  // updated first) leads, then any MAL-only shows.
  import { onMount } from 'svelte'
  import { getContextClient } from '@urql/svelte'
  import { LIST_QUERY, MEDIA_BY_MAL_QUERY, flattenEntries } from '$lib/anilist/lists'
  import { getMalListProgress } from '$lib/trackers'
  import type { Media } from '$lib/anilist/types'
  import Carousel from './Carousel.svelte'
  import ContinueCard from './ContinueCard.svelte'

  let { title, userName, malActive }: { title: string; userName?: string; malActive: boolean } = $props()
  const client = getContextClient()

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

  onMount(async () => {
    const [a, m] = await Promise.all([loadAni(), loadMal()])
    ani = a
    mal = m
    loading = false
  })

  const items = $derived.by(() => {
    const map = new Map<number, Item>()
    for (const e of ani) map.set(e.media.id, { ...e })
    for (const e of mal) {
      const cur = map.get(e.media.id)
      if (cur) cur.progress = Math.max(cur.progress, e.progress)
      else map.set(e.media.id, { ...e })
    }
    return [...map.values()]
  })
</script>

{#if loading}
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
