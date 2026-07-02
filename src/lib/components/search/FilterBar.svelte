<script lang="ts">
  import type { SearchFilters } from '$lib/anilist/detail-queries'

  let { filters = $bindable() }: { filters: SearchFilters } = $props()

  const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
  const FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL']
  const STATUSES = ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED']
  const SORTS = ['TRENDING_DESC', 'POPULARITY_DESC', 'SCORE_DESC', 'START_DATE_DESC', 'SEARCH_MATCH']
  const GENRES = [
    'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo',
    'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life',
    'Sports', 'Supernatural', 'Thriller',
  ]
  const thisYear = new Date().getFullYear()
  const YEARS = Array.from({ length: thisYear - 1939 + 2 }, (_, i) => thisYear + 1 - i)

  const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

  function toggle(key: 'formats' | 'statuses' | 'genres', value: string) {
    const cur = filters[key] ?? []
    filters = { ...filters, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] }
  }
  function clear() {
    filters = {}
  }
</script>

<div class="space-y-3">
  <div class="flex flex-wrap items-center gap-2">
    <input
      data-focusable
      type="text"
      placeholder="Search anime…"
      value={filters.search ?? ''}
      oninput={(e) => (filters = { ...filters, search: e.currentTarget.value })}
      class="min-w-[220px] flex-1 rounded-md bg-secondary px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
    />
    <select
      data-focusable
      value={filters.season ?? ''}
      onchange={(e) => (filters = { ...filters, season: e.currentTarget.value })}
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

  <div class="flex flex-wrap gap-1.5 text-xs">
    <span class="self-center font-bold text-muted-foreground">Format:</span>
    {#each FORMATS as f (f)}
      <button
        data-focusable
        onclick={() => toggle('formats', f)}
        class="rounded-full px-3 py-1 {filters.formats?.includes(f) ? 'bg-accent text-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}"
      >{label(f)}</button>
    {/each}
  </div>

  <div class="flex flex-wrap gap-1.5 text-xs">
    <span class="self-center font-bold text-muted-foreground">Status:</span>
    {#each STATUSES as s (s)}
      <button
        data-focusable
        onclick={() => toggle('statuses', s)}
        class="rounded-full px-3 py-1 {filters.statuses?.includes(s) ? 'bg-accent text-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}"
      >{label(s)}</button>
    {/each}
  </div>

  <div class="flex flex-wrap gap-1.5 text-xs">
    <span class="self-center font-bold text-muted-foreground">Genre:</span>
    {#each GENRES as g (g)}
      <button
        data-focusable
        onclick={() => toggle('genres', g)}
        class="rounded-full px-3 py-1 {filters.genres?.includes(g) ? 'bg-accent text-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}"
      >{g}</button>
    {/each}
  </div>
</div>
