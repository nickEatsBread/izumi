<script lang="ts">
  import FilterBar from '$lib/components/search/FilterBar.svelte'
  import SearchResults from '$lib/components/search/SearchResults.svelte'
  import type { SearchFilters } from '$lib/anilist/detail-queries'
  import { heroMedia } from '$lib/stores/hero'
  import { showAdult } from '$lib/settings/ui'
  import { page } from '$app/state'

  // No hero on this page — clear the shared banner so it doesn't persist.
  heroMedia.set(null)

  // Seed filters from URL params (home-row "View more" links carry sort/genre/season/year).
  // Seed BOTH filters and debounced with the SAME value so the initial render already
  // has the final filters — otherwise the 300ms debounce swaps debounced and re-keys
  // SearchResults, replaying the card animation a second time.
  const sp = page.url.searchParams
  const seed: SearchFilters = {
    sort: sp.get('sort') ?? undefined,
    genres: sp.get('genre') ? [sp.get('genre') as string] : undefined,
    season: sp.get('season') ?? undefined,
    year: sp.get('year') ? Number(sp.get('year')) : null,
  }
  let filters = $state<SearchFilters>({ ...seed })
  let debounced = $state<SearchFilters>({ ...seed })
  let t: ReturnType<typeof setTimeout>

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
</script>

<div class="p-4 sm:p-8">
  <FilterBar bind:filters />
  <div class="mt-6">
    {#key key}
      <SearchResults filters={debounced} />
    {/key}
  </div>
</div>
