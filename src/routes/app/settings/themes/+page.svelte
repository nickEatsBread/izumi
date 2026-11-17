<script module lang="ts">
  import type { ThemeListing } from '$lib/store/themes'
  import type { LoadedStore } from '$lib/store/load'
  // The last loaded listings: coming back from a preview shows the list at once instead of waiting
  // on the stores.
  let lastListings: { listings: ThemeListing[]; cached: boolean; loaded: Record<string, LoadedStore> } | null = null
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { afterNavigate, goto } from '$app/navigation'
  import Search from '@lucide/svelte/icons/search'
  import Palette from '@lucide/svelte/icons/palette'
  import Plus from '@lucide/svelte/icons/plus'
  import Store from '@lucide/svelte/icons/store'
  import RefreshCw from '@lucide/svelte/icons/refresh-cw'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import Trash2 from '@lucide/svelte/icons/trash-2'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { page } from '$app/state'
  import ThemeGrid from '$lib/components/themes/ThemeGrid.svelte'
  import ThemePane from '$lib/components/themes/ThemePane.svelte'
  import StoresDialog from '$lib/components/store/StoresDialog.svelte'
  import OptionsSheet, { type SheetGroup } from '$lib/components/detail/OptionsSheet.svelte'
  import { collectLocalThemes, prepareRelease, prepareThemeLink } from '$lib/themes/catalog'
  import { THEME_API, SUPPORTED_THEME_APIS, THEME_CATALOG_PROJECT_URL, THEME_CATALOG_URL, THEME_SCREENS, newerVersion, type PreparedTheme, type ThemeScreen } from '$lib/themes/packages'
  import { installedThemes, installTheme, applyInstalledTheme, removeInstalledTheme, rollbackTheme, previewTheme, type InstalledTheme } from '$lib/themes/installed'
  import { DEFAULT_THEME_KEY, themeKey, themeSections, type ThemeEntry } from '$lib/themes/store-shelves'
  import { newestSeriesId, screenRoute } from '$lib/themes/preview-routes'
  import { forgetScroll } from '$lib/navigation/scroll-restoration'
  import { cwSnapshot } from '$lib/player/continue-watching'
  import { allStores } from '$lib/store/feeds'
  import { findStoreThemeRelease, loadThemeListings } from '$lib/store/themes'
  import { themeStudioOpen } from '$lib/settings/theme-studio-session'
  import { activeStudioThemeId, studioThemes } from '$lib/settings/theme-studio'
  import { themePreset } from '$lib/settings/ui'
  import { catalogLabel, catalogScreen, customScreens } from '$lib/settings/catalog'
  import { screenThemeName, setScreenTheme } from '$lib/themes/screen-theme'
  import { protectedSurface, themeSafeMode } from '$lib/themes/safe-mode'
  import { THEME_PRESETS } from '$lib/theme-tokens'
  import { themeCssStatus } from '$lib/theme'
  import { navLayer } from '$lib/nav/overlay'
  import { focusByNav } from '$lib/nav'
  import { PAGE_OPTIONS_EVENT } from '$lib/nav/gamepad'
  import { controllerMode } from '$lib/nav/input'
  import { gameMode } from '$lib/player/session'
  import { isMobile, isTv } from '$lib/platform'
  import { portal } from '$lib/util/portal'
  import { DEFAULT_THEME_CARD, THEME_OPTION_LABELS, appliedThemeCard, cardAfterRemove, themeOptionIds } from '$lib/components/settings/themes/controller-themes'

  // A gallery (Installed, then the store sections, filtered by chips and search) whose cards open a
  // theme's own page through the URL: `?store=&theme=`, or `?theme=` for the default, an install from
  // a link or file, and a theme just loaded from one.
  const pad = $derived($gameMode || $isTv || $controllerMode)
  /** A link or file import that is not installed yet. */
  const LOOSE = 'loose'
  let listings = $state.raw<ThemeListing[]>([])
  let query = $state('')
  let loading = $state(true)
  let busy = $state(false)
  let error = $state('')
  let notice = $state('')
  let cached = $state(false)
  // Each store's last load, for the store manager; `showStores` opens it.
  let loaded = $state.raw<Record<string, LoadedStore>>({})
  let showStores = $state(false)
  let showAdd = $state(false)
  let link = $state('')
  let fileInput: HTMLInputElement
  let folderInput: HTMLInputElement
  let batch = $state<PreparedTheme[]>([])
  let batchErrors = $state<string[]>([])
  let loose = $state.raw<PreparedTheme | null>(null)
  // The chip: 'all' or a section id.
  let filter = $state('all')
  // Checked packages by key: a listing's (to preview or install it) or an update found for an install.
  let preparedBy = $state.raw(new Map<string, PreparedTheme>())
  let preparing = $state('')
  let message = $state<{ text: string; error: boolean } | null>(null)
  let sheetFor = $state<InstalledTheme | null>(null)
  // Whether this page pushed the open theme's history entry, so Back can pop it.
  let pushed = false
  let refocus = ''

  const failure = (cause: unknown) => cause instanceof Error ? cause.message : 'The theme could not be loaded.'
  const supported = (entry: ThemeEntry) => !entry.listing || SUPPORTED_THEME_APIS.includes(entry.listing.release.themeApi)
  // A listing built for a newer theme API than this client renders is shown but not installable;
  // one for an older API this client still reads installs as usual.
  const note = (entry: ThemeEntry) => supported(entry) || entry.installed ? '' : entry.listing!.release.themeApi > THEME_API ? 'Needs a newer izumi' : 'Needs a different theme API'
  const sections = $derived(themeSections($installedThemes, listings, THEME_CATALOG_URL, query))
  const chips = $derived(themeSections($installedThemes, listings, THEME_CATALOG_URL).map((section) => ({ id: section.id, title: section.title })))
  const shown = $derived(filter === 'all' ? sections : sections.filter((section) => section.id === filter))
  // Every theme, search or not: the selection may sit outside the filtered list.
  const everything = $derived(themeSections($installedThemes, listings, THEME_CATALOG_URL).flatMap((section) => section.entries))
  const appliedId = $derived(appliedThemeCard($themePreset, $activeStudioThemeId, $installedThemes))
  const applied = $derived.by(() => {
    if (appliedId === DEFAULT_THEME_CARD) return DEFAULT_THEME_KEY
    const item = $installedThemes.find((theme) => theme.id === appliedId)
    return item ? themeKey(item.origin, item.id) : null
  })
  const entryOf = (key: string) => everything.find((entry) => entry.key === key) ?? null
  // The open theme page: the URL's theme once it resolves, else none.
  const current = $derived.by(() => {
    const themeId = page.url.searchParams.get('theme')
    const key = themeId ? keyFromUrl(page.url.searchParams.get('store'), themeId) : ''
    return key === LOOSE || entryOf(key) ? key : ''
  })
  const open = $derived(!!current)
  const entry = $derived(current === LOOSE ? null : entryOf(current))
  const install = $derived(entry?.installed)
  const prepared = $derived(current === LOOSE ? loose : preparedBy.get(current) ?? null)
  const isApplied = $derived(current === applied)
  // Install state matches on id AND origin: a same-ID package from another location can never
  // replace this install, so it must not drive the version comparison or the Update button.
  const conflict = $derived(!!prepared && $installedThemes.some((item) => item.id === prepared.package.id && item.origin !== prepared.origin))
  const canInstall = $derived(!!prepared && !conflict && (!install || newerVersion(prepared.package.version, install.package.version) || prepared.package.version === install.package.version && !$studioThemes.some((theme) => theme.id === install.designId)))
  const tokensOf = (item: ThemeEntry) => item.key === DEFAULT_THEME_KEY ? THEME_PRESETS.izumi
    : preparedBy.get(item.key)?.package.design.tokens ?? (item.installed ? $studioThemes.find((theme) => theme.id === item.installed?.designId)?.tokens : undefined)
  const tokens = $derived(prepared?.package.design.tokens ?? (entry ? tokensOf(entry) : undefined))
  const locked = $derived($themeStudioOpen)
  const primary = $derived.by(() => {
    if (current === DEFAULT_THEME_KEY) return isApplied ? { label: 'Applied', disabled: true, run: () => {} } : { label: 'Use default', disabled: locked, run: useDefault }
    if (install && canInstall) return { label: newerVersion(prepared!.package.version, install.package.version) ? 'Update and apply' : 'Reinstall and apply', disabled: locked || busy, run: installPrepared }
    if (install) return isApplied ? { label: 'Applied', disabled: true, run: () => {} } : { label: 'Apply', disabled: locked, run: () => apply(install) }
    if (prepared) return { label: 'Install and apply', disabled: locked || busy || !canInstall, run: installPrepared }
    return { label: entry && note(entry) || 'Install and apply', disabled: true, run: () => {} }
  })
  const hint = $derived(conflict ? 'A theme with this ID is already installed from a different source. Remove it there before installing this one.' : entry ? note(entry) : '')
  const storeName = $derived(entry?.listing && entry.listing.origin !== THEME_CATALOG_URL ? entry.listing.storeName : '')
  const startScreen = $derived(THEME_SCREENS.find((screen) => screen === page.url.searchParams.get('screen')) ?? null)
  const startPlatform = $derived((['desktop', 'phone'] as const).find((option) => option === page.url.searchParams.get('platform')) ?? null)

  function useListings(result: { listings: ThemeListing[]; cached: boolean; loaded: Record<string, LoadedStore> }) {
    listings = result.listings
    cached = result.cached
    loaded = result.loaded
  }
  async function refresh(force = false) {
    if (lastListings && !force && !listings.length) useListings(lastListings)
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

  // The URL's theme (a deep link from the Store, a preview returning, a phone's open theme) selects it.
  function keyFromUrl(storeId: string | null, themeId: string): string {
    if (storeId) {
      const origin = $allStores.find((store) => store.id === storeId)?.url
      return origin ? themeKey(origin, themeId) : ''
    }
    if (themeId === DEFAULT_THEME_KEY || themeId === LOOSE && loose) return themeId
    const item = $installedThemes.find((theme) => theme.id === themeId)
    return item ? themeKey(item.origin, item.id) : ''
  }
  function paramsFor(key: string): URLSearchParams {
    const item = entryOf(key)
    const origin = item?.listing?.origin ?? item?.installed?.origin
    const store = origin ? $allStores.find((candidate) => candidate.url === origin) : undefined
    const id = item?.listing?.release.id ?? item?.installed?.id ?? key
    return new URLSearchParams(store ? { store: store.id, theme: id } : { theme: id })
  }

  // An open listing's package loads once, and is dropped if the page closes first.
  $effect(() => {
    const key = current
    const listing = key ? entryOf(key)?.listing : undefined
    if (!listing || !SUPPORTED_THEME_APIS.includes(listing.release.themeApi) || untrack(() => preparedBy.has(key))) return
    const controller = new AbortController()
    preparing = key
    prepareRelease(listing.release, listing.origin, undefined, controller.signal)
      .then((result) => { preparedBy = new Map(preparedBy).set(key, result) })
      .catch((cause) => { if (!controller.signal.aborted && current === key) message = { text: failure(cause), error: true } })
      .finally(() => { if (preparing === key) preparing = '' })
    return () => controller.abort()
  })

  function onopen(item: ThemeEntry) {
    message = null; pushed = true
    const url = new URL(`?${paramsFor(item.key)}`, page.url)
    // A theme page opened from the gallery starts at its top, never at a scroll remembered for it.
    forgetScroll(url)
    void goto(url)
  }
  function focusCard(key: string) {
    const card = document.querySelector<HTMLElement>(`[data-theme-grid] [data-theme-key="${CSS.escape(key)}"]`)
    if (card) focusByNav(card, true)
  }
  // Back to the gallery, on the card that was open.
  function back() {
    refocus = current; message = null
    if (pushed) { pushed = false; history.back() } else void goto(page.url.pathname, { replaceState: true })
  }
  afterNavigate(() => {
    // A controller opening a theme lands on its main action; the gallery gets the card back.
    if (page.url.searchParams.has('theme')) {
      if (pad) void tick().then(() => { const target = document.querySelector<HTMLElement>('[data-theme-primary]'); if (target) focusByNav(target, true) })
      return
    }
    if (!refocus) return
    const key = refocus
    refocus = ''
    void tick().then(() => focusCard(key))
  })

  function closeAdd() { showAdd = false; batch = []; batchErrors = [] }
  function showLoose(item: PreparedTheme) {
    loose = item; closeAdd()
    pushed = true; void goto(`?${new URLSearchParams({ theme: LOOSE })}`)
  }
  async function fromLink(event: SubmitEvent) {
    event.preventDefault(); if (busy) return
    busy = true; error = ''; batch = []; batchErrors = []
    try { showLoose(await prepareThemeLink(link)) } catch (cause) { error = failure(cause) } finally { busy = false }
  }
  async function fromFiles(list: FileList | null) {
    if (!list?.length || busy) return
    busy = true
    error = ''; batch = []; batchErrors = []
    try {
      const files = await Promise.all([...list].map(async file => ({ name: file.name, text: await file.text(), bytes: file.size })))
      const result = collectLocalThemes(files)
      batchErrors = result.errors
      if (result.prepared.length === 1 && !result.errors.length) showLoose(result.prepared[0])
      else { batch = result.prepared; showAdd = true }
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
    closeAdd()
  }
  function installPrepared() {
    if (!prepared) return
    const updating = !!install
    try {
      const item = installTheme(prepared); applyInstalledTheme(item)
      if (current === LOOSE) { loose = null; void goto(`?${paramsFor(themeKey(item.origin, item.id))}`, { replaceState: true, keepFocus: true, noScroll: true }) }
      message = { text: `${item.package.name} ${updating ? 'updated' : 'installed'} and applied. Your personal edits are kept when updating.`, error: false }
    } catch (cause) { message = { text: failure(cause), error: true } }
  }
  function preview(screen: ThemeScreen) {
    if (!prepared || locked) return
    previewTheme(prepared)
    void goto(screenRoute(screen, newestSeriesId(get(cwSnapshot))))
  }
  async function update(item: InstalledTheme) {
    const key = themeKey(item.origin, item.id)
    busy = true; message = null
    try {
      let candidate: PreparedTheme | undefined
      if ($allStores.some((store) => store.url === item.origin)) {
        // Themes only update from the store they were installed from.
        const release = await findStoreThemeRelease(item.origin, item.id)
        if (release && newerVersion(release.version, item.package.version)) candidate = await prepareRelease(release, item.origin)
      } else if (item.updateUrl) {
        const found = await prepareThemeLink(item.updateUrl)
        if (found.package.id !== item.id) throw new Error('The update link changed its theme identity.')
        if (newerVersion(found.package.version, item.package.version)) candidate = found
      }
      if (!candidate) { message = { text: 'You have the latest version.', error: false }; return }
      preparedBy = new Map(preparedBy).set(key, candidate)
      message = { text: `Version ${candidate.package.version} is ready to install.`, error: false }
    } catch (cause) { message = { text: failure(cause), error: true } } finally { busy = false }
  }
  function apply(item: InstalledTheme) { try { applyInstalledTheme(item); message = { text: `${item.package.name} applied.`, error: false } } catch (cause) { message = { text: failure(cause), error: true } } }
  function restore(item: InstalledTheme) { try { rollbackTheme(item.id); message = { text: 'Previous version restored.', error: false } } catch (cause) { message = { text: failure(cause), error: true } } }
  function useDefault() { $themePreset = 'izumi'; message = { text: 'Default appearance restored.', error: false } }
  function remove(item: InstalledTheme) {
    const key = themeKey(item.origin, item.id)
    const next = cardAfterRemove([DEFAULT_THEME_KEY, ...$installedThemes.map((theme) => themeKey(theme.origin, theme.id))], key)
    try {
      removeInstalledTheme(item.id)
      notice = `${item.package.name} removed.`
      // Its page goes with it: back to the gallery, on the next installed theme.
      if (current === key) { refocus = next ?? DEFAULT_THEME_KEY; if (pushed) { pushed = false; history.back() } else void goto(page.url.pathname, { replaceState: true }) }
    } catch (cause) { message = { text: failure(cause), error: true } }
  }

  const canUpdate = (item: InstalledTheme) => $allStores.some((store) => store.url === item.origin) || !!item.updateUrl
  const ICONS = { update: RefreshCw, restore: RotateCcw, remove: Trash2 }
  const groups = $derived.by((): SheetGroup[] => {
    const item = sheetFor
    if (!item) return []
    const run = { update: () => void update(item), restore: () => restore(item), remove: () => remove(item) }
    return [{ options: themeOptionIds(item, { update: canUpdate(item) }).map((id) => ({
      id, label: THEME_OPTION_LABELS[id], icon: ICONS[id], onselect: run[id], disabled: locked || (id === 'update' && busy),
    })) }]
  })
  // ☰ on an installed theme's row, or in its preview, opens its other actions; elsewhere ☰ keeps its job.
  $effect(() => {
    const claim = (event: Event) => {
      const focus = document.activeElement
      const key = focus?.closest<HTMLElement>('[data-theme-grid] [data-theme-key]')?.dataset.themeKey ?? (focus?.closest('[data-theme-pane]') ? current : null)
      const item = key ? entryOf(key)?.installed : undefined
      if (!item || sheetFor || document.querySelector('[data-nav-trap]')) return
      event.preventDefault()
      sheetFor = item
    }
    window.addEventListener(PAGE_OPTIONS_EVENT, claim)
    return () => window.removeEventListener(PAGE_OPTIONS_EVENT, claim)
  })
</script>

<svelte:head><title>Themes · izumi</title></svelte:head>
<div class="themes-page" data-theme-protected use:protectedSurface>
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
    <StoresDialog {loaded} onclose={() => { showStores = false; void refresh(true) }} onadded={() => { notice = 'Store added. Its themes are in their own section.' }} />
  {/if}
  {#if !open}
    <!-- The store header: title and store actions, search, then the section chips. -->
    <header class="store-head">
      <h2 data-settings-page-title>Themes</h2>
      <label class="search"><Search size={16} aria-hidden="true" /><input bind:value={query} aria-label="Search themes" placeholder="Search themes" data-focusable /></label>
      <div class="head-actions">
        <button type="button" class="pill" data-focusable aria-label="Stores" title="Stores" onclick={() => showStores = true}><Store size={16} aria-hidden="true" /><span>Stores</span></button>
        <button type="button" class="pill" data-focusable aria-label="Add theme" title="Add theme" onclick={() => { showAdd = true; error = '' }}><Plus size={16} aria-hidden="true" /><span>Add theme</span></button>
        <a class="pill" href="/app/settings/theme-studio" data-focusable aria-label="Theme Studio" title="Theme Studio"><Palette size={16} aria-hidden="true" /><span>Theme Studio</span></a>
      </div>
    </header>
    {#if chips.length > 1}
      <div class="chips" role="group" aria-label="Show" data-nav-scroll-x>
        {#each [{ id: 'all', title: 'All' }, ...chips] as chip (chip.id)}<button type="button" data-focusable aria-pressed={filter === chip.id} onclick={() => filter = chip.id}>{chip.title}</button>{/each}
      </div>
    {/if}
  {/if}
  {#if $themeStudioOpen}<p class="message">Finish or discard your Theme Studio draft before applying another theme.</p>{/if}
  {#if $themeSafeMode}<p class="message">Safe mode is on: izumi's default appearance is showing until you turn themes back on or restart. <button type="button" class="text-close inline" data-focusable onclick={() => themeSafeMode.set(false)}>Turn themes back on</button></p>{/if}
  {#if $screenThemeName !== null}<p class="message">{catalogLabel($catalogScreen, $customScreens)} has its own theme, {$screenThemeName}, so a theme you apply here shows on your other screens. <button type="button" class="text-close inline" data-focusable onclick={() => setScreenTheme($catalogScreen, null)}>Use the app theme on {catalogLabel($catalogScreen, $customScreens)}</button></p>{/if}
  {#if $themeCssStatus.state === 'rejected'}<p role="alert" class="message error">The active theme's stylesheet was not applied: {$themeCssStatus.reason}</p>{/if}
  {#if !open && cached}<p class="message">Showing the saved catalog. <button type="button" class="text-close inline" data-focusable disabled={loading} onclick={() => refresh(true)}>Refresh</button> when you’re back online.</p>{/if}
  {#if error}<p role="alert" class="message error">{error}</p>{/if}
  {#if notice}<p role="status" class="message">{notice}</p>{/if}
  {#if open}
    <ThemePane {entry} {prepared} {tokens} device={$isMobile ? 'phone' : 'desktop'} {storeName} busy={busy || preparing === current} {primary}
      canPreview={!!prepared && !locked && !isApplied && (!install || canInstall)} {hint} {message} {startScreen} {startPlatform}
      onback={back} onpreview={preview} onmore={install ? () => sheetFor = install : undefined} />
  {:else if shown.length || loading}
    <ThemeGrid sections={shown} {applied} device={$isMobile ? 'phone' : 'desktop'} loading={loading && !listings.length} {tokensOf} {note} {onopen} />
  {:else}
    <div class="empty"><Palette size={36} /><h3>No matching themes</h3><p>Try another name or style.</p></div>
  {/if}
</div>
{#if sheetFor}
  <!-- On <body>: the themes page is a size container and the section wrapper slides in with a
       transform, either of which can turn the sheet's `fixed` into the page's box. -->
  <div use:portal>
    <OptionsSheet title={sheetFor.package.name} subtitle={`By ${sheetFor.package.author} · ${sheetFor.package.version}`} {groups} onclose={() => (sheetFor = null)} />
  </div>
{/if}

<style>
  /* A size container: the layout follows the page's own width, which the settings rail narrows. */
  .themes-page { max-width: 1240px; padding: clamp(1.25rem, 3vw, 2.25rem); margin: auto; container-type: inline-size; }
  .store-head { display: flex; align-items: center; gap: .75rem 1rem; margin-bottom: 1rem; }
  h2 { font-size: 1.875rem; font-weight: 900; letter-spacing: -.035em; line-height: 1; margin: 0 .5rem 0 0; }
  .head-actions { display: flex; align-items: center; gap: .5rem; }
  .search { display: flex; flex: 1 1 auto; max-width: 22rem; min-width: 7.5rem; align-items: center; gap: .5rem; height: 2.375rem; padding: 0 .875rem; border-radius: 999px; background: hsl(var(--foreground) / .07); color: hsl(var(--muted-foreground)); margin-right: auto; }
  .search input { min-height: 0; height: 100%; font-size: .8125rem; }
  .pill { display: inline-flex; align-items: center; gap: .4375rem; height: 2.375rem; padding: 0 .875rem; border-radius: 999px; font-size: .75rem; font-weight: 800; white-space: nowrap; background: hsl(var(--foreground) / .07); transition: background-color .15s ease; }
  .pill:hover { background: hsl(var(--foreground) / .12); }
  /* Section chips: one row that scrolls sideways when it runs out of room. */
  .chips { display: flex; gap: .5rem; margin-bottom: 1.75rem; overflow-x: auto; scrollbar-width: none; padding: .25rem; margin-inline: -.25rem; }
  .chips button { flex: none; height: 2.125rem; padding: 0 .9375rem; border-radius: 999px; font-size: .8125rem; font-weight: 800; background: hsl(var(--foreground) / .07); color: hsl(var(--muted-foreground)); transition: background-color .15s ease, color .15s ease; }
  .chips button:hover { color: hsl(var(--foreground)); background: hsl(var(--foreground) / .12); }
  .chips button[aria-pressed='true'] { background: hsl(var(--foreground)); color: hsl(var(--background)); }
  /* The controller pane is already a padded, scrolling card. */
  :global([data-settings-controller]) .themes-page { padding: 0; }
  .control { display: inline-flex; align-items: center; justify-content: center; min-height: 2.625rem; padding: .5625rem .875rem; border: 1px solid hsl(var(--border)); border-radius: .5rem; font-size: .75rem; font-weight: 800; white-space: nowrap; background: hsl(var(--card)); }
  .control:hover { background: hsl(var(--accent)); }
  .control.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: transparent; }
  :is(button, a, input):focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 4px; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  input { background: transparent; color: hsl(var(--foreground)); min-height: 2.75rem; min-width: 0; width: 100%; font-size: .875rem; }
  input::placeholder { color: hsl(var(--muted-foreground)); }
  h3 { font-size: 1.0625rem; font-weight: 900; letter-spacing: -.02em; }
  .message { padding: .875rem 1rem; margin: 0 0 1rem; border-radius: .5rem; background: hsl(var(--muted)); font-size: .8125rem; }
  .error { border-inline-start: 3px solid hsl(var(--theme)); }
  .link-form { margin: 1.25rem 0 0; padding: 0; background: transparent; border-radius: 0; }
  .link-form label { display: block; font-size: .8125rem; font-weight: 800; margin-bottom: .5rem; }
  .link-form > div { display: flex; flex-wrap: wrap; gap: .625rem; }
  .link-form input { flex: 1; min-width: 11.25rem; border-bottom: 1px solid hsl(var(--border)); }
  .link-form p { font-size: .6875rem; color: hsl(var(--muted-foreground)); margin-top: .75rem; line-height: 1.6; }
  .add-layer { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 1.5rem; }
  .add-scrim { position: absolute; inset: 0; background: hsl(var(--background) / .72); border: 0; }
  .add-dialog { position: relative; width: min(32.5rem, 100%); max-height: min(88vh, 45rem); overflow: auto; padding: 1.5rem; border: 1px solid hsl(var(--border)); border-radius: .75rem; background: hsl(var(--card)); color: hsl(var(--card-foreground)); }
  .add-dialog h3 { font-size: 1.375rem; margin-bottom: .5rem; }
  .add-dialog > p { color: hsl(var(--muted-foreground)); font-size: .8125rem; line-height: 1.6; }
  .catalog-link { margin-top: 1rem; }
  .add-local { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1.125rem; }
  .batch { margin-top: 1.125rem; padding-top: 1rem; border-top: 1px solid hsl(var(--border)); }
  .batch ul { margin: .625rem 0 .875rem; padding-left: 1.125rem; font-size: .8125rem; }
  .batch span { color: hsl(var(--muted-foreground)); font-size: .6875rem; }
  .batch-errors { color: hsl(var(--muted-foreground)); font-size: .75rem; margin-bottom: .75rem; }
  .text-close { display: block; margin-top: 1rem; min-height: 2.5rem; font-size: .75rem; font-weight: 800; text-decoration: underline; text-underline-offset: 4px; }
  .text-close.inline { display: inline; margin: 0 0 0 .375rem; min-height: 0; }
  .empty { min-height: 15rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .75rem; text-align: center; color: hsl(var(--muted-foreground)); }
  .empty p { font-size: .8125rem; }
  /* Narrower pages keep one header row with icon-only actions. */
  @container (max-width: 56rem) {
    .pill { width: 2.375rem; padding: 0; justify-content: center; }
    .pill span { display: none; }
  }
  /* Phones: search gets a row of its own under the title and actions. */
  @container (max-width: 36rem) {
    .store-head { flex-wrap: wrap; gap: .75rem .25rem; }
    h2 { flex: 1; }
    .head-actions { margin-left: auto; }
    .pill { background: transparent; color: hsl(var(--foreground) / .85); }
    .search { order: 1; flex: 1 1 100%; max-width: none; height: 2.625rem; margin: 0; }
  }
</style>
