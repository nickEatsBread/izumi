import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('themes settings add dialog', () => {
  it('opens a single add popup instead of inline link and file controls', () => {
    expect(page).toContain('Add theme')
    expect(page).toContain('role="dialog"')
    expect(page).toContain('aria-labelledby="add-theme-title"')
    expect(page).not.toContain('onclick={() => showLink = !showLink}')
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
  it('browses themes from every store and keeps each theme tied to its store', () => {
    expect(page).toContain('loadThemeListings')
    expect(page).not.toContain('loadThemeCatalog')
    expect(page).toContain('prepareRelease(entry, originOf(entry))')
    expect(page).toContain("page.url.searchParams.get('theme')")
    expect(page).toContain('item.id === entry.id && item.origin === originOf(entry)')
  })
})

describe('themes store front', () => {
  it('renders the storefront and the theme page from components', () => {
    expect(page).toContain('<ThemeBrowse')
    expect(page).toContain('<ThemeDetail')
  })
  it('opens a theme page through the URL and steps into its preview', () => {
    expect(page).toContain("goto(`?${new URLSearchParams({ store: store.id, theme: listing.release.id })}`)")
    expect(page).toContain('stepIntoPreview(from, () => previewTheme(target)')
  })
  it('lets people add other theme stores from the store header', () => {
    expect(page).toContain('<StoresDialog {loaded}')
    expect(page).toContain('onclick={() => showStores = true}')
  })
  it('shows screenshots for this device instead of a platform filter', () => {
    expect(page).not.toContain('PLATFORMS')
    expect(page).toContain("platformFor(entry, $isMobile ? 'phone' : 'desktop')")
  })
})
