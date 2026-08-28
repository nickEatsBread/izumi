<script lang="ts">
  import { onDestroy } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { addonUrls, disabledSources, normalizeBase, replaceAddonBase } from '$lib/stremio/sources'
  import {
    autoSelectSource, autoSelectCountdown, preferredQuality, seadexAnnotations,
    sourcePriority, sourcePriorityMode, adaptiveSourceMode, extensionUrls,
    disabledExtensions,
  } from '$lib/settings/ui'
  import { classifySourceSpec } from '$lib/settings/classify-source-spec'
  import {
    matchesSourceFilters,
    matchesSourceQuery,
    sortManagedSources,
    type ManagedSourceSortEntry,
    type SourceSortMode,
    type SourceStatusFilter,
    type SourceTypeFilter,
  } from '$lib/settings/source-filters'
  import { priorityCandidates } from '$lib/settings/source-origins'
  import { fetchManifest } from '$lib/stremio/manifest'
  import { findAddonConfigureUrl } from '$lib/stremio/configure'
  import { defaultDiscussionPlatform } from '$lib/comments'
  import { checkExtensionUpdates } from '$lib/extensions/auto-update'
  import AddonConfigurator from '$lib/components/settings/AddonConfigurator.svelte'
  import CommunitySources from '../extensions/+page.svelte'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import Globe from '@lucide/svelte/icons/globe'
  import Store from '@lucide/svelte/icons/store'
  import Layers3 from '@lucide/svelte/icons/layers-3'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import ListOrdered from '@lucide/svelte/icons/list-ordered'
  import Search from '@lucide/svelte/icons/search'
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import Settings from '@lucide/svelte/icons/settings'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import X from '@lucide/svelte/icons/x'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import Toggle from '$lib/components/settings/Toggle.svelte'
  import { masonryItem } from '$lib/actions/masonry'

  // One control over two stores: whether to auto-pick at all, and whether to wait first. They were
  // separate toggles, which read as unrelated settings even though the second only means anything
  // when the first is on.
  const autoMode = $derived(!$autoSelectSource ? 'off' : $autoSelectCountdown ? 'countdown' : 'instant')
  function setAutoMode(mode: string) {
    $autoSelectSource = mode !== 'off'
    if (mode !== 'off') $autoSelectCountdown = mode === 'countdown'
  }

  let input = $state('')
  let addError = $state('')
  let adding = $state(false)
  let checkingUpdates = $state(false)
  let updateCheckFeedback = $state('')
  let updateFeedbackTimer: ReturnType<typeof setTimeout> | undefined
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
      const result = await classifySourceSpec(input)
      if ('error' in result) {
        addError = result.error
        return
      }
      if (result.kind === 'addon') {
        const alreadyCommunity = $extensionUrls.some((url) =>
          url === result.spec || normalizeBase(url) === result.spec)
        if (alreadyCommunity) {
          addError = "That's already added as a community source."
          return
        }
        if (!$addonUrls.some((url) => normalizeBase(url) === result.spec)) {
          $addonUrls = [...$addonUrls, result.spec]
        }
        $disabledSources = $disabledSources.filter((url) =>
          url !== result.spec && normalizeBase(url) !== result.spec)
        input = ''
        return
      }
      const alreadyAddon = $addonUrls.some((url) =>
        url === result.spec || normalizeBase(url) === normalizeBase(result.spec))
      if (alreadyAddon) {
        addError = "That's already added as an add-on."
        return
      }
      if ($extensionUrls.includes(result.spec)) {
        $disabledExtensions = $disabledExtensions.filter((url) => url !== result.spec)
      } else {
        $extensionUrls = [...$extensionUrls, result.spec]
      }
      input = ''
    } finally {
      adding = false
    }
  }
  function toggle(url: string) { $disabledSources = $disabledSources.includes(url) ? $disabledSources.filter((u) => u !== url) : [...$disabledSources, url] }
  function remove(i: number) { const url = $addonUrls[i]; $addonUrls = $addonUrls.filter((_, j) => j !== i); $disabledSources = $disabledSources.filter((u) => u !== url) }
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
  const manageSortRanks = $derived(new Map(
    sortManagedSources([...addonSortEntries, ...communitySortEntries], manageSortMode)
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
  async function checkForUpdates() {
    if (checkingUpdates) return
    checkingUpdates = true
    updateCheckFeedback = ''
    if (updateFeedbackTimer) clearTimeout(updateFeedbackTimer)
    try {
      const result = await checkExtensionUpdates({
        retryAttempted: true,
        includeDisabledCatalogs: true,
        includeOfficialCatalog: true,
      })
      if (result.reason === 'playback') updateCheckFeedback = 'Stop playback first'
      else if (result.reason === 'no-installed') updateCheckFeedback = 'Nothing installed'
      else if (result.reason === 'no-catalogs') updateCheckFeedback = 'No update source available'
      else if (result.reason === 'catalog-unavailable') updateCheckFeedback = 'Check failed'
      else if (result.updated.length && result.failed) updateCheckFeedback = `${result.updated.length} updated · ${result.failed} failed`
      else if (result.updated.length) updateCheckFeedback = `${result.updated.length} updated`
      else if (result.failed) updateCheckFeedback = 'Update failed'
      else updateCheckFeedback = 'Up to date'
    } catch {
      updateCheckFeedback = 'Check failed'
    } finally {
      checkingUpdates = false
      updateFeedbackTimer = setTimeout(() => (updateCheckFeedback = ''), 4500)
    }
  }
  onDestroy(() => {
    if (updateFeedbackTimer) clearTimeout(updateFeedbackTimer)
  })
  function clearManageView() {
    manageQuery = ''
    resetManageFilters()
  }
  $effect(() => {
    if (!filterOpen && !sortOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterRoot?.contains(event.target)) filterOpen = false
      if (event.target instanceof Node && !sortRoot?.contains(event.target)) sortOpen = false
    }
    document.addEventListener('pointerdown', closeOutside, true)
    return () => document.removeEventListener('pointerdown', closeOutside, true)
  })

  // --- Source priority -----------------------------------------------------------------------
  // Editing the order needs a screen of its own (see ./priority): reorder controls only stay
  // tappable at full width, and on Android this page is already a long scroll. What stays here is a
  // one-line preview of the order, so the current setting is readable without leaving Sources.
  const PREVIEW_ROWS = 3
  const candidateById = $derived(new Map($priorityCandidates.map((c) => [c.id, c])))
  const prioritySummary = $derived.by(() => {
    const named = $sourcePriority.map((id, i) => `${i + 1}. ${candidateById.get(id)?.name ?? 'Unavailable source'}`)
    const shown = named.slice(0, PREVIEW_ROWS).join('  ·  ')
    const rest = named.length - PREVIEW_ROWS
    return rest > 0 ? `${shown}  ·  +${rest} more` : shown
  })

  type SourcesTab = 'manage' | 'playback' | 'ordering'
  const tabs: { id: SourcesTab; label: string; icon: typeof Layers3 }[] = [
    { id: 'manage', label: 'My sources', icon: Layers3 },
    { id: 'playback', label: 'Playback', icon: SlidersHorizontal },
    { id: 'ordering', label: 'Ordering', icon: ListOrdered },
  ]
  const activeTab = $derived.by((): SourcesTab => {
    const requested = $page.url.searchParams.get('tab')
    if (requested === 'manage' || requested === 'playback' || requested === 'ordering') return requested
    const setting = $page.url.searchParams.get('setting')
    if (setting === 'source-priority' || setting === 'default-discussion-source') return 'ordering'
    if (setting) return 'playback'
    return 'manage'
  })
  function selectTab(tab: SourcesTab) {
    const params = new URLSearchParams($page.url.searchParams)
    params.set('tab', tab)
    params.delete('setting')
    void goto(`${$page.url.pathname}?${params}`, { keepFocus: true, noScroll: true, replaceState: true })
  }
  function moveTab(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const target = event.currentTarget as HTMLButtonElement | null
    if (!target) return
    const buttons = [...target.closest<HTMLElement>('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []]
    const current = buttons.indexOf(target)
    if (current < 0 || !buttons.length) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next].focus()
    buttons[next].click()
  }
  const configuredCount = $derived($addonUrls.length + $extensionUrls.length + orphanCount)
</script>

<svelte:window onkeydown={(event) => {
  if ((filterOpen || sortOpen) && event.key === 'Escape') {
    event.preventDefault()
    filterOpen = false
    sortOpen = false
  }
}} />

<div class="min-w-0 overflow-x-hidden p-4 sm:p-8">
  <div class="mb-5 max-w-7xl">
    <div class="mb-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-xl font-black max-sm:hidden">Sources</h2>
      <div class="flex w-full flex-col gap-2 sm:w-auto sm:translate-y-3 sm:flex-row">
        <button type="button" data-focusable disabled={checkingUpdates} onclick={() => void checkForUpdates()}
          class="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-black text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60 sm:w-auto sm:min-w-44">
          <RefreshCw size={16} class={checkingUpdates ? 'animate-spin' : ''} />
          {checkingUpdates ? 'Checking…' : updateCheckFeedback || 'Check for Updates'}
        </button>
        <a href="/app/settings/store" data-focusable
           class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-black text-primary-foreground transition-opacity active:opacity-80 sm:w-auto sm:hover:opacity-90">
          <Store size={16} />
          Add from Store
        </a>
      </div>
    </div>
    <p class="max-w-2xl text-sm text-muted-foreground">Add, configure, and prioritise every place Izumi finds an episode.</p>
    <p class="mt-1 text-xs text-muted-foreground">
      {#if configuredCount === 0}No sources yet
      {:else}{configuredCount} {configuredCount === 1 ? 'source' : 'sources'}{/if}
    </p>
  </div>

  <div role="tablist" aria-label="Source settings" class="mb-3 grid max-w-7xl grid-cols-3 gap-1 rounded-xl bg-secondary/60 p-1">
    {#each tabs as tab (tab.id)}
      {@const Icon = tab.icon}
      <button type="button" role="tab" id="sources-tab-{tab.id}" aria-controls="sources-panel-{tab.id}"
        data-focusable aria-selected={activeTab === tab.id} tabindex={activeTab === tab.id ? 0 : -1}
        onclick={() => selectTab(tab.id)} onkeydown={moveTab}
        class="flex min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-xs font-black transition-colors sm:text-sm
          {activeTab === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}">
        <Icon size={16} class="hidden shrink-0 sm:block" />
        <span class="truncate">{tab.label}</span>
      </button>
    {/each}
  </div>

  {#if activeTab === 'playback'}
  <div id="sources-panel-playback" role="tabpanel" aria-labelledby="sources-tab-playback">
  <CommunitySources section="community-results" />

  <div class="mt-6"><CommunitySources section="torrent-debrid" /></div>

  <section class="mt-10" aria-labelledby="automatic-selection-heading">
    <div class="mb-4">
      <h3 id="automatic-selection-heading" class="text-base font-black">Automatic selection</h3>
      <p class="mt-1 text-xs text-muted-foreground">Control whether Izumi chooses for you and what makes a result the best match.</p>
    </div>
  <div class="mb-6 max-w-2xl space-y-3">
    <label data-setting-key="auto-play-the-best-source" class="flex flex-col gap-1">
      <span class="text-sm font-bold">Auto-play the best source</span>
      <SelectMenu
        value={autoMode}
        onChange={setAutoMode}
        ariaLabel="Auto-play the best source"
        options={[
          { value: 'countdown', label: 'After a short countdown' },
          { value: 'instant', label: 'Immediately' },
          { value: 'off', label: 'Off — always choose manually' },
        ]}
      />
      <span class="text-xs text-muted-foreground">
        {#if autoMode === 'off'}The source list stays open until you pick one yourself.
        {:else if autoMode === 'instant'}The best cached match for your preferred quality plays the moment the source list settles — no wait, no chance to cancel.
        {:else}Once the source list settles, the Auto button fills left→right, then the best cached match for your preferred quality plays. With Mark best releases on, it waits a moment longer for the curated verdict rather than committing without it. Cancel any time by picking another source or interacting.{/if}
      </span>
    </label>

    {#if $autoSelectSource}
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">Preferred quality</span>
        <SelectMenu
          bind:value={$preferredQuality}
          ariaLabel="Preferred quality"
          options={[
            { value: '2160', label: '4K' },
            { value: '1080', label: '1080p' },
            { value: '720', label: '720p' },
            { value: '480', label: '480p' },
            { value: 'any', label: 'Any (highest available)' },
          ]}
        />
      </label>
    {/if}

    <label data-setting-key="adaptive-source-planner" class="flex flex-col gap-1">
      <span class="text-sm font-bold">Adaptive source planner</span>
      <SelectMenu
        bind:value={$adaptiveSourceMode}
        ariaLabel="Adaptive source planner"
        options={[
          { value: 'active', label: 'On — adapt automatic choices' },
          { value: 'shadow', label: 'Preview — learn without changing playback' },
          { value: 'off', label: 'Off' },
        ]}
      />
      <span class="text-xs text-muted-foreground">
        {#if $adaptiveSourceMode === 'active'}Adapts automatic choices and bounded recovery using repeated, recent outcomes stored only on this device. A bad route can trigger another route; wrong content always triggers another release. It cannot override cache, quality, audio language, or your source order.
        {:else if $adaptiveSourceMode === 'shadow'}Uses repeated, recent playback outcomes stored only on this device to preview a safer first source. It cannot override cache, quality, audio language, or your source order, and it does not change what Auto plays yet.
        {:else}Only the established source ranking is used. Existing local outcome summaries stay private on this device and can be cleared with local history.{/if}
      </span>
    </label>

    <Toggle
      label="Mark best releases"
      desc="Check releases.moe for the release its curators rate best for each title, badge it in the source list, and put it first among the sources of the same resolution. Never picks a lower resolution than you would have got without it. Adds no source — it only annotates what your addons already found."
      value={$seadexAnnotations}
      onToggle={() => ($seadexAnnotations = !$seadexAnnotations)}
    />
  </div>
  </section>
  </div>
  {/if}

  {#if activeTab === 'manage'}
  <div id="sources-panel-manage" role="tabpanel" aria-labelledby="sources-tab-manage">
  <div class="max-w-7xl">
    <div class="flex flex-col gap-2 sm:flex-row">
      <input bind:value={input} data-focusable placeholder="URL, GitHub repo, or catalog…" class="min-w-0 flex-1 rounded-md bg-input px-3 py-2.5 text-base sm:py-2 sm:text-sm" onkeydown={(event) => { if (event.key === 'Enter') void add() }} />
      <button onclick={() => void add()} data-focusable disabled={adding} class="w-full rounded-md bg-primary px-4 py-2.5 font-bold text-primary-foreground disabled:opacity-50 sm:w-auto sm:py-2">{adding ? 'Adding…' : 'Add'}</button>
    </div>
    {#if addError}<p role="alert" class="mt-2 text-xs text-destructive">{addError}</p>{/if}
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
          <div role="menu" aria-label="Source sort order"
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
          <div role="dialog" aria-label="Source filters"
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
          {visibleAddonRows.length + filteredCommunityCount} of {configuredCount}
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
    {#if !$addonUrls.length && !hasManageRows}
      <div class="mt-3 rounded-xl border border-dashed border-border p-4 text-center">
        <p class="text-sm font-bold">Nothing here yet</p>
        <p class="mt-1 text-xs text-muted-foreground">Paste a Stremio add-on, GitHub repo, or catalog. Or add one from the Store.</p>
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
              <button onclick={() => remove(i)} data-focusable title="Remove" aria-label={`Remove ${host(url)}`}
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
                      onclick={() => beginConfiguration(url, m.name, m.id, configureUrl)}
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
              <button onclick={() => remove(i)} data-focusable title="Remove" aria-label={`Remove ${m?.name ?? host(url)}`}
                class="grid size-10 shrink-0 place-items-center rounded-md text-destructive transition-colors hover:bg-accent active:bg-destructive/10 sm:size-8"><Trash2 size={16} /></button>
            </div>
          {/await}
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
  {#if manageFiltersReady && configuredCount > 0 && visibleAddonRows.length + filteredCommunityCount === 0}
    <div class="mt-3 rounded-xl border border-dashed border-border p-4 text-center">
      <p class="text-sm font-bold">No matching sources</p>
      <button type="button" data-focusable onclick={clearManageView}
        class="mt-2 rounded-md bg-secondary px-3 py-2 text-xs font-bold hover:bg-accent">Clear search and filters</button>
    </div>
  {/if}
  </div>
  </div>
  {/if}

  {#if activeTab === 'ordering'}
  <div id="sources-panel-ordering" role="tabpanel" aria-labelledby="sources-tab-ordering">
  <div class="mt-8 max-w-2xl" data-setting-key="source-priority">
    <h3 class="mb-1 text-sm font-black">Source priority</h3>
    <p class="mb-3 text-xs text-muted-foreground">The order to trust your sources in, most trusted first. It settles ties the ranking already makes — a listed source is preferred within its quality tier, never ahead of a cached copy or your audio language.</p>

    <a href="/app/settings/sources/priority" data-focusable
       class="flex items-center gap-3 rounded-lg border border-border p-4 transition-colors active:bg-secondary sm:p-3 sm:hover:bg-secondary">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-sm font-bold">{$sourcePriority.length ? `${$sourcePriority.length} ${$sourcePriority.length === 1 ? 'source' : 'sources'} ordered` : 'Not set'}</span>
          {#if $sourcePriority.length}
            <span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-muted-foreground">{$sourcePriorityMode}</span>
          {/if}
        </div>
        <p class="mt-0.5 truncate text-xs text-muted-foreground">
          {$sourcePriority.length ? prioritySummary : 'Every source is ranked on its own merits. Open to put one you trust first.'}
        </p>
      </div>
      <ChevronRight size={18} class="shrink-0 text-muted-foreground" />
    </a>
  </div>

  <div class="mt-8 max-w-2xl">
    <h3 class="mb-1 text-sm font-black">Discussion</h3>
    <p class="mb-3 text-xs text-muted-foreground">A comment button in the player shows episode discussions from the available community sources.</p>
    <label data-setting-key="default-discussion-source" class="flex flex-col gap-1">
      <span class="text-sm font-bold">Default source</span>
      <span class="text-xs text-muted-foreground">Which source the discussion panel opens on. An embeddable source (Disqus/forum) renders its embed inline.</span>
      <SelectMenu
        bind:value={$defaultDiscussionPlatform}
        className="mt-1"
        ariaLabel="Default discussion source"
        options={[
          { value: 'disqus', label: 'Disqus' },
          { value: 'auto', label: 'Auto — all sources' },
          { value: 'reddit', label: 'Reddit' },
          { value: 'anilist', label: 'AniList' },
          { value: 'mal', label: 'MyAnimeList' },
          { value: 'youtube', label: 'YouTube' },
          { value: 'animecommunity', label: 'Anime Community' },
        ]}
      />
    </label>
  </div>
  </div>
  {/if}
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
