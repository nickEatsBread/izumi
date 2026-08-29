<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import Search from '@lucide/svelte/icons/search'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import { mediaKey } from '$lib/catalog/identity'
  import { searchMergedCatalogs } from '$lib/catalog/merged-search'
  import type { Media } from '$lib/anilist/types'
  import {
    catalogLabel,
    catalogProviders,
    type CatalogSelection,
  } from '$lib/settings/catalog'
  import { rankQuickSearchResults } from '$lib/search/global-search'

  let { query = $bindable('') }: { query?: string } = $props()
  let settled = $state(query.trim())
  let media = $state<Media[]>([])
  let failedProviders = $state<CatalogSelection[]>([])
  let loading = $state(false)
  let error = $state('')
  let hasNext = $state(false)
  let pageNumber = 1
  let generation = 0
  let debounce: ReturnType<typeof setTimeout>
  let requestAbort: AbortController | null = null
  const seen = new Set<string>()

  $effect(() => {
    void query
    clearTimeout(debounce)
    debounce = setTimeout(() => (settled = query.trim()), 300)
    return () => clearTimeout(debounce)
  })

  const requestKey = $derived(JSON.stringify([$catalogProviders, settled]))
  $effect(() => {
    void requestKey
    const abort = new AbortController()
    untrack(() => {
      requestAbort?.abort()
      requestAbort = abort
      media = []
      failedProviders = []
      seen.clear()
      loading = false
      error = ''
      hasNext = false
      pageNumber = 1
      generation++
      if (settled) void loadMore()
    })
    return () => abort.abort()
  })

  async function loadMore() {
    if (loading || !settled || (pageNumber > 1 && !hasNext)) return
    const activeGeneration = generation
    const abort = requestAbort
    loading = true
    try {
      const result = await searchMergedCatalogs($catalogProviders, settled, pageNumber, abort?.signal)
      if (activeGeneration !== generation) return
      const additions: Media[] = []
      for (const item of result.media) {
        const key = mediaKey(item)
        if (seen.has(key)) continue
        seen.add(key)
        additions.push(item)
      }
      const combined = [...media, ...additions]
      media = pageNumber === 1 ? rankQuickSearchResults(combined, settled) : combined
      failedProviders = result.failedProviders
      hasNext = result.hasNextPage && additions.length > 0
      pageNumber++
    } catch (reason) {
      if (activeGeneration === generation && !abort?.signal.aborted) {
        error = reason instanceof Error ? reason.message : String(reason)
        hasNext = false
      }
    } finally {
      if (activeGeneration === generation) loading = false
    }
  }

  function providerLabel(item: Media): string {
    const provider = item.catalog?.provider
    if (!provider || provider === 'anilist') return 'AniList'
    return catalogLabel(provider)
  }

  function nearBottom() {
    return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 900
  }
  onMount(() => {
    const more = () => { if (nearBottom()) void loadMore() }
    window.addEventListener('scroll', more, { passive: true })
    window.addEventListener('resize', more)
    return () => { window.removeEventListener('scroll', more); window.removeEventListener('resize', more) }
  })
</script>

<div class="px-4 pb-20 pt-4 sm:px-8">
  <label class="relative block">
    <Search size={20} class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-theme" />
    <input
      bind:value={query}
      data-focusable
      type="search"
      placeholder="Search every enabled catalog…"
      aria-label="Search all catalogs"
      class="h-14 w-full rounded-2xl border border-border bg-card pl-12 pr-4 text-lg font-semibold shadow-sm outline-none transition-colors focus:border-theme/70 focus-visible:outline-none"
    />
  </label>
  <p class="mt-2 px-1 text-xs text-muted-foreground">A fast title search with no cross-provider filters. Choose one catalog above for its full filter set.</p>

  {#if failedProviders.length && media.length}
    <p class="mt-5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      Results are partial — {failedProviders.map(catalogLabel).join(', ')} could not be reached.
    </p>
  {/if}

  {#if media.length}
    <div class="mt-6 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-5">
      {#each media as item (mediaKey(item))}
        <SmallCard media={item} fill subline={providerLabel(item)} />
      {/each}
    </div>
  {:else if settled && !loading && !error}
    <div class="mt-6 rounded-xl bg-secondary/40 p-8 text-center text-muted-foreground">No results for “{settled}”.</div>
  {:else if !settled}
    <div class="mt-8 rounded-2xl border border-dashed border-border px-5 py-12 text-center">
      <p class="font-black">One search, every enabled catalog</p>
      <p class="mt-1 text-sm text-muted-foreground">Results retain their original provider for details and playback.</p>
    </div>
  {/if}

  {#if loading}
    <div class="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
      {#each Array.from({ length: 9 }) as _}<div class="aspect-[2/3] rounded-md skeloader"></div>{/each}
    </div>
  {/if}
  {#if error}
    <div class="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-5">
      <p class="font-bold">Search failed</p>
      <p class="mt-1 text-sm text-muted-foreground">{error}</p>
      <button data-focusable onclick={() => { error = ''; hasNext = true; void loadMore() }} class="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">Retry</button>
    </div>
  {/if}
</div>
