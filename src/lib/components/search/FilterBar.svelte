<script lang="ts">
  import type { SearchFilters } from '$lib/anilist/detail-queries'
  import { GENRE_COLLECTION } from '$lib/anilist/detail-queries'
  import { getContextClient } from '@urql/svelte'
  import { showAdult } from '$lib/settings/ui'
  import MultiSelect from './MultiSelect.svelte'
  import AdvancedFilters from './AdvancedFilters.svelte'
  import SlidersHorizontal from 'lucide-svelte/icons/sliders-horizontal'

  let { filters = $bindable() }: { filters: SearchFilters } = $props()

  let showAdvanced = $state(false)
  // Count of set advanced filters, for the button badge — so hidden filters aren't silent.
  const advCount = $derived(
    (filters.tagsIn?.length ? 1 : 0) + (filters.tagsNotIn?.length ? 1 : 0) +
    (filters.minTagRank ? 1 : 0) + (filters.sources?.length ? 1 : 0) +
    (filters.country ? 1 : 0) + (filters.minScore ? 1 : 0) +
    (filters.epMin != null ? 1 : 0) + (filters.epMax != null ? 1 : 0),
  )

  const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
  const FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC']
  const STATUSES = ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS']
  const SORTS = ['TRENDING_DESC', 'POPULARITY_DESC', 'SCORE_DESC', 'START_DATE_DESC', 'SEARCH_MATCH']
  // Fallback full genre set — replaced on mount by AniList's live GenreCollection so
  // the list is never a stale subset. 'Hentai' only shows when 18+ is enabled.
  const GENRES_FALLBACK = [
    'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo',
    'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life',
    'Sports', 'Supernatural', 'Thriller',
  ]
  let genreList = $state<string[]>(GENRES_FALLBACK)
  const genres = $derived($showAdult ? genreList : genreList.filter((g) => g !== 'Hentai'))

  const client = getContextClient()
  // Fetch the authoritative genre list once (cached by urql thereafter).
  client.query(GENRE_COLLECTION, {}).toPromise().then((r) => {
    const g = (r.data as { GenreCollection?: string[] } | undefined)?.GenreCollection
    if (Array.isArray(g) && g.length) genreList = g
  }).catch(() => {})

  const thisYear = new Date().getFullYear()
  const YEARS = Array.from({ length: thisYear - 1939 + 2 }, (_, i) => thisYear + 1 - i)
  // Title-case, but keep known acronyms fully uppercase (TV, OVA, ONA) — not "Tv"/"Ova".
  const ACRONYMS = new Set(['TV', 'OVA', 'ONA'])
  const label = (s: string) => s.split('_').map((w) => ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')

  const clear = () => (filters = {})
</script>

<!-- Mobile: search on its own full-width row, then the filters in a single horizontally-scrollable
     row (bleeds to the screen edges) so nothing wraps or gets orphaned. Desktop: the inner wrapper
     becomes `display:contents` so everything flows into one wrapping flex row as before. -->
<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
  <input
    data-focusable
    type="text"
    placeholder="Search anime…"
    value={filters.search ?? ''}
    oninput={(e) => (filters = { ...filters, search: e.currentTarget.value })}
    class="w-full rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent sm:min-w-[220px] sm:flex-1"
  />

  <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:contents sm:overflow-visible sm:px-0 sm:pb-0">
    <MultiSelect label="Genres" options={genres} selected={filters.genres ?? []}
                 onchange={(v) => (filters = { ...filters, genres: v })} />
    <MultiSelect label="Format" options={FORMATS} selected={filters.formats ?? []}
                 onchange={(v) => (filters = { ...filters, formats: v })} />
    <MultiSelect label="Status" options={STATUSES} selected={filters.statuses ?? []}
                 onchange={(v) => (filters = { ...filters, statuses: v })} />

    <select
      data-focusable
      value={filters.season ?? ''}
      onchange={(e) => (filters = { ...filters, season: e.currentTarget.value || undefined })}
      class="shrink-0 rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
    >
      <option value="">Any Season</option>
      {#each SEASONS as s (s)}<option value={s}>{label(s)}</option>{/each}
    </select>
    <select
      data-focusable
      value={filters.year != null ? String(filters.year) : ''}
      onchange={(e) => (filters = { ...filters, year: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
      class="shrink-0 rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
    >
      <option value="">Any Year</option>
      {#each YEARS as y (y)}<option value={String(y)}>{y}</option>{/each}
    </select>
    <select
      data-focusable
      value={filters.sort ?? ''}
      onchange={(e) => (filters = { ...filters, sort: e.currentTarget.value || undefined })}
      class="shrink-0 rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
    >
      <option value="">Default Sort</option>
      {#each SORTS as s (s)}<option value={s}>{label(s)}</option>{/each}
    </select>

    <button data-focusable onclick={() => (showAdvanced = true)}
            class="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-bold transition-colors {advCount ? 'bg-theme/20 text-theme hover:bg-theme/30' : 'bg-secondary hover:bg-accent'}">
      <SlidersHorizontal size={15} /> Advanced{advCount ? ` · ${advCount}` : ''}
    </button>
    <button data-focusable onclick={clear} class="shrink-0 rounded-md bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent">Clear</button>
  </div>
</div>

{#if showAdvanced}
  <AdvancedFilters
    {filters}
    onApply={(next) => { filters = next; showAdvanced = false }}
    onClose={() => (showAdvanced = false)}
  />
{/if}
