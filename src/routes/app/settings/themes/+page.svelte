<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import Search from '@lucide/svelte/icons/search'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import Palette from '@lucide/svelte/icons/palette'
  import { loadThemeCatalog, prepareRelease, prepareThemeLink } from '$lib/themes/catalog'
  import { MAX_THEME_BYTES, THEME_API, newerVersion, parseSharedTheme, type PreparedTheme, type ThemeRelease } from '$lib/themes/packages'
  import { installedThemes, installTheme, applyInstalledTheme, removeInstalledTheme, rollbackTheme, previewTheme, isCatalogTheme, type InstalledTheme } from '$lib/themes/installed'
  import { themeStudioOpen } from '$lib/settings/theme-studio-session'
  import { activeStudioThemeId, studioThemes } from '$lib/settings/theme-studio'
  import { themePreset } from '$lib/settings/ui'

  let tab = $state<'browse' | 'installed'>('browse')
  let entries = $state<ThemeRelease[]>([])
  let query = $state('')
  let loading = $state(true)
  let busy = $state(false)
  let error = $state('')
  let notice = $state('')
  let cached = $state(false)
  let selected = $state<ThemeRelease | null>(null)
  let prepared = $state<PreparedTheme | null>(null)
  let showLink = $state(false)
  let link = $state('')
  let fileInput: HTMLInputElement
  let abort: AbortController | undefined
  const filtered = $derived(entries.filter(entry => `${entry.name} ${entry.author} ${entry.description} ${entry.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())))
  const failure = (cause: unknown) => cause instanceof Error ? cause.message : 'The theme could not be loaded.'
  // Install state matches on id AND origin: a same-ID package from another location can never
  // replace this install, so it must not drive the version comparison or the Update button.
  const currentInstall = $derived(prepared ? $installedThemes.find(item => item.id === prepared?.package.id && item.origin === prepared.origin) : undefined)
  const originConflict = $derived(!!prepared && $installedThemes.some(item => item.id === prepared?.package.id && item.origin !== prepared.origin))
  const canInstall = $derived(!originConflict && (!currentInstall || !!prepared && (newerVersion(prepared.package.version, currentInstall.package.version) || prepared.package.version === currentInstall.package.version && !$studioThemes.some(theme => theme.id === currentInstall.designId))))

  async function refresh() {
    abort?.abort(); const request = new AbortController(); abort = request; loading = true; error = ''
    try { const result = await loadThemeCatalog(request.signal); if (!request.signal.aborted) { entries = result.catalog.themes; cached = result.cached } }
    catch (cause) { if (!request.signal.aborted) error = failure(cause) }
    finally { if (abort === request) loading = false }
  }
  onMount(() => { void refresh(); return () => abort?.abort() })
  async function inspect(entry: ThemeRelease) {
    if (busy) return
    selected = entry; prepared = null; busy = true; error = ''; notice = ''
    try { prepared = await prepareRelease(entry) } catch (cause) { error = failure(cause) } finally { busy = false }
  }
  async function fromLink(event: SubmitEvent) {
    event.preventDefault(); if (busy) return
    busy = true; error = ''; selected = null; prepared = null
    try { prepared = await prepareThemeLink(link); showLink = false } catch (cause) { error = failure(cause) } finally { busy = false }
  }
  async function fromFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0]; input.value = ''
    if (!file || busy) return
    busy = true
    error = ''; selected = null; prepared = null
    try {
      if (file.size > MAX_THEME_BYTES) throw new Error('Use a theme package under 256 KB.')
      const pkg = parseSharedTheme(JSON.parse(await file.text()))
      prepared = { package: pkg, origin: `file:${pkg.id}` }
    } catch (cause) { error = failure(cause) } finally { busy = false }
  }
  function install() {
    if (!prepared) return
    try {
      const item = installTheme(prepared); applyInstalledTheme(item)
      notice = `${item.package.name} installed. Your personal edits are kept when updating.`
      prepared = null; selected = null; tab = 'installed'
    } catch (cause) { error = failure(cause) }
  }
  function preview() {
    if (!prepared || $themeStudioOpen) return
    previewTheme(prepared); void goto('/app/home')
  }
  async function update(item: InstalledTheme) {
    busy = true; error = ''; notice = ''
    try {
      if (isCatalogTheme(item)) {
        const { catalog } = await loadThemeCatalog()
        const entry = catalog.themes.find(entry => entry.id === item.id)
        if (!entry || !newerVersion(entry.version, item.package.version)) { notice = 'You have the latest listed version.'; return }
        selected = entry; prepared = await prepareRelease(entry)
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
</script>

<svelte:head><title>Themes · izumi</title></svelte:head>
<div class="themes-page">
  <header class="page-heading"><div><p class="eyebrow">Make it yours</p><h2>Themes</h2><p class="intro">A different look. Still your client.</p></div><a class="control gap-2" href="/app/settings/theme-studio" data-focusable><Palette size={16} aria-hidden="true" /> Theme Studio</a></header>
  {#if $themeStudioOpen}<p class="message">Finish or discard your Theme Studio draft before applying another theme.</p>{/if}
  <div class="toolbar"><nav aria-label="Theme library"><button type="button" data-focusable aria-pressed={tab === 'browse'} onclick={() => { tab = 'browse'; selected = null; prepared = null }}>Browse</button><button type="button" data-focusable aria-pressed={tab === 'installed'} onclick={() => { tab = 'installed'; selected = null; prepared = null }}>Installed <span>{$installedThemes.length}</span></button></nav><div class="toolbar-actions"><button class="control" data-focusable onclick={() => showLink = !showLink}>Add from link</button><button class="control" data-focusable onclick={() => fileInput.click()}>Import file</button></div></div>
  <input bind:this={fileInput} type="file" accept=".json,application/json" class="hidden" onchange={fromFile} aria-label="Import theme package" />
  {#if showLink}<form onsubmit={fromLink} class="link-form"><label for="theme-link">Theme package or release link</label><div><input id="theme-link" type="url" bind:value={link} required placeholder="https://…/theme.json" data-focusable /><button class="control primary" disabled={busy} data-focusable>Load theme</button></div><p>Public HTTPS links work even when a theme is not in the catalog.</p></form>{/if}
  {#if error}<p role="alert" class="message error">{error}</p>{/if}
  {#if notice}<p role="status" class="message">{notice}</p>{/if}
  {#if selected || prepared}
    <section class="theme-detail" aria-busy={busy}>
      <button class="back" data-focusable disabled={busy} onclick={() => { selected = null; prepared = null; error = '' }}><ArrowLeft size={16} /> Back to themes</button>
      <div class="detail-grid"><div class="preview-image">{#if selected?.preview}<img src={selected.preview} alt={`${selected.name} layout preview`} referrerpolicy="no-referrer" />{:else}<Palette size={72} strokeWidth={1} />{/if}</div><div><p class="eyebrow">{prepared?.package.author ?? selected?.author}</p><h3>{prepared?.package.name ?? selected?.name}</h3><p class="description">{prepared?.package.description ?? selected?.description}</p><p class="version">Version {prepared?.package.version ?? selected?.version} · Desktop & mobile</p>
        {#if prepared}<div class="theme-actions"><button class="control" data-focusable disabled={$themeStudioOpen || !canInstall} onclick={preview}>Preview in client</button><button class="control primary" data-focusable disabled={$themeStudioOpen || !canInstall} onclick={install}>{currentInstall ? canInstall ? 'Update & apply' : 'Installed' : 'Install & apply'}</button></div>{#if originConflict}<p class="detail-hint">A theme with this ID is already installed from a different source. Remove it there before installing this one.</p>{:else}<p class="detail-hint">You can edit this theme in Theme Studio after installing it.</p>{/if}{:else if busy}<p role="status">Checking theme package…</p>{/if}
      </div></div>
    </section>
  {:else if tab === 'browse'}
    <div class="browse-tools"><label class="search"><Search size={18} /><input bind:value={query} aria-label="Search themes" placeholder="Search themes, authors or styles" data-focusable /></label><button class="control" data-focusable disabled={loading} onclick={refresh}>Refresh</button></div>
    {#if cached}<p class="message">Showing the saved catalog. Refresh when you’re back online.</p>{/if}
    {#if loading && !entries.length}<div class="theme-grid" aria-label="Loading themes" aria-busy="true">{#each [1, 2, 3] as item}<div class="skeleton" aria-hidden="true"></div>{/each}</div>
    {:else if !filtered.length}<div class="empty"><Palette size={36} /><h3>{entries.length ? 'No matching themes' : 'Your next look starts here'}</h3><p>{entries.length ? 'Try another name or style.' : 'Refresh the catalog or add a theme using its link.'}</p></div>
    {:else}<div class="theme-grid">{#each filtered as entry (entry.id)}<article><button class="theme-card" data-focusable disabled={busy || entry.themeApi !== THEME_API} onclick={() => inspect(entry)}><div class="thumbnail">{#if entry.preview}<img src={entry.preview} alt={`${entry.name} layout preview`} loading="lazy" referrerpolicy="no-referrer" />{:else}<Palette size={42} />{/if}</div><div class="card-title"><h3>{entry.name}</h3>{#if $installedThemes.some(item => item.id === entry.id)}<span>Installed</span>{/if}</div><p class="author">By {entry.author}</p><p class="summary">{entry.description}</p><p class="tags">{entry.themeApi !== THEME_API ? 'Requires a different theme API' : entry.tags.join(' · ')}</p></button></article>{/each}</div>{/if}
  {:else}
    <div class="default-theme"><div><strong>Izumi default</strong><p>The original appearance is always available.</p></div><button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => { $themePreset = 'izumi'; notice = 'Default appearance restored.' }}>Use default</button></div>
    {#each $installedThemes as item (item.id)}<article class="installed-theme"><div><h3>{item.package.name}</h3><p>By {item.package.author} · {item.package.version}{#if $themePreset === 'custom' && $activeStudioThemeId === item.designId} · Applied{/if}</p><p class="summary">{item.package.description}</p></div><div class="installed-actions"><button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => apply(item)}>Apply</button>{#if isCatalogTheme(item) || item.updateUrl}<button class="control" data-focusable disabled={busy || $themeStudioOpen} onclick={() => update(item)}>Check update</button>{/if}{#if item.previous}<button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => restore(item)}>Restore previous</button>{/if}<button class="control" data-focusable disabled={$themeStudioOpen} onclick={() => remove(item)}>Remove</button></div></article>{/each}
    {#if !$installedThemes.length}<div class="empty"><Palette size={36} /><h3>A home for your themes</h3><p>Installed themes stay here, ready to use offline.</p><button class="control" data-focusable onclick={() => tab = 'browse'}>Browse themes</button></div>{/if}
  {/if}
</div>

<style>
  .themes-page { max-width: 1160px; padding: clamp(20px, 4vw, 40px); margin: auto; }
  .page-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 32px; }
  .eyebrow { color: hsl(var(--muted-foreground)); font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  h2 { font-size: clamp(28px, 4vw, 42px); font-weight: 900; letter-spacing: -.04em; line-height: 1.2; margin: 6px 0; }
  .intro, .description { color: hsl(var(--muted-foreground)); font-size: 14px; line-height: 1.65; }
  .toolbar, .browse-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
  .toolbar { padding-bottom: 20px; border-bottom: 1px solid hsl(var(--border)); }
  nav, .toolbar-actions, .theme-actions, .installed-actions { display: flex; flex-wrap: wrap; gap: 8px; }
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
  input { background: transparent; color: hsl(var(--foreground)); min-height: 44px; min-width: 0; width: 100%; font-size: 14px; }
  input::placeholder { color: hsl(var(--muted-foreground)); }
  .theme-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 245px), 1fr)); gap: 28px 22px; }
  .theme-card { width: 100%; text-align: start; }
  .thumbnail, .preview-image { aspect-ratio: 16 / 10; display: grid; place-items: center; overflow: hidden; border-radius: 10px; background: hsl(var(--muted)); }
  img { width: 100%; height: 100%; object-fit: cover; }
  .theme-card .thumbnail { transition: transform 160ms; }
  .theme-card:hover .thumbnail { transform: translateY(-3px); }
  .card-title { display: flex; gap: 12px; align-items: baseline; justify-content: space-between; margin-top: 14px; }
  h3 { font-size: 17px; font-weight: 900; letter-spacing: -.02em; }
  .card-title span, .author, .tags, .version { color: hsl(var(--muted-foreground)); font-size: 11px; }
  .author { margin-top: 3px; }
  .summary { font-size: 12px; line-height: 1.6; margin-top: 8px; color: hsl(var(--muted-foreground)); }
  .tags { margin-top: 12px; }
  .message { padding: 14px 16px; margin: 16px 0; border-radius: 8px; background: hsl(var(--muted)); font-size: 13px; }
  .error { border-inline-start: 3px solid hsl(var(--theme)); }
  .link-form { margin: 20px 0; padding: 20px; background: hsl(var(--card)); border-radius: 10px; }
  .link-form label { display: block; font-size: 13px; font-weight: 800; margin-bottom: 8px; }
  .link-form > div { display: flex; flex-wrap: wrap; gap: 10px; }
  .link-form input { flex: 1; min-width: 180px; border-bottom: 1px solid hsl(var(--border)); }
  .link-form p, .detail-hint { font-size: 11px; color: hsl(var(--muted-foreground)); margin-top: 12px; line-height: 1.6; }
  .empty { min-height: 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; color: hsl(var(--muted-foreground)); }
  .empty p { font-size: 13px; }
  .skeleton { aspect-ratio: 16 / 10; background: hsl(var(--muted)); border-radius: 10px; }
  .back { display: flex; align-items: center; gap: 8px; font-size: 12px; min-height: 44px; margin: 14px 0; }
  .detail-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 28px; align-items: center; }
  .theme-detail h3 { font-size: 30px; margin: 10px 0; }
  .version { margin: 16px 0; }
  .default-theme, .installed-theme { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px; padding: 24px 0; border-bottom: 1px solid hsl(var(--border)); }
  .installed-theme > div:first-child { flex: 1; min-width: 180px; }
  .default-theme p, .installed-theme p { color: hsl(var(--muted-foreground)); font-size: 12px; margin-top: 5px; }
  @media(max-width: 800px) { .detail-grid { grid-template-columns: 1fr; } }
  @media(prefers-reduced-motion: reduce) { .theme-card .thumbnail { transition: none; } }
</style>
