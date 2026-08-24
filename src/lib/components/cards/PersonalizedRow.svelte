<script lang="ts">
  import { queryStore, getContextClient } from '@urql/svelte'
  import { PERSONAL_RECOMMENDATIONS_QUERY } from '$lib/anilist/queries'
  import type { Media } from '$lib/anilist/types'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  import { nearViewport } from '$lib/util/near-viewport'
  import { gameMode } from '$lib/player/session'

  let { userName }: { userName: string } = $props()
  const client = getContextClient()
  let visible = $state(false)
  const reveal = () => { visible = true }
  const store = $derived(queryStore<{
    Page: {
      mediaList: {
        media: {
          recommendations: { nodes: { rating: number; mediaRecommendation: Media | null }[] }
        }
      }[]
    }
  }>({
    client,
    query: PERSONAL_RECOMMENDATIONS_QUERY,
    variables: { userName, withPreview: !$gameMode },
    pause: !userName || !visible,
  }))

  const recommendations = $derived.by(() => {
    const ranked = ($store.data?.Page.mediaList ?? [])
      .flatMap((entry) => entry.media.recommendations.nodes)
      .filter((node): node is { rating: number; mediaRecommendation: Media } => !!node.mediaRecommendation)
      .sort((a, b) => b.rating - a.rating)
    return [...new Map(ranked.map((node) => [node.mediaRecommendation.id, node.mediaRecommendation])).values()].slice(0, 20)
  })
</script>

<div class:deferred-skeleton={!visible} use:nearViewport={{ onEnter: reveal }}>
  {#if !visible || $store.fetching}
    <Carousel title="Recommended for You">
      {#each Array.from({ length: 8 }) as _}
        <div class="skeloader aspect-[2/3] w-36 shrink-0 rounded-md sm:w-[152px]"></div>
      {/each}
    </Carousel>
  {:else if recommendations.length}
    <Carousel title="Recommended for You">
      {#each recommendations as media (media.id)}
        <div class="load-in shrink-0"><SmallCard {media} /></div>
      {/each}
    </Carousel>
  {/if}
</div>
