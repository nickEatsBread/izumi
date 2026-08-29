<script lang="ts">
  // A home row sourced from the viewer's MyAnimeList list (for MAL-primary users,
  // whose AniList list may be empty). Anime rows render the metadata embedded in MAL's list
  // response and use the local id map for canonical navigation, so an AniList outage cannot hide
  // the viewer's MAL library. Reading rows still use AniList because the anime id map has no manga.
  import { getContextClient } from '@urql/svelte'
  import {
    READING_MEDIA_BY_MAL_QUERY, matchesLibraryKind, type LibraryKind,
  } from '$lib/anilist/lists'
  import { getMalAnimeListMediaOrThrow, getMalMangaIdsOrThrow } from '$lib/trackers'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  import type { Media } from '$lib/anilist/types'
  import { nearViewport } from '$lib/util/near-viewport'

  let {
    title, status, kind = 'anime', preferLinkedRating = false,
  }: {
    title: string
    status: string
    kind?: LibraryKind
    preferLinkedRating?: boolean
  } = $props()
  const client = getContextClient()
  let medias = $state<Media[]>([])
  let loading = $state(true)
  let error = $state('')
  let requested = $state(false)
  const shown = $derived(medias.slice(0, 30))

  function reveal() {
    if (requested) return
    requested = true
    void load()
  }

  async function load() {
    loading = true
    error = ''
    try {
      if (kind === 'anime') {
        medias = (await getMalAnimeListMediaOrThrow(status)).map((entry) => entry.media)
        return
      }
      const ids = await getMalMangaIdsOrThrow(status)
      if (!ids.length) return
      const res = await client
        .query(READING_MEDIA_BY_MAL_QUERY, { ids })
        .toPromise()
      if (res.error) throw res.error
      const list = ((res.data?.Page?.media ?? []) as Media[])
        .filter((media) => matchesLibraryKind(media, kind))
      const order = new Map(ids.map((id, i) => [id, i]))
      medias = list.slice().sort((a, b) => (order.get(a.idMal ?? -1) ?? 999) - (order.get(b.idMal ?? -1) ?? 999))
    }
    catch (e) {
      console.warn('MAL row', title, e)
      error = e instanceof Error ? e.message : 'Could not load your MyAnimeList list'
    }
    finally { loading = false }
  }
</script>

<div class:deferred-skeleton={!requested} use:nearViewport={{ onEnter: reveal }}>
  {#if loading}
    <Carousel {title}>
      {#each Array.from({ length: 6 }) as _}
        <div class="skeloader aspect-[2/3] w-36 shrink-0 rounded-md sm:w-[152px]"></div>
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
  {:else if shown.length}
    <Carousel {title}>
      {#each shown as media (media.id)}
        <SmallCard {media} {preferLinkedRating} />
      {/each}
    </Carousel>
  {/if}
</div>
