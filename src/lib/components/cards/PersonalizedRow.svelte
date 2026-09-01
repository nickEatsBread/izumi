<script lang="ts">
  import { queryStore, getContextClient } from '@urql/svelte'
  import { LOCAL_RECOMMENDATIONS_QUERY, PERSONAL_RECOMMENDATIONS_QUERY } from '$lib/anilist/queries'
  import type { Media } from '$lib/anilist/types'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  import { nearViewport } from '$lib/util/near-viewport'
  import { gameMode } from '$lib/player/session'
  import { durableHistory } from '$lib/player/history'
  import { anilistIdOf } from '$lib/catalog/identity'
  import { showAdult } from '$lib/settings/ui'
  import {
    accountSeed,
    dismissForYou,
    dismissedForYouIds,
    historySeeds,
    rankForYou,
    type ForYouEdge,
    type ForYouSeed,
  } from '$lib/recommendations/for-you'
  import X from '@lucide/svelte/icons/x'
  import * as h from '$lib/haptics'

  let { userName = '', preferLinkedRating = false }: { userName?: string; preferLinkedRating?: boolean } = $props()
  const client = getContextClient()
  let visible = $state(false)
  const reveal = () => { visible = true }
  const localSeeds = $derived(historySeeds($durableHistory).filter((seed) => $showAdult || !seed.media.isAdult))
  const seedIds = $derived(localSeeds.map((seed) => seed.media.id))
  const hasTasteData = $derived(!!userName || seedIds.length > 0)

  type SourceMedia = Media & {
    recommendations?: { nodes: { rating?: number; mediaRecommendation?: Media | null }[] }
  }
  type AccountRecommendationData = {
    MediaListCollection?: { lists?: { entries?: { media: { id: number } }[] }[] }
    account?: { mediaList?: { score?: number; progress?: number; status?: string; media: SourceMedia }[] }
  }
  type HistoryRecommendationData = {
    history?: { media?: SourceMedia[] }
  }

  const accountStore = $derived(queryStore<AccountRecommendationData>({
    client,
    query: PERSONAL_RECOMMENDATIONS_QUERY,
    variables: { userName, withPreview: !$gameMode },
    pause: !visible || !userName,
  }))
  const historyStore = $derived(queryStore<HistoryRecommendationData>({
    client,
    query: LOCAL_RECOMMENDATIONS_QUERY,
    variables: { seedIds, withPreview: !$gameMode },
    pause: !visible || seedIds.length === 0,
  }))
  const loading = $derived(
    (!!userName && $accountStore.fetching) || (seedIds.length > 0 && $historyStore.fetching),
  )

  const recommendations = $derived.by(() => {
    const accountEntries = $accountStore.data?.account?.mediaList ?? []
    const sources = new Map<number, ForYouSeed>()
    for (const seed of localSeeds) sources.set(seed.media.id, seed)
    for (const entry of accountEntries) {
      if (!$showAdult && entry.media.isAdult) continue
      const seed = accountSeed(entry.media, entry.score, entry.status, entry.progress)
      const previous = sources.get(seed.media.id)
      if (!previous || seed.affinity > previous.affinity) sources.set(seed.media.id, seed)
    }

    const sourceMedia = new Map<number, SourceMedia>()
    for (const media of $historyStore.data?.history?.media ?? []) sourceMedia.set(media.id, media)
    for (const entry of accountEntries) sourceMedia.set(entry.media.id, entry.media)
    const hydratedSeeds = [...sources.values()].map((seed) => {
      const hydrated = sourceMedia.get(seed.media.id)
      return hydrated ? { ...seed, media: { ...seed.media, ...hydrated } } : seed
    })
    const edges: ForYouEdge[] = []
    for (const source of sourceMedia.values()) {
      for (const node of source.recommendations?.nodes ?? []) {
        if (node.mediaRecommendation) edges.push({
          seedId: source.id,
          rating: node.rating,
          media: node.mediaRecommendation,
        })
      }
    }
    const accountIds = ($accountStore.data?.MediaListCollection?.lists ?? [])
      .flatMap((list) => list.entries ?? [])
      .map((entry) => entry.media.id)
    const historyIds = Object.values($durableHistory)
      .map((entry) => anilistIdOf(entry.media))
      .filter((id): id is number => id != null)
    return rankForYou(hydratedSeeds, edges, {
      excludedIds: [...historyIds, ...accountIds],
      dismissedIds: $dismissedForYouIds,
      showAdult: $showAdult,
    })
  })

  function dismiss(mediaId: number) {
    dismissForYou(mediaId)
    h.tap()
  }
</script>

<div class:deferred-skeleton={!visible} use:nearViewport={{ onEnter: reveal }}>
  {#if hasTasteData && (!visible || loading)}
    <Carousel title="Recommended for You">
      {#each Array.from({ length: 8 }) as _}
        <div class="skeloader aspect-[2/3] w-36 shrink-0 rounded-md sm:w-[152px]"></div>
      {/each}
    </Carousel>
  {:else if recommendations.length}
    <Carousel title="Recommended for You">
      {#each recommendations as recommendation (recommendation.media.id)}
        <div class="group/recommendation load-in relative w-36 shrink-0 sm:w-[152px]">
          <SmallCard
            media={recommendation.media}
            subline={recommendation.reason}
            {preferLinkedRating}
          />
          <button
            type="button"
            data-focusable
            class="absolute left-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/80 text-white opacity-90 shadow-lg backdrop-blur transition hover:bg-destructive focus-visible:bg-destructive sm:opacity-0 sm:group-hover/recommendation:opacity-100 sm:focus-visible:opacity-100"
            aria-label={`Not interested in ${recommendation.media.title.userPreferred ?? recommendation.media.title.english ?? recommendation.media.title.romaji ?? 'this title'}`}
            title="Not for me"
            onclick={(event) => { event.preventDefault(); event.stopPropagation(); dismiss(recommendation.media.id) }}
          >
            <X size={15} strokeWidth={3} />
          </button>
        </div>
      {/each}
    </Carousel>
  {/if}
</div>
