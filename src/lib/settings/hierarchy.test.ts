import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETTINGS_ROOT, isSettingsPath, settingsNode, settingsPageTitle, settingsParent, settingsRailHref } from './hierarchy'

const S = (rest = '') => (rest ? `${SETTINGS_ROOT}/${rest}` : SETTINGS_ROOT)

// route below /app/settings, level, parent href, accepts, rail href, title
type Row = [string, number, string, string[], string | null, string | null]

const sections: Row[] = [
  ['playback', 1, S(), [S()], S('playback'), 'Playback'],
  ['subtitles', 1, S(), [S()], S('subtitles'), 'Subtitles'],
  ['languages', 1, S(), [S()], S('languages'), 'Languages'],
  ['library', 1, S(), [S()], S('library'), 'Home and library'],
  ['sources', 1, S(), [S()], S('sources'), 'Sources and store'],
  ['downloads', 1, S(), [S()], S('downloads'), 'Downloads and storage'],
  ['appearance', 1, S(), [S()], S('appearance'), 'Appearance'],
  ['accounts', 1, S(), [S()], S('accounts'), 'Accounts and profiles'],
  ['devices', 1, S(), [S()], S('devices'), 'Devices and backup'],
  ['network', 1, S(), [S()], S('network'), 'Network and P2P'],
  ['about', 1, S(), [S()], S('about'), 'About'],
]

const subPages: Row[] = [
  ['sources/manage', 2, S('sources'), [S('sources')], S('sources'), 'Manage sources'],
  ['sources/priority', 2, S('sources'), [S('sources')], S('sources'), 'Source priority'],
  ['store', 2, S('sources'), [S('sources'), S('library')], S('sources'), 'Store'],
  ['library/home', 2, S('library'), [S('library')], S('library'), 'Customize Home'],
  ['library/collections', 2, S('library'), [S('library'), S('library/home')], S('library'), 'Collections and covers'],
  ['themes', 2, S('appearance'), [S('appearance')], S('appearance'), 'Themes'],
  ['theme-studio', 2, S('appearance'), [S('appearance'), S('themes')], S('appearance'), 'Theme Studio'],
  ['about/changelog', 2, S('about'), [S('about')], S('about'), 'Changelog'],
  ['about/license-information', 2, S('about'), [S('about')], S('about'), 'License information'],
]

// Old routes whose pages still render until their content moves: each answers as its target.
const legacy: Row[] = [
  ['player', 1, S(), [S()], S('playback'), 'Playback'],
  ['hotkeys', 1, S(), [S()], S('playback'), 'Playback'],
  ['catalog', 1, S(), [S()], S('library'), 'Home and library'],
  ['catalog/home', 2, S('library'), [S('library')], S('library'), 'Customize Home'],
  ['catalog/collections', 2, S('library'), [S('library'), S('library/home')], S('library'), 'Collections and covers'],
  ['extensions', 2, S('sources'), [S('sources')], S('sources'), 'Manage sources'],
  ['storage', 1, S(), [S()], S('downloads'), 'Downloads and storage'],
  ['profiles', 1, S(), [S()], S('accounts'), 'Accounts and profiles'],
  ['interface', 1, S(), [S()], S('appearance'), 'Appearance'],
  ['navigation', 1, S(), [S()], S('appearance'), 'Appearance'],
  ['history', 1, S(), [S()], S('library'), 'Home and library'],
  ['scenes', 1, S(), [S()], S('library'), 'Home and library'],
  ['sync', 1, S(), [S()], S('devices'), 'Devices and backup'],
  ['backup', 1, S(), [S()], S('devices'), 'Devices and backup'],
  ['changelog', 2, S('about'), [S('about')], S('about'), 'Changelog'],
]

describe('settings hierarchy', () => {
  it('knows which paths are Settings', () => {
    expect(isSettingsPath('/app/settings')).toBe(true)
    expect(isSettingsPath('/app/settings/')).toBe(true)
    expect(isSettingsPath('/app/settings/sources?tab=manage')).toBe(true)
    expect(isSettingsPath('/app/settings/about/license-information')).toBe(true)
    expect(isSettingsPath('/app/settingsx')).toBe(false)
    expect(isSettingsPath('/app/home')).toBe(false)
    expect(isSettingsPath('/app/collections')).toBe(false)
  })

  it('treats the index as level 0 with no parent, keeping Playback lit on the rail', () => {
    expect(settingsNode('/app/settings/')).toEqual({ path: S(), level: 0, parent: null, accepts: [], railHref: S('playback'), title: null })
    expect(settingsParent(S())).toBeNull()
  })

  it.each([...sections, ...subPages, ...legacy])('%s: level %i, parent %s', (rest, level, parent, accepts, railHref, title) => {
    const path = S(rest)
    expect(settingsNode(path)).toEqual({ path, level, parent, accepts, railHref, title })
    expect(settingsNode(`${path}/`)).toEqual(settingsNode(path))
    expect(settingsParent(path)).toEqual({ href: parent, accepts })
    expect(settingsRailHref(path)).toBe(railHref)
    expect(settingsPageTitle(path)).toBe(title)
  })

  it('titles every Settings route that exists and lights a rail item for it', () => {
    const root = fileURLToPath(new URL('../../routes/app/settings', import.meta.url))
    const routes: string[] = []
    const walk = (dir: string, rest: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), rest ? `${rest}/${entry.name}` : entry.name)
        else if (entry.name === '+page.svelte' && rest) routes.push(rest)
      }
    }
    walk(root, '')
    expect(routes.length).toBeGreaterThan(20)
    for (const rest of routes) {
      expect(settingsPageTitle(S(rest)), rest).not.toBeNull()
      expect(settingsRailHref(S(rest)), rest).not.toBeNull()
    }
  })

  it('drops the last segment for deeper routes it does not name, keeping the nearest named ancestor', () => {
    expect(settingsNode(S('accounts/trakt/advanced'))).toMatchObject({ level: 3, parent: S('accounts/trakt'), accepts: [S('accounts/trakt')], railHref: S('accounts'), title: 'Accounts and profiles' })
    expect(settingsNode(S('about/license-information/third-party'))).toMatchObject({ level: 3, parent: S('about/license-information'), railHref: S('about'), title: 'License information' })
    expect(settingsNode(S('sync/devices'))).toMatchObject({ level: 2, parent: S('sync'), accepts: [S('sync')], railHref: S('devices'), title: 'Devices and backup' })
    expect(settingsNode(S('unknown'))).toEqual({ path: S('unknown'), level: 1, parent: S(), accepts: [S()], railHref: null, title: null })
    expect(settingsNode(S('constructor')).title).toBeNull()
  })

  it('ignores the query and the hash', () => {
    expect(settingsNode(S('sources/priority?x=1#top')).parent).toBe(S('sources'))
    expect(settingsPageTitle(S('store?from=catalog'))).toBe('Store')
  })

  it('answers null outside Settings', () => {
    expect(settingsParent('/app/home')).toBeNull()
    expect(settingsRailHref('/app/home')).toBeNull()
    expect(settingsPageTitle('/app/home')).toBeNull()
  })
})
