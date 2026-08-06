<script lang="ts">
  // One personalized home row = one MediaListCollection query + one carousel.
  // Owns its own query store (child-owns-store pattern) so `$store` auto-subscribes.
  import { onMount } from 'svelte'
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
  // Deferred like HomeRow: an unpaused LIST_QUERY is an uncapped MediaListCollection with full
  // MediaFields per entry — a large PLANNING/COMPLETED list is multi-MB of JSON parsed on the main
  // thread at boot, for a row that may be below the fold. Hold it until the row nears the viewport.
  let visible = $state(false)
  let el = $state<HTMLElement>()
  const store = $derived(queryStore({
    client,
    query: kind === 'anime' ? LIST_QUERY : READING_LIST_QUERY,
    variables: { userName, status },
    pause: !visible,
  }))
  // Cap what actually renders: a 1000-entry list otherwise mounts ~1000 cards. The row links to the
  // full library; the carousel is a preview.
  const RENDER_CAP = 30
  const entries = $derived(
    flattenEntries($store.data).filter(({ media }) => matchesLibraryKind(media, kind)),
  )
  const shown = $derived(entries.slice(0, RENDER_CAP))
  onMount(() => {
    const check = () => {
      if (el && el.getBoundingClientRect().top < window.innerHeight * 1.5) {
        visible = true
        window.removeEventListener('scroll', check)
        window.removeEventListener('resize', check)
      }
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    const ro = new ResizeObserver(check)
    if (el?.parentElement) ro.observe(el.parentElement)
    return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check); ro.disconnect() }
  })
</script>
<div bind:this={el}>
  {#if !visible || $store.fetching}
    <Carousel {title}>
      {#each Array.from({ length: 6 }) as _}
        <div class="aspect-[2/3] w-36 shrink-0 animate-pulse rounded-md bg-muted sm:w-[152px]"></div>
      {/each}
    </Carousel>
  {:else if shown.length}
    <Carousel {title}>
      {#each shown as e (e.media.id)}
        <SmallCard media={e.media} />
      {/each}
    </Carousel>
  {/if}
</div>
