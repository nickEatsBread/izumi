<script module lang="ts">
  import type { ThemeListing } from '$lib/store/themes'
  // The last loaded listings: returning from a preview reopens the theme page at once, so the
  // screenshot can shrink back into its viewer instead of waiting on the stores.
  let lastListings: { listings: ThemeListing[]; cached: boolean } | null = null
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { goto } from '$app/navigation'
  import Search from '@lucide/svelte/icons/search'
  import Palette from '@lucide/svelte/icons/palette'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import { page } from '$app/state'
  import ThemeBrowse from '$lib/components/themes/ThemeBrowse.svelte'
  import ThemeDetail from '$lib/components/themes/ThemeDetail.svelte'
  import { collectLocalThemes, prepareRelease, prepareThemeLink } from '$lib/themes/catalog'
  import { THEME_API, SUPPORTED_THEME_APIS, THEME_CATALOG_PROJECT_URL, THEME_CATALOG_URL, THEME_SCREENS, newerVersion, primaryPlatform, shotsFor, type PreparedTheme, type ThemePlatform, type ThemeRelease, type ThemeScreen } from '$lib/themes/packages'
  import { installedThemes, installTheme, applyInstalledTheme, removeInstalledTheme, rollbackTheme, previewTheme, type InstalledTheme } from '$lib/themes/installed'
  import { newestSeriesId, screenRoute } from '$lib/themes/preview-routes'
  import { stepIntoPreview } from '$lib/themes/preview-transition'
  import { cwSnapshot } from '$lib/player/continue-watching'
  import { allStores } from '$lib/store/feeds'
  import { findStoreThemeRelease, loadThemeListings } from '$lib/store/themes'
  import { themeStudioOpen } from '$lib/settings/theme-studio-session'
  import { activeStudioThemeId, studioThemes } from '$lib/settings/theme-studio'
  import { themePreset } from '$lib/settings/ui'
  import { protectedSurface, themeSafeMode } from '$lib/themes/safe-mode'
  import { themeCssStatus } from '$lib/theme'
  import { navLayer } from '$lib/nav/overlay'

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
  // Platform filter: a listing without `platforms` serves both layouts, so it stays under every filter.
  let platform = $state<'all' | ThemePlatform>('all')
  const PLATFORMS: { id: 'all' | ThemePlatform; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'desktop', label: 'Desktop' }, { id: 'phone', label: 'Phone' }]
  const forPlatform = (entry: ThemeRelease) => platform === 'all' || !entry.platforms?.length || entry.platforms.includes(platform)
  const filtered = $derived(entries.filter(entry => forPlatform(entry) && `${entry.name} ${entry.author} ${entry.description} ${entry.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())))
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
  const startScreen = $derived(THEME_SCREENS.find(screen => screen === page.url.searchParams.get('screen')) ?? null)
  const startPlatform = $derived((['desktop', 'phone'] as const).find(option => option === page.url.searchParams.get('platform')) ?? null)

  function useListings(result: { listings: ThemeListing[]; cached: boolean }) {
    listingFor = new Map(result.listings.map((listing) => [listing.release, listing]))
    entries = result.listings.map((listing) => listing.release)
    cached = result.cached
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
  async function preview(screen: ThemeScreen, from: HTMLImageElement | null) {
    if (!prepared || $themeStudioOpen) return
    const target = prepared
    await stepIntoPreview(from, () => previewTheme(target), screenRoute(screen, newestSeriesId(get(cwSnapshot))))
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
    return entry ? shotsFor(entry, primaryPlatform(entry))[0]?.url : undefined
  }
</script>

<svelte:head><title>Themes · izumi</title></svelte:head>
<div class="themes-page" data-theme-protected use:protectedSurface>
  <header class="page-heading"><div><p class="eyebrow">Make it yours</p><h2 data-settings-page-title>Themes</h2><p class="intro">A different look. Still your client.</p></div><a class="control gap-2" href="/app/settings/theme-studio" data-focusable><Palette size={16} aria-hidden="true" /> Theme Studio</a></header>
  {#if $themeStudioOpen}<p class="message">Finish or discard your Theme Studio draft before applying another theme.</p>{/if}
  {#if $themeSafeMode}<p class="message">Safe mode is on: izumi's default appearance is showing until you turn themes back on or restart. <button type="button" class="text-close inline" data-focusable onclick={() => themeSafeMode.set(false)}>Turn themes back on</button></p>{/if}
  {#if $themeCssStatus.state === 'rejected'}<p role="alert" class="message error">The active theme's stylesheet was not applied: {$themeCssStatus.reason}</p>{/if}
  <div class="toolbar"><nav aria-label="Theme library"><button type="button" data-focusable aria-pressed={tab === 'browse'} onclick={() => { tab = 'browse'; leaveDetail() }}>Browse</button><button type="button" data-focusable aria-pressed={tab === 'installed'} onclick={() => { tab = 'installed'; leaveDetail() }}>Installed <span>{$installedThemes.length}</span></button></nav><div class="toolbar-actions"><button class="control" data-focusable onclick={() => { showAdd = true; error = '' }}>Add theme</button></div></div>
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
  {#if error}<p role="alert" class="message error">{error}</p>{/if}
  {#if notice}<p role="status" class="message">{notice}</p>{/if}
  {#if selected || prepared}
    {#key selectedKey || prepared?.package.id}
      <ThemeDetail release={selected ?? prepared?.release ?? null} {prepared} storeName={selected ? listingFor.get(selected)?.storeName ?? '' : ''} {busy} {canInstall}
        installLabel={currentInstall ? canInstall ? 'Update & apply' : 'Installed' : 'Install & apply'} locked={$themeStudioOpen} conflict={originConflict}
        {startScreen} {startPlatform} onback={back} oninstall={install} onpreview={preview} />
    {/key}
  {:else if tab === 'browse'}
    <div class="browse-tools"><label class="search"><Search size={18} /><input bind:value={query} aria-label="Search themes" placeholder="Search themes, authors or styles" data-focusable /></label><div class="platform-filter" role="group" aria-label="Show themes for">{#each PLATFORMS as option (option.id)}<button type="button" data-focusable aria-pressed={platform === option.id} onclick={() => platform = option.id}>{option.label}</button>{/each}</div><button class="control" data-focusable disabled={loading} onclick={() => refresh(true)}>Refresh</button></div>
    {#if cached}<p class="message">Showing the saved catalog. Refresh when you’re back online.</p>{/if}
    {#if loading && !entries.length}<div class="skeletons" aria-label="Loading themes" aria-busy="true">{#each [1, 2, 3] as item (item)}<div class="skeleton" aria-hidden="true"></div>{/each}</div>
    {:else if !filtered.length}<div class="empty"><Palette size={36} /><h3>{entries.length ? 'No matching themes' : 'Your next look starts here'}</h3><p>{entries.length ? 'Try another name or style.' : 'Refresh the catalog, or add a theme from a link, file or folder.'}</p></div>
    {:else}<ThemeBrowse listings={filteredListings} filtered={!!query.trim() || platform !== 'all'} official={THEME_CATALOG_URL} {platform} installed={(listing) => isInstalled(listing.release)} note={listingNote} onopen={open} />{/if}
  {:else}
    <div class="default-theme"><div><strong>Izumi default</strong><p>The original appearance is always available.</p></div><button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => { $themePreset = 'izumi'; notice = 'Default appearance restored.' }}>Use default</button></div>
    {#each $installedThemes as item (item.id)}{@const thumb = thumbOf(item)}<article class="installed-theme"><div class="installed-thumb">{#if thumb}<img src={thumb} alt="" loading="lazy" referrerpolicy="no-referrer" />{:else}<Palette size={22} />{/if}</div><div><h3>{item.package.name}</h3><p>By {item.package.author} · {item.package.version}{#if $themePreset === 'custom' && $activeStudioThemeId === item.designId} · Applied{/if}</p><p class="summary">{item.package.description}</p></div><div class="installed-actions"><button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => apply(item)}>Apply</button>{#if $allStores.some((store) => store.url === item.origin) || item.updateUrl}<button class="control" data-focusable disabled={busy || $themeStudioOpen} onclick={() => update(item)}>Check update</button>{/if}{#if item.previous}<button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => restore(item)}>Restore previous</button>{/if}<button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => remove(item)}>Remove</button></div></article>{/each}
    {#if !$installedThemes.length}<div class="empty"><Palette size={36} /><h3>A home for your themes</h3><p>Installed themes stay here, ready to use offline.</p><button class="control" data-focusable onclick={() => tab = 'browse'}>Browse themes</button></div>{/if}
  {/if}
</div>

<style>
  .themes-page { max-width: 1160px; padding: clamp(20px, 4vw, 40px); margin: auto; }
  .page-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 32px; }
  .eyebrow { color: hsl(var(--muted-foreground)); font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  h2 { font-size: clamp(28px, 4vw, 42px); font-weight: 900; letter-spacing: -.04em; line-height: 1.2; margin: 6px 0; }
  .intro { color: hsl(var(--muted-foreground)); font-size: 14px; line-height: 1.65; }
  .toolbar, .browse-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
  .toolbar { padding-bottom: 20px; border-bottom: 1px solid hsl(var(--border)); }
  nav, .toolbar-actions, .installed-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  nav button { min-height: 44px; padding: 10px 14px; font-weight: 800; border-bottom: 2px solid transparent; color: hsl(var(--muted-foreground)); }
  nav button[aria-pressed='true'] { color: hsl(var(--foreground)); border-color: hsl(var(--theme)); }
  nav span { font-size: 11px; margin-left: 5px; }
  .control { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 9px 14px; border: 1px solid hsl(var(--border)); border-radius: 8px; font-size: 12px; font-weight: 800; white-space: nowrap; background: hsl(var(--card)); }
  .control:hover { background: hsl(var(--accent)); }
  .control.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: transparent; }
  :is(button, a, input):focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 4px; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  .browse-tools { margin: 24px 0; }
  .search { display: flex; align-items: center; gap: 10px; color: hsl(var(--muted-foreground)); flex: 1; min-width: 180px; max-width: 420px; border-bottom: 1px solid hsl(var(--border)); }
  .platform-filter { display: flex; gap: 4px; padding: 3px; border-radius: 999px; background: hsl(var(--muted)); }
  .platform-filter button { min-height: 32px; padding: 0 14px; border-radius: 999px; font-size: 12px; font-weight: 800; color: hsl(var(--muted-foreground)); }
  .platform-filter button[aria-pressed="true"] { background: hsl(var(--background)); color: hsl(var(--foreground)); box-shadow: 0 1px 2px hsl(0 0% 0% / .2); }
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
</style>
