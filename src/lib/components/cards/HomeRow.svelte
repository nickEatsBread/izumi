<script lang="ts">
  // One home section = one query + one carousel row. Each row owns its own
  // query store so Svelte auto-subscription (`$store`) works correctly — an
  // array of stores can't be `$`-subscribed by index from the page.
  import { queryStore, getContextClient } from '@urql/svelte'
  import { pageQuery } from '$lib/anilist/queries'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  import type { Media } from '$lib/anilist/types'

  let { title, vars }: { title: string; vars: Record<string, unknown> } = $props()

  const client = getContextClient()
  const store = $derived(queryStore<{ Page: { media: Media[] } }>({
    client,
    query: pageQuery(),
    variables: { perPage: 20, ...vars },
  }))

  // "View more" → the search page seeded with this row's filters (sort/genre/season).
  function viewMoreHref(v: Record<string, unknown>): string {
    const p = new URLSearchParams()
    const sort = v.sort
    if (Array.isArray(sort) && sort[0]) p.set('sort', String(sort[0]))
    else if (typeof sort === 'string') p.set('sort', sort)
    if (typeof v.genre === 'string') p.set('genre', v.genre)
    if (typeof v.season === 'string') p.set('season', v.season)
    if (v.seasonYear != null) p.set('year', String(v.seasonYear))
    const q = p.toString()
    return '/app/search' + (q ? `?${q}` : '')
  }
</script>

<Carousel {title} viewMoreHref={viewMoreHref(vars)}>
  {#if $store.fetching}
    {#each Array.from({ length: 8 }) as _}
      <div class="aspect-[2/3] w-28 shrink-0 animate-pulse rounded-md bg-muted sm:w-[152px]"></div>
    {/each}
  {:else if $store.data}
    {#each $store.data.Page.media as media (media.id)}
      <SmallCard {media} />
    {/each}
  {/if}
</Carousel>
