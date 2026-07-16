<script lang="ts">
  // A home row sourced from the viewer's MyAnimeList list (for MAL-primary users,
  // whose AniList list may be empty). Fetches MAL ids for a status, maps them to
  // AniList media (one `idMal_in` query) so the cards + navigation work exactly
  // like the AniList rows, then re-sorts into MAL's recency order.
  import { onMount } from 'svelte'
  import { getContextClient } from '@urql/svelte'
  import { MEDIA_BY_MAL_QUERY } from '$lib/anilist/lists'
  import { getMalAnimeIdsOrThrow } from '$lib/trackers'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  import type { Media } from '$lib/anilist/types'

  let { title, status }: { title: string; status: string } = $props()
  const client = getContextClient()
  let medias = $state<Media[]>([])
  let loading = $state(true)
  let error = $state('')

  async function load() {
    loading = true
    error = ''
    try {
      const ids = await getMalAnimeIdsOrThrow(status)
      if (!ids.length) return
      const res = await client.query(MEDIA_BY_MAL_QUERY, { ids }).toPromise()
      if (res.error) throw res.error
      const list = (res.data?.Page?.media ?? []) as Media[]
      const order = new Map(ids.map((id, i) => [id, i]))
      medias = list.slice().sort((a, b) => (order.get(a.idMal ?? -1) ?? 999) - (order.get(b.idMal ?? -1) ?? 999))
    }
    catch (e) {
      console.warn('MAL row', title, e)
      error = e instanceof Error ? e.message : 'Could not load your MyAnimeList list'
    }
    finally { loading = false }
  }

  onMount(load)
</script>

{#if loading}
  <Carousel {title}>
    {#each Array.from({ length: 6 }) as _}
      <div class="h-[228px] w-[152px] shrink-0 animate-pulse rounded-md bg-muted"></div>
    {/each}
  </Carousel>
{:else if error}
  <section class="space-y-2">
    <h2 class="text-lg font-black">{title}</h2>
    <div class="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      <span class="min-w-0 flex-1">Could not load your MyAnimeList list.</span>
      <button class="shrink-0 rounded-md bg-primary px-3 py-1.5 font-bold text-primary-foreground" onclick={load}>Retry</button>
    </div>
  </section>
{:else if medias.length}
  <Carousel {title}>
    {#each medias as media (media.id)}
      <SmallCard {media} />
    {/each}
  </Carousel>
{/if}
