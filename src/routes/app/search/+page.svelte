<script lang="ts">
  import FilterBar from '$lib/components/search/FilterBar.svelte'
  import SearchResults from '$lib/components/search/SearchResults.svelte'
  import type { SearchFilters } from '$lib/anilist/detail-queries'
  import { heroMedia } from '$lib/stores/hero'
  import { showAdult } from '$lib/settings/ui'
  import { offlineMode } from '$lib/stores/offline'
  import OfflineUnavailable from '$lib/components/offline/OfflineUnavailable.svelte'
  import { page } from '$app/state'
  import { replaceState } from '$app/navigation'
  import type { Snapshot } from './$types'

  // No hero on this page — clear the shared banner so it doesn't persist.
  heroMedia.set(null)

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
  }
  let filters = $state<SearchFilters>({ ...seed })
  let debounced = $state<SearchFilters>({ ...seed })
  let t: ReturnType<typeof setTimeout>

  // The URL round-trip below covers only the quick-bar fields; a second genre and everything from
  // the Advanced modal (formats, statuses, tags, score, episode range, …) has no URL form, so a
  // Back from a series page silently dropped them. The history-entry snapshot restores the FULL
  // filter set — it runs after the URL seed above, so on a back-navigation it wins, while a fresh
  // visit or shared link still seeds from the URL alone.
  export const snapshot: Snapshot<SearchFilters> = {
    capture: () => $state.snapshot(filters) as SearchFilters,
    restore: (value) => {
      filters = { ...value }
      debounced = { ...value } // same value for both — no debounce swap, no replayed card animation
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
    const params = new URLSearchParams()
    if (f.search) params.set('search', f.search)
    if (f.sort) params.set('sort', f.sort)
    if (f.genres?.[0]) params.set('genre', f.genres[0])
    if (f.season) params.set('season', f.season)
    if (f.year != null) params.set('year', String(f.year))
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
{:else}
  <div class="p-4 sm:p-8">
    <FilterBar bind:filters />
    <div class="mt-6">
      {#key key}
        <SearchResults filters={debounced} />
      {/key}
    </div>
  </div>
{/if}
