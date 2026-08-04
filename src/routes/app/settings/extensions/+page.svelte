<script lang="ts">
  import { debridKey, debridProvider, extensionUrls, disabledExtensions, disabledPlugins, torrentPlaybackMode, providerLanguages, providerAudio } from '$lib/settings/ui'
  import {
    fetchExtensionInfo,
    installCatalogPackage,
    installedExtensionPackages,
    removeInstalledExtension,
    type ExtensionCatalogPackage,
    type ExtensionSourceInfo,
    type InstalledExtensionPackage,
  } from '$lib/extensions/manager'
  import { sourceLabel } from '$lib/extensions/catalog'
  import { langName } from '$lib/player/track-label'
  import { SOURCE_LANGUAGES } from '$lib/stremio/sublang'
  import MultiSelect from '$lib/components/search/MultiSelect.svelte'
  import { accountInfo, providerList, providerMeta, type DebridAccountInfo } from '$lib/stremio/debrid'
  import Boxes from '@lucide/svelte/icons/boxes'
  import Puzzle from '@lucide/svelte/icons/puzzle'
  import Search from '@lucide/svelte/icons/search'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import SelectMenu from '$lib/components/settings/SelectMenu.svelte'

  const current = $derived(providerMeta($debridProvider))
  let account = $state<DebridAccountInfo | null>(null)
  let accountError = $state('')
  let accountLoading = $state(false)
  async function refreshAccount() {
    if (!$debridKey) { account = null; accountError = ''; return }
    accountLoading = true
    accountError = ''
    try { account = await accountInfo($debridProvider, $debridKey) }
    catch (error) { account = null; accountError = error instanceof Error ? error.message : String(error) }
    finally { accountLoading = false }
  }
  const accountDate = (value?: number) => value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value)
    : ''
  $effect(() => { void $debridProvider; void $debridKey; account = null; accountError = '' })

  let extInput = $state('')
  let localPackages = $state<InstalledExtensionPackage[]>([])
  // Keyed by the source that raised it, so an install result lands under the catalog it came from
  // instead of a page-level banner far from the row that was clicked.
  let packageStatus = $state<{ url: string; text: string; ok: boolean } | null>(null)
  let packageBusy = $state(false)
  const installedById = $derived(new Map(localPackages.map((extension) => [extension.id, extension])))
  const installedIn = (packages: ExtensionCatalogPackage[]) => packages.filter((p) => installedById.has(p.id))
  const enabledInstalledIn = (packages: ExtensionCatalogPackage[]) =>
    installedIn(packages).filter((extension) => !pluginOff(extension.id))

  async function refreshPackages() {
    localPackages = await installedExtensionPackages()
  }
  async function installFromCatalog(url: string, extension: ExtensionCatalogPackage) {
    packageBusy = true
    packageStatus = null
    try {
      const installed = await installCatalogPackage(extension)
      await refreshPackages()
      packageStatus = { url, text: `${installed.name} ${installed.version} installed.`, ok: true }
    } catch (error) {
      packageStatus = { url, text: String(error), ok: false }
    } finally {
      packageBusy = false
    }
  }
  async function removePackage(url: string, id: string) {
    packageBusy = true
    packageStatus = null
    try {
      await removeInstalledExtension(id)
      await refreshPackages()
    } catch (error) {
      packageStatus = { url, text: String(error), ok: false }
    } finally {
      packageBusy = false
    }
  }
  $effect(() => { void refreshPackages() })

  function addExt() { const u = extInput.trim(); if (u) { $extensionUrls = [...$extensionUrls, u]; extInput = '' } }
  function toggleExt(url: string) { $disabledExtensions = $disabledExtensions.includes(url) ? $disabledExtensions.filter((u) => u !== url) : [...$disabledExtensions, url] }
  function removeExt(i: number) { const url = $extensionUrls[i]; $extensionUrls = $extensionUrls.filter((_, j) => j !== i); $disabledExtensions = $disabledExtensions.filter((u) => u !== url) }
  const iconSrc = (l: string) => l.startsWith('http') || l.startsWith('data:image') ? l : `data:image/png;base64,${l}`
  // A GitHub spec (gh:owner/repo or bare owner/repo/sub) — shown with a GitHub icon +
  // the repo path as the title.
  const isGh = (u: string) => u.startsWith('gh:') || (/^[A-Za-z0-9][A-Za-z0-9-]*\/[^\s:]+$/.test(u) && !/^https?:/.test(u))

  // One promise per source, SHARED between the list below and the language chips — calling
  // fetchExtensionInfo separately for each would refetch every manifest a second time.
  const metaByUrl = $derived(new Map($extensionUrls.map((u) =>
    [u, fetchExtensionInfo(u).catch((): ExtensionSourceInfo => ({ configs: [], problem: 'That URL could not be fetched.' }))] as const)))
  const langLabel = (l: string) => langName(l) ?? l.toUpperCase()
  // Which languages the installed sources actually declare — used only to sort those to the top of
  // the list, NOT to limit it: a source may declare no language at all, and a language can be
  // chosen before adding a source that serves it.
  let installedLangs = $state<string[]>([])
  // Which stored specs turned out to be package catalogs. Needed OUTSIDE the {#await} below, where
  // the row-level enable switch and the dimming live: a catalog runs nothing itself, so switching
  // its URL off would have no effect and must not be offered.
  let catalogUrls = $state<string[]>([])
  $effect(() => {
    let stale = false
    void Promise.all([...metaByUrl].map(async ([url, info]) => [url, await info] as const)).then((entries) => {
      if (stale) return
      catalogUrls = entries.filter(([, info]) => !!info.packages).map(([url]) => url)
      installedLangs = [...new Set([
        ...entries.flatMap(([, info]) => info.configs).map((m) => m.lang).filter((l): l is string => !!l),
        ...localPackages.map((extension) => extension.lang).filter((lang): lang is string => !!lang),
      ])]
    })
    return () => { stale = true }
  })
  // Installed languages first (alphabetically within each group), then the rest.
  const langOptions = $derived(
    [...SOURCE_LANGUAGES].sort((a, b) => {
      const ia = installedLangs.includes(a) ? 0 : 1
      const ib = installedLangs.includes(b) ? 0 : 1
      return ia - ib || langLabel(a).localeCompare(langLabel(b))
    }),
  )
  // Empty = every language, matching the resolver's "no allowlist means all" rule.
  const allLangs = $derived($providerLanguages.length === 0)

  // Per-plugin switches. One source URL expands to many plugins (a marketplace index yields ~18),
  // so the URL toggle above is all-or-nothing and this is the finer control. A catalog row expands
  // the same way, except its entries are installable packages rather than live plugins.
  let expanded = $state<string[]>([])
  const isExpanded = (url: string) => expanded.includes(url)
  function toggleExpanded(url: string) {
    expanded = isExpanded(url) ? expanded.filter((u) => u !== url) : [...expanded, url]
  }
  const pluginOff = (id: string) => $disabledPlugins.includes(id)
  function togglePlugin(id: string) {
    $disabledPlugins = pluginOff(id) ? $disabledPlugins.filter((x) => x !== id) : [...$disabledPlugins, id]
  }
  function setAllPlugins(ids: string[], on: boolean) {
    $disabledPlugins = on
      ? $disabledPlugins.filter((x) => !ids.includes(x))
      : [...new Set([...$disabledPlugins, ...ids])]
  }
  const enabledCount = (ids: string[]) => ids.filter((id) => !pluginOff(id)).length

  // Per-catalog search text; the adult switch is a single preference across all of them.
  let catalogQuery = $state<Record<string, string>>({})
  let showNsfw = $state(false)
  function visiblePackages(url: string, packages: ExtensionCatalogPackage[]) {
    const query = (catalogQuery[url] ?? '').trim().toLocaleLowerCase()
    return packages.filter((extension) => {
      if (extension.nsfw && !showNsfw) return false
      if (!query) return true
      return [
        extension.name,
        extension.id,
        extension.language,
        ...(extension.sources ?? []).flatMap((source) => [source.name, source.language]),
      ].some((value) => value?.toLocaleLowerCase().includes(query))
    }).sort((a, b) => {
      // Keep the handful of locally-installed packages visible above a catalog with hundreds of
      // entries. Enabled first, then installed-but-off, then packages that are not installed.
      const rank = (extension: ExtensionCatalogPackage) =>
        !installedById.has(extension.id) ? 2 : pluginOff(extension.id) ? 1 : 0
      return rank(a) - rank(b)
    })
  }
</script>

<div class="p-4 sm:p-8">
  <h2 class="mb-1 text-xl font-black">Extensions</h2>
  <p class="mb-4 max-w-2xl text-sm text-muted-foreground">
    Community source extensions can play through your debrid service or Izumi's built-in direct torrent engine. Their results appear in the source picker alongside your addons.
    <span class="text-amber-400">Experimental — extensions run as untrusted third-party code in an isolated worker. Only add manifests you trust.</span>
  </p>

  <div class="max-w-2xl">
    <div class="mb-4 grid gap-x-4 gap-y-1 sm:grid-cols-2">
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">Torrent playback</span>
        <SelectMenu bind:value={$torrentPlaybackMode} ariaLabel="Torrent playback" options={[
          { value: 'debrid', label: 'Prefer debrid' },
          { value: 'direct', label: 'Direct P2P' },
        ]} />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">Debrid service</span>
        <SelectMenu
          bind:value={$debridProvider}
          ariaLabel="Debrid service"
          options={providerList.map((provider) => ({
            value: provider.id,
            label: `${provider.name}${provider.experimental ? ' (experimental)' : ''}`,
          }))}
        />
      </label>

      <span class="text-xs text-muted-foreground sm:col-span-2">
        {#if $torrentPlaybackMode === 'direct'}Streams the selected episode from peers and seeds with a protected upload limit. Playback data is temporary and your IP address is visible to torrent peers.{:else}Uses your configured debrid service. If no credential is configured, Izumi falls back to direct P2P playback.{/if}
      </span>
    </div>

    <label class="mb-6 flex flex-col gap-1">
      <span class="text-sm font-bold">{current?.name ?? 'Debrid'} {current?.credential === 'userpass' ? 'login' : 'API key'}</span>
      <input type="password" bind:value={$debridKey} data-focusable placeholder={current?.credential === 'userpass' ? 'username:password' : `Your ${current?.name ?? 'debrid'} token`} class="rounded-md bg-input px-3 py-2 text-sm" />
      <span class="text-xs text-muted-foreground">From {current?.keyHint ?? 'your debrid account'}. Turns extension torrent results into cached streams.</span>
    </label>

    {#if $debridKey}
      <section class="mb-6 rounded-lg border border-border bg-card p-4" aria-label="Debrid account usage">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-black">Account & usage</h3>
            <p class="text-xs text-muted-foreground">Live data from {current?.name ?? 'your provider'}; fetched only when you ask.</p>
          </div>
          <button data-focusable onclick={refreshAccount} disabled={accountLoading}
            class="rounded-md bg-secondary px-3 py-1.5 text-xs font-bold hover:bg-accent disabled:opacity-50">
            {accountLoading ? 'Checking…' : account ? 'Refresh' : 'Check account'}
          </button>
        </div>
        {#if account}
          <dl class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {#if account.username}<div><dt class="text-xs text-muted-foreground">Account</dt><dd class="truncate font-bold">{account.username}</dd></div>{/if}
            {#if account.plan}<div><dt class="text-xs text-muted-foreground">Plan</dt><dd class="font-bold capitalize">{account.plan}</dd></div>{/if}
            {#if account.premiumUntil}<div><dt class="text-xs text-muted-foreground">Premium until</dt><dd class="font-bold">{accountDate(account.premiumUntil)}</dd></div>{/if}
            {#if account.points != null}<div><dt class="text-xs text-muted-foreground">Points</dt><dd class="font-bold">{account.points}</dd></div>{/if}
          </dl>
          {#if account.quotaUsed != null}
            <div class="mt-3">
              <div class="mb-1 flex justify-between text-xs"><span>Fair-use allowance</span><span>{Math.round(account.quotaUsed * 100)}% used</span></div>
              <div class="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Fair-use allowance used" aria-valuenow={Math.round(account.quotaUsed * 100)} aria-valuemin="0" aria-valuemax="100">
                <div class="h-full rounded-full bg-theme" style={`width:${Math.round(account.quotaUsed * 100)}%`}></div>
              </div>
            </div>
          {/if}
        {:else if accountError}
          <p role="alert" class="mt-3 text-xs text-amber-400">{accountError}</p>
        {/if}
      </section>
    {/if}

    <div class="mb-6 grid items-start gap-x-4 gap-y-4 sm:grid-cols-2">
      <label class="flex flex-col gap-1">
        <span class="text-sm font-bold">Audio</span>
        <SelectMenu bind:value={$providerAudio} ariaLabel="Audio" options={[
          { value: 'both', label: 'Subbed and dubbed' },
          { value: 'sub', label: 'Subbed only' },
          { value: 'dub', label: 'Dubbed only' },
        ]} />
        <span class="text-xs text-muted-foreground">
          {#if $providerAudio === 'both'}Both are offered when a source carries them, each labelled SUB or DUB.{:else}Only {$providerAudio === 'dub' ? 'dubbed' : 'subbed'} results are requested — sources that carry nothing else are skipped entirely, which also makes the search faster.{/if}
        </span>
      </label>

      <div class="flex flex-col gap-1">
        <span class="text-sm font-bold">Source languages</span>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <MultiSelect
            label="Languages"
            options={langOptions}
            selected={$providerLanguages}
            labelOf={langLabel}
            onchange={(v) => ($providerLanguages = v)}
          />
          {#if !allLangs}
            <button data-focusable onclick={() => ($providerLanguages = [])}
              class="rounded-md px-2 py-1 text-xs font-bold text-muted-foreground hover:bg-accent">Clear (all languages)</button>
          {/if}
        </div>
        <span class="mt-1 text-xs text-muted-foreground">
          {#if allLangs}
            Every language is searched. Pick one or more to narrow it — sources serving other languages are then not queried at all, which also speeds up the source list.
          {:else}
            Only {$providerLanguages.map(langLabel).join(', ')} {$providerLanguages.length === 1 ? 'is' : 'are'} searched. Sources that don't declare a language are always included.
          {/if}
        </span>
      </div>
    </div>

    <p class="mb-2 text-sm text-muted-foreground">Extension sources — a GitHub repo (<code class="rounded bg-secondary px-1 text-xs">gh:owner/repo</code> or <code class="rounded bg-secondary px-1 text-xs">owner/repo/folder</code>), a manifest URL, or a package catalog URL. A catalog lists installable packages instead of live plugins; open it to install them.</p>
    <div class="flex gap-2">
      <input bind:value={extInput} data-focusable placeholder="gh:owner/anime-extensions  ·  or  https://…/manifest.json" class="flex-1 rounded-md bg-input px-3 py-2 text-sm" onkeydown={(e) => e.key === 'Enter' && addExt()} />
      <button onclick={addExt} data-focusable class="rounded-md bg-primary px-4 py-2 font-bold text-primary-foreground">Add</button>
    </div>
    <ul class="mt-3 space-y-2">
      {#each $extensionUrls as url, i (url)}
        {@const ext = metaByUrl.get(url)!}
        {@const gh = isGh(url)}
        {@const label = sourceLabel(url)}
        {@const cat = catalogUrls.includes(url)}
        {@const off = $disabledExtensions.includes(url)}
        <li class="rounded-lg border border-border p-3" class:opacity-50={off && !cat}>
          <div class="flex items-center gap-3">
          {#await ext}
            <div class="skeloader size-10 shrink-0 rounded-md"></div>
            <div class="min-w-0 flex-1"><div class="skeloader h-4 w-1/3 rounded"></div></div>
          {:then info}
            {@const metas = info.configs}
            {@const pkgs = info.packages}
            {@const m = metas[0]}
            {#if pkgs}
              <div class="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground"><Boxes size={18} /></div>
            {:else if gh}
              <div class="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-foreground">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.61 8.2 11.17.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.7-4.04-1.58-4.04-1.58-.55-1.36-1.33-1.73-1.33-1.73-1.09-.73.08-.71.08-.71 1.2.08 1.83 1.21 1.83 1.21 1.07 1.79 2.81 1.27 3.5.97.11-.76.42-1.27.76-1.56-2.67-.3-5.47-1.29-5.47-5.75 0-1.27.47-2.31 1.24-3.12-.12-.3-.54-1.52.12-3.16 0 0 1.01-.32 3.3 1.19a11.6 11.6 0 0 1 3-.39c1.02 0 2.05.13 3 .39 2.29-1.51 3.3-1.19 3.3-1.19.66 1.64.24 2.86.12 3.16.77.81 1.24 1.85 1.24 3.12 0 4.47-2.81 5.45-5.49 5.74.43.36.81 1.08.81 2.18 0 1.57-.01 2.84-.01 3.23 0 .31.22.68.83.56A12.02 12.02 0 0 0 24 12.29C24 5.78 18.63.5 12 .5Z"/></svg>
              </div>
            {:else if m?.icon}
              <img src={iconSrc(m.icon)} alt="" class="size-10 shrink-0 rounded-md bg-neutral-900 object-contain" />
            {:else}
              <div class="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground"><Puzzle size={18} /></div>
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <!-- A manifest with several plugins has no single name of its own, so the source is
                     named after where it came from — owner/repo, not the raw URL. -->
                <span class="truncate font-bold">{pkgs || gh || metas.length > 1 ? label : (m?.name ?? label)}</span>
                {#if pkgs}
                  <span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold text-muted-foreground">{pkgs.length} {pkgs.length === 1 ? 'Package' : 'Packages'}</span>
                {:else if metas.length}
                  <span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold text-muted-foreground">{metas.length} {metas.length === 1 ? 'Extension' : 'Extensions'}</span>
                {/if}
                {#if m?.version && metas.length === 1}<span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold text-muted-foreground">v{m.version}</span>{/if}
              </div>
              {#if pkgs}
                {@const mine = installedIn(pkgs)}
                {@const enabledMine = enabledInstalledIn(pkgs)}
                <p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {mine.length} of {pkgs.length} installed · {enabledMine.length} enabled
                  {#if enabledMine.length} · {enabledMine.map((p) => p.name).join(' · ')}
                  {:else if mine.length} · none enabled
                  {:else} · no packages installed{/if}
                </p>
              {:else if metas.length > 1}
                {@const on = enabledCount(metas.map((x) => x.id))}
                <p class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{on} of {metas.length} plugins on · {metas.filter((x) => !pluginOff(x.id)).map((x) => x.name).join(' · ') || 'none'}</p>
              {:else if info.problem}
                <!-- Loudly, rather than an empty list that reads as "izumi is broken". -->
                <p class="mt-0.5 text-xs text-amber-400">{info.problem}</p>
              {:else}
                <p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{m?.description ?? label}</p>
              {/if}
            </div>
            {#if pkgs || metas.length > 1}
              <button data-focusable onclick={() => toggleExpanded(url)} aria-expanded={isExpanded(url)}
                class="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-muted-foreground hover:bg-accent">
                {isExpanded(url) ? 'Hide' : pkgs ? 'Packages' : 'Plugins'}
              </button>
            {/if}
            <!-- No source-level switch for a catalog: nothing of it runs, so it would toggle
                 nothing. Its packages carry their own switches inside. -->
            {#if !pkgs}
              <!-- `data-switch`: fixed-geometry pill — the large-target a11y mode grows its pointer
                   target, not its box, so the slider never squares off into a circle (app.css). -->
              <button data-focusable data-switch onclick={() => toggleExt(url)} aria-pressed={!off} title={off ? 'Enable' : 'Disable'}
                class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {off ? 'bg-white/20 ring-1 ring-inset ring-white/20' : 'bg-theme'}">
                <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform {off ? 'translate-x-0.5' : 'translate-x-4'}"></span>
              </button>
            {/if}
          {/await}
          <button onclick={() => removeExt(i)} data-focusable title="Remove" class="grid size-8 shrink-0 place-items-center rounded-md text-destructive hover:bg-accent"><Trash2 size={16} /></button>
          </div>

          {#if isExpanded(url)}
            {#await ext then info}
              {#if info.packages}
                {@const pkgs = info.packages}
                {@const shown = visiblePackages(url, pkgs)}
                {@const ids = installedIn(pkgs).map((p) => p.id)}
                {@const enabledPackages = enabledInstalledIn(pkgs)}
                <div class="mt-3 border-t border-border pt-3">
                  <div class="mb-2 flex flex-wrap items-center gap-2">
                    <label class="relative min-w-48 flex-1">
                      <Search size={14} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        bind:value={catalogQuery[url]}
                        data-focusable
                        placeholder="Search packages"
                        class="w-full rounded-md bg-input py-1.5 pl-8 pr-3 text-sm"
                      />
                    </label>
                    <label class="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                      <input type="checkbox" bind:checked={showNsfw} />
                      Adult sources
                    </label>
                    {#if ids.length}
                      <span class="flex gap-1">
                        <button data-focusable onclick={() => setAllPlugins(ids, true)} class="rounded px-2 py-0.5 text-xs font-bold text-muted-foreground hover:bg-accent">All on</button>
                        <button data-focusable onclick={() => setAllPlugins(ids, false)} class="rounded px-2 py-0.5 text-xs font-bold text-muted-foreground hover:bg-accent">All off</button>
                      </span>
                    {/if}
                  </div>
                  {#if packageStatus?.url === url}
                    <p class="mb-2 text-xs {packageStatus.ok ? 'text-emerald-400' : 'text-amber-400'}">{packageStatus.text}</p>
                  {/if}
                  <p class="px-1 pb-1 text-[0.68rem] text-muted-foreground">
                    {shown.length} of {pkgs.length} packages. Installed ones stay installed if this source is removed.
                    Aniyomi support and its shared runtime download only when needed.
                  </p>
                  {#if ids.length}
                    <p class="mb-2 rounded-md bg-secondary/60 px-2 py-1.5 text-[0.68rem] text-muted-foreground">
                      <span class="font-bold text-foreground">Enabled ({enabledPackages.length}):</span>
                      {enabledPackages.map((extension) => extension.name).join(' · ') || 'None'}
                    </p>
                  {/if}
                  <ul class="max-h-72 space-y-1 overflow-y-auto pr-1">
                    {#each shown as p (p.id)}
                      {@const inst = installedById.get(p.id)}
                      {@const pOff = !!inst && pluginOff(p.id)}
                      <li class="flex items-center gap-2 rounded-md bg-background/45 px-2 py-1.5" class:opacity-50={pOff}>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-1.5">
                            <span class="truncate text-xs font-bold">{p.name}</span>
                            <span class="rounded bg-secondary px-1 py-0.5 text-[0.55rem] font-bold text-muted-foreground">{p.language?.toUpperCase() ?? 'MULTI'}</span>
                            {#if p.backend === 'izumi-js'}
                              <span class="rounded bg-emerald-500/15 px-1 py-0.5 text-[0.55rem] font-bold text-emerald-400">NATIVE</span>
                            {/if}
                            {#if p.nsfw}
                              <span class="rounded bg-rose-500/15 px-1 py-0.5 text-[0.55rem] font-bold text-rose-400">18+</span>
                            {/if}
                            {#if inst}
                              <span class="rounded bg-secondary px-1 py-0.5 text-[0.55rem] font-bold text-muted-foreground">v{inst.version}</span>
                              <span class="rounded px-1 py-0.5 text-[0.55rem] font-bold {pOff ? 'bg-white/10 text-muted-foreground' : 'bg-emerald-500/15 text-emerald-400'}">
                                {pOff ? 'OFF' : 'ENABLED'}
                              </span>
                            {/if}
                          </div>
                          <p class="truncate text-[0.65rem] text-muted-foreground">{(p.sources ?? []).map((source) => source.name).join(' · ') || p.id}</p>
                        </div>
                        {#if inst}
                          <button data-focusable data-switch onclick={() => togglePlugin(p.id)} aria-pressed={!pOff}
                            title={pOff ? 'Enable' : 'Disable'}
                            class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {pOff ? 'bg-white/20 ring-1 ring-inset ring-white/20' : 'bg-theme'}">
                            <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform {pOff ? 'translate-x-0.5' : 'translate-x-4'}"></span>
                          </button>
                        {/if}
                        <button
                          data-focusable
                          disabled={packageBusy}
                          onclick={() => installFromCatalog(url, p)}
                          class="shrink-0 rounded-md px-2 py-1 text-xs font-bold {inst ? 'text-muted-foreground hover:bg-accent' : 'bg-primary text-primary-foreground'} disabled:opacity-50"
                        >{!inst ? 'Install' : inst.version === p.version ? 'Reinstall' : 'Update'}</button>
                        {#if inst}
                          <button data-focusable disabled={packageBusy} onclick={() => removePackage(url, p.id)} title="Uninstall"
                            class="grid size-7 shrink-0 place-items-center rounded-md text-destructive hover:bg-accent disabled:opacity-50"><Trash2 size={14} /></button>
                        {/if}
                      </li>
                    {/each}
                    {#if !shown.length}
                      <li class="p-3 text-xs text-muted-foreground">No packages match that search.</li>
                    {/if}
                  </ul>
                </div>
              {:else}
                {@const metas = info.configs}
                {@const ids = metas.map((x) => x.id)}
                <div class="mt-3 border-t border-border pt-3">
                  <div class="mb-2 flex items-center justify-between">
                    <span class="text-xs font-bold text-muted-foreground">Plugins in this source</span>
                    <span class="flex gap-1">
                      <button data-focusable onclick={() => setAllPlugins(ids, true)} class="rounded px-2 py-0.5 text-xs font-bold text-muted-foreground hover:bg-accent">All on</button>
                      <button data-focusable onclick={() => setAllPlugins(ids, false)} class="rounded px-2 py-0.5 text-xs font-bold text-muted-foreground hover:bg-accent">All off</button>
                    </span>
                  </div>
                  <ul class="space-y-1">
                    {#each metas as p (p.id)}
                      {@const pOff = pluginOff(p.id)}
                      <li class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50" class:opacity-50={pOff}>
                        {#if p.icon}
                          <img src={iconSrc(p.icon)} alt="" class="size-6 shrink-0 rounded bg-neutral-900 object-contain" />
                        {:else}
                          <div class="grid size-6 shrink-0 place-items-center rounded bg-secondary text-muted-foreground"><Puzzle size={12} /></div>
                        {/if}
                        <span class="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                        {#if p.lang}<span class="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[0.6rem] font-bold text-muted-foreground">{langLabel(p.lang)}</span>{/if}
                        <button data-focusable data-switch onclick={() => togglePlugin(p.id)} aria-pressed={!pOff} title={pOff ? 'Enable' : 'Disable'}
                          class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors {pOff ? 'bg-white/20 ring-1 ring-inset ring-white/20' : 'bg-theme'}">
                          <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform {pOff ? 'translate-x-0.5' : 'translate-x-4'}"></span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            {/await}
          {/if}
        </li>
      {/each}
      {#if !$extensionUrls.length}<li class="text-sm text-muted-foreground">No extensions added.</li>{/if}
    </ul>
  </div>
</div>
