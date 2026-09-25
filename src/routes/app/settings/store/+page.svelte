<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import Search from '@lucide/svelte/icons/search'
  import Plus from '@lucide/svelte/icons/plus'
  import Settings2 from '@lucide/svelte/icons/settings-2'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import AddonConfigurator from '$lib/components/settings/AddonConfigurator.svelte'
  import ExtensionServiceSettings from '$lib/components/settings/ExtensionServiceSettings.svelte'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'
  import StoreEntryCard from '$lib/components/store/StoreEntryCard.svelte'
  import StoreEntrySheet from '$lib/components/store/StoreEntrySheet.svelte'
  import StoresDialog from '$lib/components/store/StoresDialog.svelte'
  import { listCommunityAddons } from '$lib/stremio/community-store'
  import { addonUrls, disabledSources, normalizeBase, replaceAddonBase } from '$lib/stremio/sources'
  import { fetchManifest } from '$lib/stremio/manifest'
  import {
    fetchExtensionMeta,
    installCatalogPackage,
    installedExtensionPackages,
    installedPackageIcons,
    removeInstalledExtension,
    type InstalledExtensionPackage,
  } from '$lib/extensions/manager'
  import { disabledExtensions, disabledPlugins, enabledExtensionUrls, extensionUrls, showAdult } from '$lib/settings/ui'
  import { installedThemes } from '$lib/themes/installed'
  import { newerVersion } from '$lib/themes/packages'
  import { BUILTIN_STORES, allStores, directoryEnabled, enabledStores } from '$lib/store/feeds'
  import { loadStoreAndPin } from '$lib/store/service'
  import type { LoadedStore } from '$lib/store/load'
  import { directoryEntries } from '$lib/store/directory'
  import { DEFAULT_STORE_FILTER, filterStoreEntries, storeLanguages, type StoreFilter } from '$lib/store/filters'
  import { installStoreEntry, installedRef, type InstalledState } from '$lib/store/install'
  import { currentLegacyStores, legacyPackageStores, legacyStoresFrom, packageOrigins } from '$lib/store/origins'
  import { packageHashPinned, packageSignatureLabel } from '$lib/store/trust'
  import { migrateCatalogStores } from '$lib/store/migrate'
  import { ADDON_DIRECTORY_ID, type SourceType, type StoreEntry } from '$lib/store/types'

  type KindChip = 'all' | 'source' | 'theme'
  const KIND_CHIPS: { id: KindChip; label: string }[] = [
    { id: 'all', label: 'Everything' },
    { id: 'source', label: 'Sources' },
    { id: 'theme', label: 'Themes' },
  ]
  const SOURCE_CHIPS: { id: 'all' | SourceType; label: string }[] = [
    { id: 'all', label: 'All sources' },
    { id: 'stremio-addon', label: 'Addons' },
    { id: 'torrent-provider', label: 'Torrent' },
    { id: 'stream-provider', label: 'Streaming' },
    { id: 'package', label: 'Packages' },
  ]
  const CONTENT_OPTIONS = [
    { value: 'all', label: 'Any content' },
    { value: 'anime', label: 'Anime' },
    { value: 'movie', label: 'Films' },
    { value: 'series', label: 'Series' },
  ]
  const SORT_OPTIONS = [
    { value: 'popular', label: 'Popular' },
    { value: 'updated', label: 'Recently updated' },
    { value: 'name', label: 'Name' },
  ]
  const PAGE = 60
  const builtinIds = new Set([...BUILTIN_STORES.map((store) => store.id), ADDON_DIRECTORY_ID])

  let storeChip = $state('all')
  let kind = $state<KindChip>('all')
  let sourceType = $state<'all' | SourceType>('all')
  let language = $state('all')
  let content = $state('all')
  let sort = $state('popular')
  let withoutDebrid = $state(false)
  let installedOnly = $state(false)
  let query = $state('')
  let limit = $state(PAGE)
  let loaded = $state.raw<Record<string, LoadedStore>>({})
  let loading = $state(false)
  let directory = $state.raw<StoreEntry[]>([])
  let directoryTotal = $state(0)
  let directoryError = $state('')
  let installedPackages = $state.raw<InstalledExtensionPackage[]>([])
  let addonBaseById = $state.raw<Record<string, string>>({})
  // Real package artwork, filled in after the list paints (icon loading can start the JVM runtime):
  // installed Aniyomi launcher icons by package id, and manifest icons of the providers the user's
  // own sources expand to.
  let jvmIcons = $state.raw(new Map<string, string>())
  let configIcons = $state.raw<Record<string, string>>({})
  let selected = $state.raw<StoreEntry | null>(null)
  let busyKey = $state('')
  let notice = $state('')
  let error = $state('')
  let storesDialog = $state<{ mode: 'manage' | 'add'; url: string } | null>(null)
  let configuring = $state<{ name: string; id: string; configureUrl: string; currentBase?: string } | null>(null)
  let serviceSettings = $state<{ id: string; name: string } | null>(null)

  const storeUrlById = $derived(new Map($allStores.map((store) => [store.id, store.url])))
  const storeNameById = $derived(new Map<string, string>([
    ...$allStores.map((store): [string, string] => [store.id, store.name]),
    [ADDON_DIRECTORY_ID, 'Addon directory'],
  ]))
  const storeChips = $derived([
    { id: 'all', label: 'All stores' },
    { id: 'izumi', label: 'izumi' },
    ...($directoryEnabled ? [{ id: ADDON_DIRECTORY_ID, label: 'Addon directory' }] : []),
    ...$enabledStores.filter((store) => !store.builtin).map((store) => ({ id: store.id, label: store.name })),
  ])
  const directoryWanted = $derived($directoryEnabled
    && (storeChip === 'all' || storeChip === ADDON_DIRECTORY_ID)
    && (kind === 'all' || kind === 'source')
    && (sourceType === 'all' || sourceType === 'stremio-addon'))
  const installedState: InstalledState = $derived({
    addonBases: $addonUrls.map(normalizeBase),
    addonBaseById,
    extensionSpecs: $extensionUrls,
    packages: installedPackages,
    packageOrigins: $packageOrigins,
    // Packages installed before origins existed may only be claimed by the stores frozen for them.
    legacyStores: legacyStoresFrom($legacyPackageStores, $extensionUrls),
    themes: $installedThemes.map((theme) => ({ id: theme.id, origin: theme.origin })),
  })
  const refOf = (entry: StoreEntry) => installedRef(entry, installedState, storeUrlById.get(entry.storeId) ?? '')
  const isInstalled = (entry: StoreEntry) => refOf(entry) !== null
  /** Whether two URLs share a host. Reconfigure only ever runs through the installed addon's own host:
   *  a listing's configure page anywhere else must never be able to replace the configured copy. */
  function sameHost(a: string, b: string): boolean {
    try {
      return new URL(a).hostname === new URL(b).hostname
    } catch {
      return false
    }
  }
  function iconOf(entry: StoreEntry): string | undefined {
    if (entry.icon || entry.install.type !== 'package') return entry.icon
    const id = entry.install.pkg.id
    return Object.hasOwn(configIcons, id) ? configIcons[id] : jvmIcons.get(id)
  }
  /** Installed, and this store lists another version. A package only updates from its own store
   *  (a same-id package elsewhere is a takeover); a theme only when the listed version is newer. */
  function updateAvailable(entry: StoreEntry): boolean {
    const install = entry.install
    const storeUrl = storeUrlById.get(entry.storeId) ?? ''
    if (install.type === 'package') {
      const installed = installedPackages.find((item) => item.id === install.pkg.id)
      // refOf is origin-aware: it only matches when this store is where the package came from.
      return !!installed && refOf(entry) !== null && installed.version !== install.pkg.version
    }
    if (install.type === 'theme') {
      const installed = $installedThemes.find((theme) => theme.id === install.release.id && theme.origin === storeUrl)
      try {
        return !!installed && newerVersion(install.release.version, installed.package.version)
      } catch {
        return false
      }
    }
    return false
  }
  const staticEntries = $derived($enabledStores.flatMap((store) => loaded[store.id]?.listing?.entries ?? []))
  const allEntries = $derived([...staticEntries, ...(directoryWanted ? directory : [])])
  const filter: StoreFilter = $derived({
    ...DEFAULT_STORE_FILTER,
    storeIds: storeChip === 'all' ? 'all' : storeChip === 'izumi' ? BUILTIN_STORES.map((store) => store.id) : [storeChip],
    kind,
    sourceType: kind === 'source' ? sourceType : 'all',
    language,
    content: content as StoreFilter['content'],
    withoutDebrid,
    installedOnly,
    showAdult: $showAdult,
    query,
    sort: sort as StoreFilter['sort'],
  })
  const results = $derived(filterStoreEntries(allEntries, filter, isInstalled))
  const visible = $derived(results.slice(0, limit))
  const languageOptions = $derived([
    { value: 'all', label: 'Any language' },
    ...storeLanguages(allEntries).map((code) => ({ value: code, label: code.toUpperCase() })),
  ])
  const lockedStores = $derived($enabledStores.filter((store) => loaded[store.id]?.trust.state === 'locked'))
  const failedStores = $derived($enabledStores.filter((store) => loaded[store.id]?.error && !loaded[store.id]?.listing))
  // Adding, hiding or re-trusting a store changes this signature, which reloads the listings.
  const storeSignature = $derived($enabledStores.map((store) => `${store.id}:${store.pinnedKey ?? ''}`).join('|'))

  // Each load supersedes the ones before it: an older load that answers late (after a refresh or a
  // re-trusted key) must not put its stale verdict back.
  let loadGeneration = 0
  async function loadStores(force = false) {
    const generation = ++loadGeneration
    loading = true
    try {
      await Promise.all($enabledStores.map(async (store) => {
        const result = await loadStoreAndPin(store, { force })
        if (generation === loadGeneration) loaded = { ...loaded, [store.id]: result }
      }))
    } finally {
      if (generation === loadGeneration) loading = false
    }
  }

  async function refreshInstalled() {
    installedPackages = await installedExtensionPackages()
    void installedPackageIcons(installedPackages).then((icons) => { jvmIcons = icons })
  }

  $effect(() => {
    void storeSignature
    untrack(() => { void loadStores() })
  })

  $effect(() => {
    const specs = $enabledExtensionUrls
    let stale = false
    void Promise.all(specs.map((spec) => fetchExtensionMeta(spec))).then((results) => {
      if (stale) return
      configIcons = Object.fromEntries(results.flat().flatMap((config) => config.icon ? [[config.id, config.icon]] : []))
    })
    return () => { stale = true }
  })

  // The directory is searched on its server; debounce typing like the old addon tab did.
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    if (!directoryWanted) return
    const search = query
    const order = sort
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      directoryError = ''
      listCommunityAddons({ search, category: search.trim() ? undefined : 'anime', sort: order === 'updated' ? 'new' : 'stars', limit: 40 })
        .then((result) => {
          directory = directoryEntries(result.addons)
          directoryTotal = result.pagination.total
        })
        .catch((cause) => { directoryError = cause instanceof Error ? cause.message : String(cause) })
    }, 250)
    return () => clearTimeout(searchTimer)
  })

  // A configured addon has a credential-bearing URL that differs from its listing, so installed
  // addons are matched by manifest id as well as by URL.
  $effect(() => {
    const bases = [...$addonUrls]
    let stale = false
    void Promise.all(bases.map(async (base) => [base, await fetchManifest(base)] as const)).then((entries) => {
      if (stale) return
      addonBaseById = Object.fromEntries(entries.flatMap(([base, manifest]) => manifest?.id ? [[manifest.id, base]] : []))
    })
    return () => { stale = true }
  })

  $effect(() => {
    void filter
    untrack(() => { limit = PAGE })
  })

  // izumi://store/add?url=… arrives here as ?add=…: open the preview; adding still needs a click.
  $effect(() => {
    const add = page.url.searchParams.get('add')
    if (add) untrack(() => { storesDialog = { mode: 'add', url: add } })
  })

  onMount(() => {
    // Freeze which stores may claim packages installed before origins were recorded, before any
    // install from this page can add a catalog to the source list.
    currentLegacyStores()
    void refreshInstalled()
    // Catalogs added before stores existed become stores the first time the Store opens.
    void migrateCatalogStores().catch(() => 0)
  })

  function trustLabel(entry: StoreEntry): string {
    if (entry.storeId === ADDON_DIRECTORY_ID) return 'Directory listing · addons are remote services'
    const state = loaded[entry.storeId]?.trust.state
    const listing = state === 'signed' ? 'Store listing signed' : state === 'locked' ? 'Store key check failed' : 'Store listing unsigned'
    const install = entry.install
    if (install.type !== 'package') return listing
    const hashPinned = packageHashPinned(install.pkg)
    const installed = installedPackages.find((item) => item.id === install.pkg.id)
    if (!installed) return `${listing} · ${hashPinned ? "package pinned by the listing's hash" : 'package not hash-pinned by its store'}`
    const pin = $allStores.find((store) => store.id === entry.storeId)?.pinnedKey
    return `${listing} · ${packageSignatureLabel(installed.signerKey, pin, hashPinned)}`
  }

  function enabledState(entry: StoreEntry): boolean {
    const ref = refOf(entry)
    if (!ref) return false
    if (entry.install.type === 'addon') return !$disabledSources.includes(ref)
    if (entry.install.type === 'extension') return !$disabledExtensions.includes(ref)
    if (entry.install.type === 'package') return !$disabledPlugins.includes(ref)
    return true
  }

  function toggle(entry: StoreEntry) {
    const ref = refOf(entry)
    if (!ref) return
    const flip = (list: string[]) => list.includes(ref) ? list.filter((item) => item !== ref) : [...list, ref]
    if (entry.install.type === 'addon') $disabledSources = flip($disabledSources)
    else if (entry.install.type === 'extension') $disabledExtensions = flip($disabledExtensions)
    else if (entry.install.type === 'package') $disabledPlugins = flip($disabledPlugins)
  }

  async function install(entry: StoreEntry) {
    if (busyKey) return
    busyKey = entry.key
    notice = ''
    error = ''
    try {
      // The package installer itself refuses to replace a package installed from another store.
      const outcome = await installStoreEntry(entry, {
        storeUrl: storeUrlById.get(entry.storeId) ?? '',
        adapter: loaded[entry.storeId]?.listing?.adapter,
        locked: loaded[entry.storeId]?.trust.state === 'locked',
        update: isInstalled(entry),
      }, installCatalogPackage)
      if (outcome.kind === 'configure') {
        // Replace an installed copy only through its own host's configure page; otherwise add a copy.
        const current = refOf(entry)
        configuring = { name: outcome.name, id: outcome.id, configureUrl: outcome.configureUrl, currentBase: current && sameHost(outcome.configureUrl, current) ? current : undefined }
        // One dialog at a time: the controller's focus trap would stay in the sheet underneath.
        selected = null
      } else if (outcome.kind === 'open-theme') {
        await goto(outcome.path)
      } else {
        notice = outcome.message
        await refreshInstalled()
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busyKey = ''
    }
  }

  async function remove(entry: StoreEntry) {
    const ref = refOf(entry)
    if (!ref || busyKey) return
    busyKey = entry.key
    error = ''
    try {
      if (entry.install.type === 'addon') {
        $addonUrls = $addonUrls.filter((item) => item !== ref)
        $disabledSources = $disabledSources.filter((item) => item !== ref)
      } else if (entry.install.type === 'extension') {
        $extensionUrls = $extensionUrls.filter((item) => item !== ref)
        $disabledExtensions = $disabledExtensions.filter((item) => item !== ref)
      } else if (entry.install.type === 'package') {
        await removeInstalledExtension(ref)
        await refreshInstalled()
      }
      notice = `${entry.name} removed.`
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busyKey = ''
    }
  }

  function saveConfiguredAddon(base: string) {
    if (!configuring) return
    const previous = configuring.currentBase
    $addonUrls = replaceAddonBase($addonUrls, previous, base)
    $disabledSources = $disabledSources.filter((item) => item !== previous && normalizeBase(item) !== normalizeBase(base))
    notice = `${configuring.name} configured, installed, and enabled.`
    configuring = null
  }
</script>

<div class="min-w-0 overflow-x-hidden p-4 sm:p-8">
  <div class="mb-5 max-w-5xl">
    <h2 class="text-xl font-black">Store</h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Sources and themes from izumi and from the stores you add. Third-party stores and community sources
      aren't reviewed by izumi; check their terms and privacy before use.
    </p>
  </div>

  <div class="mb-3 flex max-w-5xl flex-wrap gap-2" role="group" aria-label="Stores">
    {#each storeChips as chip (chip.id)}
      <button type="button" data-focusable aria-pressed={storeChip === chip.id} onclick={() => (storeChip = chip.id)}
              class="rounded-lg px-3 py-2 text-sm font-black sm:py-1.5 {storeChip === chip.id ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">{chip.label}</button>
    {/each}
    <button type="button" data-focusable onclick={() => (storesDialog = { mode: 'add', url: '' })}
            class="flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-sm font-bold sm:py-1.5"><Plus size={14} /> Add store</button>
    <button type="button" data-focusable onclick={() => (storesDialog = { mode: 'manage', url: '' })}
            class="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-bold text-muted-foreground sm:py-1.5"><Settings2 size={14} /> Manage stores</button>
  </div>

  <div class="mb-3 flex max-w-5xl flex-wrap gap-2" role="group" aria-label="Type">
    {#each KIND_CHIPS as chip (chip.id)}
      <button type="button" data-focusable aria-pressed={kind === chip.id} onclick={() => { kind = chip.id; sourceType = 'all' }}
              class="rounded-lg px-3 py-2 text-sm font-black sm:py-1.5 {kind === chip.id ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">{chip.label}</button>
    {/each}
    {#if kind === 'source'}
      {#each SOURCE_CHIPS as chip (chip.id)}
        <button type="button" data-focusable aria-pressed={sourceType === chip.id} onclick={() => (sourceType = chip.id)}
                class="rounded-lg px-3 py-2 text-sm font-bold sm:py-1.5 {sourceType === chip.id ? 'bg-foreground text-background' : 'bg-secondary/60'}">{chip.label}</button>
      {/each}
    {/if}
  </div>

  <div class="mb-4 flex min-w-0 max-w-5xl flex-wrap gap-2">
    <label class="relative min-w-0 basis-full sm:min-w-60 sm:basis-auto sm:flex-1">
      <Search size={16} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input bind:value={query} data-focusable placeholder="Search the Store…" aria-label="Search the Store"
             class="w-full rounded-lg bg-input py-2.5 pl-9 pr-3 text-base sm:text-sm" />
    </label>
    <SelectMenu bind:value={language} ariaLabel="Language" options={languageOptions} />
    <SelectMenu bind:value={content} ariaLabel="Content" options={CONTENT_OPTIONS} />
    <SelectMenu bind:value={sort} ariaLabel="Sort" options={SORT_OPTIONS} />
    <button type="button" data-focusable aria-pressed={withoutDebrid} onclick={() => (withoutDebrid = !withoutDebrid)}
            class="rounded-lg px-3 py-2.5 text-sm font-bold sm:py-2 {withoutDebrid ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">No debrid needed</button>
    <button type="button" data-focusable aria-pressed={installedOnly} onclick={() => (installedOnly = !installedOnly)}
            class="rounded-lg px-3 py-2.5 text-sm font-bold sm:py-2 {installedOnly ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">Installed</button>
    <button type="button" data-focusable disabled={loading} aria-label="Refresh stores" onclick={() => void loadStores(true)}
            class="rounded-lg bg-secondary px-3 py-2.5 sm:py-2"><RefreshCw size={16} class={loading ? 'animate-spin' : ''} /></button>
  </div>

  {#if notice}<p role="status" class="mb-4 max-w-5xl rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{notice}</p>{/if}
  {#if error}<p role="alert" class="mb-4 max-w-5xl rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>{/if}
  {#each lockedStores as store (store.id)}
    <p class="mb-4 max-w-5xl rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {store.name} failed its signing-key check, so installs and updates from it are paused.
      <button type="button" data-focusable class="ml-1 font-black underline" onclick={() => (storesDialog = { mode: 'manage', url: '' })}>Review</button>
    </p>
  {/each}
  {#each failedStores as store (store.id)}
    <p class="mb-2 max-w-5xl text-xs text-muted-foreground">{store.name} couldn't be loaded: {loaded[store.id]?.error}</p>
  {/each}
  {#if directoryWanted && directoryError}<p class="mb-2 max-w-5xl text-xs text-muted-foreground">Addon directory: {directoryError}</p>{/if}

  <p class="mb-3 text-xs text-muted-foreground">
    {results.length} {results.length === 1 ? 'result' : 'results'}{#if directoryWanted} · addon directory: top {directory.length} of {directoryTotal}{/if}
  </p>

  {#if loading && !allEntries.length}
    <div class="grid max-w-5xl gap-3 sm:grid-cols-2">
      {#each [0, 1, 2, 3, 4, 5] as index (index)}<div class="skeloader h-24 rounded-xl"></div>{/each}
    </div>
  {:else}
    <div class="grid min-w-0 max-w-5xl gap-3 sm:grid-cols-2">
      {#each visible as entry (entry.key)}
        <StoreEntryCard
          {entry}
          storeName={storeNameById.get(entry.storeId) ?? 'Store'}
          thirdParty={!builtinIds.has(entry.storeId)}
          icon={iconOf(entry)}
          installed={isInstalled(entry)}
          update={updateAvailable(entry)}
          busy={busyKey === entry.key}
          locked={loaded[entry.storeId]?.trust.state === 'locked'}
          onopen={() => { error = ''; selected = entry }}
          oninstall={() => void install(entry)}
        />
      {/each}
    </div>
    {#if !results.length}<p class="text-sm text-muted-foreground">Nothing matches these filters.</p>{/if}
    {#if results.length > visible.length}
      <button type="button" data-focusable onclick={() => (limit += PAGE)} class="mt-4 rounded-lg bg-secondary px-4 py-2.5 text-sm font-bold">Show more</button>
    {/if}
  {/if}

  <p class="mt-6 max-w-5xl text-xs text-muted-foreground">
    Sources you added by hand are on <a href="/app/settings/sources?tab=manage" class="font-bold text-theme">Sources</a>;
    installed themes are on <a href="/app/settings/themes" class="font-bold text-theme">Themes</a>.
  </p>
</div>

{#if selected}
  {@const entry = selected}
  {@const ref = refOf(entry)}
  {@const target = entry.install}
  <StoreEntrySheet
    {entry}
    storeName={storeNameById.get(entry.storeId) ?? 'Store'}
    thirdParty={!builtinIds.has(entry.storeId)}
    icon={iconOf(entry)}
    trustLabel={trustLabel(entry)}
    installed={ref !== null}
    update={updateAvailable(entry)}
    enabled={enabledState(entry)}
    busy={busyKey === entry.key}
    locked={loaded[entry.storeId]?.trust.state === 'locked'}
    {error}
    onclose={() => (selected = null)}
    oninstall={() => void install(entry)}
    onremove={target.type === 'theme' || (target.type === 'extension' && ref !== target.spec) ? undefined : () => void remove(entry)}
    ontoggle={target.type === 'theme' ? undefined : () => toggle(entry)}
    settingsLabel={target.type === 'addon' ? 'Reconfigure' : 'Settings'}
    onsettings={target.type === 'addon' && target.configureUrl && ref && sameHost(target.configureUrl, ref)
      ? () => { configuring = { name: entry.name, id: target.manifestId ?? entry.id, configureUrl: target.configureUrl ?? '', currentBase: ref }; selected = null }
      : target.type === 'package' && installedPackages.find((item) => item.id === ref)?.backend === 'izumi-service'
        ? () => { serviceSettings = { id: target.pkg.id, name: entry.name }; selected = null }
        : undefined}
    onmanage={target.type === 'theme' ? () => void goto('/app/settings/themes') : undefined}
  />
{/if}

{#if storesDialog}
  <StoresDialog
    mode={storesDialog.mode}
    initialUrl={storesDialog.url}
    {loaded}
    onclose={() => (storesDialog = null)}
    onadded={(id) => { storeChip = id; notice = 'Store added. Nothing was installed.' }}
  />
{/if}

{#if configuring}
  <AddonConfigurator
    name={configuring.name}
    expectedId={configuring.id}
    configureUrl={configuring.configureUrl}
    onCancel={() => (configuring = null)}
    onConfigured={saveConfiguredAddon}
  />
{/if}

{#if serviceSettings}
  <ExtensionServiceSettings
    id={serviceSettings.id}
    name={serviceSettings.name}
    onclose={() => (serviceSettings = null)}
  />
{/if}
