<script lang="ts">
  import { addonUrls, disabledSources, normalizeBase, replaceAddonBase } from '$lib/stremio/sources'
  import { extensionUrls } from '$lib/settings/ui'
  import { addSourceSpec, type AddSourceResult } from '$lib/settings/add-source'
  import {
    matchesSourceFilters,
    matchesSourceQuery,
    sortManagedSources,
    type ManagedSourceSortEntry,
    type SourceSortMode,
    type SourceStatusFilter,
    type SourceTypeFilter,
  } from '$lib/settings/source-filters'
  import { fetchManifest } from '$lib/stremio/manifest'
  import { findAddonConfigureUrl } from '$lib/stremio/configure'
  import { checkTrackerFeed, isSearchFeedUrl, trackerFeedUrls } from '$lib/extensions/tracker-feeds'
  import AddonConfigurator from '$lib/components/settings/AddonConfigurator.svelte'
  import CommunitySources from '../../extensions/+page.svelte'
  import Globe from '@lucide/svelte/icons/globe'
  import Radar from '@lucide/svelte/icons/radar'
  import Store from '@lucide/svelte/icons/store'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import Search from '@lucide/svelte/icons/search'
  import { isOskTarget } from '$lib/nav/osk'
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down'
  import Settings from '@lucide/svelte/icons/settings'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import X from '@lucide/svelte/icons/x'
  import { masonryItem } from '$lib/actions/masonry'
  import { navLayer } from '$lib/nav/overlay'

  let input = $state('')
  let addError = $state('')
  let adding = $state(false)
  let hasManageRows = $state(true)
  let orphanCount = $state(0)
  let filteredCommunityCount = $state(0)
  let manageFiltersReady = $state(false)
  let manageStatusFilter = $state<SourceStatusFilter>('all')
  let manageTypeFilter = $state<SourceTypeFilter>('all')
  let manageSortMode = $state<SourceSortMode>('enabled')
  let manageQuery = $state('')
  let filterOpen = $state(false)
  let filterRoot = $state<HTMLDivElement>()
  let sortOpen = $state(false)
  let sortRoot = $state<HTMLDivElement>()
  let communitySortEntries = $state<ManagedSourceSortEntry[]>([])
  const manageStatusOptions: { value: SourceStatusFilter; label: string }[] = [
    { value: 'all', label: 'Any status' },
    { value: 'enabled', label: 'Enabled' },
    { value: 'disabled', label: 'Disabled' },
  ]
  const manageTypeOptions: { value: SourceTypeFilter; label: string }[] = [
    { value: 'all', label: 'Any type' },
    { value: 'addon', label: 'Stremio add-ons' },
    { value: 'community', label: 'Community sources' },
    { value: 'indexer', label: 'Torrent trackers' },
    { value: 'catalog', label: 'Package catalogs' },
    { value: 'package', label: 'Installed packages' },
  ]
  const manageSortOptions: { value: SourceSortMode; label: string }[] = [
    { value: 'enabled', label: 'Enabled first' },
    { value: 'disabled', label: 'Disabled first' },
    { value: 'name-asc', label: 'Name A–Z' },
    { value: 'name-desc', label: 'Name Z–A' },
    { value: 'added', label: 'Added order' },
  ]
  let configuring = $state<{
    name: string
    id: string
    configureUrl: string
    currentBase: string
  } | null>(null)
  async function add() {
    if (adding) return
    adding = true
    addError = ''
    try {
      // undefined until checked; a search URL is checked as a tracker feed first.
      let indexer = isSearchFeedUrl(input) ? await checkTrackerFeed(input) : undefined
      const result: AddSourceResult = indexer && 'name' in indexer ? { error: '' } : await addSourceSpec(input)
      if ('error' in result) {
        // A source that is already added needs no second guess; it keeps its own message.
        if (result.duplicate) {
          addError = result.error
          return
        }
        // Not an add-on or a catalog: it may be a torrent tracker's feed (a Torznab endpoint, a
        // tracker's own RSS search, or a JSON search API).
        if (indexer === undefined) indexer = await checkTrackerFeed(input)
        if (indexer && 'name' in indexer) {
          const spec = input.trim()
          if (!$trackerFeedUrls.includes(spec)) $trackerFeedUrls = [...$trackerFeedUrls, spec]
          $disabledSources = $disabledSources.filter((url) => url !== spec)
          input = ''
          return
        }
        addError = indexer?.error ?? result.error
        return
      }
      input = ''
    } finally {
      adding = false
    }
  }
  function toggle(url: string) { $disabledSources = $disabledSources.includes(url) ? $disabledSources.filter((u) => u !== url) : [...$disabledSources, url] }
  function remove(i: number) { const url = $addonUrls[i]; $addonUrls = $addonUrls.filter((_, j) => j !== i); $disabledSources = $disabledSources.filter((u) => u !== url) }
  function removeIndexer(url: string) { $trackerFeedUrls = $trackerFeedUrls.filter((u) => u !== url); $disabledSources = $disabledSources.filter((u) => u !== url) }
  function beginConfiguration(currentBase: string, name: string, id: string, configureUrl: string) {
    configuring = { currentBase, name, id, configureUrl }
  }
  function saveConfiguration(base: string) {
    if (!configuring) return
    $addonUrls = replaceAddonBase($addonUrls, configuring.currentBase, base)
    $disabledSources = $disabledSources.filter((url) =>
      url !== configuring?.currentBase && normalizeBase(url) !== normalizeBase(base))
    configuring = null
  }
  const host = (u: string) => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname } catch { return u } }
  // An indexer URL carries its API key in the query, so only its host and path are ever shown.
  const indexerLabel = (u: string) => { try { const url = new URL(u); return `${url.host}${url.pathname}` } catch { return host(u) } }
  let indexerNames = $state(new Map<string, string>())
  $effect(() => {
    let stale = false
    const urls = $trackerFeedUrls
    void Promise.all(urls.map(async (url) => {
      const checked = await checkTrackerFeed(url)
      return [url, checked && 'name' in checked ? checked.name : undefined] as const
    })).then((entries) => {
      if (!stale) indexerNames = new Map(entries.filter((entry): entry is readonly [string, string] => !!entry[1]))
    })
    return () => { stale = true }
  })
  const visibleIndexerRows = $derived($trackerFeedUrls
    .map((url) => ({ url, disabled: $disabledSources.includes(url) }))
    .filter(({ url, disabled }) =>
      matchesSourceFilters({ types: ['indexer'], enabled: !disabled, disabled }, manageStatusFilter, manageTypeFilter)
      && matchesSourceQuery(manageQuery, indexerNames.get(url), indexerLabel(url))))
  const addonMetaByUrl = $derived(new Map($addonUrls.map((url) => [url, fetchManifest(url)] as const)))
  let addonNames = $state(new Map<string, string>())
  $effect(() => {
    let stale = false
    const pending = [...addonMetaByUrl]
    if (!pending.length) {
      addonNames = new Map()
      return
    }
    void Promise.all(pending.map(async ([url, manifest]) => [url, (await manifest)?.name] as const))
      .then((entries) => {
        if (!stale) addonNames = new Map(entries.filter((entry): entry is readonly [string, string] => !!entry[1]))
      })
    return () => { stale = true }
  })
  const visibleAddonRows = $derived($addonUrls
    .map((url, i) => ({ url, i, disabled: $disabledSources.includes(url) }))
    .filter(({ url, disabled }) =>
      matchesSourceFilters(
        { types: ['addon'], enabled: !disabled, disabled },
        manageStatusFilter,
        manageTypeFilter,
      ) && matchesSourceQuery(manageQuery, addonNames.get(url), host(url), url)))
  const addonSortEntries = $derived(visibleAddonRows.map(({ url, disabled }) => ({
    id: `addon:${url}`,
    label: addonNames.get(url) ?? host(url),
    enabled: !disabled,
    disabled,
  })))
  const indexerSortEntries = $derived(visibleIndexerRows.map(({ url, disabled }) => ({
    id: `indexer:${url}`,
    label: indexerNames.get(url) ?? indexerLabel(url),
    enabled: !disabled,
    disabled,
  })))
  const manageSortRanks = $derived(new Map(
    sortManagedSources([...addonSortEntries, ...indexerSortEntries, ...communitySortEntries], manageSortMode)
      .map((entry, index) => [entry.id, index] as const),
  ))
  const manageFiltersActive = $derived(manageStatusFilter !== 'all' || manageTypeFilter !== 'all')
  const manageFilterCount = $derived(Number(manageStatusFilter !== 'all') + Number(manageTypeFilter !== 'all'))
  const manageStatusLabel = $derived(manageStatusOptions.find((option) => option.value === manageStatusFilter)?.label)
  const manageTypeLabel = $derived(manageTypeOptions.find((option) => option.value === manageTypeFilter)?.label)
  function resetManageFilters() {
    manageStatusFilter = 'all'
    manageTypeFilter = 'all'
    filterOpen = false
  }
  function clearManageView() {
    manageQuery = ''
    resetManageFilters()
  }
  $effect(() => {
    if (!filterOpen && !sortOpen) return
    const closeOutside = (event: PointerEvent) => {
      // A tap on the on-screen keyboard is typing, not a press outside.
      if (isOskTarget(event.target)) return
      if (event.target instanceof Node && !filterRoot?.contains(event.target)) filterOpen = false
      if (event.target instanceof Node && !sortRoot?.contains(event.target)) sortOpen = false
    }
    document.addEventListener('pointerdown', closeOutside, true)
    return () => document.removeEventListener('pointerdown', closeOutside, true)
  })
  const configuredCount = $derived($addonUrls.length + $trackerFeedUrls.length + $extensionUrls.length + orphanCount)
</script>

<div class="min-w-0 overflow-x-hidden p-4 sm:p-8">
  <div class="mb-5 flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h2 data-settings-page-title class="text-xl font-black">Manage sources</h2>
      <p class="mt-1 text-xs text-muted-foreground">
        {#if configuredCount === 0}No sources yet
        {:else}{configuredCount} {configuredCount === 1 ? 'source' : 'sources'}{/if}
      </p>
    </div>
    <a href="/app/settings/store" data-focusable
       class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground transition-opacity active:opacity-80 sm:w-auto sm:hover:opacity-90">
      <Store size={16} />
      Add from Store
    </a>
  </div>

  <div class="max-w-7xl">
    <div class="flex flex-col gap-2 sm:flex-row">
      <input bind:value={input} data-focusable placeholder="URL, GitHub repo, or catalog…" class="min-w-0 flex-1 rounded-md bg-input px-3 py-2.5 text-base sm:py-2 sm:text-sm" onkeydown={(event) => { if (event.key === 'Enter') void add() }} />
      <button onclick={() => void add()} data-focusable disabled={adding} class="w-full rounded-md bg-primary px-4 py-2.5 font-bold text-primary-foreground disabled:opacity-50 sm:w-auto sm:py-2">{adding ? 'Adding…' : 'Add'}</button>
    </div>
    {#if addError}<p role="alert" class="mt-2 text-xs text-destructive">{addError}</p>{/if}
    <p class="mt-2 text-xs text-muted-foreground">Supports Nuvio provider manifests, Stremio add-on links from Nuvio or Omni, and torrent trackers: a tracker's RSS or JSON search URL (put <code>{'{query}'}</code> where the search words go, or keep its search parameter), or a Torznab feed from Jackett or Prowlarr with <code>?apikey=</code> and your key.</p>
    <div class="mt-2 grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
      <div class="relative col-span-2 min-w-0 sm:min-w-52 sm:flex-1">
        <Search size={14} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input type="search" data-focusable bind:value={manageQuery} aria-label="Search sources" placeholder="Search sources…"
          class="w-full rounded-md border border-border bg-transparent py-2 pl-9 pr-8 text-xs outline-none placeholder:text-muted-foreground" />
        {#if manageQuery}
          <button type="button" data-focusable aria-label="Clear source search" onclick={() => (manageQuery = '')}
            class="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
            <X size={13} />
          </button>
        {/if}
      </div>

      <div class="relative min-w-0 sm:shrink-0" bind:this={sortRoot}>
        <button type="button" data-focusable aria-label="Sort sources" aria-haspopup="menu" aria-expanded={sortOpen}
          onclick={() => (sortOpen = !sortOpen)}
          class="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:w-auto">
          <ArrowUpDown size={14} />
          Sort
        </button>

        {#if sortOpen}
          <!-- Sort and Filter are nav layers: Escape, B and remote Back close only the open one, the
               d-pad stays inside it, and closing hands focus back to its trigger (the opener). -->
          <div role="menu" aria-label="Source sort order" data-nav-trap data-nav-escape
            use:navLayer={{ kind: 'sources-sort', onClose: () => { sortOpen = false } }}
            class="absolute left-0 top-[calc(100%+0.35rem)] z-50 w-44 rounded-xl border border-border bg-card p-1.5 shadow-xl sm:left-auto sm:right-0">
            {#each manageSortOptions as option (option.value)}
              <button type="button" role="menuitemradio" aria-checked={manageSortMode === option.value} data-focusable
                onclick={() => { manageSortMode = option.value; sortOpen = false }}
                class="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-bold transition-colors {manageSortMode === option.value ? 'bg-theme/15 text-theme' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}">
                {option.label}
                {#if manageSortMode === option.value}<span class="size-1.5 rounded-full bg-theme" aria-hidden="true"></span>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="relative min-w-0 sm:shrink-0" bind:this={filterRoot}>
        <button type="button" data-focusable aria-label="Filter sources" aria-haspopup="dialog" aria-expanded={filterOpen}
          onclick={() => (filterOpen = !filterOpen)}
          class="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:w-auto">
          <SlidersHorizontal size={14} />
          Filter
          {#if manageFilterCount}<span class="grid size-4 place-items-center rounded-full bg-theme text-[0.6rem] text-white">{manageFilterCount}</span>{/if}
        </button>

        {#if filterOpen}
          <div role="dialog" aria-label="Source filters" data-nav-trap data-nav-escape
            use:navLayer={{ kind: 'sources-filter', onClose: () => { filterOpen = false } }}
            class="absolute right-0 top-[calc(100%+0.35rem)] z-50 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 shadow-xl">
            <div>
              <p class="mb-1.5 text-[0.68rem] font-black uppercase tracking-wide text-muted-foreground">Status</p>
              <div class="grid grid-cols-3 gap-1 rounded-lg bg-secondary/60 p-1">
                {#each manageStatusOptions as option (option.value)}
                  <button type="button" data-focusable aria-pressed={manageStatusFilter === option.value}
                    onclick={() => (manageStatusFilter = option.value)}
                    class="rounded-md px-2 py-1.5 text-xs font-bold transition-colors {manageStatusFilter === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
                    {option.label}
                  </button>
                {/each}
              </div>
            </div>
            <div class="mt-3">
              <p class="mb-1.5 text-[0.68rem] font-black uppercase tracking-wide text-muted-foreground">Type</p>
              <div class="grid grid-cols-2 gap-1">
                {#each manageTypeOptions as option (option.value)}
                  <button type="button" data-focusable aria-pressed={manageTypeFilter === option.value}
                    onclick={() => (manageTypeFilter = option.value)}
                    class="rounded-md px-2.5 py-2 text-left text-xs font-bold transition-colors {manageTypeFilter === option.value ? 'bg-theme/15 text-theme' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}">
                    {option.label}
                  </button>
                {/each}
              </div>
            </div>
            <div class="mt-3 flex items-center justify-between border-t border-border pt-2">
              <button type="button" data-focusable disabled={!manageFiltersActive} onclick={resetManageFilters}
                class="rounded-md px-2 py-1.5 text-xs font-bold text-muted-foreground hover:bg-accent disabled:invisible">Clear</button>
              <button type="button" data-focusable onclick={() => (filterOpen = false)}
                class="rounded-md bg-secondary px-3 py-1.5 text-xs font-bold hover:bg-accent">Done</button>
            </div>
          </div>
        {/if}
      </div>

      {#if manageFiltersReady}
        <span class="col-span-2 text-right text-[0.68rem] font-bold tabular-nums text-muted-foreground sm:ml-auto sm:shrink-0">
          {visibleAddonRows.length + visibleIndexerRows.length + filteredCommunityCount} of {configuredCount}
        </span>
      {/if}
    </div>
    {#if manageFiltersActive}
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        {#if manageStatusFilter !== 'all'}
          <button type="button" data-focusable aria-label="Clear status filter" onclick={() => (manageStatusFilter = 'all')}
            class="inline-flex items-center gap-1 rounded-full bg-theme/15 px-2.5 py-1.5 text-xs font-bold text-theme hover:bg-theme/25">
            {manageStatusLabel}<X size={12} />
          </button>
        {/if}
        {#if manageTypeFilter !== 'all'}
          <button type="button" data-focusable aria-label="Clear type filter" onclick={() => (manageTypeFilter = 'all')}
            class="inline-flex items-center gap-1 rounded-full bg-theme/15 px-2.5 py-1.5 text-xs font-bold text-theme hover:bg-theme/25">
            {manageTypeLabel}<X size={12} />
          </button>
        {/if}
      </div>
    {/if}
    {#if !$addonUrls.length && !$trackerFeedUrls.length && !hasManageRows}
      <div class="mt-3 rounded-xl border border-dashed border-border p-4 text-center">
        <p class="text-sm font-bold">Nothing here yet</p>
        <p class="mt-1 text-xs text-muted-foreground">Paste a Nuvio provider manifest, a Stremio add-on from Nuvio or Omni, a GitHub repo, or a catalog. Or add one from the Store.</p>
      </div>
    {/if}
    <div data-source-masonry class="mt-3 grid items-start gap-2 2xl:auto-rows-[1px] 2xl:grid-cols-2">
    {#if visibleAddonRows.length}
    <ul class="contents">
      {#each visibleAddonRows as { url, i, disabled: off } (url)}
        <li use:masonryItem style:order={manageSortRanks.get(`addon:${url}`) ?? 0} class="flex min-w-0 flex-col gap-3 overflow-hidden rounded-lg border border-border p-3 sm:flex-row sm:items-center" class:opacity-50={off}>
          {#await addonMetaByUrl.get(url)!}
            <div class="flex min-w-0 items-center gap-3 sm:flex-1">
              <div class="skeloader size-10 shrink-0 rounded-md"></div>
              <div class="min-w-0 flex-1"><div class="skeloader h-4 w-1/3 rounded"></div></div>
            </div>
            <div class="flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto">
              <button data-focusable data-switch onclick={() => toggle(url)} aria-pressed={!off} title={off ? 'Enable' : 'Disable'}
                class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors sm:h-5 sm:w-9 {off ? 'bg-white/20 ring-1 ring-inset ring-white/20' : 'bg-theme'}">
                <span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform sm:h-4 sm:w-4 {off ? 'translate-x-0.5' : 'translate-x-5 sm:translate-x-4'}"></span>
              </button>
              <button onclick={() => remove(i)} data-focusable title="Remove" data-touch-target aria-label={`Remove ${host(url)}`}
                class="grid size-10 shrink-0 place-items-center rounded-md text-destructive transition-colors hover:bg-accent active:bg-destructive/10 sm:size-8"><Trash2 size={16} /></button>
            </div>
          {:then m}
            <div class="flex min-w-0 items-start gap-3 sm:flex-1 sm:items-center">
              {#if m?.logo}
                <img src={m.logo} alt="" loading="lazy" decoding="async" class="size-10 shrink-0 rounded-md bg-neutral-900 object-contain" />
              {:else}
                <div class="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground"><Globe size={18} /></div>
              {/if}
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span class="min-w-0 flex-1 truncate font-bold">{m?.name ?? host(url)}</span>
                  <span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold text-muted-foreground">ADD-ON</span>
                  {#if m?.version}<span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold text-muted-foreground">v{m.version}</span>{/if}
                </div>
                <p class="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">{m?.description ?? url}</p>
              </div>
            </div>
            <div class="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
              {#if m}
                {#await findAddonConfigureUrl(url, m) then configureUrl}
                  {#if configureUrl}
                    <button type="button" data-focusable aria-label={`Configure ${m.name}`} title={`Configure ${m.name}`}
                      data-touch-target onclick={() => beginConfiguration(url, m.name, m.id, configureUrl)}
                      class="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                      <Settings size={17} />
                    </button>
                  {/if}
                {/await}
              {/if}
              <!-- `data-switch`: fixed-geometry pill — the large-target a11y mode grows its pointer
                   target, not its box, so the slider never squares off into a circle (app.css). -->
              <button data-focusable data-switch onclick={() => toggle(url)} aria-pressed={!off} title={off ? 'Enable' : 'Disable'}
                class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors sm:h-5 sm:w-9 {off ? 'bg-white/20 ring-1 ring-inset ring-white/20' : 'bg-theme'}">
                <span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform sm:h-4 sm:w-4 {off ? 'translate-x-0.5' : 'translate-x-5 sm:translate-x-4'}"></span>
              </button>
              <button onclick={() => remove(i)} data-focusable title="Remove" data-touch-target aria-label={`Remove ${m?.name ?? host(url)}`}
                class="grid size-10 shrink-0 place-items-center rounded-md text-destructive transition-colors hover:bg-accent active:bg-destructive/10 sm:size-8"><Trash2 size={16} /></button>
            </div>
          {/await}
        </li>
      {/each}
    </ul>
    {/if}
    {#if visibleIndexerRows.length}
    <ul class="contents">
      {#each visibleIndexerRows as { url, disabled: off } (url)}
        <li use:masonryItem style:order={manageSortRanks.get(`indexer:${url}`) ?? 0} class="flex min-w-0 flex-col gap-3 overflow-hidden rounded-lg border border-border p-3 sm:flex-row sm:items-center" class:opacity-50={off}>
          <div class="flex min-w-0 items-start gap-3 sm:flex-1 sm:items-center">
            <div class="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground"><Radar size={18} /></div>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <span class="min-w-0 flex-1 truncate font-bold">{indexerNames.get(url) ?? host(url)}</span>
                <span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold text-muted-foreground">TRACKER</span>
              </div>
              <p class="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">{indexerLabel(url)}</p>
            </div>
          </div>
          <div class="flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto">
            <button data-focusable data-switch onclick={() => toggle(url)} aria-pressed={!off} title={off ? 'Enable' : 'Disable'}
              class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors sm:h-5 sm:w-9 {off ? 'bg-white/20 ring-1 ring-inset ring-white/20' : 'bg-theme'}">
              <span class="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform sm:h-4 sm:w-4 {off ? 'translate-x-0.5' : 'translate-x-5 sm:translate-x-4'}"></span>
            </button>
            <button onclick={() => removeIndexer(url)} data-focusable title="Remove" data-touch-target aria-label={`Remove ${indexerNames.get(url) ?? host(url)}`}
              class="grid size-10 shrink-0 place-items-center rounded-md text-destructive transition-colors hover:bg-accent active:bg-destructive/10 sm:size-8"><Trash2 size={16} /></button>
          </div>
        </li>
      {/each}
    </ul>
    {/if}

  <div class="contents">
    <CommunitySources
      section="manage"
      query={manageQuery}
      statusFilter={manageStatusFilter}
      typeFilter={manageTypeFilter}
      sortMode={manageSortMode}
      sortRanks={manageSortRanks}
      bind:hasManageRows
      bind:orphanCount
      bind:visibleManageRows={filteredCommunityCount}
      bind:manageFiltersReady
      bind:manageSortEntries={communitySortEntries}
    />
  </div>
  </div>
  {#if manageFiltersReady && configuredCount > 0 && visibleAddonRows.length + visibleIndexerRows.length + filteredCommunityCount === 0}
    <div class="mt-3 rounded-xl border border-dashed border-border p-4 text-center">
      <p class="text-sm font-bold">No matching sources</p>
      <button type="button" data-focusable onclick={clearManageView}
        class="mt-2 rounded-md bg-secondary px-3 py-2 text-xs font-bold hover:bg-accent">Clear search and filters</button>
    </div>
  {/if}
  </div>
</div>

{#if configuring}
  <AddonConfigurator
    name={configuring.name}
    expectedId={configuring.id}
    configureUrl={configuring.configureUrl}
    onCancel={() => (configuring = null)}
    onConfigured={saveConfiguration}
  />
{/if}
