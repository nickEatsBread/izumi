import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SEARCH_INDEX } from '$lib/settings/search'
import { settingsSection } from '$lib/settings/sections'
import { renderedSettingKeys, sectionOf, subcategoriesOf } from '../../../../test/settings-sections'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (relative: string) => readFileSync(here(relative), 'utf8').replace(/\r\n/g, '\n')
const file = here('./+page.svelte')
const source = read('./+page.svelte')
const subcategories = subcategoriesOf(file)
/** The markup of one subcategory block. */
const block = (id: string) => subcategories.find((sub) => sub.id === id)?.source ?? ''

/** Every row key P1C puts on this page, with the subcategory that renders it. */
const ROWS: Record<string, string> = {
  'catalog-platform-auto': 'home',
  'default-catalog-platform': 'home',
  'continue-watching': 'home',
  'remove-from-continue-watching': 'home',
  'tmdb-token': 'home',
  'omdb-key': 'home',
  'episode-list-layout': 'layouts',
  'browse-layout': 'layouts',
  'schedule-layout': 'layouts',
  'default-schedule-tab': 'layouts',
  'show-next-up-on-the-schedule': 'layouts',
  'rating-style': 'ratings',
  'show-rating-on-the-series-page': 'ratings',
  'hide-spoilers': 'ratings',
  'episode-airing-notifications': 'notifications',
  'save-watch-history-on-this-device': 'history',
  'incognito-mode': 'history',
  'import-export-history': 'history',
  'watched-history': 'history',
  'scene-bookmarks': 'scenes',
  'saved-scenes': 'scenes',
  'episode-queue': 'features',
  'catalog-switcher-placement': 'advanced',
  'per-extension-catalogs': 'advanced',
  'series-wide-episode-numbers': 'advanced',
  'pin-schedule-header': 'advanced',
}
const COMPONENTS: Record<string, { tag: string; file: string }> = {
  history: { tag: '<HistorySettings />', file: '../../../../lib/components/settings/HistorySettings.svelte' },
  scenes: { tag: '<SceneBookmarkSettings />', file: '../../../../lib/components/settings/SceneBookmarkSettings.svelte' },
}

describe('Home and library section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('library')
    expect(source).not.toContain('data-settings-page-title')
  })

  it('renders the registry subcategories in order with Advanced last', () => {
    const ids = subcategories.map((sub) => sub.id)
    expect(ids).toEqual(['home', 'layouts', 'ratings', 'notifications', 'history', 'scenes', 'features', 'advanced'])
    expect(ids).toEqual(settingsSection('library').subcategories.map((sub) => sub.id))
  })

  it('folds Advanced behind a summary of its first rows, and folds nothing else', () => {
    expect(subcategories.at(-1)).toMatchObject({
      id: 'advanced',
      summary: 'Catalog switcher, series-wide numbers, pinned schedule header',
      collapsible: false,
      plain: false,
    })
    expect(subcategories.filter((sub) => sub.collapsible || sub.summary !== undefined).map((sub) => sub.id)).toEqual(['advanced'])
  })

  it('renders every moved row key through the page and its components', () => {
    const keys = renderedSettingKeys(file)
    for (const key of Object.keys(ROWS)) if (key !== 'catalog-platform-auto') expect(keys, key).toContain(key)
  })

  it.each(Object.entries(ROWS))('%s sits in %s and search sends it there', (key, subcategory) => {
    const owner = COMPONENTS[subcategory]
    if (owner) {
      expect(block(subcategory)).toContain(owner.tag)
      expect(read(owner.file)).toContain(`settingKey="${key}"`)
    } else if (key === 'catalog-platform-auto') {
      expect(block(subcategory)).toContain('settingKey={`catalog-platform-${platform.id}`}')
    } else {
      expect(block(subcategory)).toContain(`settingKey="${key}"`)
    }
    const entries = SETTINGS_SEARCH_INDEX.filter((item) => item.key === key)
    expect(entries.length, key).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry, key).toMatchObject({ section: 'library', subcategory, href: '/app/settings/library' })
      expect(entry.advanced === true, key).toBe(subcategory === 'advanced')
    }
  })

  it('uses value rows instead of card grids, chips, selects and old toggles', () => {
    expect(source).not.toContain('aria-pressed=')
    expect(source).not.toContain('<SelectMenu')
    expect(source).not.toContain('<Toggle')
    expect(source).not.toContain('SettingsGroup')
    expect(source).not.toMatch(/text-\[1[01]px\]/)
    for (const text of [...source.matchAll(/\sdescription="([^"]*)"/g)].map((match) => match[1])) {
      expect(text.length, text).toBeLessThanOrEqual(80)
    }
  })

  it('keeps the rating preview under its row', () => {
    const style = source.indexOf('settingKey="rating-style"')
    const preview = source.indexOf('Preview — try it')
    expect(style).toBeGreaterThan(-1)
    expect(preview).toBeGreaterThan(style)
    expect(source.indexOf('settingKey="show-rating-on-the-series-page"')).toBeGreaterThan(preview)
    expect(source).toContain('<ScoreScale value={ratingDemo} onpick={(n) => (ratingDemo = n)} />')
  })

  it('shows the desktop schedule layout only where the desktop schedule reads it', () => {
    expect(source).toMatch(/\{#if !\$isMobile && !\$isTv && !\$gameMode\}\s*<SettingsChoiceRow\s+settingKey="schedule-layout"/)
    expect(SETTINGS_SEARCH_INDEX.find((item) => item.key === 'schedule-layout')?.hideOn).toEqual(['phone', 'tv', 'gamemode'])
  })

  it('asks for notification permission from the switch', () => {
    expect(source).toContain('onActivate={toggleAiringNotifications}')
    expect(source).toContain('await setAiringNotificationsEnabled(!$airingNotifications)')
    expect(source).toContain('{#if $airingNotifications}')
  })

  it('links the Home editor and collections sub-pages', () => {
    expect(source).toContain('href={`/app/settings/library/home?provider=${homeCustomizeProvider}`}')
    expect(source).toContain('href="/app/settings/library/collections"')
  })

  it('treats Merged as a Home destination instead of a global experience mode', () => {
    expect(source).toContain('label: isMergedScreen(id) ? catalogLabel(id, $customScreens)')
    expect(source).toContain('selectCatalogScreen(value)')
    expect(source).toContain('<SettingsSubcategory id="screens">')
    expect(source).toContain('<CatalogScreensSettings />')
    expect(source).not.toContain('onChange={setCatalogMode}')
    expect(source).not.toContain('settingKey="catalog-mode"')
  })

  it('puts provider connections before catalog behaviour controls', () => {
    expect(source.indexOf('<CatalogPlatformRow')).toBeLessThan(source.indexOf('settingKey="default-catalog-platform"'))
  })

  it('offers every platform as an independently enabled row', () => {
    for (const id of ['auto', 'anilist', 'kitsu', 'tmdb', 'stremio', 'jvm']) expect(source).toContain(`id: '${id}'`)
    expect(source).toContain('platform={platform.id}')
    expect(source).toContain('onToggle={() => togglePlatform(platform.id)}')
  })

  it('keeps at least one platform enabled and repairs the default and active platforms', () => {
    expect(source).toContain('if (turningOff && current.length === 1) return')
    expect(source).toContain("$catalogDefaultProvider === 'adaptive'")
    expect(source).toContain('const fallback = resolveCatalogStartup(nextDefault')
    expect(source).toContain('if (!nextScreens.includes($catalogScreen)) selectCatalogProvider(fallback)')
  })

  it('offers the default platform from the enabled choices', () => {
    expect(source).toContain('title="Default Home"')
    expect(source).toContain('options={defaultOptions}')
    expect(source).toContain('onChange={setDefaultPlatform}')
    expect(source).toContain("{ value: 'adaptive', label: 'Adaptive · last selected' }")
    expect(source).toContain("if (value === 'adaptive')")
    expect(source).toContain('if (isMergedScreen(value) && catalogScreens($catalogProviders, $customScreens).includes(value))')
  })

  it('lets Continue Watching stay provider-specific or combine every platform', () => {
    expect(source).toContain('title="Continue Watching"')
    expect(source).toContain("{ value: 'provider', label: 'Current platform only' }")
    expect(source).toContain("{ value: 'all', label: 'All platforms' }")
    expect(source).toContain('value={$continueWatchingCatalogScope}')
    expect(source).toContain('onChange={setContinueWatchingScope}')
  })

  it('shows provider-specific configuration whenever that provider is enabled', () => {
    expect(source).toContain("{#if hasPlatform('tmdb') || collectionsUseTmdb}")
    expect(source).toContain("{#if hasPlatform('stremio')}")
    expect(source).toContain("{#if hasPlatform('jvm')}")
  })

  it('keeps the TMDB guide, keyless switch and attribution', () => {
    expect(source).toContain('How to get a free token')
    expect(source).toContain('showTmdbGuide = true')
    expect(source).toContain('<TmdbCredentialGuide')
    expect(source).toContain('function useKeylessCatalog()')
    expect(source).toContain('replaceAddonBase($addonUrls, undefined, CINEMETA_BASE)')
    expect(source).toContain("provider !== 'tmdb' && provider !== 'stremio'")
    expect(source).toContain("selectCatalogProvider('stremio')")
    expect(source).toContain('onUseKeyless={useKeylessCatalog}')
    expect(source).toContain('This product uses the TMDB API but is not endorsed or certified by TMDB.')
  })

  it('offers optional critic-rating enrichment as a credential row', () => {
    expect(source).toContain('Rotten Tomatoes, Metacritic, IMDb vote counts')
    expect(source).toContain('https://www.omdbapi.com/apikey.aspx')
    expect(source).toContain('bind:value={$omdbApiKey}')
    expect(source).toContain("value={$omdbApiKey ? 'Saved · hidden' : 'Not set'}")
  })

  it('opens the TMDB credential row while no token is saved', () => {
    expect(source).toContain('let tmdbOpen = $state(!$tmdbReadToken)')
  })

  it('filters extension catalog providers independently with their source artwork', () => {
    expect(source).toContain('installedJvmCatalogSources')
    expect(source).toContain('JvmCatalogSourceRow')
    expect(source).toContain('isJvmCatalogSourceEnabled(source.id, $jvmCatalogSourceOverrides)')
    expect(source).toContain('onToggle={() => toggleJvmSource(source.id)}')
    expect(source).toContain('onSettings={() => (configuringJvmSource = source)}')
    expect(source).toContain('<JvmSourcePreferences')
  })

  it('starts the extension runtime only once Advanced unfolds', () => {
    expect(block('advanced')).toContain('bind:open={advancedOpen}')
    expect(source).toContain("if (!advancedOpen || !hasPlatform('jvm') || jvmSourcesLoaded || jvmSourcesLoading) return")
  })
})
