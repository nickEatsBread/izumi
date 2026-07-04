<script lang="ts">
  import type { SearchFilters } from '$lib/anilist/detail-queries'
  import { GENRE_COLLECTION } from '$lib/anilist/detail-queries'
  import { getContextClient } from '@urql/svelte'
  import { showAdult } from '$lib/settings/ui'
  import MultiSelect from './MultiSelect.svelte'

  let { filters = $bindable() }: { filters: SearchFilters } = $props()

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
  const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

  const clear = () => (filters = {})
</script>

<div class="flex flex-wrap items-center gap-2">
  <input
    data-focusable
    type="text"
    placeholder="Search anime…"
    value={filters.search ?? ''}
    oninput={(e) => (filters = { ...filters, search: e.currentTarget.value })}
    class="min-w-[220px] flex-1 rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
  />

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
    class="rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
  >
    <option value="">Any Season</option>
    {#each SEASONS as s (s)}<option value={s}>{label(s)}</option>{/each}
  </select>
  <select
    data-focusable
    value={filters.year != null ? String(filters.year) : ''}
    onchange={(e) => (filters = { ...filters, year: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
    class="rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
  >
    <option value="">Any Year</option>
    {#each YEARS as y (y)}<option value={y}>{y}</option>{/each}
  </select>
  <select
    data-focusable
    value={filters.sort ?? ''}
    onchange={(e) => (filters = { ...filters, sort: e.currentTarget.value || undefined })}
    class="rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
  >
    <option value="">Default Sort</option>
    {#each SORTS as s (s)}<option value={s}>{label(s)}</option>{/each}
  </select>

  <button data-focusable onclick={clear} class="rounded-md bg-secondary px-3 py-2 text-sm font-bold hover:bg-accent">Clear</button>
</div>
