<script lang="ts">
  // One personalized home row = one MediaListCollection query + one carousel.
  // Owns its own query store (child-owns-store pattern) so `$store` auto-subscribes.
  import { queryStore, getContextClient } from '@urql/svelte'
  import { LIST_QUERY, flattenEntries } from '$lib/anilist/lists'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  let { title, userName, status }: { title: string; userName: string; status: string } = $props()
  const client = getContextClient()
  const store = $derived(queryStore({ client, query: LIST_QUERY, variables: { userName, status } }))
  const entries = $derived(flattenEntries($store.data))
</script>
{#if $store.fetching}
  <Carousel {title}>
    {#each Array.from({ length: 6 }) as _}
      <div class="h-[228px] w-[152px] shrink-0 animate-pulse rounded-md bg-muted"></div>
    {/each}
  </Carousel>
{:else if entries.length}
  <Carousel {title}>
    {#each entries as e (e.media.id)}
      <SmallCard media={e.media} />
    {/each}
  </Carousel>
{/if}
