<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { page } from '$app/state'
  import { replaceState } from '$app/navigation'
  import Search from '@lucide/svelte/icons/search'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import X from '@lucide/svelte/icons/x'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import SmallCard from '$lib/components/cards/SmallCard.svelte'
  import TmdbAdvancedFilters from './TmdbAdvancedFilters.svelte'
  import JvmSourceFilters from './JvmSourceFilters.svelte'
  import { catalogProvider, type CatalogSelection } from '$lib/settings/catalog'
  import { loadCatalogProvider } from '$lib/catalog/registry'
  import type { CatalogContentType } from '$lib/catalog/identity'
  import { mediaKey } from '$lib/catalog/identity'
  import { CatalogConfigurationError, type CatalogAdvancedSearchFilters, type CatalogSearchOptions } from '$lib/catalog/types'
  import {
    installedJvmCatalogSources,
    jvmCatalogSourceFilters,
    type JvmCatalogSource,
    type JvmSourceFilter,
  } from '$lib/extensions/manager'
  import type { Media } from '$lib/anilist/types'

  let { selection, embedded = false, onQueryChange }: {
    selection?: CatalogSelection
    embedded?: boolean
    onQueryChange?: (query: string) => void
  } = $props()
  const activeSelection = $derived(selection ?? $catalogProvider)

  type CatalogSort = 'popular' | 'rating' | 'recent' | 'oldest' | 'title' | 'trending'

  let query = $state(page.url.searchParams.get('search') ?? page.url.searchParams.get('q') ?? '')
  let type = $state<CatalogContentType | 'all'>((page.url.searchParams.get('type') as CatalogContentType | null) ?? 'all')
  let genre = $state(page.url.searchParams.get('genre') ?? '')
  let year = $state(page.url.searchParams.get('year') ?? '')
  let sort = $state<CatalogSort>((page.url.searchParams.get('sort') as CatalogSort | null) ?? 'popular')
  let minScore = $state<number | undefined>(Number(page.url.searchParams.get('score')) || undefined)
  let minVotes = $state<number | undefined>(Number(page.url.searchParams.get('votes')) || undefined)
  let language = $state(page.url.searchParams.get('language') ?? '')
  let country = $state(page.url.searchParams.get('country') ?? '')
  let watchProvider = $state<number | undefined>(Number(page.url.searchParams.get('watchProvider')) || undefined)
  let watchProviderName = $state(page.url.searchParams.get('watchProviderName') ?? '')
  let jvmSourceId = $state(page.url.searchParams.get('source') ?? '')
  let settled = $state(page.url.searchParams.get('search') ?? page.url.searchParams.get('q') ?? '')
  let debounce: ReturnType<typeof setTimeout>
  let media = $state<Media[]>([])
  let loading = $state(false)
  let error = $state('')
  let tmdbNeedsConfiguration = $state(false)
  let availableGenres = $state<string[]>([])
  let filterOptions = $state<CatalogSearchOptions>({})
  let showAdvanced = $state(false)
  let jvmSources = $state<JvmCatalogSource[]>([])
  let jvmFilters = $state<JvmSourceFilter[]>([])
  let jvmFilterDefaults = $state<JvmSourceFilter[]>([])
  let jvmFiltersLoading = $state(false)
  let showJvmFilters = $state(false)
  let resultTotal = $state<number | undefined>()
  let hasNext = true
  let pageNumber = 1
  let requestGeneration = 0
  let requestAbort: AbortController | null = null
  let emptyPageStreak = 0
  const seen = new Set<string>()

  const animeOnly = $derived(activeSelection === 'kitsu' || activeSelection === 'jvm')
  const isTmdb = $derived(activeSelection === 'tmdb')
  const isJvm = $derived(activeSelection === 'jvm')
  const typeOptions = $derived(animeOnly
    ? [{ value: 'all', label: 'Anime' }]
    : [
        { value: 'all', label: 'Movies and series' },
        { value: 'anime', label: 'Anime' },
        { value: 'movie', label: 'Movies' },
        { value: 'series', label: 'Series' },
      ])
  const sortOptions = $derived(activeSelection === 'jvm'
    ? [{ value: 'popular', label: 'Popular' }, { value: 'recent', label: 'Latest' }]
    : activeSelection === 'tmdb'
    ? [
        { value: 'popular', label: 'Most popular' }, { value: 'rating', label: 'Highest rated' },
        { value: 'recent', label: 'Newest releases' }, { value: 'oldest', label: 'Oldest releases' },
        { value: 'title', label: 'Title A–Z' },
      ]
    : [
        { value: 'popular', label: 'Popular' }, { value: 'rating', label: 'Rating' },
        { value: 'recent', label: 'Recent' }, { value: 'trending', label: 'Trending' },
      ])
  const genreOptions = $derived([
    { value: '', label: 'All genres' },
    ...availableGenres.map((name) => ({ value: name, label: name })),
  ])
  const advancedFilters = $derived<CatalogAdvancedSearchFilters>({
    minScore,
    minVotes,
    language: language || undefined,
    country: country || undefined,
  })
  const advancedCount = $derived(
    (minScore ? 1 : 0) + (minVotes ? 1 : 0) + (language ? 1 : 0) + (country ? 1 : 0),
  )
  const jvmSourceOptions = $derived([
    { value: '', label: 'All enabled sources' },
    ...jvmSources.map((source) => ({ value: source.id, label: source.name })),
  ])
  const selectedJvmSource = $derived(jvmSources.find((source) => source.id === jvmSourceId))
  const jvmFilterCount = $derived(jvmFilters.reduce((count, filter, index) =>
    count + (JSON.stringify(filter.state) === JSON.stringify(jvmFilterDefaults[index]?.state) ? 0 : 1), 0))

  $effect(() => {
    const selection = activeSelection
    if (selection === 'auto' || selection === 'anilist') return
    if ((selection === 'kitsu' || selection === 'jvm') && type !== 'all' && type !== 'anime') type = 'all'
    if (selection === 'jvm' && sort !== 'popular' && sort !== 'recent') sort = 'popular'
    if (selection !== 'tmdb' && (sort === 'oldest' || sort === 'title')) sort = 'popular'
    if (selection !== 'tmdb') {
      minScore = undefined
      minVotes = undefined
      language = ''
      country = ''
      watchProvider = undefined
      watchProviderName = ''
      filterOptions = {}
      showAdvanced = false
    }
    const abort = new AbortController()
    availableGenres = []
    void loadCatalogProvider(selection).then(async (provider) => {
      const [genres, options] = await Promise.allSettled([
        provider.genres?.(abort.signal) ?? [],
        selection === 'tmdb' ? provider.searchOptions?.(abort.signal) ?? {} : {},
      ])
      if (!abort.signal.aborted) {
        if (genres.status === 'fulfilled') availableGenres = genres.value
        if (options.status === 'fulfilled') filterOptions = options.value
      }
    })
      .catch(() => {})
    return () => abort.abort()
  })

  $effect(() => {
    void query
    if (embedded) onQueryChange?.(query)
    clearTimeout(debounce)
    debounce = setTimeout(() => (settled = query.trim()), 300)
    return () => clearTimeout(debounce)
  })

  $effect(() => {
    if (!isJvm) {
      jvmSources = []
      jvmSourceId = ''
      return
    }
    const abort = new AbortController()
    void installedJvmCatalogSources().then((sources) => {
      if (abort.signal.aborted) return
      jvmSources = sources
      if (jvmSourceId && !sources.some((source) => source.id === jvmSourceId)) jvmSourceId = ''
    }).catch(() => {})
    return () => abort.abort()
  })

  $effect(() => {
    const sourceId = isJvm ? jvmSourceId : ''
    showJvmFilters = false
    jvmFilters = []
    jvmFilterDefaults = []
    if (!sourceId) return
    const abort = new AbortController()
    jvmFiltersLoading = true
    void jvmCatalogSourceFilters(sourceId, abort.signal).then((filters) => {
      if (abort.signal.aborted) return
      jvmFilterDefaults = structuredClone(filters)
      jvmFilters = structuredClone(filters)
    }).catch(() => {}).finally(() => {
      if (!abort.signal.aborted) jvmFiltersLoading = false
    })
    return () => abort.abort()
  })

  const requestKey = $derived(JSON.stringify([
    activeSelection, settled, type, genre, year, sort, minScore, minVotes, language, country, watchProvider,
    jvmSourceId, jvmFilters, jvmFiltersLoading,
  ]))
  $effect(() => {
    void requestKey
    const abort = new AbortController()
    // loadMore reads and writes loading/hasNext. Keep those reads outside this effect's dependency
    // graph or the initial request invalidates itself, repeatedly discarding slower TMDB results.
    untrack(() => {
      requestAbort?.abort()
      requestAbort = abort
      media = []
      seen.clear()
      loading = false
      pageNumber = 1
      hasNext = true
      error = ''
      tmdbNeedsConfiguration = false
      resultTotal = undefined
      emptyPageStreak = 0
      requestGeneration++
      void loadMore()
    })
    return () => abort.abort()
  })

  $effect(() => {
    const params = new URLSearchParams()
    if (embedded) params.set('provider', activeSelection)
    if (settled) params.set('search', settled)
    if (type !== 'all') params.set('type', type)
    if (genre) params.set('genre', genre)
    if (year) params.set('year', year)
    if (sort !== 'popular') params.set('sort', sort)
    if (minScore) params.set('score', String(minScore))
    if (minVotes) params.set('votes', String(minVotes))
    if (language) params.set('language', language)
    if (country) params.set('country', country)
    if (isTmdb && watchProvider) params.set('watchProvider', String(watchProvider))
    if (isTmdb && watchProviderName) params.set('watchProviderName', watchProviderName)
    if (isJvm && jvmSourceId) params.set('source', jvmSourceId)
    const next = params.size ? `${page.url.pathname}?${params}` : page.url.pathname
    if (next !== page.url.pathname + page.url.search) {
      try { replaceState(next, page.state) } catch { /* router not ready */ }
    }
  })

  async function loadMore() {
    if (loading || !hasNext) return
    if (isJvm && jvmSourceId && jvmFiltersLoading) return
    const selection = activeSelection
    if (selection === 'auto' || selection === 'anilist') return
    const generation = requestGeneration
    const abort = requestAbort
    let seekNextFilteredPage = false
    loading = true
    try {
      const provider = await loadCatalogProvider(selection)
      const result = await provider.search({
        query: settled || undefined,
        type,
        genre: genre || undefined,
        year: Number(year) || undefined,
        sort,
        minScore,
        minVotes,
        language: language || undefined,
        country: country || undefined,
        watchProvider,
        sourceId: isJvm ? jvmSourceId || undefined : undefined,
        jvmFilters: isJvm && jvmSourceId ? jvmFilters : undefined,
        page: pageNumber,
        signal: abort?.signal,
      })
      if (generation !== requestGeneration) return
      resultTotal = result.total
      let added = 0
      for (const item of result.media) {
        const key = mediaKey(item)
        if (seen.has(key)) continue
        seen.add(key)
        media.push(item)
        added++
      }
      emptyPageStreak = added ? 0 : emptyPageStreak + 1
      hasNext = result.hasNextPage
      // Text search cannot send advanced Discover parameters to TMDB. If client-side filtering
      // empties a page, quietly inspect a few more rather than claiming there are no matches while
      // later result pages still exist. The cap prevents a narrow filter from crawling the API.
      seekNextFilteredPage = !!settled && advancedCount > 0 && !added && hasNext && emptyPageStreak < 4
      pageNumber++
    } catch (reason) {
      if (generation === requestGeneration && !abort?.signal.aborted) {
        error = reason instanceof Error ? reason.message : String(reason)
        tmdbNeedsConfiguration = selection === 'tmdb' && reason instanceof CatalogConfigurationError
        hasNext = false
      }
    } finally {
      if (generation === requestGeneration) {
        loading = false
        if (seekNextFilteredPage && !abort?.signal.aborted) queueMicrotask(() => void loadMore())
      }
    }
  }

  function applyAdvanced(filters: CatalogAdvancedSearchFilters) {
    minScore = filters.minScore
    minVotes = filters.minVotes
    language = filters.language ?? ''
    country = filters.country ?? ''
    showAdvanced = false
  }

  function tmdbMetadata(item: Media): string {
    const kind = item.catalog?.type === 'movie' ? 'Movie' : item.catalog?.type === 'series' ? 'Series' : ''
    const rating = item.averageScore != null ? `${(item.averageScore / 10).toFixed(1)} ★` : ''
    return [item.startDate?.year, kind, rating].filter(Boolean).join(' · ')
  }

  function jvmMetadata(item: Media): string {
    const sourceCount = 1 + (item.catalogAlternatives?.length ?? 0)
    return sourceCount > 1 ? `${sourceCount} sources` : item.catalog?.sourceName ?? ''
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

<div class="pb-20 {embedded ? 'pt-4' : 'p-4 sm:p-8'}">
  {#if isTmdb && watchProvider}
    <div class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div><p class="text-xs font-semibold text-muted-foreground">Streaming service</p><p class="font-black">{watchProviderName || 'Selected provider'}</p></div>
      <button type="button" data-focusable onclick={() => { watchProvider = undefined; watchProviderName = '' }} aria-label="Clear streaming service" class="grid size-9 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"><X size={17} /></button>
    </div>
  {/if}
  <div class="mb-6 flex flex-col gap-3">
    <label class="relative min-w-0 flex-1">
      <Search size={19} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input bind:value={query} data-focusable placeholder="Search {animeOnly ? 'anime' : 'movies and series'}…"
        class="h-11 w-full rounded-lg bg-input pl-10 pr-3 text-base" />
    </label>
    <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
      <SelectMenu bind:value={type} ariaLabel="Content type" options={typeOptions} className="w-48 shrink-0" />
      <SelectMenu bind:value={sort} ariaLabel="Sort results" className="w-40 shrink-0" options={sortOptions} />
      {#if isJvm}
        <SelectMenu bind:value={jvmSourceId} ariaLabel="Aniyomi source" className="w-52 shrink-0" options={jvmSourceOptions} />
        {#if jvmSourceId}
          <button
            type="button"
            data-focusable
            disabled={jvmFiltersLoading || !jvmFilters.length}
            onclick={() => (showJvmFilters = true)}
            class="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-bold transition-colors disabled:opacity-45 {jvmFilterCount ? 'bg-theme/20 text-theme hover:bg-theme/30' : 'bg-secondary hover:bg-accent'}"
          >
            <SlidersHorizontal size={16} /> {jvmFiltersLoading ? 'Loading filters…' : `Source filters${jvmFilterCount ? ` · ${jvmFilterCount}` : ''}`}
          </button>
        {/if}
      {/if}
      {#if availableGenres.length}
        <SelectMenu bind:value={genre} ariaLabel="Genre" className="w-44 shrink-0" options={genreOptions} />
      {:else if activeSelection === 'stremio'}
        <input bind:value={genre} data-focusable placeholder="Genre" aria-label="Genre"
          class="h-11 w-32 shrink-0 rounded-lg bg-input px-3 text-base" />
      {/if}
      {#if activeSelection !== 'jvm'}
        <input bind:value={year} inputmode="numeric" maxlength="4" data-focusable placeholder="Year" aria-label="Release year"
          class="h-11 w-24 shrink-0 rounded-lg bg-input px-3 text-base" />
      {/if}
      {#if isTmdb}
        <button
          type="button"
          data-focusable
          onclick={() => (showAdvanced = true)}
          class="flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-bold transition-colors {advancedCount ? 'bg-theme/20 text-theme hover:bg-theme/30' : 'bg-secondary hover:bg-accent'}"
        >
          <SlidersHorizontal size={16} /> More filters{advancedCount ? ` · ${advancedCount}` : ''}
        </button>
      {/if}
    </div>
  </div>

  {#if isTmdb && (media.length || resultTotal != null)}
    <p class="mb-3 text-xs font-semibold text-muted-foreground">
      {settled && advancedCount ? `${media.length} filtered title${media.length === 1 ? '' : 's'} loaded` : `${resultTotal?.toLocaleString() ?? media.length} title${resultTotal === 1 ? '' : 's'}`}
    </p>
  {/if}

  {#if media.length}
    <div class="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:gap-5">
      {#each media as item (mediaKey(item))}
        <SmallCard media={item} fill subline={isTmdb ? tmdbMetadata(item) : isJvm ? jvmMetadata(item) : undefined} />
      {/each}
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
      {#if tmdbNeedsConfiguration}
        <a href="/app/settings/catalog" data-focusable class="mt-3 inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground">Add TMDB token</a>
      {:else}
        <button data-focusable onclick={() => { error = ''; hasNext = true; void loadMore() }} class="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">Retry</button>
      {/if}
    </div>
  {/if}
</div>

{#if showAdvanced && isTmdb}
  <TmdbAdvancedFilters
    filters={advancedFilters}
    options={filterOptions}
    queryActive={!!settled}
    onApply={applyAdvanced}
    onClose={() => (showAdvanced = false)}
  />
{/if}

{#if showJvmFilters && isJvm && selectedJvmSource && jvmFilters.length}
  <JvmSourceFilters
    sourceName={selectedJvmSource.name}
    filters={jvmFilters}
    onApply={(filters) => { jvmFilters = filters; showJvmFilters = false }}
    onClose={() => (showJvmFilters = false)}
  />
{/if}
