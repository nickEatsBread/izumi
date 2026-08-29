<script lang="ts">
  // One personalized home row = one MediaListCollection query + one carousel.
  // Owns its own query store (child-owns-store pattern) so `$store` auto-subscribes.
  import { queryStore, getContextClient } from '@urql/svelte'
  import {
    LIST_PREVIEW_QUERY, READING_LIST_QUERY, flattenEntries, matchesLibraryKind,
    type Entry, type LibraryKind,
  } from '$lib/anilist/lists'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  import { nearViewport } from '$lib/util/near-viewport'
  import { gameMode } from '$lib/player/session'
  let {
    title, userName, status, kind = 'anime', preferLinkedRating = false,
  }: {
    title: string
    userName: string
    status: string
    kind?: LibraryKind
    preferLinkedRating?: boolean
  } = $props()
  const client = getContextClient()
  // Deferred like HomeRow. Anime previews use Page.mediaList(perPage:30), so a carousel never
  // downloads an account's complete list. Reading rows still need the collection because filtering
  // manga from novels after a 30-entry page could incorrectly produce an empty section.
  let visible = $state(false)
  const reveal = () => { visible = true }
  const store = $derived(queryStore({
    client,
    query: kind === 'anime' ? LIST_PREVIEW_QUERY : READING_LIST_QUERY,
    variables: { userName, status, withPreview: !$gameMode },
    pause: !visible,
  }))
  // Cap what actually renders: a 1000-entry list otherwise mounts ~1000 cards. The row links to the
  // full library; the carousel is a preview.
  const RENDER_CAP = 30
  type PreviewData = { Page?: { mediaList?: Entry[] } }
  const entries = $derived((kind === 'anime'
    ? (($store.data as PreviewData | undefined)?.Page?.mediaList ?? [])
    : flattenEntries($store.data))
    .filter(({ media }) => matchesLibraryKind(media, kind)))
  const shown = $derived(entries.slice(0, RENDER_CAP))
</script>
<div class:deferred-skeleton={!visible} use:nearViewport={{ onEnter: reveal }}>
  {#if !visible || $store.fetching}
    <Carousel {title}>
      {#each Array.from({ length: 6 }) as _}
        <div class="skeloader aspect-[2/3] w-36 shrink-0 rounded-md sm:w-[152px]"></div>
      {/each}
    </Carousel>
  {:else if shown.length}
    <Carousel {title}>
      {#each shown as e (e.media.id)}
        <SmallCard media={e.media} {preferLinkedRating} />
      {/each}
    </Carousel>
  {/if}
</div>
