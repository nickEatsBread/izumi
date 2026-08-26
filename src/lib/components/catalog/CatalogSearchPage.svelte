<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/state'
  import { replaceState } from '$app/navigation'
  import Search from '@lucide/svelte/icons/search'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import { catalogProvider } from '$lib/settings/catalog'
  import { loadCatalogProvider } from '$lib/catalog/registry'
  import type { CatalogContentType } from '$lib/catalog/identity'
  import { mediaKey } from '$lib/catalog/identity'
  import type { Media } from '$lib/anilist/types'

  type CatalogSort = 'popular' | 'rating' | 'recent' | 'trending'

  let query = $state(page.url.searchParams.get('search') ?? page.url.searchParams.get('q') ?? '')
  let type = $state<CatalogContentType | 'all'>((page.url.searchParams.get('type') as CatalogContentType | null) ?? 'all')
  let genre = $state(page.url.searchParams.get('genre') ?? '')
  let year = $state(page.url.searchParams.get('year') ?? '')
  let sort = $state<CatalogSort>((page.url.searchParams.get('sort') as CatalogSort | null) ?? 'popular')
  let settled = $state(page.url.searchParams.get('search') ?? page.url.searchParams.get('q') ?? '')
  let debounce: ReturnType<typeof setTimeout>
  let media = $state<Media[]>([])
  let loading = $state(false)
  let error = $state('')
  let availableGenres = $state<string[]>([])
  let hasNext = true
  let pageNumber = 1
  let requestGeneration = 0
  const seen = new Set<string>()

  const typeOptions = $derived($catalogProvider === 'kitsu'
    ? [{ value: 'all', label: 'Anime' }]
    : [
        { value: 'all', label: 'Movies and series' },
        { value: 'anime', label: 'Anime' },
        { value: 'movie', label: 'Movies' },
        { value: 'series', label: 'Series' },
      ])
  const genreOptions = $derived([
    { value: '', label: 'All genres' },
    ...availableGenres.map((name) => ({ value: name, label: name })),
  ])

  $effect(() => {
    const selection = $catalogProvider
    if (selection === 'auto' || selection === 'anilist') return
    if (selection === 'kitsu' && type !== 'all' && type !== 'anime') type = 'all'
    const abort = new AbortController()
    availableGenres = []
    void loadCatalogProvider(selection).then((provider) => provider.genres?.(abort.signal) ?? [])
      .then((values) => { if (!abort.signal.aborted) availableGenres = values })
      .catch(() => {})
    return () => abort.abort()
  })

  $effect(() => {
    void query
    clearTimeout(debounce)
    debounce = setTimeout(() => (settled = query.trim()), 300)
    return () => clearTimeout(debounce)
  })

  const requestKey = $derived(JSON.stringify([$catalogProvider, settled, type, genre, year, sort]))
  $effect(() => {
    void requestKey
    media = []
    seen.clear()
    loading = false
    pageNumber = 1
    hasNext = true
    error = ''
    requestGeneration++
    void loadMore()
  })

  $effect(() => {
    const params = new URLSearchParams()
    if (settled) params.set('search', settled)
    if (type !== 'all') params.set('type', type)
    if (genre) params.set('genre', genre)
    if (year) params.set('year', year)
    if (sort !== 'popular') params.set('sort', sort)
    const next = params.size ? `${page.url.pathname}?${params}` : page.url.pathname
    if (next !== page.url.pathname + page.url.search) {
      try { replaceState(next, page.state) } catch { /* router not ready */ }
    }
  })

  async function loadMore() {
    if (loading || !hasNext) return
    const selection = $catalogProvider
    if (selection === 'auto' || selection === 'anilist') return
    const generation = requestGeneration
    loading = true
    try {
      const provider = await loadCatalogProvider(selection)
      const result = await provider.search({
        query: settled || undefined,
        type,
        genre: genre || undefined,
        year: Number(year) || undefined,
        sort,
        page: pageNumber,
      })
      if (generation !== requestGeneration) return
      let added = 0
      for (const item of result.media) {
        const key = mediaKey(item)
        if (seen.has(key)) continue
        seen.add(key)
        media.push(item)
        added++
      }
      hasNext = result.hasNextPage && added > 0
      pageNumber++
    } catch (reason) {
      if (generation === requestGeneration) {
        error = reason instanceof Error ? reason.message : String(reason)
        hasNext = false
      }
    } finally {
      if (generation === requestGeneration) loading = false
    }
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

<div class="p-4 pb-20 sm:p-8">
  <div class="mb-6 flex flex-col gap-3 sm:flex-row">
    <label class="relative min-w-0 flex-1">
      <Search size={19} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input bind:value={query} data-focusable placeholder="Search {$catalogProvider === 'kitsu' ? 'anime' : 'movies and series'}…"
        class="h-11 w-full rounded-lg bg-input pl-10 pr-3 text-base" />
    </label>
    <SelectMenu bind:value={type} ariaLabel="Content type" options={typeOptions} className="sm:w-48" />
    <SelectMenu bind:value={sort} ariaLabel="Sort results" className="sm:w-40" options={[
      { value: 'popular', label: 'Popular' }, { value: 'rating', label: 'Rating' },
      { value: 'recent', label: 'Recent' }, { value: 'trending', label: 'Trending' },
    ]} />
    {#if availableGenres.length}
      <SelectMenu bind:value={genre} ariaLabel="Genre" className="sm:w-44" options={genreOptions} />
    {:else if $catalogProvider === 'stremio'}
      <input bind:value={genre} data-focusable placeholder="Genre" aria-label="Genre"
        class="h-11 w-full rounded-lg bg-input px-3 text-base sm:w-32" />
    {/if}
    <input bind:value={year} inputmode="numeric" maxlength="4" data-focusable placeholder="Year" aria-label="Release year"
      class="h-11 w-full rounded-lg bg-input px-3 text-base sm:w-24" />
  </div>

  {#if media.length}
    <div class="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-5">
      {#each media as item (mediaKey(item))}<SmallCard media={item} fill />{/each}
    </div>
  {:else if !loading && !error}
    <div class="rounded-xl bg-secondary/40 p-8 text-center text-muted-foreground">No results.</div>
  {/if}

  {#if loading}
    <div class="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
      {#each Array.from({ length: 9 }) as _}<div class="aspect-[2/3] rounded-md skeloader"></div>{/each}
    </div>
  {/if}
  {#if error}
    <div class="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 p-5">
      <p class="text-sm">{error}</p>
      <button data-focusable onclick={() => { error = ''; hasNext = true; void loadMore() }} class="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">Retry</button>
    </div>
  {/if}
</div>
