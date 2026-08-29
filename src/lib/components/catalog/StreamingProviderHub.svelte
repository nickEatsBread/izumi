<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import MapPin from '@lucide/svelte/icons/map-pin'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import { loadCatalogProvider } from '$lib/catalog/registry'
  import { streamingBrand } from '$lib/catalog/streaming-brands'
  import { tmdbRegion, tmdbRegionName } from '$lib/catalog/providers/tmdb'
  import type { CatalogContentType } from '$lib/catalog/identity'
  import type { CatalogHomeSection, CatalogSearchRequest } from '$lib/catalog/types'
  import CatalogSectionRow from './CatalogSectionRow.svelte'

  let { id, name, logo }: { id: number; name: string; logo?: string } = $props()

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'movies', label: 'Movies' },
    { id: 'series', label: 'TV Shows' },
    { id: 'documentary', label: 'Documentaries', movieGenre: 'Documentary', seriesGenre: 'Documentary' },
    { id: 'animation', label: 'Animation', movieGenre: 'Animation', seriesGenre: 'Animation' },
    { id: 'family', label: 'Kids & Family', movieGenre: 'Family', seriesGenre: 'Kids' },
    { id: 'reality', label: 'Reality', seriesGenre: 'Reality' },
    { id: 'action', label: 'Action', movieGenre: 'Action', seriesGenre: 'Action & Adventure' },
    { id: 'comedy', label: 'Comedy', movieGenre: 'Comedy', seriesGenre: 'Comedy' },
    { id: 'drama', label: 'Drama', movieGenre: 'Drama', seriesGenre: 'Drama' },
    { id: 'horror', label: 'Horror', movieGenre: 'Horror' },
    { id: 'scifi', label: 'Sci-Fi & Fantasy', movieGenre: 'Science Fiction', seriesGenre: 'Sci-Fi & Fantasy' },
  ] as const
  type FilterId = typeof filters[number]['id']

  interface HubRow {
    id: string
    title: string
    type: Extract<CatalogContentType, 'movie' | 'series'>
    sort: NonNullable<CatalogSearchRequest['sort']>
    genre?: string
    minVotes?: number
    ranked?: boolean
  }

  let activeFilter = $state<FilterId>('all')
  let sections = $state.raw<CatalogHomeSection[]>([])
  let loading = $state(true)
  let error = $state('')
  let retryKey = $state(0)

  const region = tmdbRegion()
  const regionName = tmdbRegionName(region)
  const brand = $derived(streamingBrand(name))
  const brandStyle = $derived(`--service-primary:${brand.primary};--service-secondary:${brand.secondary}`)

  function rowSpecs(filter: FilterId): HubRow[] {
    if (filter === 'all') return [
      { id: 'top-movies', title: `Top 10 Movies on ${name} in ${regionName}`, type: 'movie', sort: 'popular', ranked: true },
      { id: 'top-series', title: `Top 10 TV Shows on ${name} in ${regionName}`, type: 'series', sort: 'popular', ranked: true },
      { id: 'new-movies', title: `New Movies on ${name}`, type: 'movie', sort: 'recent' },
      { id: 'new-series', title: `New TV Shows on ${name}`, type: 'series', sort: 'recent' },
      { id: 'rated-movies', title: 'Critically Acclaimed Movies', type: 'movie', sort: 'rating', minVotes: 300 },
      { id: 'rated-series', title: 'Critically Acclaimed TV Shows', type: 'series', sort: 'rating', minVotes: 200 },
      { id: 'documentaries', title: `Documentaries on ${name}`, type: 'movie', sort: 'popular', genre: 'Documentary' },
      { id: 'family', title: 'Family Favourites', type: 'movie', sort: 'popular', genre: 'Family' },
    ]
    if (filter === 'movies' || filter === 'series') {
      const type = filter === 'movies' ? 'movie' : 'series'
      const label = filter === 'movies' ? 'Movies' : 'TV Shows'
      return [
        { id: `top-${filter}`, title: `Top 10 ${label} on ${name} in ${regionName}`, type, sort: 'popular', ranked: true },
        { id: `new-${filter}`, title: `New ${label}`, type, sort: 'recent' },
        { id: `rated-${filter}`, title: `Critically Acclaimed ${label}`, type, sort: 'rating', minVotes: 200 },
        { id: `comedy-${filter}`, title: `Comedy ${label}`, type, sort: 'popular', genre: 'Comedy' },
        { id: `drama-${filter}`, title: `Drama ${label}`, type, sort: 'popular', genre: 'Drama' },
      ]
    }
    const selected = filters.find((entry) => entry.id === filter)
    if (!selected || !('movieGenre' in selected || 'seriesGenre' in selected)) return []
    const rows: HubRow[] = []
    if ('movieGenre' in selected && selected.movieGenre) rows.push(
      { id: `${filter}-movies`, title: `Top 10 ${selected.label} Movies`, type: 'movie', sort: 'popular', genre: selected.movieGenre, ranked: true },
      { id: `rated-${filter}-movies`, title: `Acclaimed ${selected.label} Movies`, type: 'movie', sort: 'rating', genre: selected.movieGenre, minVotes: 150 },
    )
    if ('seriesGenre' in selected && selected.seriesGenre) rows.push(
      { id: `${filter}-series`, title: `Top 10 ${selected.label} TV Shows`, type: 'series', sort: 'popular', genre: selected.seriesGenre, ranked: true },
      { id: `rated-${filter}-series`, title: `Acclaimed ${selected.label} TV Shows`, type: 'series', sort: 'rating', genre: selected.seriesGenre, minVotes: 100 },
    )
    return rows
  }

  function searchHref(spec: HubRow) {
    const params = new URLSearchParams({
      provider: 'tmdb', type: spec.type, watchProvider: String(id), watchProviderName: name, sort: spec.sort,
    })
    if (spec.genre) params.set('genre', spec.genre)
    if (spec.minVotes) params.set('minVotes', String(spec.minVotes))
    return `/app/search?${params}`
  }

  $effect(() => {
    const filter = activeFilter
    void retryKey
    if (!Number.isFinite(id) || id <= 0) {
      error = 'This streaming service could not be opened.'
      loading = false
      return
    }
    const abort = new AbortController()
    loading = true
    error = ''
    sections = []
    void (async () => {
      try {
        const provider = await loadCatalogProvider('tmdb')
        const rows = rowSpecs(filter)
        const loaded = await Promise.all(rows.map(async (spec): Promise<CatalogHomeSection | null> => {
          const result = await provider.search({
            type: spec.type,
            watchProvider: id,
            genre: spec.genre,
            sort: spec.sort,
            minVotes: spec.minVotes,
            signal: abort.signal,
          })
          const media = spec.ranked ? result.media.slice(0, 10) : result.media
          return media.length ? {
            id: spec.id,
            title: spec.title,
            media,
            presentation: spec.ranked ? 'ranked' : 'posters',
          } : null
        }))
        if (!abort.signal.aborted) sections = loaded.filter((section): section is CatalogHomeSection => section != null)
      } catch (reason) {
        if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Couldn’t load this service.'
      } finally {
        if (!abort.signal.aborted) loading = false
      }
    })()
    return () => abort.abort()
  })
</script>

<div class="brand-{brand.id} min-h-full pb-20" style={brandStyle}>
  <header class="relative overflow-hidden border-b border-white/10 px-4 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-8">
    <div class="provider-backdrop pointer-events-none absolute inset-0"></div>
    <div class="relative mx-auto max-w-[96rem]">
      <a href="/app/home" data-focusable class="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 text-sm font-bold text-white/75 backdrop-blur transition hover:bg-white/10 hover:text-white">
        <ArrowLeft size={17} /> Home
      </a>
      <div class="flex items-center gap-4 sm:gap-5">
        {#if brand.mark || logo}
          <div class="grid size-20 shrink-0 place-items-center rounded-[1.35rem] bg-black/30 p-3 shadow-2xl ring-1 ring-white/15 backdrop-blur sm:size-24 sm:p-4">
            <img src={brand.mark ?? logo} alt="" class="provider-hub-mark size-full object-contain" />
          </div>
        {/if}
        <div class="min-w-0">
          <p class="mb-1 flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-white/55"><MapPin size={13} /> Streaming in {regionName}</p>
          <h1 class="truncate text-3xl font-black tracking-tight text-white sm:text-5xl">{name}</h1>
          <p class="mt-1 text-sm text-white/60">Movies and shows available with your local streaming options.</p>
        </div>
      </div>

      <div class="mt-7 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter {name} titles">
        {#each filters as filter (filter.id)}
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === filter.id}
            data-focusable
            onclick={() => activeFilter = filter.id}
            class="shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition
              {activeFilter === filter.id ? 'border-white bg-white text-black shadow-lg' : 'border-white/15 bg-black/20 text-white/65 hover:border-white/30 hover:bg-white/10 hover:text-white'}"
          >{filter.label}</button>
        {/each}
      </div>
    </div>
  </header>

  <main class="pt-7">
    {#if loading}
      {#each Array.from({ length: 4 }) as _}
        <section class="mb-8 px-4 sm:px-8">
          <div class="mb-3 h-5 w-48 rounded skeloader"></div>
          <div class="flex gap-3 overflow-hidden">
            {#each Array.from({ length: 7 }) as _}<div class="aspect-[2/3] w-36 shrink-0 rounded-md skeloader"></div>{/each}
          </div>
        </section>
      {/each}
    {:else if error}
      <div class="mx-4 rounded-2xl border border-border bg-card p-8 text-center sm:mx-8">
        <h2 class="text-lg font-black">Couldn’t load {name}</h2>
        <p class="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{error}</p>
        <button type="button" data-focusable onclick={() => retryKey++} class="mt-5 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-black text-background"><RotateCcw size={15} /> Retry</button>
      </div>
    {:else if sections.length}
      {#each sections as section (section.id)}
        {@const spec = rowSpecs(activeFilter).find((row) => row.id === section.id)}
        <CatalogSectionRow {section} viewMoreHref={spec ? searchHref(spec) : undefined} />
      {/each}
    {:else}
      <div class="mx-4 rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground sm:mx-8">No titles matched this filter in {regionName}.</div>
    {/if}
  </main>
</div>

<style>
  .provider-hub-mark { filter: brightness(0) invert(1); }
  :global(.brand-netflix) .provider-hub-mark { filter: none; }
  .provider-backdrop {
    background:
      radial-gradient(circle at 13% 34%, color-mix(in srgb, var(--service-primary) 34%, transparent), transparent 34%),
      linear-gradient(115deg, color-mix(in srgb, var(--service-secondary) 58%, #08090d), #08090d 64%);
  }
</style>
