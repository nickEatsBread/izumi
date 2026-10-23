<script module lang="ts">
  import type { ThemeListing } from '$lib/store/themes'
  import type { LoadedStore } from '$lib/store/load'
  // The last loaded listings: returning from a preview reopens the theme page at once, so the
  // screenshot can shrink back into its viewer instead of waiting on the stores.
  let lastListings: { listings: ThemeListing[]; cached: boolean; loaded: Record<string, LoadedStore> } | null = null
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { goto } from '$app/navigation'
  import Search from '@lucide/svelte/icons/search'
  import Palette from '@lucide/svelte/icons/palette'
  import Plus from '@lucide/svelte/icons/plus'
  import Store from '@lucide/svelte/icons/store'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { page } from '$app/state'
  import ThemeBrowse from '$lib/components/themes/ThemeBrowse.svelte'
  import ThemeDetail from '$lib/components/themes/ThemeDetail.svelte'
  import StoresDialog from '$lib/components/store/StoresDialog.svelte'
  import { collectLocalThemes, prepareRelease, prepareThemeLink } from '$lib/themes/catalog'
  import { THEME_API, SUPPORTED_THEME_APIS, THEME_CATALOG_PROJECT_URL, THEME_CATALOG_URL, THEME_SCREENS, newerVersion, platformFor, shotsFor, type PreparedTheme, type ThemeRelease, type ThemeScreen } from '$lib/themes/packages'
  import { installedThemes, installTheme, applyInstalledTheme, removeInstalledTheme, rollbackTheme, previewTheme, type InstalledTheme } from '$lib/themes/installed'
  import { newestSeriesId, screenRoute } from '$lib/themes/preview-routes'
  import { cwSnapshot } from '$lib/player/continue-watching'
  import { allStores } from '$lib/store/feeds'
  import { findStoreThemeRelease, loadThemeListings } from '$lib/store/themes'
  import { themeStudioOpen } from '$lib/settings/theme-studio-session'
  import { activeStudioThemeId, studioThemes } from '$lib/settings/theme-studio'
  import { themePreset } from '$lib/settings/ui'
  import { protectedSurface, themeSafeMode } from '$lib/themes/safe-mode'
  import { themeCssStatus } from '$lib/theme'
  import { navLayer } from '$lib/nav/overlay'
  import { isMobile } from '$lib/platform'

  let tab = $state<'browse' | 'installed'>('browse')
  // Raw, never proxied: listingFor is keyed by these exact objects.
  let entries = $state.raw<ThemeRelease[]>([])
  let listingFor = $state.raw(new Map<ThemeRelease, ThemeListing>())
  const originOf = (entry: ThemeRelease) => listingFor.get(entry)?.origin ?? ''
  let query = $state('')
  let loading = $state(true)
  let busy = $state(false)
  let error = $state('')
  let notice = $state('')
  let cached = $state(false)
  // Each store's last load, for the store manager; `showStores` opens it.
  let loaded = $state.raw<Record<string, LoadedStore>>({})
  let showStores = $state(false)
  let selected = $state<ThemeRelease | null>(null)
  let prepared = $state<PreparedTheme | null>(null)
  // `${origin}|${id}` of the theme page the URL opened; empty for link, file and update views.
  let selectedKey = $state('')
  // Whether this page pushed the theme page's history entry, so Back can pop it.
  let pushed = false
  let showAdd = $state(false)
  let link = $state('')
  let fileInput: HTMLInputElement
  let folderInput: HTMLInputElement
  let batch = $state<PreparedTheme[]>([])
  let batchErrors = $state<string[]>([])
  const filtered = $derived(entries.filter(entry => `${entry.name} ${entry.author} ${entry.description} ${entry.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())))
  const filteredListings = $derived(filtered.map(entry => listingFor.get(entry)).filter((item): item is ThemeListing => !!item))
  // A listing built for a newer theme API than this client renders is shown but not installable;
  // one for an older API this client still reads installs as usual.
  const supported = (entry: ThemeRelease) => SUPPORTED_THEME_APIS.includes(entry.themeApi)
  const apiNote = (entry: ThemeRelease) => entry.themeApi > THEME_API ? 'Needs a newer izumi' : 'Requires a different theme API'
  const failure = (cause: unknown) => cause instanceof Error ? cause.message : 'The theme could not be loaded.'
  const keyOf = (origin: string, id: string) => `${origin}|${id}`
  const isInstalled = (entry: ThemeRelease) => $installedThemes.some(item => item.id === entry.id && item.origin === originOf(entry))
  const listingNote = (listing: ThemeListing) => supported(listing.release) ? '' : apiNote(listing.release)
  // Install state matches on id AND origin: a same-ID package from another location can never
  // replace this install, so it must not drive the version comparison or the Update button.
  const currentInstall = $derived(prepared ? $installedThemes.find(item => item.id === prepared?.package.id && item.origin === prepared.origin) : undefined)
  const originConflict = $derived(!!prepared && $installedThemes.some(item => item.id === prepared?.package.id && item.origin !== prepared.origin))
  const canInstall = $derived(!originConflict && (!currentInstall || !!prepared && (newerVersion(prepared.package.version, currentInstall.package.version) || prepared.package.version === currentInstall.package.version && !$studioThemes.some(theme => theme.id === currentInstall.designId))))
  // By the open theme's store URL: a catalog refresh replaces the listing objects themselves.
  const selectedStoreName = $derived(selectedKey ? $allStores.find((store) => selectedKey.startsWith(`${store.url}|`))?.name ?? '' : '')
  const startScreen = $derived(THEME_SCREENS.find(screen => screen === page.url.searchParams.get('screen')) ?? null)
  const startPlatform = $derived((['desktop', 'phone'] as const).find(option => option === page.url.searchParams.get('platform')) ?? null)

  function useListings(result: { listings: ThemeListing[]; cached: boolean; loaded: Record<string, LoadedStore> }) {
    listingFor = new Map(result.listings.map((listing) => [listing.release, listing]))
    entries = result.listings.map((listing) => listing.release)
    cached = result.cached
    loaded = result.loaded
  }
  async function refresh(force = false) {
    if (lastListings && !force && !entries.length) useListings(lastListings)
    loading = true; error = ''
    try {
      const result = await loadThemeListings({ force })
      lastListings = result
      useListings(result)
      if (!result.listings.length && result.errors.length) error = result.errors[0]
    } catch (cause) { error = failure(cause) }
    finally { loading = false }
  }
  onMount(() => { void refresh() })
  // Reactive, so `izumi://safe-mode` also works while this page is already open.
  $effect(() => { if (page.url.searchParams.get('safe') === '1') themeSafeMode.set(true) })
  // `?store=<id>&theme=<id>` is a theme page: opened from a card, by the Store's "Preview & install",
  // and on the way back from a preview. Leaving it (Back) returns focus to the theme's card.
  $effect(() => {
    const storeId = page.url.searchParams.get('store'), themeId = page.url.searchParams.get('theme')
    if (!themeId) {
      const was = untrack(() => selectedKey)
      if (was) untrack(() => close(was))
      return
    }
    const origin = $allStores.find((store) => store.id === storeId)?.url
    const entry = entries.find((item) => item.id === themeId && originOf(item) === origin)
    if (entry && untrack(() => selectedKey) !== keyOf(originOf(entry), entry.id)) untrack(() => void inspect(entry))
  })
  function open(listing: ThemeListing) {
    const store = $allStores.find((item) => item.url === listing.origin)
    if (!store) return
    pushed = true
    void goto(`?${new URLSearchParams({ store: store.id, theme: listing.release.id })}`)
  }
  function close(key: string) {
    selected = null; prepared = null; selectedKey = ''; busy = false; error = ''
    void tick().then(() => document.querySelector<HTMLElement>(`[data-theme-key="${CSS.escape(key)}"]`)?.focus())
  }
  function back() {
    if (!selectedKey || !page.url.searchParams.has('theme')) { selected = null; prepared = null; error = ''; return }
    if (pushed) { pushed = false; history.back() } else void goto(page.url.pathname, { replaceState: true })
  }
  // Leaves the theme page without a history step (after installing, or switching tabs).
  function leaveDetail() {
    selected = null; prepared = null; selectedKey = ''; pushed = false
    if (page.url.searchParams.has('theme')) void goto(page.url.pathname, { replaceState: true, keepFocus: true })
  }
  async function inspect(entry: ThemeRelease) {
    const key = keyOf(originOf(entry), entry.id)
    selected = entry; selectedKey = key; prepared = null; busy = true; error = ''; notice = ''
    try {
      const result = await prepareRelease(entry, originOf(entry))
      if (selectedKey === key) prepared = result
    } catch (cause) { if (selectedKey === key) error = failure(cause) }
    finally { if (selectedKey === key) busy = false }
  }
  function closeAdd() { showAdd = false; batch = []; batchErrors = [] }
  async function fromLink(event: SubmitEvent) {
    event.preventDefault(); if (busy) return
    leaveDetail(); busy = true; error = ''; batch = []; batchErrors = []
    try { prepared = await prepareThemeLink(link); closeAdd() } catch (cause) { error = failure(cause) } finally { busy = false }
  }
  async function fromFiles(list: FileList | null) {
    if (!list?.length || busy) return
    leaveDetail(); busy = true
    error = ''; batch = []; batchErrors = []
    try {
      const files = await Promise.all([...list].map(async file => ({ name: file.name, text: await file.text(), bytes: file.size })))
      const result = collectLocalThemes(files)
      batchErrors = result.errors
      if (result.prepared.length === 1 && !result.errors.length) {
        prepared = result.prepared[0]
        closeAdd()
      } else {
        batch = result.prepared
        showAdd = true
      }
    } catch (cause) { error = failure(cause) } finally { busy = false }
  }
  function installBatch() {
    if (!batch.length) return
    const names: string[] = []
    const failed: string[] = []
    for (const item of batch) {
      try { installTheme(item); names.push(item.package.name) }
      catch (cause) { failed.push(`${item.package.name}: ${failure(cause)}`) }
    }
    notice = names.length ? `Installed ${names.join(', ')}. Apply one from Installed.` : ''
    error = failed.length ? failed.join(' ') : ''
    closeAdd(); tab = 'installed'; leaveDetail()
  }
  function install() {
    if (!prepared) return
    try {
      const item = installTheme(prepared); applyInstalledTheme(item)
      notice = `${item.package.name} installed. Your personal edits are kept when updating.`
      leaveDetail(); tab = 'installed'
    } catch (cause) { error = failure(cause) }
  }
  function preview(screen: ThemeScreen) {
    if (!prepared || $themeStudioOpen) return
    const target = prepared
    previewTheme(target); void goto(screenRoute(screen, newestSeriesId(get(cwSnapshot))))
  }
  // Preview straight from the store's spotlight, with the same origin guard as the theme page.
  async function previewListing(listing: ThemeListing) {
    if ($themeStudioOpen) return
    error = ''
    try {
      const target = await prepareRelease(listing.release, listing.origin)
      if ($installedThemes.some(item => item.id === target.package.id && item.origin !== target.origin)) throw new Error('A theme with this ID is already installed from a different source. Remove it there before previewing this one.')
      previewTheme(target); await goto(screenRoute('home', null))
    } catch (cause) { error = failure(cause) }
  }
  async function update(item: InstalledTheme) {
    busy = true; error = ''; notice = ''
    try {
      if ($allStores.some((store) => store.url === item.origin)) {
        // Themes only update from the store they were installed from.
        const entry = await findStoreThemeRelease(item.origin, item.id)
        if (!entry || !newerVersion(entry.version, item.package.version)) { notice = 'You have the latest listed version.'; return }
        selected = entry; prepared = await prepareRelease(entry, item.origin)
      } else if (item.updateUrl) {
        const candidate = await prepareThemeLink(item.updateUrl)
        if (candidate.package.id !== item.id) throw new Error('The update link changed its theme identity.')
        if (!newerVersion(candidate.package.version, item.package.version)) { notice = 'You have the latest version.'; return }
        prepared = candidate
      }
    } catch (cause) { error = failure(cause) } finally { busy = false }
  }
  function apply(item: InstalledTheme) { try { applyInstalledTheme(item); notice = `${item.package.name} applied.` } catch (cause) { error = failure(cause) } }
  function remove(item: InstalledTheme) { try { removeInstalledTheme(item.id); notice = `${item.package.name} removed.` } catch (cause) { error = failure(cause) } }
  function restore(item: InstalledTheme) { try { rollbackTheme(item.id); notice = 'Previous version restored.' } catch (cause) { error = failure(cause) } }
  // The Installed tab's thumbnail: the listing's own screenshot, when the theme is still listed.
  function thumbOf(item: InstalledTheme) {
    const entry = entries.find(candidate => candidate.id === item.id && originOf(candidate) === item.origin)
    return entry ? shotsFor(entry, platformFor(entry, $isMobile ? 'phone' : 'desktop'))[0]?.url : undefined
  }
</script>

<svelte:head><title>Themes · izumi</title></svelte:head>
<div class="themes-page" data-theme-protected use:protectedSurface>
  <!-- One store header: the title, the Discover / Installed switch, then search and the store actions. -->
  <header class="store-head">
    <h2 data-settings-page-title>Themes</h2>
    <nav class="tabs" aria-label="Theme library"><button type="button" data-focusable aria-pressed={tab === 'browse'} onclick={() => { tab = 'browse'; leaveDetail() }}>Discover</button><button type="button" data-focusable aria-pressed={tab === 'installed'} onclick={() => { tab = 'installed'; leaveDetail() }}>Installed <span>{$installedThemes.length}</span></button></nav>
    <div class="head-actions">
      {#if tab === 'browse' && !(selected || prepared)}<label class="search"><Search size={16} aria-hidden="true" /><input bind:value={query} aria-label="Search themes" placeholder="Search themes" data-focusable /></label>{/if}
      <button type="button" class="pill" data-focusable aria-label="Stores" title="Stores" onclick={() => showStores = true}><Store size={16} aria-hidden="true" /><span>Stores</span></button>
      <button type="button" class="pill" data-focusable aria-label="Add theme" title="Add theme" onclick={() => { showAdd = true; error = '' }}><Plus size={16} aria-hidden="true" /><span>Add theme</span></button>
      <a class="pill" href="/app/settings/theme-studio" data-focusable aria-label="Theme Studio" title="Theme Studio"><Palette size={16} aria-hidden="true" /><span>Theme Studio</span></a>
    </div>
  </header>
  {#if $themeStudioOpen}<p class="message">Finish or discard your Theme Studio draft before applying another theme.</p>{/if}
  {#if $themeSafeMode}<p class="message">Safe mode is on: izumi's default appearance is showing until you turn themes back on or restart. <button type="button" class="text-close inline" data-focusable onclick={() => themeSafeMode.set(false)}>Turn themes back on</button></p>{/if}
  {#if $themeCssStatus.state === 'rejected'}<p role="alert" class="message error">The active theme's stylesheet was not applied: {$themeCssStatus.reason}</p>{/if}
  <input bind:this={fileInput} type="file" accept=".json,application/json" multiple class="hidden" onchange={(event) => { const input = event.currentTarget; void fromFiles(input.files); input.value = '' }} aria-label="Import theme package files" />
  <input bind:this={folderInput} type="file" accept=".json,application/json" multiple webkitdirectory class="hidden" onchange={(event) => { const input = event.currentTarget; void fromFiles(input.files); input.value = '' }} aria-label="Import theme package folder" />
  {#if showAdd}
    <div class="add-layer">
      <button type="button" class="add-scrim" tabindex="-1" aria-label="Close add theme" onclick={closeAdd}></button>
      <!-- A nav layer: Escape (the shared capture), B and remote Back close only this dialog, and the
           d-pad stays inside it. -->
      <div data-nav-scroll-container class="add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-theme-title" data-nav-trap data-nav-escape use:navLayer={{ kind: 'themes-add', onClose: closeAdd }}>
        <h3 id="add-theme-title">Add a theme</h3>
        <p>Install from the community catalog, a public HTTPS link, a JSON file, or a folder of packages.</p>
        <button type="button" class="control catalog-link" data-focusable onclick={() => void openUrl(THEME_CATALOG_PROJECT_URL)}>Open izumi-themes catalog</button>
        <form onsubmit={fromLink} class="link-form">
          <label for="theme-link">Theme package or release link</label>
          <div><input id="theme-link" type="url" bind:value={link} required placeholder="https://…/theme.json" data-focusable /><button class="control primary" disabled={busy} data-focusable>Load link</button></div>
          <p>Public HTTPS links work even when a theme is not listed in the catalog. GitHub file links are accepted.</p>
        </form>
        <div class="add-local">
          <button class="control" data-focusable disabled={busy} onclick={() => fileInput.click()}>Import file</button>
          <button class="control" data-focusable disabled={busy} onclick={() => folderInput.click()}>Import folder</button>
        </div>
        {#if batch.length}
          <div class="batch">
            <p>{batch.length} packages ready. They stay on this device until you apply one from Installed.</p>
            <ul>{#each batch as item (item.package.id)}<li>{item.package.name} <span>{item.package.version}</span></li>{/each}</ul>
            {#if batchErrors.length}<p class="batch-errors">{batchErrors.join(' ')}</p>{/if}
            <button class="control primary" data-focusable disabled={busy || $themeStudioOpen} onclick={installBatch}>Install all</button>
          </div>
        {/if}
        <button class="text-close" data-focusable onclick={closeAdd}>Cancel</button>
      </div>
    </div>
  {/if}
  {#if showStores}
    <!-- The shared store manager: add any theme catalog or store link; its themes get their own shelf. -->
    <StoresDialog {loaded} onclose={() => { showStores = false; void refresh(true) }} onadded={() => { notice = 'Store added. Its themes are in their own shelf.' }} />
  {/if}
  {#if error}<p role="alert" class="message error">{error}</p>{/if}
  {#if notice}<p role="status" class="message">{notice}</p>{/if}
  {#if selected || prepared}
    {#key selectedKey || prepared?.package.id}
      <ThemeDetail release={selected ?? prepared?.release ?? null} {prepared} storeName={selectedStoreName} {busy} {canInstall}
        installLabel={currentInstall ? canInstall ? 'Update & apply' : 'Installed' : 'Install & apply'} installed={!!currentInstall} locked={$themeStudioOpen} conflict={originConflict}
        {startScreen} {startPlatform} onback={back} oninstall={install} onpreview={preview} />
    {/key}
  {:else if tab === 'browse'}
    {#if cached}<p class="message">Showing the saved catalog. <button type="button" class="text-close inline" data-focusable disabled={loading} onclick={() => refresh(true)}>Refresh</button> when you’re back online.</p>{/if}
    {#if loading && !entries.length}<div class="skeletons" aria-label="Loading themes" aria-busy="true">{#each [1, 2, 3] as item (item)}<div class="skeleton" aria-hidden="true"></div>{/each}</div>
    {:else if !filtered.length}<div class="empty"><Palette size={36} /><h3>{entries.length ? 'No matching themes' : 'Your next look starts here'}</h3><p>{entries.length ? 'Try another name or style.' : 'Refresh the catalog, or add a theme from a link, file or folder.'}</p></div>
    {:else}<ThemeBrowse listings={filteredListings} filtered={!!query.trim()} official={THEME_CATALOG_URL} installed={(listing) => isInstalled(listing.release)} note={listingNote} onopen={open} onpreview={previewListing} previewLocked={$themeStudioOpen} />{/if}
  {:else}
    <div class="default-theme"><div><strong>Izumi default</strong><p>The original appearance is always available.</p></div><button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => { $themePreset = 'izumi'; notice = 'Default appearance restored.' }}>Use default</button></div>
    {#each $installedThemes as item (item.id)}{@const thumb = thumbOf(item)}<article class="installed-theme"><div class="installed-thumb">{#if thumb}<img src={thumb} alt="" loading="lazy" referrerpolicy="no-referrer" />{:else}<Palette size={22} />{/if}</div><div><h3>{item.package.name}</h3><p>By {item.package.author} · {item.package.version}{#if $themePreset === 'custom' && $activeStudioThemeId === item.designId} · Applied{/if}</p><p class="summary">{item.package.description}</p></div><div class="installed-actions"><button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => apply(item)}>Apply</button>{#if $allStores.some((store) => store.url === item.origin) || item.updateUrl}<button class="control" data-focusable disabled={busy || $themeStudioOpen} onclick={() => update(item)}>Check update</button>{/if}{#if item.previous}<button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => restore(item)}>Restore previous</button>{/if}<button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => remove(item)}>Remove</button></div></article>{/each}
    {#if !$installedThemes.length}<div class="empty"><Palette size={36} /><h3>A home for your themes</h3><p>Installed themes stay here, ready to use offline.</p><button class="control" data-focusable onclick={() => tab = 'browse'}>Browse themes</button></div>{/if}
  {/if}
</div>

<style>
  /* A size container: the header adapts to the page's own width, which the settings rail narrows. */
  .themes-page { max-width: 1160px; padding: clamp(20px, 4vw, 40px); margin: auto; container-type: inline-size; }
  .store-head { display: flex; align-items: center; gap: 12px 16px; margin-bottom: 26px; }
  h2 { font-size: 30px; font-weight: 900; letter-spacing: -.035em; line-height: 1; margin: 0; }
  .tabs { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: hsl(var(--foreground) / .07); }
  .tabs button { min-height: 34px; padding: 0 16px; border-radius: 999px; font-size: 13px; font-weight: 800; color: hsl(var(--muted-foreground)); }
  .tabs button[aria-pressed='true'] { background: hsl(var(--foreground)); color: hsl(var(--background)); }
  .tabs span { margin-left: 4px; font-size: 11px; opacity: .7; }
  .head-actions { display: flex; flex: 1 1 auto; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
  .search { display: flex; flex: 0 1 260px; min-width: 120px; align-items: center; gap: 8px; height: 38px; padding: 0 14px; border-radius: 999px; background: hsl(var(--foreground) / .07); color: hsl(var(--muted-foreground)); }
  .search input { min-height: 0; height: 100%; font-size: 13px; }
  .pill { display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 14px; border-radius: 999px; font-size: 12px; font-weight: 800; white-space: nowrap; background: hsl(var(--foreground) / .07); }
  .pill:hover { background: hsl(var(--foreground) / .12); }
  .installed-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .control { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 9px 14px; border: 1px solid hsl(var(--border)); border-radius: 8px; font-size: 12px; font-weight: 800; white-space: nowrap; background: hsl(var(--card)); }
  .control:hover { background: hsl(var(--accent)); }
  .control.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: transparent; }
  :is(button, a, input):focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 4px; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  input { background: transparent; color: hsl(var(--foreground)); min-height: 44px; min-width: 0; width: 100%; font-size: 14px; }
  input::placeholder { color: hsl(var(--muted-foreground)); }
  h3 { font-size: 17px; font-weight: 900; letter-spacing: -.02em; }
  /* Installed shows a one-line teaser; the theme page keeps the full text. */
  .summary { font-size: 12px; line-height: 1.6; margin-top: 8px; color: hsl(var(--muted-foreground)); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; line-clamp: 1; overflow: hidden; }
  .message { padding: 14px 16px; margin: 16px 0; border-radius: 8px; background: hsl(var(--muted)); font-size: 13px; }
  .error { border-inline-start: 3px solid hsl(var(--theme)); }
  .link-form { margin: 20px 0 0; padding: 0; background: transparent; border-radius: 0; }
  .link-form label { display: block; font-size: 13px; font-weight: 800; margin-bottom: 8px; }
  .link-form > div { display: flex; flex-wrap: wrap; gap: 10px; }
  .link-form input { flex: 1; min-width: 180px; border-bottom: 1px solid hsl(var(--border)); }
  .link-form p { font-size: 11px; color: hsl(var(--muted-foreground)); margin-top: 12px; line-height: 1.6; }
  .add-layer { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 24px; }
  .add-scrim { position: absolute; inset: 0; background: hsl(var(--background) / .72); border: 0; }
  .add-dialog { position: relative; width: min(520px, 100%); max-height: min(88vh, 720px); overflow: auto; padding: 24px; border: 1px solid hsl(var(--border)); border-radius: 12px; background: hsl(var(--card)); color: hsl(var(--card-foreground)); }
  .add-dialog h3 { font-size: 22px; margin-bottom: 8px; }
  .add-dialog > p { color: hsl(var(--muted-foreground)); font-size: 13px; line-height: 1.6; }
  .catalog-link { margin-top: 16px; }
  .add-local { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  .batch { margin-top: 18px; padding-top: 16px; border-top: 1px solid hsl(var(--border)); }
  .batch ul { margin: 10px 0 14px; padding-left: 18px; font-size: 13px; }
  .batch span { color: hsl(var(--muted-foreground)); font-size: 11px; }
  .batch-errors { color: hsl(var(--muted-foreground)); font-size: 12px; margin-bottom: 12px; }
  .text-close { display: block; margin-top: 16px; min-height: 40px; font-size: 12px; font-weight: 800; text-decoration: underline; text-underline-offset: 4px; }
  .text-close.inline { display: inline; margin: 0 0 0 6px; min-height: 0; }
  .empty { min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; color: hsl(var(--muted-foreground)); }
  .empty p { font-size: 13px; }
  .skeletons { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 245px), 1fr)); gap: 22px; }
  .skeleton { aspect-ratio: 16 / 10; background: hsl(var(--muted)); border-radius: 10px; }
  .default-theme, .installed-theme { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px; padding: 24px 0; border-bottom: 1px solid hsl(var(--border)); }
  .installed-theme > div:nth-child(2) { flex: 1; min-width: 180px; }
  .installed-thumb { width: 112px; aspect-ratio: 16 / 10; flex: none; display: grid; place-items: center; overflow: hidden; border-radius: 8px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
  .installed-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .default-theme p, .installed-theme p { color: hsl(var(--muted-foreground)); font-size: 12px; margin-top: 5px; }
  /* Narrower pages keep one header row with icon-only actions; phones put search and actions on a row of their own. */
  @container (max-width: 900px) {
    .pill { width: 38px; padding: 0; justify-content: center; }
    .pill span { display: none; }
  }
  /* Phones: the Discover / Installed switch fills the first row beside three light icon actions;
     search gets a full-width row of its own. */
  @container (max-width: 560px) {
    .store-head { flex-wrap: wrap; gap: 12px 4px; }
    .head-actions { display: contents; }
    .tabs { flex: 1 1 auto; margin-right: 4px; }
    .tabs button { flex: 1 1 0; }
    .pill { background: transparent; color: hsl(var(--foreground) / .85); }
    .search { order: 1; flex: 1 1 100%; height: 42px; }
  }
</style>
