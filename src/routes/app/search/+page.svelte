<script lang="ts">
  import FilterBar from '$lib/components/search/FilterBar.svelte'
  import SearchResults from '$lib/components/search/SearchResults.svelte'
  import type { SearchFilters } from '$lib/anilist/detail-queries'

  let filters = $state<SearchFilters>({})
  let debounced = $state<SearchFilters>({})
  let t: ReturnType<typeof setTimeout>

  // Debounce filter changes ~300ms, then hand a snapshot to the child store.
  $effect(() => {
    const f = $state.snapshot(filters) as SearchFilters
    clearTimeout(t)
    t = setTimeout(() => (debounced = f), 300)
    return () => clearTimeout(t)
  })

  // Serialized key: re-creates SearchResults (and its query store) on any change.
  const key = $derived(JSON.stringify(debounced))
</script>

<div class="p-8">
  <FilterBar bind:filters />
  <div class="mt-6">
    {#key key}
      <SearchResults filters={debounced} />
    {/key}
  </div>
</div>
