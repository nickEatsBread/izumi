<script lang="ts">
  import { queryStore, getContextClient } from '@urql/svelte'
  import { PAGE_QUERY, homeSections } from '$lib/anilist/queries'
  import HomeRow from '$lib/components/cards/HomeRow.svelte'
  import Hero from '$lib/components/banner/Hero.svelte'
  import type { Media } from '$lib/anilist/types'

  const client = getContextClient()
  const sections = homeSections(new Date())

  // Dedicated top-item query for the hero (graphcache dedupes vs the row query).
  const heroStore = queryStore<{ Page: { media: Media[] } }>({
    client,
    query: PAGE_QUERY,
    variables: { perPage: 1, ...sections[0].vars },
  })
</script>

<div class="pb-16">
  {#if $heroStore.data?.Page.media?.[0]}
    <Hero media={$heroStore.data.Page.media[0]} />
  {:else}
    <div class="mb-6 h-[42vh] w-full animate-pulse bg-muted"></div>
  {/if}

  {#each sections as s (s.key)}
    <HomeRow title={s.title} vars={s.vars} />
  {/each}
</div>
