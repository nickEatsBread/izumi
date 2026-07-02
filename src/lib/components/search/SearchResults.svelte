<script lang="ts">
  // Owns its own query store so Svelte auto-subscription (`$store`) works — a
  // store rebuilt inside `$derived` doesn't reliably re-subscribe. The parent
  // keys this component on a serialized filter string, so a new store is created
  // (and re-subscribed) whenever the debounced filters change. Mirrors HomeRow.
  import { queryStore, getContextClient } from '@urql/svelte'
  import { SEARCH_QUERY, searchVariables, type SearchFilters } from '$lib/anilist/detail-queries'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import type { Media } from '$lib/anilist/types'

  let { filters }: { filters: SearchFilters } = $props()

  const client = getContextClient()
  const store = queryStore<{ Page: { media: Media[] } }>({
    client,
    query: SEARCH_QUERY,
    variables: searchVariables(filters),
  })
</script>

<div class="flex flex-wrap gap-3">
  {#if $store.fetching}
    {#each Array.from({ length: 12 }) as _}
      <div class="h-[228px] w-[152px] animate-pulse rounded-md bg-muted"></div>
    {/each}
  {:else if $store.error}
    <p class="text-muted-foreground">Search failed: {$store.error.message}</p>
  {:else if $store.data?.Page.media.length}
    {#each $store.data.Page.media as media (media.id)}
      <SmallCard {media} />
    {/each}
  {:else}
    <p class="text-muted-foreground">No results.</p>
  {/if}
</div>
