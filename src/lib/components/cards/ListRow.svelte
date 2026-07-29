<script lang="ts">
  // One personalized home row = one MediaListCollection query + one carousel.
  // Owns its own query store (child-owns-store pattern) so `$store` auto-subscribes.
  import { queryStore, getContextClient } from '@urql/svelte'
  import {
    LIST_QUERY, READING_LIST_QUERY, flattenEntries, matchesLibraryKind, type LibraryKind,
  } from '$lib/anilist/lists'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  let {
    title, userName, status, kind = 'anime',
  }: {
    title: string
    userName: string
    status: string
    kind?: LibraryKind
  } = $props()
  const client = getContextClient()
  const store = $derived(queryStore({
    client,
    query: kind === 'anime' ? LIST_QUERY : READING_LIST_QUERY,
    variables: { userName, status },
  }))
  const entries = $derived(
    flattenEntries($store.data).filter(({ media }) => matchesLibraryKind(media, kind)),
  )
</script>
{#if $store.fetching}
  <Carousel {title}>
    {#each Array.from({ length: 6 }) as _}
      <div class="aspect-[2/3] w-36 shrink-0 animate-pulse rounded-md bg-muted sm:w-[152px]"></div>
    {/each}
  </Carousel>
{:else if entries.length}
  <Carousel {title}>
    {#each entries as e (e.media.id)}
      <SmallCard media={e.media} />
    {/each}
  </Carousel>
{/if}
