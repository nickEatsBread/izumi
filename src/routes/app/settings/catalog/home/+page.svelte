<script lang="ts">
  import { page } from '$app/stores'
  import { catalogHomeRowOptions, mergedCatalogHomeRowOptions } from '$lib/catalog/registry'
  import {
    catalogHomeLayoutFromRows,
    catalogHomeLayoutKey,
    catalogHomeLayouts,
    resetCatalogHomeLayout,
    resolveCatalogHomeRows,
  } from '$lib/catalog/home-layout'
  import {
    catalogLabel,
    catalogProviders,
    catalogScreens,
    normalizeCatalogProviders,
    stremioHeroArtwork,
    type CatalogSelection,
    type StremioHeroArtwork,
  } from '$lib/settings/catalog'
  import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
  import type { CatalogHomeRowOption } from '$lib/catalog/types'
  import ArrowUp from '@lucide/svelte/icons/arrow-up'
  import ArrowDown from '@lucide/svelte/icons/arrow-down'
  import EyeOff from '@lucide/svelte/icons/eye-off'
  import Plus from '@lucide/svelte/icons/plus'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import Search from '@lucide/svelte/icons/search'

  const targets = $derived.by(() => {
    const seen = new Set<string>()
    const separate = normalizeCatalogProviders($catalogProviders).flatMap((provider) => {
      const key = catalogHomeLayoutKey(provider)
      if (seen.has(key)) return []
      seen.add(key)
      const selection: CatalogSelection = key === 'anilist' ? 'anilist' : provider
      return [{ selection: selection as CatalogHomeTarget, label: key === 'anilist' ? 'Anime' : catalogLabel(provider) }]
    })
    const merged = catalogScreens($catalogProviders).includes('merged')
      ? [{ selection: 'merged' as CatalogHomeTarget, label: 'Merged' }]
      : []
    return [...merged, ...separate]
  })

  let selected = $state<CatalogHomeTarget>('anilist')
  let options = $state<CatalogHomeRowOption[]>([])
  let loading = $state(true)
  let error = $state('')
  let availableSearch = $state('')
  const artworkChoices: Array<{ value: StremioHeroArtwork; title: string; description: string }> = [
    { value: 'backdrop', title: 'Cinematic backdrop', description: 'Use wide artwork when available, with cover art as a fallback.' },
    { value: 'cover', title: 'Cover art', description: 'Keep the full portrait cover visible over a softened background.' },
  ]

  // Honour a direct provider link, then keep the selection valid as catalog platforms change.
  $effect(() => {
    const requested = $page.url.searchParams.get('provider') as CatalogHomeTarget | null
    const available = targets.map((target) => target.selection)
    if (requested && available.includes(requested)) selected = requested
    else if (!available.includes(selected) && available[0]) selected = available[0]
  })

  $effect(() => {
    const selection = selected
    const abort = new AbortController()
    availableSearch = ''
    loading = true
    error = ''
    options = []
    const request = selection === 'merged'
      ? mergedCatalogHomeRowOptions($catalogProviders, abort.signal)
      : catalogHomeRowOptions(selection, abort.signal)
    void request.then((rows) => {
      if (!abort.signal.aborted) options = rows
    }).catch((reason) => {
      if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : String(reason)
    }).finally(() => { if (!abort.signal.aborted) loading = false })
    return () => abort.abort()
  })

  const rows = $derived(resolveCatalogHomeRows(selected, options, $catalogHomeLayouts))
  const visibleRows = $derived(rows.filter((row) => row.enabled))
  const availableGroups = $derived.by(() => {
    const grouped = new Map<string, typeof rows>()
    const query = availableSearch.trim().toLowerCase()
    for (const row of rows.filter((item) => !item.enabled && (!query
      || `${item.title} ${item.description ?? ''} ${item.group ?? ''}`.toLowerCase().includes(query)))) {
      const group = row.group ?? 'More rows'
      grouped.set(group, [...(grouped.get(group) ?? []), row])
    }
    return [...grouped].map(([group, items]) => ({ group, items }))
  })

  function save(nextRows: typeof rows) {
    const key = catalogHomeLayoutKey(selected)
    catalogHomeLayouts.update((layouts) => ({ ...layouts, [key]: catalogHomeLayoutFromRows(nextRows) }))
  }

  function move(id: string, direction: -1 | 1) {
    const visible = rows.filter((row) => row.enabled)
    const index = visible.findIndex((row) => row.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= visible.length) return
    ;[visible[index], visible[target]] = [visible[target], visible[index]]
    save([...visible, ...rows.filter((row) => !row.enabled)])
  }

  function hide(id: string) {
    save(rows.map((row) => row.id === id ? { ...row, enabled: false } : row))
  }

  function add(id: string) {
    const added = rows.find((row) => row.id === id)
    if (!added) return
    save([
      ...rows.filter((row) => row.enabled),
      { ...added, enabled: true },
      ...rows.filter((row) => !row.enabled && row.id !== id),
    ])
  }

  function resetSelected() {
    resetCatalogHomeLayout(selected)
    if (selected === 'stremio') $stremioHeroArtwork = 'backdrop'
  }
</script>

<div class="p-4 sm:p-8">
  <div class="mb-5 flex max-w-3xl items-start justify-between gap-4">
    <div>
      <h2 class="mb-1 text-xl font-black">Customize Home</h2>
      <p class="text-sm text-muted-foreground">Choose the rows each catalog shows and put the most useful ones first. Merged has its own layout.</p>
    </div>
    <button data-focusable onclick={resetSelected} class="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-sm font-bold transition-colors hover:bg-secondary active:bg-secondary">
      <RotateCcw size={16} /> Reset
    </button>
  </div>

  {#if targets.length > 1}
    <div class="mb-5 flex max-w-3xl gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Catalog platform">
      {#each targets as target (target.selection)}
        <button data-focusable role="tab" aria-selected={selected === target.selection} onclick={() => (selected = target.selection)}
          class="min-h-10 shrink-0 rounded-full border px-4 text-sm font-bold transition-colors {selected === target.selection ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-secondary'}">
          {target.label}
        </button>
      {/each}
    </div>
  {/if}

  <div class="max-w-3xl">
    {#if selected === 'stremio'}
      <section class="mb-6 rounded-xl border border-border bg-card p-4" aria-labelledby="stremio-featured-artwork-title">
        <h3 id="stremio-featured-artwork-title" class="font-black">Featured artwork</h3>
        <p class="mt-0.5 text-xs text-muted-foreground">Choose how Stremio metadata appears in the desktop Home banner. Phones continue to use cover art.</p>
        <div class="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Stremio featured artwork">
          {#each artworkChoices as choice (choice.value)}
            <button type="button" data-focusable role="radio" aria-checked={$stremioHeroArtwork === choice.value}
              onclick={() => ($stremioHeroArtwork = choice.value)}
              class="rounded-lg border p-3 text-left transition-colors {$stremioHeroArtwork === choice.value ? 'border-primary bg-primary/10' : 'border-border bg-secondary/35 hover:bg-secondary'}">
              <span class="block text-sm font-black">{choice.title}</span>
              <span class="mt-1 block text-xs leading-5 text-muted-foreground">{choice.description}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if loading}
      <div class="space-y-2" aria-label="Loading Home rows">
        {#each Array.from({ length: 6 }) as _}<div class="h-16 rounded-lg skeloader"></div>{/each}
      </div>
    {:else if error}
      <div role="alert" class="rounded-xl border border-destructive/30 bg-destructive/10 p-5">
        <p class="font-bold">Couldn’t load these catalog rows</p>
        <p class="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
    {:else}
      <div class="mb-6">
        <div class="mb-2 flex items-end justify-between gap-3">
          <div>
            <h3 class="font-black">On your Home</h3>
            <p class="text-xs text-muted-foreground">Rows load from top to bottom. Use the arrows to change their order.</p>
          </div>
          <span class="text-xs tabular-nums text-muted-foreground">{visibleRows.length} shown</span>
        </div>
        <div class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {#each visibleRows as row, index (row.id)}
            <div class="flex min-h-16 items-center gap-2 px-2 py-2 sm:px-3">
              <div class="flex shrink-0">
                <button data-focusable disabled={index === 0} onclick={() => move(row.id, -1)} aria-label={`Move ${row.title} up`} class="grid size-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-20"><ArrowUp size={17} /></button>
                <button data-focusable disabled={index === visibleRows.length - 1} onclick={() => move(row.id, 1)} aria-label={`Move ${row.title} down`} class="grid size-10 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-20"><ArrowDown size={17} /></button>
              </div>
              <span class="min-w-0 flex-1">
                <span class="block font-bold leading-tight">{row.title}</span>
                <span class="mt-0.5 block text-[11px] text-muted-foreground">{row.description ?? row.group}</span>
              </span>
              <button data-focusable onclick={() => hide(row.id)} aria-label={`Hide ${row.title}`} class="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-bold transition-colors hover:bg-secondary active:bg-secondary">
                <EyeOff size={15} /> <span class="hidden sm:inline">Hide</span>
              </button>
            </div>
          {/each}
          {#if !visibleRows.length}<p class="p-5 text-center text-sm text-muted-foreground">Your featured banner will remain, but no carousel rows are selected.</p>{/if}
        </div>
      </div>

      <div>
        <h3 class="font-black">Available rows</h3>
        <p class="mb-2 text-xs text-muted-foreground">Add a row to place it at the bottom of your Home.</p>
        {#if rows.filter((row) => !row.enabled).length > 8}
          <label class="relative mb-3 block">
            <span class="sr-only">Filter available Home rows</span>
            <Search size={17} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input bind:value={availableSearch} type="search" placeholder="Find a genre, year, or catalog…"
              class="h-11 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm outline-none transition focus:border-theme/70" />
          </label>
        {/if}
        {#if availableGroups.length}
          <div class="space-y-4">
            {#each availableGroups as group (group.group)}
              <section>
                <h4 class="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{group.group}</h4>
                <div class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {#each group.items as row (row.id)}
                    <div class="flex min-h-16 items-center gap-3 px-3 py-2">
                      <span class="min-w-0 flex-1">
                        <span class="block font-bold leading-tight">{row.title}</span>
                        {#if row.description}<span class="mt-0.5 block text-[11px] text-muted-foreground">{row.description}</span>{/if}
                      </span>
                      <button data-focusable onclick={() => add(row.id)} class="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground">
                        <Plus size={15} /> Add
                      </button>
                    </div>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        {:else if rows.some((row) => !row.enabled) && availableSearch.trim()}
          <div class="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No rows match that search.</div>
        {:else}
          <div class="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">Every available row is already on your Home.</div>
        {/if}
      </div>
    {/if}
  </div>
</div>
