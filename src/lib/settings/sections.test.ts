import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LEGACY_SETTINGS_ROUTES, SETTINGS_GROUPS, SETTINGS_SECTIONS, SETTINGS_SECTION_CONTEXT, SETTINGS_SUB_PAGES,
  SUBCATEGORY_OPEN_EVENT, sectionForPath, settingsSection, subcategoryDef,
} from './sections'

const source = readFileSync(fileURLToPath(new URL('./sections.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

describe('settings section registry', () => {
  it('lists the five groups with their labels', () => {
    expect(SETTINGS_GROUPS).toEqual([
      { id: 'watch', label: 'Watch' },
      { id: 'library', label: 'Library' },
      { id: 'look', label: 'Look' },
      { id: 'you', label: 'You' },
      { id: 'system', label: 'System' },
    ])
  })

  it('lists the eleven sections in rail order, each in its group', () => {
    expect(SETTINGS_SECTIONS.map((section) => [section.id, section.group, section.title])).toEqual([
      ['playback', 'watch', 'Playback'],
      ['subtitles', 'watch', 'Subtitles'],
      ['languages', 'watch', 'Languages'],
      ['library', 'library', 'Home and library'],
      ['sources', 'library', 'Sources and store'],
      ['downloads', 'library', 'Downloads and storage'],
      ['appearance', 'look', 'Appearance'],
      ['accounts', 'you', 'Accounts and profiles'],
      ['devices', 'you', 'Devices and backup'],
      ['network', 'system', 'Network and P2P'],
      ['about', 'system', 'About'],
    ])
  })

  it('gives each section a one-word rail label, so neither rail cuts or wraps a name', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.railTitle)).toEqual([
      'Playback', 'Subtitles', 'Languages', 'Library', 'Sources', 'Downloads', 'Appearance', 'Accounts', 'Devices', 'Network', 'About',
    ])
    for (const section of SETTINGS_SECTIONS) expect(section.railTitle, section.id).not.toContain(' ')
  })

  it('routes each section to /app/settings/<id> with a short static subtitle and a Lucide icon name', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.iconName)).toEqual([
      'play', 'captions', 'languages', 'library', 'rss', 'download', 'palette', 'user', 'refresh-cw', 'globe', 'info',
    ])
    for (const section of SETTINGS_SECTIONS) {
      expect(section.href).toBe(`/app/settings/${section.id}`)
      expect(section.subtitle.length, section.id).toBeGreaterThan(0)
      expect(section.subtitle.length, section.id).toBeLessThanOrEqual(48)
    }
    expect(SETTINGS_SECTIONS.map((section) => section.subtitle)).toEqual([
      'Autoplay, skipping and the player',
      'Style, saved styles and providers',
      'App, audio, subtitle and source languages',
      'Platforms, Home, layouts and history',
      'Add, manage and order sources',
      'Offline library, folder and caches',
      'Theme, accessibility and navigation',
      'Trackers, keys and household profiles',
      'Device sync, TV connections and backups',
      'P2P limits, DNS and VPN',
      'Version, changelog and licences',
    ])
  })

  it('splits every section into its subcategories, Advanced last and flagged', () => {
    expect(SETTINGS_SECTIONS.map((section) => [section.id, section.subcategories.map((sub) => `${sub.id}: ${sub.title}`)])).toEqual([
      ['playback', ['up-next: Up next and autoplay', 'skipping: Skipping', 'seeking: Seeking and scrubbing', 'player-window: Player window', 'quality: Quality and sources', 'controls: Controls', 'advanced: Advanced']],
      ['subtitles', ['appearance: Appearance', 'styles: Saved styles', 'providers: Providers', 'advanced: Advanced']],
      ['languages', ['app: App and titles', 'playback: Audio and subtitles', 'sources: Sources and sub/dub', 'downloads: Downloads']],
      ['library', ['home: Platforms and Home', 'layouts: Layouts', 'ratings: Ratings and spoilers', 'notifications: Notifications', 'history: History', 'scenes: Scene bookmarks', 'features: Optional features', 'advanced: Advanced']],
      ['sources', ['my-sources: My sources', 'store: Store', 'debrid: Torrent and debrid', 'discussion: Discussion', 'priority: Priority', 'advanced: Advanced']],
      ['downloads', ['offline: Offline mode', 'folder: Folder and automatic downloads', 'storage: Storage and caches', 'advanced: Advanced']],
      ['appearance', ['theme: Theme', 'accessibility: Accessibility', 'navigation: Navigation', 'tv: TV layout', 'advanced: Advanced']],
      ['accounts', ['trackers: Trackers and lists', 'keys: Keys', 'profiles: Profiles', 'content: Content']],
      ['devices', ['devices: Devices', 'tv: TV connections', 'backup: Backup and restore', 'transfer: Transfer', 'advanced: Advanced']],
      ['network', ['p2p: P2P status and limits', 'advanced: Advanced']],
      ['about', ['version: Version and updates', 'changelog: Changelog', 'licenses: Licenses', 'reset: Reset', 'advanced: Advanced']],
    ])
    for (const section of SETTINGS_SECTIONS) {
      for (const sub of section.subcategories) expect(sub.advanced === true, `${section.id}#${sub.id}`).toBe(sub.id === 'advanced')
    }
  })

  it('looks sections and subcategories up by id', () => {
    expect(settingsSection('network').title).toBe('Network and P2P')
    expect(subcategoryDef('playback', 'player-window')).toEqual({ id: 'player-window', title: 'Player window' })
    expect(subcategoryDef('playback', 'advanced')).toEqual({ id: 'advanced', title: 'Advanced', advanced: true })
    expect(subcategoryDef('languages', 'advanced')).toBeUndefined()
  })

  it('shares the context key and the unfold event name', () => {
    expect(SETTINGS_SECTION_CONTEXT).toBe('izumi-settings-section')
    expect(SUBCATEGORY_OPEN_EVENT).toBe('izumi-subcategory-open')
  })

  it('stays plain data with no imports, so tests and the app-wide Back path can load it', () => {
    expect(source).not.toMatch(/^import /m)
  })
})

describe('sub-pages and old routes', () => {
  it('knows the sub-pages that stay routes, with their section and title', () => {
    expect(Object.fromEntries(SETTINGS_SUB_PAGES)).toEqual({
      'sources/manage': { section: 'sources', title: 'Manage sources' },
      'sources/priority': { section: 'sources', title: 'Source priority' },
      store: { section: 'sources', title: 'Store' },
      'library/home': { section: 'library', title: 'Customize Home' },
      'library/collections': { section: 'library', title: 'Collections and covers' },
      themes: { section: 'appearance', title: 'Themes' },
      'theme-studio': { section: 'appearance', title: 'Theme Studio' },
      'about/changelog': { section: 'about', title: 'Changelog' },
      'about/license-information': { section: 'about', title: 'License information' },
    })
  })

  it('sends every old route to a section or sub-page, and every anchor to a subcategory there', () => {
    expect([...LEGACY_SETTINGS_ROUTES.keys()].sort()).toEqual([
      'backup', 'catalog', 'catalog/collections', 'catalog/home', 'changelog', 'extensions', 'history', 'hotkeys',
      'interface', 'navigation', 'player', 'profiles', 'scenes', 'storage', 'sync',
    ])
    for (const [old, target] of LEGACY_SETTINGS_ROUTES) {
      const [path, hash] = target.split('#')
      const section = sectionForPath(`/app/settings/${path}`)
      expect(section, old).not.toBeNull()
      expect(path === section!.id || SETTINGS_SUB_PAGES.has(path), old).toBe(true)
      if (hash) expect(subcategoryDef(section!.id, hash), old).toBeDefined()
    }
  })
})

describe('sectionForPath', () => {
  it.each([
    ['/app/settings/playback', 'playback'],
    ['/app/settings/about/', 'about'],
    ['/app/settings/accounts?section=x#keys', 'accounts'],
    ['/app/settings/accounts/trakt/advanced', 'accounts'],
    ['/app/settings/sources/manage', 'sources'],
    ['/app/settings/sources/priority', 'sources'],
    ['/app/settings/store', 'sources'],
    ['/app/settings/library/home', 'library'],
    ['/app/settings/library/collections', 'library'],
    ['/app/settings/themes', 'appearance'],
    ['/app/settings/theme-studio', 'appearance'],
    ['/app/settings/about/changelog', 'about'],
    ['/app/settings/about/license-information', 'about'],
  ])('%s belongs to %s', (path, id) => {
    expect(sectionForPath(path)?.id).toBe(id)
  })

  it('answers null at the index, on old routes and outside Settings', () => {
    for (const path of ['/app/settings', '/app/settings/', '/app/settings/player', '/app/settings/catalog/home', '/app/settingsx', '/app/home']) {
      expect(sectionForPath(path), path).toBeNull()
    }
  })
})
