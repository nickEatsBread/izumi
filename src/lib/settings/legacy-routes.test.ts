import { describe, expect, it } from 'vitest'
import { legacySettingsRedirect } from './legacy-routes'

const at = (path: string) => legacySettingsRedirect(new URL(path, 'https://izumi.invalid'))

describe('legacySettingsRedirect', () => {
  it.each([
    ['/app/settings/player', '/app/settings/playback'],
    ['/app/settings/hotkeys', '/app/settings/playback#controls'],
    ['/app/settings/catalog', '/app/settings/library#home'],
    ['/app/settings/catalog/home', '/app/settings/library/home'],
    ['/app/settings/catalog/collections', '/app/settings/library/collections'],
    ['/app/settings/extensions', '/app/settings/sources/manage'],
    ['/app/settings/storage', '/app/settings/downloads#storage'],
    ['/app/settings/profiles', '/app/settings/accounts#profiles'],
    ['/app/settings/interface', '/app/settings/appearance'],
    ['/app/settings/navigation', '/app/settings/appearance#navigation'],
    ['/app/settings/history', '/app/settings/library#history'],
    ['/app/settings/scenes', '/app/settings/library#scenes'],
    ['/app/settings/sync', '/app/settings/devices#devices'],
    ['/app/settings/backup', '/app/settings/devices#backup'],
    ['/app/settings/changelog', '/app/settings/about/changelog'],
  ])('%s → %s', (from, to) => {
    expect(at(from)).toBe(to)
    expect(at(`${from}/`)).toBe(to)
  })

  it.each([
    ['/app/settings/sources?tab=manage', '/app/settings/sources/manage'],
    ['/app/settings/sources?tab=playback', '/app/settings/playback#quality'],
    ['/app/settings/sources?tab=ordering', '/app/settings/sources#priority'],
    ['/app/settings/accounts?section=connections', '/app/settings/accounts#trackers'],
    ['/app/settings/accounts?section=libraries', '/app/settings/accounts#trackers'],
    ['/app/settings/accounts?section=behaviour', '/app/settings/accounts#trackers'],
    ['/app/settings/sync?section=tv', '/app/settings/devices#tv'],
    ['/app/settings/sync?section=sync', '/app/settings/devices#devices'],
  ])('maps the old query %s → %s', (from, to) => {
    expect(at(from)).toBe(to)
  })

  it('sends a known ?setting= key to the section that holds its row, keeping both setting parameters', () => {
    expect(at('/app/settings/interface?setting=rating-style')).toBe('/app/settings/library?setting=rating-style')
    expect(at('/app/settings/player?setting=include-subtitles-in-gifs&settingFallback=gif-recorder'))
      .toBe('/app/settings/playback?setting=include-subtitles-in-gifs&settingFallback=gif-recorder')
    expect(at('/app/settings/sources?tab=playback&setting=auto-play-the-best-source')).toBe('/app/settings/playback?setting=auto-play-the-best-source')
    expect(at('/app/settings/accounts?section=behaviour&setting=episodes-before-watchlist')).toBe('/app/settings/accounts?setting=episodes-before-watchlist')
  })

  it('keeps an unknown setting key on the mapped target, and every other parameter', () => {
    expect(at('/app/settings/hotkeys?setting=nope')).toBe('/app/settings/playback?setting=nope#controls')
    expect(at('/app/settings/sync?offer=abc')).toBe('/app/settings/devices?offer=abc#devices')
    expect(at('/app/settings/catalog/home?provider=tmdb')).toBe('/app/settings/library/home?provider=tmdb')
  })

  it('leaves current routes, surviving routes without an old query and other pages alone', () => {
    for (const path of [
      '/app/settings', '/app/settings/playback', '/app/settings/sources', '/app/settings/sources?tab=other',
      '/app/settings/accounts?setting=anilist-account', '/app/settings/store?add=x', '/app/home', '/app/settingsx/player',
    ]) expect(at(path), path).toBeNull()
  })
})
