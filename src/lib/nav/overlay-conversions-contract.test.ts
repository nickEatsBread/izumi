import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Settings fix pass, commit 3 (spec §3.3, §4): dropdowns and Settings overlays are nav layers
// (`use:navLayer`, src/lib/nav/overlay.ts), so Escape (one window capture), B and remote Back close
// only the top one. The rest stay legacy traps that B reaches as a window Escape. This is a source
// contract: this vitest config cannot mount Svelte components.

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

/** Markup only: script and style blocks and HTML comments are blanked (offsets kept), so prose and
 *  code never match an attribute search. */
const markup = (source: string) =>
  source.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, ' '))

/** The whole opening tag containing `index`: quote- and brace-aware, because attribute values hold
 *  arrow functions and object literals with `>` in them. */
function tagAt(source: string, index: number): string {
  const start = source.lastIndexOf('<', index)
  let depth = 0
  let quote = ''
  let i = start + 1
  for (; i < source.length; i++) {
    const char = source[i]
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === '>' && depth === 0) break
  }
  return source.slice(start, i + 1)
}

/** Opening tags (in markup) that contain `needle`. */
function tagsWith(source: string, needle: string): string[] {
  const text = markup(source)
  const tags: string[] = []
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) tags.push(tagAt(text, at))
  return tags
}

/** Opening tags that carry the bare attribute `name` (no value). */
function tagsWithBare(source: string, name: string): string[] {
  const text = markup(source)
  return [...text.matchAll(new RegExp(String.raw`\s${name}(?=[\s/>])`, 'g'))].map((match) => tagAt(text, match.index!))
}

const layerTags = (source: string) => tagsWith(source, 'use:navLayer={{')
const bare = (tag: string, name: string) => new RegExp(String.raw`\s${name}(?=[\s/>])`).test(tag)

const FILES = {
  selectMenu: '../components/settings/SelectMenu.svelte',
  multiSelect: '../components/search/MultiSelect.svelte',
  catalogSwitcher: '../components/catalog/CatalogSwitcher.svelte',
  settingsSearch: '../components/settings/SettingsSearch.svelte',
  addonConfigurator: '../components/settings/AddonConfigurator.svelte',
  serviceSettings: '../components/settings/ExtensionServiceSettings.svelte',
  tmdbGuide: '../components/catalog/TmdbCredentialGuide.svelte',
  jvmPreferences: '../components/catalog/JvmSourcePreferences.svelte',
  jvmFilters: '../components/catalog/JvmSourceFilters.svelte',
  storeEntry: '../components/store/StoreEntrySheet.svelte',
  storesDialog: '../components/store/StoresDialog.svelte',
  replacePackage: '../components/store/ReplacePackageDialog.svelte',
  storePage: '../../routes/app/settings/store/+page.svelte',
  trailer: '../components/cards/TrailerDialog.svelte',
  fileBrowser: '../components/cloud/FileBrowser.svelte',
  profileSwitcher: '../components/profiles/ProfileSwitcher.svelte',
  homeEditor: '../components/catalog/HomeEditor.svelte',
  degradedBanner: '../components/shell/AniListDegradedBanner.svelte',
  sources: '../../routes/app/settings/sources/+page.svelte',
  themes: '../../routes/app/settings/themes/+page.svelte',
  profiles: '../../routes/app/settings/profiles/+page.svelte',
  accounts: '../../routes/app/settings/accounts/+page.svelte',
  sync: '../../routes/app/settings/sync/+page.svelte',
} as const

/** Every layer node keeps the literal trap markers: hints.ts, page-tabs.ts and the button-hint bar
 *  detect an open dialog by a visible `[data-nav-trap]` (contract §1.7). */
function expectLayerMarkers(tag: string) {
  expect(bare(tag, 'data-nav-trap'), tag).toBe(true)
  expect(bare(tag, 'data-nav-escape'), tag).toBe(true)
}

describe('SelectMenu is a nav layer', () => {
  const source = read(FILES.selectMenu)

  it('makes each open panel a layer that closes only itself and scrolls inside itself', () => {
    const tags = layerTags(source)
    expect(tags).toHaveLength(3)
    for (const tag of tags) {
      expectLayerMarkers(tag)
      expect(bare(tag, 'data-nav-scroll-container'), tag).toBe(true)
      expect(tag).toContain("use:navLayer={{ kind: 'select-menu', onClose: closeMenu, initialFocus: 'none', returnFocus: 'none' }}")
    }
    expect(source).toContain("import { navLayer } from '$lib/nav/overlay'")
    // The root no longer traps: the layer panel is the trap, so the page-tabs/hints scope is the list.
    expect(source).toContain('<div bind:this={root} class="relative {className}">')
    expect(source).not.toMatch(/key === 'Escape'/)
    expect(source).toContain("if (reason === 'back') trigger.focus({ preventScroll: true })")
  })

  it('stops the arrows it handles, so the d-pad engine cannot step a second time', () => {
    const handler = source.slice(source.indexOf('function onMenuKeydown'), source.indexOf('onMount('))
    const filter = handler.indexOf("if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return")
    expect(filter).toBeGreaterThanOrEqual(0)
    expect(handler.indexOf('event.stopPropagation()')).toBeGreaterThan(filter)
  })

  it('opens a searchable list onto the current option for controller users', () => {
    expect(source).toContain('const controllerUi = $derived($gameMode || $isTv || $controllerMode)')
    expect(source).toContain('(searchable && !controllerUi ? searchInput : current ?? first)?.focus({ preventScroll: true })')
  })
})

describe('MultiSelect and CatalogSwitcher are nav layers', () => {
  it('makes both MultiSelect panels layers with their own scroller and a trigger to return to', () => {
    const source = read(FILES.multiSelect)
    const tags = layerTags(source)
    expect(tags).toHaveLength(2)
    for (const tag of tags) {
      expectLayerMarkers(tag)
      expect(bare(tag, 'data-nav-scroll-container'), tag).toBe(true)
      expect(tag).toContain("use:navLayer={{ kind: 'multi-select', onClose: closePanel, initialFocus: 'none', returnFocus: 'none' }}")
    }
    expect(source).toContain('bind:this={trigger}')
    expect(source).toContain("if (reason === 'back') trigger?.focus({ preventScroll: true })")
    // The document keydown never saw the pad's window-dispatched Escape; the layer capture replaces it.
    expect(source).not.toContain("addEventListener('keydown'")
    expect(source).not.toMatch(/key === 'Escape'/)
  })

  it('lands a pad or remote on the first ticked MultiSelect option, and only them', () => {
    const source = read(FILES.multiSelect)
    expect(source).toContain('aria-pressed={on}')
    expect(source).toContain('if (!focusRestoreAllowed()) return')
    expect(source).toContain(`panel?.querySelector<HTMLElement>('[aria-pressed="true"]')`)
  })

  it('makes the CatalogSwitcher panel the layer, not the whole switcher', () => {
    const source = read(FILES.catalogSwitcher)
    const tags = layerTags(source)
    expect(tags).toHaveLength(1)
    expectLayerMarkers(tags[0])
    expect(tags[0]).toContain("use:navLayer={{ kind: 'catalog-switcher', onClose: closeSwitcher, initialFocus: 'none', returnFocus: 'none' }}")
    expect(source).toContain('<div bind:this={root} class={className}>')
    expect(source).toContain("void setOpen(false, reason === 'back')")
    expect(source).not.toMatch(/key === 'Escape'/)
    const [list] = tagsWith(source, 'id="catalog-switcher-options"')
    expect(bare(list, 'data-nav-scroll-container'), list).toBe(true)
  })
})

describe('Settings overlays are nav layers', () => {
  const OVERLAYS: Array<{ file: string; kind: string; veto?: string; options?: string[] }> = [
    { file: FILES.settingsSearch, kind: 'settings-search', options: ["initialFocus: 'none'", "returnFocus: 'none'"] },
    { file: FILES.addonConfigurator, kind: 'addon-configurator', veto: 'if (busy) return false', options: ["initialFocus: 'always'"] },
    { file: FILES.serviceSettings, kind: 'extension-service-settings', veto: 'if (saving) return false', options: ["initialFocus: 'none'", "returnFocus: 'none'"] },
    { file: FILES.tmdbGuide, kind: 'tmdb-guide', options: ["initialFocus: 'none'", "returnFocus: 'none'"] },
    { file: FILES.jvmPreferences, kind: 'jvm-source-preferences', veto: 'if (saving) return false' },
  ]

  it.each(OVERLAYS)('$kind closes through its layer alone, with no second Escape path', ({ file, kind, veto, options }) => {
    const source = read(file)
    const tags = layerTags(source)
    expect(tags).toHaveLength(1)
    const [tag] = tags
    expectLayerMarkers(tag)
    expect(tag).toContain(`kind: '${kind}'`)
    if (veto) expect(tag).toContain(veto)
    for (const option of options ?? []) expect(tag).toContain(option)
    expect(tag).not.toContain('onkeydown=')
    expect(source).toContain("import { navLayer } from '$lib/nav/overlay'")
    expect(source).not.toContain('<svelte:window')
    expect(source).not.toMatch(/key === 'Escape'/)
  })

  it('keeps the settings search scrim off the d-pad and its results in their own scroller', () => {
    const source = read(FILES.settingsSearch)
    expect(layerTags(source)[0]).toContain('use:portal')
    const [scrim] = tagsWith(source, 'aria-label="Close settings search"')
    expect(scrim).toContain('tabindex="-1"')
    const [results] = tagsWith(source, 'class="min-h-0 overflow-y-auto bg-card p-2"')
    expect(bare(results, 'data-nav-scroll-container'), results).toBe(true)
  })

  it('lets the layer focus the add-on configurator instead of the dialog box', () => {
    expect(read(FILES.addonConfigurator)).not.toContain('dialogEl')
  })

  it('marks the dialog bodies as the scrollers the d-pad reveals within', () => {
    const bodies: Array<[string, string]> = [
      [FILES.serviceSettings, 'class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"'],
      [FILES.tmdbGuide, 'class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6"'],
      [FILES.jvmPreferences, 'class="min-h-0 flex-1 overflow-y-auto px-5 py-4"'],
    ]
    for (const [file, className] of bodies) {
      const [body] = tagsWith(read(file), className)
      expect(bare(body, 'data-nav-scroll-container'), `${file}: ${body}`).toBe(true)
    }
  })
})

describe('Store sheets are nav layers', () => {
  const SHEETS: Array<{ file: string; kind: string; veto?: string; scroller: boolean }> = [
    { file: FILES.storeEntry, kind: 'store-entry', veto: 'if (busy) return false', scroller: true },
    { file: FILES.storesDialog, kind: 'stores-dialog', veto: 'if (busy) return false', scroller: true },
    { file: FILES.replacePackage, kind: 'replace-package', scroller: false },
  ]

  it.each(SHEETS)('$kind closes through its layer alone', ({ file, kind, veto, scroller }) => {
    const source = read(file)
    const tags = layerTags(source)
    expect(tags).toHaveLength(1)
    const [tag] = tags
    // store-components.test.ts pins this exact pair.
    expect(tag).toContain('data-nav-trap data-nav-escape')
    expect(tag).toContain(`kind: '${kind}'`)
    if (veto) expect(tag).toContain(veto)
    expect(bare(tag, 'data-nav-scroll-container')).toBe(scroller)
    expect(source).toContain("import { navLayer } from '$lib/nav/overlay'")
    expect(source).not.toContain('<svelte:window')
    expect(source).not.toMatch(/key === 'Escape'/)
  })

  it('opens a store link preview only after the replace navigation that drops ?add= lands', () => {
    // The app layout's beforeNavigate closes every nav layer when a navigation starts (commit 2), so
    // a StoresDialog mounted before this replace would be closed by it at once.
    const source = read(FILES.storePage)
    const effect = source.slice(source.indexOf("const add = page.url.searchParams.get('add')"), source.indexOf('onMount(() => {'))
    const replace = effect.indexOf('void goto(url, { replaceState: true, noScroll: true, keepFocus: true })')
    expect(replace).toBeGreaterThanOrEqual(0)
    expect(effect.indexOf(".then(() => { storesDialog = { mode: 'add', url: add } })")).toBeGreaterThan(replace)
    expect(effect.match(/storesDialog = /g)).toHaveLength(1)
  })
})

describe('Sources popovers, Themes Add and the trailer are nav layers', () => {
  it('makes Sources Sort and Filter layers and drops the page-level Escape', () => {
    const source = read(FILES.sources)
    const tags = layerTags(source)
    expect(tags).toHaveLength(2)
    const [sort, filter] = tags
    for (const tag of tags) expectLayerMarkers(tag)
    expect(sort).toContain('role="menu"')
    expect(sort).toContain("use:navLayer={{ kind: 'sources-sort', onClose: () => { sortOpen = false } }}")
    expect(filter).toContain('aria-label="Source filters"')
    expect(filter).toContain("use:navLayer={{ kind: 'sources-filter', onClose: () => { filterOpen = false } }}")
    expect(source).toContain("import { navLayer } from '$lib/nav/overlay'")
    expect(source).not.toContain('<svelte:window')
    expect(source).not.toMatch(/key === 'Escape'/)
  })

  it('makes the Themes Add dialog a layer with a scrim the d-pad skips', () => {
    const source = read(FILES.themes)
    const tags = layerTags(source)
    expect(tags).toHaveLength(1)
    expectLayerMarkers(tags[0])
    expect(tags[0]).toContain('class="add-dialog" role="dialog"')
    expect(tags[0]).toContain("use:navLayer={{ kind: 'themes-add', onClose: closeAdd }}")
    // A <section> cannot carry role="dialog" without an a11y warning; the dialog is a <div> now.
    expect(source).not.toContain('<section class="add-dialog"')
    const [scrim] = tagsWith(source, 'aria-label="Close add theme"')
    expect(scrim).toContain('tabindex="-1"')
    expect(source).not.toMatch(/key === 'Escape'/)
  })

  it('makes the trailer dialog a layer, so B and remote Back close it', () => {
    const source = read(FILES.trailer)
    const tags = layerTags(source)
    expect(tags).toHaveLength(1)
    expect(tags[0].startsWith('<dialog')).toBe(true)
    expectLayerMarkers(tags[0])
    expect(tags[0]).toContain("use:navLayer={{ kind: 'trailer', onClose: () => closeTrailerPopup(), returnFocus: 'none' }}")
    // Keyboard Escape still has the native cancel as a fallback (trailer-dialog.test.ts pins it).
    expect(source).toContain('oncancel={(e) => { e.preventDefault(); closeTrailerPopup() }}')
  })
})

describe('legacy traps close on B and Escape', () => {
  const LEGACY = [FILES.jvmFilters, FILES.fileBrowser, FILES.profiles, FILES.profileSwitcher, FILES.homeEditor, FILES.degradedBanner]

  it.each(LEGACY)('%s: every trap opts into data-nav-escape and has one window Escape', (file) => {
    const source = read(file)
    const traps = tagsWithBare(source, 'data-nav-trap')
    expect(traps.length).toBeGreaterThan(0)
    for (const trap of traps) {
      expect(bare(trap, 'data-nav-escape'), trap).toBe(true)
      expect(trap).not.toContain('onkeydown=')
    }
    expect(source).toContain('<svelte:window onkeydown=')
  })

  it('routes the pad B to the Aniyomi source filters through advanced-close', () => {
    const source = read(FILES.jvmFilters)
    expect(source).toContain("window.addEventListener('advanced-close', close)")
    expect(source).toContain("window.removeEventListener('advanced-close', close)")
    expect(source.match(/key === 'Escape'/g)).toHaveLength(1)
  })

  it('closes the cloud file list on Escape', () => {
    expect(read(FILES.fileBrowser)).toContain("if (event.key === 'Escape' && $cloudFiles) { event.preventDefault(); cloudFiles.set(null) }")
  })

  it('scrolls the Profiles screens inside themselves and marks a locked switcher for the exit prompt', () => {
    const [profiles] = tagsWithBare(read(FILES.profiles), 'data-nav-trap')
    expect(bare(profiles, 'data-nav-scroll-container'), profiles).toBe(true)
    const [switcher] = tagsWithBare(read(FILES.profileSwitcher), 'data-nav-trap')
    expect(bare(switcher, 'data-nav-scroll-container'), switcher).toBe(true)
    // An attribute set to `false` would still render (as "false") and match [data-nav-back-exit].
    expect(switcher).toContain("data-nav-back-exit={$activeProfileLocked && !pending ? '' : undefined}")
  })

  it('keeps the Home editor section picker pin (escape after class=)', () => {
    expect(read(FILES.homeEditor)).toContain('data-nav-trap class="pointer-events-auto')
  })
})

describe('page tab strips for the theme bumpers (data-page-tabs, Themes page-tabs.ts)', () => {
  it('marks the Sources tablist, whose active tab is aria-selected', () => {
    const source = read(FILES.sources)
    const [strip] = tagsWith(source, 'role="tablist"')
    expect(bare(strip, 'data-page-tabs'), strip).toBe(true)
    expect(source).toContain('aria-selected={activeTab === tab.id}')
  })

  it('marks the Accounts and Sync section navs, whose active item is aria-current', () => {
    const accounts = read(FILES.accounts)
    const [accountsNav] = tagsWith(accounts, 'aria-label="Account settings sections"')
    expect(bare(accountsNav, 'data-page-tabs'), accountsNav).toBe(true)
    expect(accounts).toContain("aria-current={section === item.id ? 'page' : undefined}")
    const sync = read(FILES.sync)
    const [syncNav] = tagsWith(sync, 'aria-label="Device sync sections"')
    expect(bare(syncNav, 'data-page-tabs'), syncNav).toBe(true)
    expect(sync).toContain("aria-current={syncSection === item.id ? 'page' : undefined}")
  })
})
