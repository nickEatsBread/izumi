<script lang="ts">
  import {
    listCommunityAddons,
    type CommunityAddon,
  } from '$lib/stremio/community-store'
  import { addonUrls, disabledSources, normalizeBase, replaceAddonBase } from '$lib/stremio/sources'
  import { fetchManifest } from '$lib/stremio/manifest'
  import { findAddonConfigureUrl } from '$lib/stremio/configure'
  import { resolveAddonLogo } from '$lib/stremio/addon-logo'
  import AddonLogo from '$lib/components/player/AddonLogo.svelte'
  import AddonConfigurator from '$lib/components/settings/AddonConfigurator.svelte'
  import {
    OFFICIAL_ANIME_CATALOG,
    fetchExtensionInfo,
    installCatalogPackage,
    installedExtensionPackages,
    removeInstalledExtension,
    type ExtensionCatalogPackage,
    type InstalledExtensionPackage,
  } from '$lib/extensions/manager'
  import { disabledPlugins, extensionUrls } from '$lib/settings/ui'
  import Search from 'lucide-svelte/icons/search'
  import Star from 'lucide-svelte/icons/star'
  import Puzzle from 'lucide-svelte/icons/puzzle'
  import RefreshCw from 'lucide-svelte/icons/refresh-cw'
  import Check from 'lucide-svelte/icons/check'

  let tab = $state<'addons' | 'extensions' | 'installed'>('addons')
  let query = $state('')
  let sort = $state<'stars' | 'new'>('stars')
  let addons = $state<CommunityAddon[]>([])
  let addonTotal = $state(0)
  let extensionPackages = $state<ExtensionCatalogPackage[]>([])
  let installedPackages = $state<InstalledExtensionPackage[]>([])
  let loading = $state(false)
  let error = $state('')
  let busyId = $state('')
  let notice = $state('')
  let installedAddonBases = $state<Record<string, string>>({})
  let configuring = $state<{
    name: string
    id: string
    configureUrl: string
    currentBase?: string
  } | null>(null)

  const configuredBases = $derived(new Set($addonUrls.map(normalizeBase)))
  const packageById = $derived(new Map(installedPackages.map((item) => [item.id, item])))
  const extensionResults = $derived.by(() => {
    const value = query.trim().toLocaleLowerCase()
    const items = !value ? extensionPackages : extensionPackages.filter((item) => [
      item.name,
      item.id,
      item.language,
      ...(item.sources ?? []).map((source) => source.name),
    ].some((part) => part?.toLocaleLowerCase().includes(value)))
    return [...items].sort((left, right) => {
      const installed = Number(!packageById.has(left.id)) - Number(!packageById.has(right.id))
      return installed || left.name.localeCompare(right.name)
    })
  })

  async function loadAddons() {
    loading = true
    error = ''
    try {
      const page = await listCommunityAddons({
        search: query,
        category: query.trim() ? undefined : 'anime',
        sort,
        limit: 40,
      })
      addons = page.addons
      addonTotal = page.pagination.total
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading = false
    }
  }

  async function loadExtensions() {
    try {
      const info = await fetchExtensionInfo(OFFICIAL_ANIME_CATALOG)
      extensionPackages = info.packages ?? []
      if (!info.packages && info.problem) error = info.problem
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function refreshInstalled() {
    installedPackages = await installedExtensionPackages()
  }

  let searchTimer: ReturnType<typeof setTimeout>
  $effect(() => {
    const value = query
    const order = sort
    if (tab !== 'addons') return
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { void value; void order; void loadAddons() }, 250)
    return () => clearTimeout(searchTimer)
  })
  $effect(() => {
    void loadExtensions()
    void refreshInstalled()
  })
  // A configured add-on has a credential-bearing URL that differs from the public directory URL.
  // Match installed entries by manifest id so configuring one does not make its store card look
  // uninstalled (or cause a second, unconfigured copy to be added).
  $effect(() => {
    const bases = [...$addonUrls]
    let stale = false
    void Promise.all(bases.map(async (base) => [base, await fetchManifest(base)] as const)).then((entries) => {
      if (stale) return
      installedAddonBases = Object.fromEntries(
        entries.flatMap(([base, manifest]) => manifest?.id ? [[manifest.id, base]] : []),
      )
    })
    return () => { stale = true }
  })

  function addonBase(addon: CommunityAddon) {
    return normalizeBase(addon.manifestUrl)
  }
  function addonLocation(base: string) {
    try {
      return new URL(base).host
    } catch {
      return 'Custom addon'
    }
  }
  function addAddon(addon: CommunityAddon) {
    const base = addonBase(addon)
    if (!$addonUrls.includes(base)) $addonUrls = [...$addonUrls, base]
    $disabledSources = $disabledSources.filter((item) => item !== base)
    notice = `${addon.manifest.name} installed and enabled.`
  }
  function configureAddon(addon: CommunityAddon, currentBase?: string) {
    if (!addon.configureUrl) return
    beginAddonConfiguration(addon.manifest.name, addon.manifest.id, addon.configureUrl, currentBase)
  }
  function beginAddonConfiguration(name: string, id: string, configureUrl: string, currentBase?: string) {
    error = ''
    notice = ''
    configuring = {
      name,
      id,
      configureUrl,
      currentBase,
    }
  }
  function saveConfiguredAddon(base: string) {
    if (!configuring) return
    const previous = configuring.currentBase
    $addonUrls = replaceAddonBase($addonUrls, previous, base)
    $disabledSources = $disabledSources.filter((item) =>
      item !== previous && normalizeBase(item) !== normalizeBase(base))
    notice = `${configuring.name} configured, installed, and enabled.`
    configuring = null
  }
  function toggleAddon(base: string) {
    $disabledSources = $disabledSources.includes(base)
      ? $disabledSources.filter((item) => item !== base)
      : [...$disabledSources, base]
  }
  function removeAddon(base: string) {
    $addonUrls = $addonUrls.filter((item) => item !== base)
    $disabledSources = $disabledSources.filter((item) => item !== base)
  }
  async function installExtension(item: ExtensionCatalogPackage) {
    busyId = item.id
    notice = ''
    try {
      const installed = await installCatalogPackage(item)
      await refreshInstalled()
      if (!$extensionUrls.includes(OFFICIAL_ANIME_CATALOG)) {
        $extensionUrls = [...$extensionUrls, OFFICIAL_ANIME_CATALOG]
      }
      $disabledPlugins = $disabledPlugins.filter((id) => id !== installed.id)
      notice = `${installed.name} installed and enabled.`
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busyId = ''
    }
  }
  async function removeExtension(id: string) {
    busyId = id
    await removeInstalledExtension(id).catch((cause) => { error = String(cause) })
    await refreshInstalled()
    busyId = ''
  }
  function toggleExtension(id: string) {
    $disabledPlugins = $disabledPlugins.includes(id)
      ? $disabledPlugins.filter((item) => item !== id)
      : [...new Set([...$disabledPlugins, id])]
  }
</script>

<div class="p-4 sm:p-8">
  <div class="mb-5 max-w-5xl">
    <h2 class="text-xl font-black">Source Store</h2>
    <p class="mt-1 text-sm text-muted-foreground">
      Discover Stremio addons and Izumi anime packages, then see exactly what is installed and enabled.
      Community sources are third-party services; review their configuration and privacy terms before use.
    </p>
  </div>

  <div class="mb-5 flex flex-wrap gap-2">
    <button data-focusable onclick={() => (tab = 'addons')}
            class="rounded-lg px-4 py-2 text-sm font-black {tab === 'addons' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">Stremio addons</button>
    <button data-focusable onclick={() => (tab = 'extensions')}
            class="rounded-lg px-4 py-2 text-sm font-black {tab === 'extensions' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">Anime packages</button>
    <button data-focusable onclick={() => (tab = 'installed')}
            class="rounded-lg px-4 py-2 text-sm font-black {tab === 'installed' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">
      Installed · {$addonUrls.length + installedPackages.length}
    </button>
  </div>

  {#if notice}<p class="mb-4 max-w-5xl rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{notice}</p>{/if}
  {#if error}<p class="mb-4 max-w-5xl rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>{/if}

  {#if tab !== 'installed'}
    <div class="mb-4 flex max-w-5xl flex-wrap gap-2">
      <label class="relative min-w-60 flex-1">
        <Search size={16} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input bind:value={query} data-focusable placeholder={tab === 'addons' ? 'Search community addons…' : 'Search anime packages…'}
               class="w-full rounded-lg bg-input py-2.5 pl-9 pr-3 text-sm" />
      </label>
      {#if tab === 'addons'}
        <button data-focusable onclick={() => (sort = sort === 'stars' ? 'new' : 'stars')}
                class="rounded-lg bg-secondary px-4 py-2 text-sm font-bold">
          {sort === 'stars' ? 'Top rated' : 'Recently added'}
        </button>
      {/if}
    </div>
  {/if}

  {#if tab === 'addons'}
    <p class="mb-3 text-xs text-muted-foreground">
      {query.trim() ? `${addonTotal} matching community addons` : `${addonTotal} anime addons`} · directory data from stremio-addons.net
    </p>
    {#if loading && !addons.length}
      <div class="grid max-w-5xl gap-3 sm:grid-cols-2">{#each Array(6) as _}<div class="skeloader h-32 rounded-xl"></div>{/each}</div>
    {:else}
      <div class="grid max-w-5xl gap-3 sm:grid-cols-2">
        {#each addons as addon (addon.uuid)}
          {@const base = addonBase(addon)}
          {@const installedBase = installedAddonBases[addon.manifest.id] ?? (configuredBases.has(base) ? base : '')}
          {@const installed = !!installedBase}
          {@const off = installed && $disabledSources.includes(installedBase)}
          <article class="flex gap-3 rounded-xl border border-border bg-secondary/25 p-4" class:opacity-60={installed && off}>
            <AddonLogo
              logo={resolveAddonLogo(addon.manifest.logo, base)}
              name={addon.manifest.name}
              id={addon.manifest.id}
              size={48}
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-start gap-2">
                <h3 class="min-w-0 flex-1 truncate font-black">{addon.manifest.name}</h3>
                <span class="flex shrink-0 items-center gap-1 text-xs font-bold text-amber-400"><Star size={12} fill="currentColor" />{addon.stars}</span>
              </div>
              <p class="mt-1 line-clamp-2 text-xs text-muted-foreground">{addon.manifest.description || 'Community Stremio addon'}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                {#if installed}
                  <button data-focusable onclick={() => toggleAddon(installedBase)}
                          class="rounded-md px-3 py-1.5 text-xs font-black {off ? 'bg-secondary' : 'bg-emerald-500/15 text-emerald-400'}">{off ? 'Enable' : 'Enabled'}</button>
                  <button data-focusable onclick={() => removeAddon(installedBase)} class="rounded-md px-3 py-1.5 text-xs font-bold text-destructive">Remove</button>
                {:else if !addon.configureUrl}
                  <button data-focusable onclick={() => addAddon(addon)} class="rounded-md bg-primary px-3 py-1.5 text-xs font-black text-primary-foreground">Install</button>
                {/if}
                {#if addon.configureUrl}
                  <button data-focusable onclick={() => configureAddon(addon, installedBase || undefined)}
                          class="flex items-center gap-1 rounded-md {installed ? 'bg-secondary' : 'bg-primary text-primary-foreground'} px-3 py-1.5 text-xs font-bold">
                    {installed ? 'Reconfigure' : 'Configure & install'}
                  </button>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </div>
      {#if !addons.length}<p class="text-sm text-muted-foreground">No matching addons were found.</p>{/if}
    {/if}
  {:else if tab === 'extensions'}
    <p class="mb-3 text-xs text-muted-foreground">
      {extensionResults.length} packages · signed/hash-pinned catalog from nickEatsBread/izumi-extension-repo
    </p>
    <div class="grid max-w-5xl gap-3 sm:grid-cols-2">
      {#each extensionResults as item (item.id)}
        {@const installed = packageById.get(item.id)}
        {@const off = $disabledPlugins.includes(item.id)}
        <article class="rounded-xl border border-border bg-secondary/25 p-4" class:opacity-60={!!installed && off}>
          <div class="flex items-start gap-3">
            <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-theme/10 text-theme"><Puzzle size={19} /></span>
            <div class="min-w-0 flex-1">
              <h3 class="truncate font-black">{item.name}</h3>
              <p class="text-xs text-muted-foreground">{item.language || 'Language unspecified'} · {item.sources.length} providers · v{item.version}</p>
              <p class="mt-1 line-clamp-1 text-[0.68rem] text-muted-foreground">{item.sources.map((source) => source.name).join(' · ')}</p>
            </div>
          </div>
          <div class="mt-3 flex gap-2">
            {#if installed}
              <button data-focusable onclick={() => toggleExtension(item.id)}
                      class="rounded-md px-3 py-1.5 text-xs font-black {off ? 'bg-secondary' : 'bg-emerald-500/15 text-emerald-400'}">{off ? 'Enable' : 'Enabled'}</button>
              <button data-focusable disabled={busyId === item.id} onclick={() => removeExtension(item.id)}
                      class="rounded-md px-3 py-1.5 text-xs font-bold text-destructive">Remove</button>
            {:else}
              <button data-focusable disabled={!!busyId} onclick={() => installExtension(item)}
                      class="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-black text-primary-foreground disabled:opacity-40">
                {#if busyId === item.id}<RefreshCw size={12} class="animate-spin" />{/if} Install
              </button>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <div class="max-w-5xl space-y-6">
      <section>
        <div class="mb-2 flex items-center justify-between">
          <h3 class="font-black">Stremio addons</h3>
          <a href="/app/settings/sources" class="text-xs font-bold text-theme">Advanced settings →</a>
        </div>
        <div class="space-y-2">
          {#each $addonUrls as base (base)}
            {@const off = $disabledSources.includes(base)}
            <div class="flex items-center gap-3 rounded-lg border border-border p-3" class:opacity-60={off}>
              {#await fetchManifest(base)}
                <span class="skeloader size-9 rounded"></span><span class="flex-1 text-sm text-muted-foreground">Loading manifest…</span>
              {:then manifest}
                <AddonLogo
                  logo={resolveAddonLogo(manifest?.logo, base)}
                  name={manifest?.name ?? addonLocation(base)}
                  id={manifest?.id ?? base}
                  size={36}
                />
                <span class="min-w-0 flex-1"><span class="block truncate text-sm font-black">{manifest?.name ?? addonLocation(base)}</span><span class="block truncate text-xs text-muted-foreground">{addonLocation(base)}</span></span>
                {#if manifest}
                  {#await findAddonConfigureUrl(base, manifest, addons) then configureUrl}
                    {#if configureUrl}
                      <button data-focusable onclick={() => beginAddonConfiguration(manifest.name, manifest.id, configureUrl, base)}
                              class="rounded-md bg-secondary px-3 py-1.5 text-xs font-bold">Configure</button>
                    {/if}
                  {/await}
                {/if}
              {/await}
              <button data-focusable onclick={() => toggleAddon(base)}
                      class="rounded-md px-3 py-1.5 text-xs font-black {off ? 'bg-secondary' : 'bg-emerald-500/15 text-emerald-400'}">{off ? 'Disabled' : 'Enabled'}</button>
              <button data-focusable onclick={() => removeAddon(base)} class="text-xs font-bold text-destructive">Remove</button>
            </div>
          {/each}
          {#if !$addonUrls.length}<p class="text-sm text-muted-foreground">No Stremio addons installed.</p>{/if}
        </div>
      </section>
      <section>
        <div class="mb-2 flex items-center justify-between">
          <h3 class="font-black">Anime packages</h3>
          <a href="/app/settings/extensions" class="text-xs font-bold text-theme">Advanced settings →</a>
        </div>
        <div class="space-y-2">
          {#each installedPackages as item (item.id)}
            {@const off = $disabledPlugins.includes(item.id)}
            <div class="flex items-center gap-3 rounded-lg border border-border p-3" class:opacity-60={off}>
              <Puzzle size={18} />
              <span class="min-w-0 flex-1"><span class="block truncate text-sm font-black">{item.name}</span><span class="block text-xs text-muted-foreground">{item.backend} · v{item.version}</span></span>
              <button data-focusable onclick={() => toggleExtension(item.id)}
                      class="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-black {off ? 'bg-secondary' : 'bg-emerald-500/15 text-emerald-400'}">
                {#if !off}<Check size={12} />{/if}{off ? 'Disabled' : 'Enabled'}
              </button>
              <button data-focusable disabled={busyId === item.id} onclick={() => removeExtension(item.id)} class="text-xs font-bold text-destructive">Remove</button>
            </div>
          {/each}
          {#if !installedPackages.length}<p class="text-sm text-muted-foreground">No anime packages installed.</p>{/if}
        </div>
      </section>
    </div>
  {/if}
</div>

{#if configuring}
  <AddonConfigurator
    name={configuring.name}
    expectedId={configuring.id}
    configureUrl={configuring.configureUrl}
    onCancel={() => (configuring = null)}
    onConfigured={saveConfiguredAddon}
  />
{/if}
