import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SEARCH_INDEX, SETTING_FALLBACK_PARAM, SETTING_PARAM, searchSettings, settingHref, settingKey,
  settingVisible, type SettingSearchItem,
} from './search'
import { isSettingsPath, settingsPageTitle } from './hierarchy'
import { SETTINGS_SECTIONS, settingsSection, subcategoryDef } from './sections'

describe('settings search', () => {
  it('ranks direct title matches ahead of keyword matches', () => {
    const results = searchSettings('subtitle language')
    expect(results[0]?.title).toBe('Subtitle language')
  })

  it('finds settings through friendly keywords', () => {
    expect(searchSettings('vibration', true)[0]?.title).toBe('Haptics')
    expect(searchSettings('4k resolution')[0]?.title).toBe('Preferred quality')
  })

  it('resolves the curated-release row from the words on it and around it', () => {
    // The row's own words, and the ones a user would reach for instead — the setting is useless if
    // it can only be found by scrolling to it.
    expect(searchSettings('mark best releases')[0]?.title).toBe('Mark best releases')
    expect(searchSettings('curated')[0]?.title).toBe('Mark best releases')
  })

  it('hides controls that do not exist in the Android UI', () => {
    expect(searchSettings('player cache', true)).toHaveLength(0)
    expect(searchSettings('discord rpc', true)).toHaveLength(0)
    expect(searchSettings('title language', true)[0]).toMatchObject({
      title: 'Title language',
      category: 'Languages',
      href: '/app/settings/languages',
      key: 'title-language',
      section: 'languages',
      subcategory: 'app',
    })
  })

  it('finds the rendering preset on Android, by its old name too', () => {
    expect(searchSettings('rendering preset', true)[0]?.title).toBe('Rendering preset')
    expect(searchSettings('video quality', true)[0]?.title).toBe('Rendering preset')
  })

  it('finds the rating settings by the words people use for scoring', () => {
    expect(searchSettings('rating style')[0]).toMatchObject({ title: 'Rating style', href: '/app/settings/library', key: 'rating-style', section: 'library', subcategory: 'ratings' })
    expect(searchSettings('stars')[0]?.title).toBe('Rating style')
    expect(searchSettings('score').map((r) => r.title)).toContain('Show rating on the series page')
    expect(settingKey('Rating style')).toBe('rating-style')
    expect(settingKey('Show rating on the series page')).toBe('show-rating-on-the-series-page')
    expect(searchSettings('rating', true).map((r) => r.title)).toContain('Ask for a rating when a series ends')
  })

  it('finds the desktop Discord toggle by RPC terminology', () => {
    expect(searchSettings('discord rpc')[0]?.title).toBe('Discord Rich Presence')
  })

  it('keeps the two auto-skip toggles distinguishable', () => {
    // They share a label prefix, so a query for either has to land on the right one rather than
    // whichever was registered first.
    expect(searchSettings('next episode preview')[0]?.title).toBe('Auto-skip next-episode previews')
    expect(searchSettings('skip opening')[0]?.title).toBe('Auto-skip openings & endings')
  })

  it('finds dialogue-only subtitle styling from typesetting terminology', () => {
    expect(searchSettings('preserve subtitle signs')[0]?.title).toBe('Subtitle dialogue style overrides')
  })

  it('finds the Game-mode player animation toggle by progress and motion terms', () => {
    expect(searchSettings('animate player progress')[0]?.title).toBe('Animate player progress controls')
    expect(searchSettings('vacuumtube')[0]?.title).toBe('Animate player progress controls')
    expect(searchSettings('progress animation', true)).toHaveLength(0)
  })

  it('finds the production inspector on desktop only', () => {
    expect(searchSettings('inspect element')[0]?.title).toBe('Developer tools')
    expect(searchSettings('inspect element', true)).toHaveLength(0)
  })

  it('finds the VPN adapter binding by provider names, desktop only', () => {
    expect(searchSettings('nordlynx')[0]?.title).toBe('VPN adapter binding')
    expect(searchSettings('mullvad')[0]?.title).toBe('VPN adapter binding')
    expect(searchSettings('nordlynx', true)).toHaveLength(0)
  })

  it('hides Android-only controls on desktop', () => {
    expect(searchSettings('continue seeding', false)).toHaveLength(0)
    expect(searchSettings('continue seeding', true)[0]?.title).toBe('Continue seeding after playback')
  })

  it('finds the series-wide numbering toggle now that it left the series page', () => {
    expect(searchSettings('absolute episode numbers')[0]?.title).toBe('Series-wide episode numbers')
    expect(searchSettings('absolute')[0]).toMatchObject({ category: 'Home and library', section: 'library', subcategory: 'advanced', advanced: true })
  })

  it('uses the same stable keys as Toggle rows', () => {
    expect(settingKey('Auto-skip openings & endings')).toBe('auto-skip-openings-endings')
  })

  it('finds the GIF recorder from the words people actually type', () => {
    expect(searchSettings('gif')[0]?.title).toBe('GIF recorder')
    expect(searchSettings('gif recorder')[0]?.title).toBe('GIF recorder')
    expect(searchSettings('record gif')[0]?.title).toBe('GIF recorder')
    expect(settingKey('GIF recorder')).toBe('gif-recorder')
  })
})

const titles = (query: string, env?: Parameters<typeof searchSettings>[1]) => searchSettings(query, env).map((item) => item.title)

/** Rows the in-app player owns (commit 12's gates): desktop and Android full builds, not the lite build. */
const IN_APP_PLAYER_ROWS = [
  'Audio processing', 'Rendering preset', 'P2P playback status', 'Auto-play next episode', 'Show Up Next countdown',
  'Keep screen awake while playing', 'Binge next episode (preload)', 'Auto-skip openings & endings',
  'Auto-skip next-episode previews', 'Skip filler episodes', 'Scrub preview thumbnails', 'Include subtitles in GIFs',
  'Seek duration', 'Home-theatre audio', 'Dolby Vision source handling',
]
const DESKTOP_ONLY_ROWS = [
  'Discord Rich Presence', 'Animate player progress controls', 'Subtitle line navigation', 'Hide sidebar while playing', 'GIF recorder',
  'Player cache size', 'Enable external player', 'Title at top of player (Game mode)', 'Release channel',
  'Developer tools', 'Hotkeys',
]

describe('settings search per device', () => {
  it('still reads a bare boolean as the Android flag', () => {
    expect(titles('player cache', true)).toEqual([])
    expect(titles('player cache', { android: true })).toEqual([])
    expect(titles('player cache', false)).toContain('Player cache size')
  })

  it.each(IN_APP_PLAYER_ROWS)('%s shows on desktop and the Android full build, not on the lite build', (title) => {
    expect(titles(title)).toContain(title)
    expect(titles(title, { android: true })).toContain(title)
    expect(titles(title, { android: true, tv: true })).toContain(title)
    expect(titles(title, { android: true, lite: true })).not.toContain(title)
  })

  it.each(DESKTOP_ONLY_ROWS)('%s stays off Android', (title) => {
    expect(titles(title)).toContain(title)
    expect(titles(title, { android: true })).not.toContain(title)
  })

  it('offers the miniplayer on Android phones only, never on TV or the lite build', () => {
    const title = 'Miniplayer when you leave the app'
    expect(titles(title)).not.toContain(title)
    expect(titles(title, { android: true, phone: true })).toContain(title)
    expect(titles(title, { android: true, tv: true })).not.toContain(title)
    expect(titles(title, { android: true, phone: true, lite: true })).not.toContain(title)
  })

  it('hides UI scale on the phone layout, where zoom is fixed at 1, and keeps it on TV', () => {
    expect(titles('ui scale')[0]).toBe('UI scale')
    expect(titles('ui scale', { android: true, tv: true })[0]).toBe('UI scale')
    expect(titles('ui scale', { android: false, phone: true })).not.toContain('UI scale')
    expect(titles('ui scale', { android: true, phone: true })).not.toContain('UI scale')
  })

  it('offers the navigation editor only in the phone layout, where Appearance renders it', () => {
    const title = 'Navigation items'
    expect(titles('reorder', { android: true, phone: true })).toContain(title)
    expect(titles('reorder', { android: false, phone: true })).toContain(title)
    expect(titles('reorder')).not.toContain(title)
    expect(titles('reorder', { android: true, tv: true })).not.toContain(title)
    expect(titles('reorder', { android: false, gamemode: true })).not.toContain(title)
  })

  it('decides visibility with the same rules the search uses', () => {
    const item: SettingSearchItem = { title: 'x', category: 'x', href: '/app/settings/playback', section: 'playback', subcategory: 'up-next', hideOn: ['tv', 'lite'] }
    expect(settingVisible(item, { android: true })).toBe(true)
    expect(settingVisible(item, { android: true, tv: true })).toBe(false)
    expect(settingVisible(item, { android: false, lite: true })).toBe(false)
    expect(settingVisible({ ...item, hideOn: undefined, desktopOnly: true }, { android: true })).toBe(false)
    expect(settingVisible({ ...item, hideOn: undefined, androidOnly: true }, { android: false })).toBe(false)
    expect(settingVisible({ ...item, hideOn: ['gamemode'] }, { android: false, gamemode: true })).toBe(false)
    expect(settingVisible({ ...item, hideOn: ['gamemode'] }, { android: false })).toBe(true)
  })
})

describe('settings search entries', () => {
  it('drops the dead MDBList entry and names the update rows after what the page shows', () => {
    expect(titles('mdblist')).toEqual([])
    const all = SETTINGS_SEARCH_INDEX.map((item) => item.title)
    expect(all).not.toContain('Auto-check for updates')
    expect(all).not.toContain('Update channel')
    expect(searchSettings('check for updates')[0]).toMatchObject({ title: 'Check for updates', href: '/app/settings/about', key: 'updates' })
    expect(searchSettings('release channel')[0]).toMatchObject({ title: 'Release channel', key: 'release-channel', desktopOnly: true })
  })

  it('opens each Accounts hit on its subcategory row', () => {
    for (const [query, key, subcategory] of [
      ['episodes before watchlist', 'episodes-before-watchlist', 'trackers'],
      ['automatically add watched', 'automatically-add-watched-shows', 'trackers'],
      ['anilist account', 'anilist-account', 'trackers'],
      ['simkl account', 'simkl-account', 'trackers'],
      ['trakt list provider', 'trakt-account', 'trackers'],
      ['stremio add-on sync', 'stremio-addon-account', 'trackers'],
      ['anilist public profile', 'anilist-public-profile', 'trackers'],
      ['letterboxd', 'letterboxd-account', 'trackers'],
      ['parental pins', 'household-profiles', 'profiles'],
      ['show 18+', 'show-18-content', 'content'],
    ] as const) {
      expect(searchSettings(query)[0], query).toMatchObject({ href: '/app/settings/accounts', key, section: 'accounts', subcategory })
    }
  })

  it('finds the settings that had no entry', () => {
    expect(searchSettings('backup')[0]?.title).toBe('Backup & restore')
    expect(searchSettings('reset izumi')[0]).toMatchObject({ title: 'Reset izumi to defaults', key: 'reset-defaults' })
    expect(searchSettings('diagnostics', true)[0]).toMatchObject({ title: 'Diagnostics report', key: 'diagnostics-report' })
    expect(searchSettings('hotkeys')[0]?.title).toBe('Hotkeys')
    expect(searchSettings('app language', true)[0]).toMatchObject({ title: 'App language', key: 'app-language' })
    expect(searchSettings('tmdb token')[0]).toMatchObject({ title: 'TMDB read access token', key: 'tmdb-token', fallbackKey: 'catalog-platform-tmdb' })
    expect(searchSettings('omdb')[0]).toMatchObject({ title: 'OMDb API key', key: 'omdb-key', fallbackKey: 'catalog-platform-tmdb' })
    expect(searchSettings('up next overlay', true)[0]).toMatchObject({ title: 'Show Up Next countdown', key: 'show-up-next-countdown' })
    expect(searchSettings('catalog platforms')[0]).toMatchObject({ key: 'catalog-platform-auto' })
  })

  it('reveals the GIF recorder group where the GIF subtitle row is not rendered', () => {
    expect(searchSettings('include subtitles in gifs')[0]).toMatchObject({ key: 'include-subtitles-in-gifs', fallbackKey: 'gif-recorder' })
  })

  it('gives every row key the data-setting-key format and every hit a unique list key', () => {
    for (const item of SETTINGS_SEARCH_INDEX) {
      if (item.key) expect(item.key).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      if (item.fallbackKey) expect(item.fallbackKey).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
    const listKeys = SETTINGS_SEARCH_INDEX.map((item) => item.category + item.title)
    expect(new Set(listKeys).size).toBe(listKeys.length)
  })
})

describe('settingHref', () => {
  it('adds the row key and its fallback to the destination URL', () => {
    expect(SETTING_PARAM).toBe('setting')
    expect(SETTING_FALLBACK_PARAM).toBe('settingFallback')
    const gif = SETTINGS_SEARCH_INDEX.find((item) => item.title === 'Include subtitles in GIFs')!
    expect(settingHref(gif)).toBe('/app/settings/playback?setting=include-subtitles-in-gifs&settingFallback=gif-recorder')
    const threshold = SETTINGS_SEARCH_INDEX.find((item) => item.title === 'Episodes before Watchlist')!
    expect(settingHref(threshold)).toBe('/app/settings/accounts?setting=episodes-before-watchlist')
    const caches = SETTINGS_SEARCH_INDEX.find((item) => item.title === 'Cache sizes')!
    expect(settingHref(caches)).toBe('/app/settings/downloads?setting=cache-total')
  })

  it('anchors only keyless hits, since the setting query would land after a hash', () => {
    for (const item of SETTINGS_SEARCH_INDEX) if (item.key) expect(item.href, item.title).not.toContain('#')
  })
})

describe('settings search metadata', () => {
  it('files every hit under a registry section and subcategory, titled after its section', () => {
    expect(SETTINGS_SEARCH_INDEX.length).toBeGreaterThanOrEqual(132)
    for (const item of SETTINGS_SEARCH_INDEX) {
      const sub = subcategoryDef(item.section, item.subcategory)
      expect(sub, `${item.title}: ${item.section}#${item.subcategory}`).toBeDefined()
      expect(item.category, item.title).toBe(settingsSection(item.section).title)
      // `advanced` marks exactly the rows of the folded Advanced subcategory.
      expect(item.advanced === true, `${item.title} advanced`).toBe(sub?.advanced === true)
    }
  })

  it('opens every Settings hit on a route the route table knows', () => {
    for (const item of SETTINGS_SEARCH_INDEX) {
      if (isSettingsPath(item.href)) expect(settingsPageTitle(item.href), item.href).not.toBeNull()
    }
  })

  it('gives every section at least one hit', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(SETTINGS_SEARCH_INDEX.some((item) => item.section === section.id), section.id).toBe(true)
    }
  })
})
