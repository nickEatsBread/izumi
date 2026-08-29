<script lang="ts">
  import FilterBar from '$lib/components/search/FilterBar.svelte'
  import SearchResults from '$lib/components/search/SearchResults.svelte'
  import type { SearchFilters } from '$lib/anilist/detail-queries'
  import { heroMedia } from '$lib/stores/hero'
  import { showAdult } from '$lib/settings/ui'
  import { offlineMode } from '$lib/stores/offline'
  import { anilistDegraded } from '$lib/anilist/degraded'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import { page } from '$app/state'
  import { replaceState } from '$app/navigation'
  import type { Snapshot } from './$types'
  import {
    CATALOG_SELECTIONS,
    catalogLabel,
    catalogScreen,
    catalogProvider,
    catalogProviders,
    isLegacyAniListCatalog,
    mergedCatalogProviders,
    type CatalogSelection,
  } from '$lib/settings/catalog'
  import CatalogSearchPage from '$lib/components/catalog/CatalogSearchPage.svelte'
  import CatalogPlatformLogo from '$lib/components/catalog/CatalogPlatformLogo.svelte'
  import MergedCatalogSearchPage from '$lib/components/catalog/MergedCatalogSearchPage.svelte'
  import Layers3 from '@lucide/svelte/icons/layers-3'

  // No hero on this page — clear the shared banner so it doesn't persist.
  heroMedia.set(null)
  const legacyCatalog = $derived(isLegacyAniListCatalog($catalogProvider))

  // Seed filters from URL params (home-row "View more" links carry sort/genre/season/year).
  // Seed BOTH filters and debounced with the SAME value so the initial render already
  // has the final filters — otherwise the 300ms debounce swaps debounced and re-keys
  // SearchResults, replaying the card animation a second time.
  const sp = page.url.searchParams
  const seed: SearchFilters = {
    // `q` is what magnet/izumi:// deep links carry (deep-link-target.ts); `search` is ours.
    search: sp.get('search') ?? sp.get('q') ?? undefined,
    sort: sp.get('sort') ?? undefined,
    genres: sp.get('genre') ? [sp.get('genre') as string] : undefined,
    season: sp.get('season') ?? undefined,
    year: sp.get('year') ? Number(sp.get('year')) : null,
    studioId: sp.get('studio') ? Number(sp.get('studio')) : undefined,
    staffId: sp.get('staff') ? Number(sp.get('staff')) : undefined,
    exploreName: sp.get('name') ?? undefined,
  }
  let filters = $state<SearchFilters>({ ...seed })
  let debounced = $state<SearchFilters>({ ...seed })
  type MergedScope = 'all' | CatalogSelection
  const requestedScope = sp.get('provider')
  let mergedScope = $state<MergedScope>(requestedScope && CATALOG_SELECTIONS.includes(requestedScope as CatalogSelection)
    ? requestedScope as CatalogSelection : 'all')
  let mergedQuery = $state(seed.search ?? '')
  let t: ReturnType<typeof setTimeout>
  const mergedSelections = $derived(mergedCatalogProviders($catalogProviders))

  $effect(() => {
    if (mergedScope !== 'all' && !mergedSelections.includes(mergedScope)) mergedScope = 'all'
  })

  $effect(() => {
    if ($catalogScreen !== 'merged') return
    if (mergedScope === 'all') {
      const search = mergedQuery.trim() || undefined
      if (filters.search !== search) filters = { search }
    } else {
      mergedQuery = filters.search ?? ''
    }
  })

  function selectMergedScope(scope: MergedScope) {
    if (scope === mergedScope) return
    const next = { search: mergedQuery.trim() || undefined }
    mergedScope = scope
    filters = next
    debounced = next
  }

  // The URL round-trip below covers only the quick-bar fields; a second genre and everything from
  // the Advanced modal (formats, statuses, tags, score, episode range, …) has no URL form, so a
  // Back from a series page silently dropped them. The history-entry snapshot restores the FULL
  // filter set — it runs after the URL seed above, so on a back-navigation it wins, while a fresh
  // visit or shared link still seeds from the URL alone.
  interface SearchSnapshot {
    filters: SearchFilters
    mergedScope: MergedScope
    mergedQuery: string
  }
  export const snapshot: Snapshot<SearchSnapshot> = {
    capture: () => ({
      filters: $state.snapshot(filters) as SearchFilters,
      mergedScope,
      mergedQuery,
    }),
    restore: (value) => {
      filters = { ...value.filters }
      debounced = { ...value.filters } // same value for both — no debounce swap, no replayed card animation
      mergedScope = value.mergedScope
      mergedQuery = value.mergedQuery
    },
  }

  // Debounce filter changes ~300ms, then hand a snapshot to the child store.
  $effect(() => {
    const f = $state.snapshot(filters) as SearchFilters
    clearTimeout(t)
    t = setTimeout(() => (debounced = f), 300)
    return () => clearTimeout(t)
  })

  // Serialized key: re-creates SearchResults (and its query store) on any change,
  // including the 18+ toggle (which swaps the query variant).
  const key = $derived(JSON.stringify(debounced) + '|' + $showAdult)

  // Mirror the settled filters into the URL so the search SURVIVES leaving the page. Opening a
  // result pushes a history entry; coming back (browser Back, Android back, B on the Deck)
  // remounts this page, which seeds itself from the URL — and with nothing written there, every
  // return landed on an empty search after the user had just typed one.
  //
  // replaceState, never pushState: the query is already debounced, but pushing would still stack a
  // history entry per edit, so Back would crawl backwards through the query letter-group by
  // letter-group instead of leaving the page. Only the quick-bar fields are round-tripped, matching
  // exactly what `seed` above reads — writing params the seed ignores would silently drop them on
  // the return trip and look like the filters had been mangled.
  $effect(() => {
    const f = debounced
    if ($catalogScreen !== 'merged' && !legacyCatalog) return
    if ($catalogScreen === 'merged' && mergedScope !== 'all' && !isLegacyAniListCatalog(mergedScope)) return
    const params = new URLSearchParams()
    if ($catalogScreen === 'merged' && mergedScope !== 'all') params.set('provider', mergedScope)
    if (f.search) params.set('search', f.search)
    if ($catalogScreen !== 'merged' || mergedScope !== 'all') {
      if (f.sort) params.set('sort', f.sort)
      if (f.genres?.[0]) params.set('genre', f.genres[0])
      if (f.season) params.set('season', f.season)
      if (f.year != null) params.set('year', String(f.year))
      if (f.studioId) params.set('studio', String(f.studioId))
      if (f.staffId) params.set('staff', String(f.staffId))
      if (f.exploreName) params.set('name', f.exploreName)
    }
    const query = params.toString()
    const next = query ? `${page.url.pathname}?${query}` : page.url.pathname
    // Compare against the live URL so this settles instead of re-writing every run.
    if (next === page.url.pathname + page.url.search) return
    // Guarded: replaceState throws if the router has not finished initialising (an effect can run
    // during the first navigation), and a failed URL sync must never break the search itself.
    try { replaceState(next, page.state) } catch { /* URL stays as-is; results are unaffected */ }
  })
</script>

{#if $offlineMode}
  <OfflineUnavailable title="Search is unavailable offline" subtitle="Searching needs a connection. Your downloaded titles are available on the Downloads page." />
{:else if $catalogScreen === 'merged'}
  <div class="px-4 pt-4 sm:px-8 sm:pt-8">
    <h1 class="text-2xl font-black">Search</h1>
    <p class="mt-1 text-sm text-muted-foreground">Search everything together, or choose one catalog to unlock its filters.</p>
    <div class="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Search catalog">
      <button
        type="button"
        data-focusable
        role="tab"
        aria-selected={mergedScope === 'all'}
        onclick={() => selectMergedScope('all')}
        class="flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-black transition-colors {mergedScope === 'all' ? 'border-theme bg-theme text-white' : 'border-border bg-card hover:bg-secondary'}"
      >
        <Layers3 size={18} /> All catalogs
      </button>
      {#each mergedSelections as provider (provider)}
        <button
          type="button"
          data-focusable
          role="tab"
          aria-selected={mergedScope === provider}
          onclick={() => selectMergedScope(provider)}
          class="flex min-h-11 shrink-0 items-center gap-2 rounded-full border py-1 pl-1.5 pr-3.5 text-sm font-black transition-colors {mergedScope === provider ? 'border-theme bg-theme/15 text-foreground' : 'border-border bg-card hover:bg-secondary'}"
        >
          <span class="-m-1 scale-75"><CatalogPlatformLogo platform={provider} /></span>
          {catalogLabel(provider)}
        </button>
      {/each}
    </div>
  </div>

  {#if mergedScope === 'all'}
    <MergedCatalogSearchPage bind:query={mergedQuery} />
  {:else if !isLegacyAniListCatalog(mergedScope)}
    <CatalogSearchPage selection={mergedScope} embedded onQueryChange={(value) => (mergedQuery = value)} />
  {:else}
    <div class="p-4 pt-5 sm:px-8">
      <FilterBar bind:filters />
      <div class="mt-6">
        {#key key}<SearchResults filters={debounced} />{/key}
      </div>
    </div>
  {/if}
{:else if !legacyCatalog}
  <CatalogSearchPage />
{:else}
  <!-- Normal padding clears the mobile edge/titlebar. While the fixed degraded strip exists, add
       its 1.75rem height as well so it cannot cover the browse controls. -->
  <div class="p-4 sm:p-8 {$anilistDegraded ? 'pt-[2.75rem] sm:pt-[3.75rem]' : ''}">
    {#if filters.studioId || filters.staffId || filters.genres?.[0]}
      <h1 class="mb-4 text-2xl font-black">
        {filters.staffId ? (filters.exploreName || 'Voice actor') : filters.studioId ? (filters.exploreName || 'Studio') : filters.genres?.[0]}
      </h1>
    {/if}
    <FilterBar bind:filters />
    <div class="mt-6">
      {#key key}
        <SearchResults filters={debounced} />
      {/key}
    </div>
  </div>
{/if}
