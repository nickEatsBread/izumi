import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const layout = read('./+layout.svelte')
const css = read('../../../app.css')

/** Each settings page's leading title as it reads with the marker (spec §5.4). Collections marks its
 *  "← Catalog" link too: on the phone the back-header replaces both. */
const PAGE_TITLES: Array<[string, string]> = [
  ['player/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Player</h2>'],
  ['subtitles/+page.svelte', '<h2 data-settings-page-title class="mb-2 text-3xl font-bold tracking-tight">Subtitles</h2>'],
  ['hotkeys/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Hotkeys</h2>'],
  ['store/+page.svelte', '<h2 data-settings-page-title class="text-xl font-black">Store</h2>'],
  ['catalog/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Catalog</h2>'],
  ['catalog/home/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Customize Home</h2>'],
  ['catalog/collections/+page.svelte', '<a data-settings-page-title href="/app/settings/catalog" data-focusable class="text-sm text-muted-foreground">← Catalog</a>'],
  ['catalog/collections/+page.svelte', '<h1 data-settings-page-title class="mt-3 text-2xl font-black">Collections & covers</h1>'],
  ['sources/+page.svelte', '<h2 data-settings-page-title class="text-xl font-black">Sources</h2>'],
  ['sources/priority/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Source priority</h2>'],
  ['downloads/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Downloads</h2>'],
  ['storage/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Storage</h2>'],
  ['interface/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">{m.settings_interface()}</h2>'],
  ['themes/+page.svelte', '<h2 data-settings-page-title>Themes</h2>'],
  ['navigation/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Navigation</h2>'],
  ['history/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">History</h2>'],
  ['scenes/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Scene bookmarks</h2>'],
  ['sync/+page.svelte', '<h2 data-settings-page-title class="mb-2 text-3xl font-bold tracking-tight">Device sync</h2>'],
  ['backup/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Backup &amp; restore</h2>'],
  ['accounts/+page.svelte', '<h2 data-settings-page-title class="text-3xl font-bold tracking-tight">Accounts</h2>'],
  ['network/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">Network</h2>'],
  ['changelog/+page.svelte', '<h1 data-settings-page-title class="text-xl font-bold">Changelog</h1>'],
  ['about/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">About</h2>'],
  ['about/license-information/+page.svelte', '<h2 data-settings-page-title class="mb-1 text-xl font-black">License Information</h2>'],
]

describe('phone settings titles', () => {
  it('shows the page title once, as the back-header h1 fed by the settings hierarchy', () => {
    // `childTitle` comes from the shared route table (settings/hierarchy.ts, wired in by commit 10).
    expect(layout).toContain('const childTitle = $derived(settingsPageTitle($page.url.pathname) ?? m.nav_settings())')
    expect(layout).toContain('<h1 class="text-lg font-black">{childTitle}</h1>')
    expect(layout).not.toContain('<span class="text-lg font-black">')
  })

  it("hides each page's own leading title inside the phone child only", () => {
    let hide: postcss.Rule | undefined
    postcss.parse(css).walkRules((rule) => {
      if (rule.selector === '.settings-child [data-settings-page-title]') hide = rule
    })
    expect(hide, '.settings-child [data-settings-page-title] rule').toBeDefined()
    expect(hide!.parent?.type).toBe('root')
    expect(hide!.toString()).toMatch(/display:\s*none/)
    expect(css).not.toContain('h2:first-child')
  })

  it.each(PAGE_TITLES)('%s marks its leading title', (page, title) => {
    expect(read(`./${page}`)).toContain(title)
  })

  it('marks one title per page (two on Collections)', () => {
    for (const page of new Set(PAGE_TITLES.map(([file]) => file))) {
      const expected = PAGE_TITLES.filter(([file]) => file === page).length
      expect(read(`./${page}`).split('data-settings-page-title').length - 1, page).toBe(expected)
    }
  })
})

describe('settings search reveal', () => {
  it('reveals the searched row from afterNavigate, never on a history step', () => {
    expect(layout).toContain("import { afterNavigate } from '$app/navigation'")
    expect(layout).toContain("import { SETTING_FALLBACK_PARAM, SETTING_PARAM } from '$lib/settings/search'")
    expect(layout).toContain("import { revealSetting } from '$lib/settings/search-target'")
    const start = layout.indexOf('afterNavigate((navigation) => {')
    const abort = layout.indexOf('revealAbort?.abort()', start)
    const popstate = layout.indexOf("if (navigation.type === 'popstate') return", start)
    const reveal = layout.indexOf('void revealSetting(key, url.searchParams.get(SETTING_FALLBACK_PARAM), controller.signal)', start)
    expect(start).toBeGreaterThan(-1)
    expect(abort).toBeGreaterThan(start)
    expect(popstate).toBeGreaterThan(abort)
    expect(reveal).toBeGreaterThan(popstate)
    expect(layout).toContain('onDestroy(() => revealAbort?.abort())')
  })

  it('drops the old retrying effect that only scrolled and tinted', () => {
    expect(layout).not.toContain("searchParams.get('setting')")
    expect(layout).not.toContain('settings-search-hit')
  })
})
