<script lang="ts">
  // Infinite-scroll results. The parent keys this component on the serialized filter
  // string, so a NEW instance is created whenever filters change — page state resets to
  // 1 and results never mix across filter sets. Pages are fetched imperatively and
  // appended.
  //
  // Uses a plain window SCROLL listener, NOT IntersectionObserver: the app sets a CSS
  // `zoom` on <html>, which breaks IO's intersection geometry (the sentinel never fires).
  // And fetches `network-only` so the normalized (graphcache) cache — which can't key the
  // unkeyed `Page` type — can't hand back a stale/embedded page for page 2+.
  import { onMount } from 'svelte'
  import { getContextClient } from '@urql/svelte'
  import { searchQuery, searchVariables, type SearchFilters } from '$lib/anilist/detail-queries'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import type { Media } from '$lib/anilist/types'

  let { filters }: { filters: SearchFilters } = $props()

  const client = getContextClient()
  let media = $state<Media[]>([])
  let page = 1
  let hasNext = true
  let loading = $state(false)
  let error = $state('')
  const seen = new Set<number>()

  async function loadMore() {
    if (loading || !hasNext) return
    loading = true
    try {
      const res = await client
        .query(searchQuery(), { ...searchVariables(filters), page }, { requestPolicy: 'network-only' })
        .toPromise()
      if (res.error) { error = res.error.message; hasNext = false; return }
      const p = res.data?.Page as { media?: Media[]; pageInfo?: { hasNextPage?: boolean } } | undefined
      let added = 0
      for (const m of p?.media ?? []) if (!seen.has(m.id)) { seen.add(m.id); media.push(m); added++ }
      // Stop if there's no next page OR a page contributed nothing new (guards a loop).
      hasNext = !!p?.pageInfo?.hasNextPage && added > 0
      page += 1
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      hasNext = false
    } finally {
      loading = false
      // After the DOM updates, keep filling while the content is shorter than the
      // viewport (short pages / tall screens) or the user is near the bottom.
      setTimeout(maybeLoad, 120)
    }
  }

  function nearBottom(): boolean {
    const doc = document.documentElement
    return window.scrollY + window.innerHeight >= doc.scrollHeight - 1000
  }
  function maybeLoad() {
    if (hasNext && !loading && nearBottom()) loadMore()
  }

  onMount(() => {
    loadMore()
    window.addEventListener('scroll', maybeLoad, { passive: true })
    window.addEventListener('resize', maybeLoad)
    return () => {
      window.removeEventListener('scroll', maybeLoad)
      window.removeEventListener('resize', maybeLoad)
    }
  })
</script>

<div class="flex flex-wrap gap-3">
  {#each media as m (m.id)}
    <SmallCard media={m} />
  {/each}

  {#if loading}
    {#each Array.from({ length: media.length ? 6 : 12 }) as _}
      <div class="h-[228px] w-[152px] animate-pulse rounded-md bg-muted"></div>
    {/each}
  {/if}
</div>

{#if error && !media.length}
  <p class="mt-4 text-muted-foreground">Search failed: {error}</p>
{:else if !loading && !media.length}
  <p class="mt-4 text-muted-foreground">No results.</p>
{/if}
