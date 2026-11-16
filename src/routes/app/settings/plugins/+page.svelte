<script module lang="ts">
  import type { PluginListing } from '$lib/store/plugins'
  import type { LoadedStore } from '$lib/store/load'
  // The last loaded listings: coming back to the page shows the gallery at once instead of waiting on
  // the stores.
  let lastListings: { listings: PluginListing[]; cached: boolean; loaded: Record<string, LoadedStore> } | null = null
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte'
  import { afterNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import { invoke } from '@tauri-apps/api/core'
  import Search from '@lucide/svelte/icons/search'
  import Plus from '@lucide/svelte/icons/plus'
  import Store from '@lucide/svelte/icons/store'
  import Puzzle from '@lucide/svelte/icons/puzzle'
  import SettingsSwitch from '$lib/components/settings/SettingsSwitch.svelte'
  import StoresDialog from '$lib/components/store/StoresDialog.svelte'
  import PluginGrid from '$lib/components/plugins/PluginGrid.svelte'
  import PluginPane from '$lib/components/plugins/PluginPane.svelte'
  import {
    installedElsewhere, installedPlugins, installPlugin, pluginsEnabled, preparePlugin, preparePluginFromUrl, removePlugin,
    setPluginEnabled, type InstalledPlugin, type PreparedPlugin,
  } from '$lib/plugins/registry'
  import { pluginConformance } from '$lib/plugins/host'
  import { pluginKey, pluginNote, pluginOriginLabel, pluginSections, pluginUpdatable, type PluginEntry } from '$lib/plugins/sections'
  import { loadPluginListings } from '$lib/store/plugins'
  import { allStores } from '$lib/store/feeds'
  import { forgetScroll } from '$lib/navigation/scroll-restoration'
  import { navLayer } from '$lib/nav/overlay'
  import { focusByNav } from '$lib/nav'
  import { controllerMode } from '$lib/nav/input'
  import { gameMode } from '$lib/player/session'
  import { isTv } from '$lib/platform'
  import { protectedSurface } from '$lib/themes/safe-mode'

  // A gallery like the Themes page (Installed, then a section per store, filtered by chips and search)
  // whose cards open a plugin's own page through the URL: `?store=&plugin=` for a store's plugin,
  // `?plugin=` for one installed from a link or file, and `?plugin=loose` for one loaded but not
  // installed yet. Install on that page is the consent to the permissions it lists.
  const pad = $derived($gameMode || $isTv || $controllerMode)
  const LOOSE = 'loose'
  let listings = $state.raw<PluginListing[]>([])
  let loaded = $state.raw<Record<string, LoadedStore>>({})
  let query = $state('')
  // The chip: 'all' or a section id.
  let filter = $state('all')
  let loading = $state(true)
  let cached = $state(false)
  let error = $state('')
  let notice = $state('')
  let busy = $state(false)
  let showStores = $state(false)
  let showAdd = $state(false)
  let link = $state('')
  let files = $state<HTMLInputElement | undefined>()
  let addError = $state('')
  let loose = $state.raw<PreparedPlugin | null>(null)
  // Checked plugins by key: a listing's (to install it) or a newer version of an install.
  let preparedBy = $state.raw(new Map<string, PreparedPlugin>())
  let preparing = $state('')
  let message = $state<{ text: string; error: boolean } | null>(null)
  // Whether this page pushed the open plugin's history entry, so Back can pop it.
  let pushed = false
  let refocus = ''

  const failure = (cause: unknown) => cause instanceof Error ? cause.message : 'The plugin could not be loaded.'
  const sections = $derived(pluginSections($installedPlugins, listings, query))
  const chips = $derived(pluginSections($installedPlugins, listings).map(({ id, title }) => ({ id, title })))
  const shown = $derived(filter === 'all' ? sections : sections.filter((section) => section.id === filter))
  // Every plugin, search or not: the open one may sit outside the filtered list.
  const everything = $derived(pluginSections($installedPlugins, listings).flatMap((section) => section.entries))
  const entryOf = (key: string) => everything.find((entry) => entry.key === key) ?? null
  const originOf = (entry: PluginEntry) => entry.installed?.origin ?? entry.listing?.origin ?? ''
  const fromOf = (entry: PluginEntry) => pluginOriginLabel(originOf(entry), $allStores)

  const current = $derived.by(() => {
    const id = page.url.searchParams.get('plugin')
    if (!id) return ''
    if (id === LOOSE) return loose ? LOOSE : ''
    const storeId = page.url.searchParams.get('store')
    const origin = storeId ? $allStores.find((store) => store.id === storeId)?.url : $installedPlugins.find((item) => item.manifest.id === id)?.origin
    const key = origin ? pluginKey(origin, id) : ''
    return entryOf(key) ? key : ''
  })
  const open = $derived(!!current)
  const entry = $derived(current === LOOSE ? null : entryOf(current))
  const install = $derived(entry?.installed)
  const prepared = $derived(current === LOOSE ? loose : preparedBy.get(current) ?? null)
  const elsewhere = $derived(prepared && !install ? installedElsewhere(prepared, $installedPlugins) : undefined)
  const note = $derived(entry ? pluginNote(entry) : '')
  const updatable = $derived(!!entry && pluginUpdatable(entry))
  const primary = $derived.by(() => {
    if (install && updatable) return { label: 'Update', disabled: busy || !prepared, run: installPrepared }
    if (install) return { label: install.enabled ? 'Turn off' : 'Turn on', disabled: false, run: () => setPluginEnabled(install.manifest.id, !install.enabled) }
    if (note) return { label: note, disabled: true, run: () => {} }
    return { label: 'Install', disabled: busy || !prepared || !!elsewhere, run: installPrepared }
  })
  const hint = $derived(elsewhere
    ? `${elsewhere.manifest.name} is already installed from ${pluginOriginLabel(elsewhere.origin, $allStores)}. Remove it there before installing this copy.`
    : install && prepared && prepared.grantHash !== install.grantHash ? 'This version asks for different permissions. Check them below before you update.' : '')

  async function fetchText(target: string) {
    const reply = await invoke<{ status: number; body: string }>('http_get', { url: target, requestId: crypto.randomUUID(), timeoutMs: 20_000, maxBytes: 3 * 1024 * 1024 })
    if (reply.status < 200 || reply.status >= 300) throw new Error(`${target} answered ${reply.status}.`)
    return reply.body
  }

  function useListings(result: { listings: PluginListing[]; cached: boolean; loaded: Record<string, LoadedStore> }) {
    listings = result.listings
    cached = result.cached
    loaded = result.loaded
  }
  async function refresh(force = false) {
    if (lastListings && !force && !listings.length) useListings(lastListings)
    loading = true; error = ''
    try {
      const result = await loadPluginListings({ force })
      lastListings = result
      useListings(result)
      if (!result.listings.length && result.errors.length) error = result.errors[0]
    } catch (cause) { error = failure(cause) }
    finally { loading = false }
  }
  onMount(() => { void refresh() })

  // An open listing is checked once (plugin.json against the listing, the code against plugin.json),
  // when it isn't installed or the store has a newer version; dropped if the page closes first.
  $effect(() => {
    const key = current
    const item = key && key !== LOOSE ? entryOf(key) : null
    const listing = item?.listing
    if (!item || !listing || pluginNote(item) || (item.installed && !pluginUpdatable(item)) || untrack(() => preparedBy.has(key))) return
    let live = true
    preparing = key
    const pin = { origin: listing.origin, sha256: listing.install.sha256, bytes: listing.install.bytes, id: listing.entry.id, version: listing.entry.version }
    preparePluginFromUrl(listing.install.url, fetchText, pin)
      .then((result) => { preparedBy = new Map(preparedBy).set(key, result) })
      .catch((cause) => { if (live && current === key) message = { text: failure(cause), error: true } })
      .finally(() => { if (preparing === key) preparing = '' })
    return () => { live = false }
  })

  function paramsFor(key: string): URLSearchParams {
    const item = entryOf(key)
    const store = item ? $allStores.find((candidate) => candidate.url === originOf(item)) : undefined
    const id = item?.installed?.manifest.id ?? item?.listing?.entry.id ?? key
    return new URLSearchParams(store ? { store: store.id, plugin: id } : { plugin: id })
  }
  function onopen(item: PluginEntry) {
    message = null; pushed = true
    const url = new URL(`?${paramsFor(item.key)}`, page.url)
    // A plugin page opened from the gallery starts at its top, never at a scroll remembered for it.
    forgetScroll(url)
    void goto(url)
  }
  function focusCard(key: string) {
    const card = document.querySelector<HTMLElement>(`[data-plugin-grid] [data-plugin-key="${CSS.escape(key)}"]`)
    if (card) focusByNav(card, true)
  }
  // Back to the gallery, on the card that was open.
  function back() {
    refocus = current; message = null
    if (pushed) { pushed = false; history.back() } else void goto(page.url.pathname, { replaceState: true })
  }
  afterNavigate(() => {
    // A controller opening a plugin lands on its main action; the gallery gets the card back.
    if (page.url.searchParams.has('plugin')) {
      if (pad) void tick().then(() => { const target = document.querySelector<HTMLElement>('[data-plugin-primary]'); if (target) focusByNav(target, true) })
      return
    }
    if (!refocus) return
    const key = refocus
    refocus = ''
    void tick().then(() => focusCard(key))
  })

  function closeAdd() { showAdd = false; addError = '' }
  function showLoose(item: PreparedPlugin) {
    loose = item; closeAdd(); link = ''
    message = null; pushed = true
    void goto(`?${new URLSearchParams({ plugin: LOOSE })}`)
  }
  async function fromLink(event: SubmitEvent) {
    event.preventDefault(); if (busy) return
    busy = true; addError = ''
    try { showLoose(await preparePluginFromUrl(link.trim(), fetchText)) } catch (cause) { addError = failure(cause) } finally { busy = false }
  }
  /** For plugin authors: plugin.json and its main file, picked from disk. */
  async function fromFiles() {
    addError = ''
    const list = [...(files?.files ?? [])]
    const manifestFile = list.find((file) => file.name === 'plugin.json')
    try {
      if (!manifestFile) throw new Error('Pick plugin.json together with its .js file.')
      const manifestText = await manifestFile.text()
      const mainName = JSON.parse(manifestText)?.main?.path
      const main = list.find((file) => file.name === mainName)
      if (!main) throw new Error(`Pick ${mainName ?? 'the main file'} too.`)
      showLoose(await preparePlugin(manifestText, await main.text(), 'file'))
    } catch (cause) { addError = failure(cause) }
    if (files) files.value = ''
  }

  async function installPrepared() {
    if (!prepared || busy) return
    const updating = !!install
    const key = current
    busy = true; message = null
    try {
      const item = await installPlugin(prepared)
      const next = new Map(preparedBy)
      next.delete(key)
      preparedBy = next
      if (key === LOOSE) { loose = null; void goto(`?${paramsFor(pluginKey(item.origin, item.manifest.id))}`, { replaceState: true, keepFocus: true, noScroll: true }) }
      message = { text: `${item.manifest.name} ${updating ? 'updated' : 'installed'}.${$pluginsEnabled ? '' : ' Turn on plugins at the top of this page to run it.'}`, error: false }
    } catch (cause) { message = { text: failure(cause), error: true } } finally { busy = false }
  }
  async function remove(item: InstalledPlugin) {
    const key = pluginKey(item.origin, item.manifest.id)
    busy = true
    try {
      await removePlugin(item.manifest.id)
      notice = `${item.manifest.name} removed.`
      message = null
      // A plugin its store still lists keeps its page, now with Install; otherwise back to the gallery.
      if (current === key && !entryOf(key)) {
        if (pushed) { pushed = false; history.back() } else void goto(page.url.pathname, { replaceState: true })
      }
    } catch (cause) { message = { text: failure(cause), error: true } } finally { busy = false }
  }
</script>

<svelte:head><title>Plugins · izumi</title></svelte:head>
<div class="plugins-page" data-theme-protected use:protectedSurface>
  <input bind:this={files} type="file" multiple accept=".json,.js,.mjs" class="hidden" onchange={fromFiles} aria-label="Pick plugin.json and its .js file" />
  {#if showAdd}
    <div class="add-layer">
      <button type="button" class="add-scrim" tabindex="-1" aria-label="Close add plugin" onclick={closeAdd}></button>
      <!-- A nav layer: Escape, B and remote Back close only this dialog, and the d-pad stays inside it. -->
      <div data-nav-scroll-container class="add-dialog" role="dialog" aria-modal="true" aria-labelledby="add-plugin-title" data-nav-trap data-nav-escape use:navLayer={{ kind: 'plugins-add', onClose: closeAdd }}>
        <h3 id="add-plugin-title">Add a plugin</h3>
        <p>Plugins from a store are under its section. To add one that isn't, paste the https link to its plugin.json.</p>
        <form onsubmit={fromLink} class="link-form">
          <label for="plugin-link">plugin.json link</label>
          <div><input id="plugin-link" type="url" bind:value={link} required placeholder="https://…/plugin.json" data-focusable /><button class="control primary" disabled={busy || !link.trim()} data-focusable>Load link</button></div>
        </form>
        <p class="small">For plugin authors: <button type="button" class="text-close inline" data-focusable onclick={() => files?.click()}>pick plugin.json and its .js file</button>.</p>
        {#if addError}<p role="alert" class="message error">{addError}</p>{/if}
        <button class="text-close" data-focusable onclick={closeAdd}>Cancel</button>
      </div>
    </div>
  {/if}
  {#if showStores}
    <!-- The shared store manager: add any store link; its plugins get their own section. izumi's own
         stores are built in and can be hidden, not removed. -->
    <StoresDialog {loaded} onclose={() => { showStores = false; void refresh(true) }} onadded={() => { notice = 'Store added. Its plugins are in their own section.' }} />
  {/if}

  {#if !open}
    <header class="store-head">
      <h2 data-settings-page-title>Plugins</h2>
      <label class="search"><Search size={16} aria-hidden="true" /><input bind:value={query} aria-label="Search plugins" placeholder="Search plugins" data-focusable /></label>
      <div class="head-actions">
        <button type="button" class="pill" data-focusable aria-label="Stores" title="Stores" onclick={() => showStores = true}><Store size={16} aria-hidden="true" /><span>Stores</span></button>
        <button type="button" class="pill" data-focusable aria-label="Add plugin" title="Add plugin" onclick={() => { showAdd = true; addError = '' }}><Plus size={16} aria-hidden="true" /><span>Add plugin</span></button>
      </div>
    </header>
    <p class="intro">Plugins add features to izumi. Each runs in a sandbox with no access to your accounts, sources or files, and can only do what you allow when you install it.</p>
  {/if}
  <section class="beta">
    <div>
      <h3>Enable plugins (beta)</h3>
      <p>Off by default. Turning it off stops every plugin.</p>
      {#if $pluginConformance && !$pluginConformance.ok}
        <p class="failed">Plugins are switched off on this device: the sandbox did not block {$pluginConformance.failed.join(', ')}.</p>
      {/if}
    </div>
    <SettingsSwitch value={$pluginsEnabled} onToggle={() => ($pluginsEnabled = !$pluginsEnabled)} label="Enable plugins (beta)" />
  </section>
  {#if !open && chips.length > 1}
    <div class="chips" role="group" aria-label="Show" data-nav-scroll-x>
      {#each [{ id: 'all', title: 'All' }, ...chips] as chip (chip.id)}<button type="button" data-focusable aria-pressed={filter === chip.id} onclick={() => filter = chip.id}>{chip.title}</button>{/each}
    </div>
  {/if}
  {#if !open && cached}<p class="message">Showing the saved stores. <button type="button" class="text-close inline" data-focusable disabled={loading} onclick={() => refresh(true)}>Refresh</button> when you’re back online.</p>{/if}
  {#if !open && error}<p role="alert" class="message error">{error}</p>{/if}
  {#if notice}<p role="status" class="message">{notice}</p>{/if}
  {#if open}
    <PluginPane {entry} {prepared} from={entry ? fromOf(entry) : pluginOriginLabel(prepared?.origin ?? '', $allStores)}
      enabledAll={$pluginsEnabled} busy={busy || preparing === current} {primary} {hint} {message}
      onback={back} onremove={install ? () => void remove(install) : undefined} />
  {:else if shown.length || loading}
    <PluginGrid sections={shown} loading={loading && !listings.length} {fromOf} {onopen} />
  {:else}
    <div class="empty"><Puzzle size={36} /><h3>{query ? 'No matching plugins' : 'No plugins yet'}</h3><p>{query ? 'Try another name.' : 'Add a store, or a plugin from its link.'}</p></div>
  {/if}
</div>

<style>
  /* A size container: the layout follows the page's own width, which the settings rail narrows. */
  .plugins-page { max-width: 1240px; padding: clamp(1.25rem, 3vw, 2.25rem); margin: auto; container-type: inline-size; }
  .store-head { display: flex; align-items: center; gap: .75rem 1rem; margin-bottom: .75rem; }
  h2 { font-size: 1.875rem; font-weight: 900; letter-spacing: -.035em; line-height: 1; margin: 0 .5rem 0 0; }
  .head-actions { display: flex; align-items: center; gap: .5rem; }
  .search { display: flex; flex: 1 1 auto; max-width: 22rem; min-width: 7.5rem; align-items: center; gap: .5rem; height: 2.375rem; padding: 0 .875rem; border-radius: 999px; background: hsl(var(--foreground) / .07); color: hsl(var(--muted-foreground)); margin-right: auto; }
  .search input { min-height: 0; height: 100%; font-size: .8125rem; }
  .pill { display: inline-flex; align-items: center; gap: .4375rem; height: 2.375rem; padding: 0 .875rem; border-radius: 999px; font-size: .75rem; font-weight: 800; white-space: nowrap; background: hsl(var(--foreground) / .07); transition: background-color .15s ease; }
  .pill:hover { background: hsl(var(--foreground) / .12); }
  .intro { max-width: 42rem; margin-bottom: 1rem; font-size: .8125rem; line-height: 1.6; color: hsl(var(--muted-foreground)); }
  .beta { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; padding: .875rem 1rem; border-radius: .875rem; background: hsl(var(--foreground) / .045); }
  .beta h3 { font-size: .875rem; }
  .beta p { margin-top: .25rem; font-size: .8125rem; color: hsl(var(--muted-foreground)); }
  .beta .failed { color: hsl(var(--destructive)); }
  /* Section chips: one row that scrolls sideways when it runs out of room. */
  .chips { display: flex; gap: .5rem; margin-bottom: 1.75rem; overflow-x: auto; scrollbar-width: none; padding: .25rem; margin-inline: -.25rem; }
  .chips button { flex: none; height: 2.125rem; padding: 0 .9375rem; border-radius: 999px; font-size: .8125rem; font-weight: 800; background: hsl(var(--foreground) / .07); color: hsl(var(--muted-foreground)); transition: background-color .15s ease, color .15s ease; }
  .chips button:hover { color: hsl(var(--foreground)); background: hsl(var(--foreground) / .12); }
  .chips button[aria-pressed='true'] { background: hsl(var(--foreground)); color: hsl(var(--background)); }
  /* The controller pane is already a padded, scrolling card. */
  :global([data-settings-controller]) .plugins-page { padding: 0; }
  .control { display: inline-flex; align-items: center; justify-content: center; min-height: 2.625rem; padding: .5625rem .875rem; border: 1px solid hsl(var(--border)); border-radius: .5rem; font-size: .75rem; font-weight: 800; white-space: nowrap; background: hsl(var(--card)); }
  .control:hover { background: hsl(var(--accent)); }
  .control.primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: transparent; }
  :is(button, input):focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 4px; }
  button:disabled { opacity: .45; cursor: not-allowed; }
  input { background: transparent; color: hsl(var(--foreground)); min-height: 2.75rem; min-width: 0; width: 100%; font-size: .875rem; }
  input::placeholder { color: hsl(var(--muted-foreground)); }
  h3 { font-size: 1.0625rem; font-weight: 900; letter-spacing: -.02em; }
  .message { padding: .875rem 1rem; margin: 0 0 1rem; border-radius: .5rem; background: hsl(var(--muted)); font-size: .8125rem; }
  .error { border-inline-start: 3px solid hsl(var(--theme)); }
  .link-form { margin: 1.25rem 0 0; }
  .link-form label { display: block; font-size: .8125rem; font-weight: 800; margin-bottom: .5rem; }
  .link-form > div { display: flex; flex-wrap: wrap; gap: .625rem; }
  .link-form input { flex: 1; min-width: 11.25rem; border-bottom: 1px solid hsl(var(--border)); }
  .add-layer { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 1.5rem; }
  .add-scrim { position: absolute; inset: 0; background: hsl(var(--background) / .72); border: 0; }
  .add-dialog { position: relative; width: min(32.5rem, 100%); max-height: min(88vh, 45rem); overflow: auto; padding: 1.5rem; border: 1px solid hsl(var(--border)); border-radius: .75rem; background: hsl(var(--card)); color: hsl(var(--card-foreground)); }
  .add-dialog h3 { font-size: 1.375rem; margin-bottom: .5rem; }
  .add-dialog > p { color: hsl(var(--muted-foreground)); font-size: .8125rem; line-height: 1.6; }
  .add-dialog .small { margin-top: 1rem; font-size: .75rem; }
  .add-dialog .message { margin: 1rem 0 0; }
  .text-close { display: block; margin-top: 1rem; min-height: 2.5rem; font-size: .75rem; font-weight: 800; text-decoration: underline; text-underline-offset: 4px; }
  .text-close.inline { display: inline; margin: 0 0 0 .375rem; min-height: 0; }
  .add-dialog .text-close.inline { margin: 0; }
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
