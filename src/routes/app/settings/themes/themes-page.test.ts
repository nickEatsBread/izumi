import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const page = read('./+page.svelte')
const pane = read('../../../../lib/components/themes/ThemePane.svelte')
const grid = read('../../../../lib/components/themes/ThemeGrid.svelte')

describe('themes settings add dialog', () => {
  it('opens a single add popup instead of inline link and file controls', () => {
    expect(page).toContain('Add theme')
    expect(page).toContain('role="dialog"')
    expect(page).toContain('aria-labelledby="add-theme-title"')
  })
  it('links the community catalog and accepts a URL, file or folder', () => {
    expect(page).toContain('THEME_CATALOG_PROJECT_URL')
    expect(page).toContain('Open izumi-themes catalog')
    expect(page).toContain('Import file')
    expect(page).toContain('Import folder')
    expect(page).toContain('webkitdirectory')
    expect(page).toContain('collectLocalThemes')
    expect(page).toContain('Install all')
  })
  it('lets people add other theme stores from the header', () => {
    expect(page).toContain('<StoresDialog {loaded}')
    expect(page).toContain('onclick={() => showStores = true}')
  })
})

describe('themes gallery and theme page', () => {
  it('is one gallery with section chips, no Discover / Installed tabs', () => {
    expect(page).toContain('<ThemeGrid sections={shown}')
    expect(page).not.toContain('Discover')
    expect(page).toContain('themeSections($installedThemes, listings, THEME_CATALOG_URL, query)')
    expect(page).toContain("const shown = $derived(filter === 'all' ? sections : sections.filter((section) => section.id === filter))")
  })
  it('opens a theme as its own page through the URL, at its top, and Back returns to the same card', () => {
    expect(grid).toContain('onclick={() => onopen(entry)}')
    expect(page).toContain('forgetScroll(url)')
    expect(page).toContain("const key = themeId ? keyFromUrl(page.url.searchParams.get('store'), themeId) : ''")
    expect(page).toContain('void tick().then(() => focusCard(key))')
  })
  it('browses every store and keeps each theme tied to its store', () => {
    expect(page).toContain('loadThemeListings')
    expect(page).toContain('prepareRelease(listing.release, listing.origin, undefined, controller.signal)')
    expect(page).toContain('item.id === prepared.package.id && item.origin !== prepared.origin')
  })
  it('lands a controller on the main action of an opened theme', () => {
    expect(page).toContain("if (pad) void tick().then(() => { const target = document.querySelector<HTMLElement>('[data-theme-primary]'); if (target) focusByNav(target, true) })")
  })
  it('jumps straight into a preview, with no scripted transition', () => {
    expect(page).toContain('previewTheme(prepared)\n    void goto(screenRoute(screen, newestSeriesId(get(cwSnapshot))))')
    expect(page).not.toContain('preview-transition')
  })
  it('never disables the focused action: Apply turning into Applied keeps a controller on it', () => {
    expect(pane).toContain('aria-disabled={primary.disabled || undefined} onclick={() => { if (!primary.disabled) primary.run() }}')
    expect(pane).not.toMatch(/data-theme-primary[^>]*\sdisabled=/)
  })
  it('opens an install\'s other actions from More or ☰', () => {
    expect(page).toContain('<OptionsSheet')
    expect(page).toContain('window.addEventListener(PAGE_OPTIONS_EVENT, claim)')
    expect(page).toContain('onmore={install ? () => sheetFor = install : undefined}')
  })
  it('never covers a screenshot with text, lifts cards instead of outlining them, and moves with CSS only', () => {
    expect(grid).toContain('.card:hover .shot, .card:focus-visible .shot { transform: translateY(-.25rem);')
    expect(grid).not.toMatch(/\.card:hover[^{]*\{[^}]*outline/)
    expect(pane).toContain('.stage > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .3s ease; }')
    for (const source of [pane, grid]) expect(source).not.toContain('gm-motion')
  })
})
