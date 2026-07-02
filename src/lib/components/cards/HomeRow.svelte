<script lang="ts">
  // One home section = one query + one carousel row. Each row owns its own
  // query store so Svelte auto-subscription (`$store`) works correctly — an
  // array of stores can't be `$`-subscribed by index from the page.
  import { queryStore, getContextClient } from '@urql/svelte'
  import { PAGE_QUERY } from '$lib/anilist/queries'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  import type { Media } from '$lib/anilist/types'

  let { title, vars }: { title: string; vars: Record<string, unknown> } = $props()

  const client = getContextClient()
  const store = queryStore<{ Page: { media: Media[] } }>({
    client,
    query: PAGE_QUERY,
    variables: { perPage: 20, ...vars },
  })
</script>

<Carousel {title}>
  {#if $store.fetching}
    {#each Array.from({ length: 8 }) as _}
      <div class="h-[228px] w-[152px] shrink-0 animate-pulse rounded-md bg-muted"></div>
    {/each}
  {:else if $store.data}
    {#each $store.data.Page.media as media (media.id)}
      <SmallCard {media} />
    {/each}
  {/if}
</Carousel>
