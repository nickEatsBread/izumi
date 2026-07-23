<script lang="ts">
  // One home section = one query + one carousel row. Each row owns its own
  // query store so Svelte auto-subscription (`$store`) works correctly — an
  // array of stores can't be `$`-subscribed by index from the page.
  import { onMount } from 'svelte'
  import { queryStore, getContextClient } from '@urql/svelte'
  import { pageQuery } from '$lib/anilist/queries'
  import Carousel from './Carousel.svelte'
  import SmallCard from './SmallCard.svelte'
  import type { Media } from '$lib/anilist/types'

  let { title, vars }: { title: string; vars: Record<string, unknown> } = $props()

  const client = getContextClient()

  // Deferred fetch: hold this row's AniList query until the row nears the viewport. The home mounts
  // 6 public rows; fetching them ALL eagerly at mount fired 6 simultaneous requests (stressing
  // AniList's 30/min cap) with no staggered reveal. `pause: !visible` keeps the store off the
  // network until `visible` flips on scroll, so only rows you actually reach get fetched — and each
  // resolves as you scroll to it (the per-row stagger). NOT IntersectionObserver: the app's <html>
  // CSS `zoom` breaks IO's geometry (the same reason SearchResults uses a scroll listener).
  let visible = $state(false)
  let el = $state<HTMLElement>()

  const store = $derived(queryStore<{ Page: { media: Media[] } }>({
    client,
    query: pageQuery(),
    variables: { perPage: 20, ...vars },
    pause: !visible,
  }))

  onMount(() => {
    const check = () => {
      // Reveal when the row's top is within ~1.5 viewports (prefetch a bit ahead). The CSS zoom can
      // skew rect-vs-innerHeight, but a scroll listener always fires (unlike IO) and the generous
      // margin keeps the reveal ahead of the row coming on-screen — a slightly early/late fetch is
      // harmless. Self-removes once revealed.
      if (el && el.getBoundingClientRect().top < window.innerHeight * 1.5) {
        visible = true
        window.removeEventListener('scroll', check)
        window.removeEventListener('resize', check)
      }
    }
    check() // above-the-fold rows load immediately
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  })

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

<div bind:this={el}>
  <Carousel {title} viewMoreHref={viewMoreHref(vars)}>
    <!-- Skeletons also stand in while NOT yet visible, so the row keeps its height and lower rows
         stay below the fold until scrolled to (otherwise every row reveals at once). -->
    {#if !visible || $store.fetching}
      {#each Array.from({ length: 8 }) as _}
        <div class="aspect-[2/3] w-36 shrink-0 animate-pulse rounded-md bg-muted sm:w-[152px]"></div>
      {/each}
    {:else if $store.data}
      {#each $store.data.Page.media as media (media.id)}
        <!-- load-in: one-shot slide-up+fade (gamemode-disabled in app.css). Cards animate in when
             this row's deferred query resolves — the per-row staggered reveal as you scroll. -->
        <div class="load-in shrink-0">
          <SmallCard {media} />
        </div>
      {/each}
    {/if}
  </Carousel>
</div>
