import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETTINGS_ROOT, isSettingsPath, settingsNode, settingsPageTitle, settingsParent, settingsRailHref } from './hierarchy'

const S = (rest = '') => (rest ? `${SETTINGS_ROOT}/${rest}` : SETTINGS_ROOT)

// route below /app/settings, level, parent href, accepts, rail href, title
const table: Array<[string, number, string, string[], string | null, string | null]> = [
  ['player', 1, S(), [S()], S('player'), 'Player'],
  ['subtitles', 1, S(), [S()], S('subtitles'), 'Subtitles'],
  ['hotkeys', 1, S(), [S()], S('hotkeys'), 'Hotkeys'],
  ['catalog', 1, S(), [S()], S('catalog'), 'Catalog'],
  ['catalog/home', 2, S('catalog'), [S('catalog')], S('catalog'), 'Customize Home'],
  ['catalog/collections', 2, S('catalog'), [S('catalog'), S('catalog/home')], S('catalog'), 'Collections & covers'],
  ['sources', 1, S(), [S()], S('sources'), 'Sources'],
  ['sources/priority', 2, S('sources?tab=ordering'), [S('sources')], S('sources'), 'Source priority'],
  ['store', 2, S('sources?tab=manage'), [S('sources'), S('catalog')], S('sources'), 'Store'],
  ['extensions', 1, S(), [S()], S('sources'), 'Sources'],
  ['downloads', 1, S(), [S()], S('downloads'), 'Downloads'],
  ['storage', 1, S(), [S()], S('storage'), 'Storage'],
  ['profiles', 1, S(), [S()], S('profiles'), 'Profiles'],
  ['interface', 1, S(), [S()], S('interface'), 'Interface'],
  ['themes', 1, S(), [S()], S('themes'), 'Themes'],
  ['theme-studio', 1, S(), [S()], S('themes'), 'Theme Studio'],
  ['navigation', 1, S(), [S()], null, 'Navigation'],
  ['history', 1, S(), [S()], S('history'), 'History'],
  ['scenes', 1, S(), [S()], S('scenes'), 'Scene bookmarks'],
  ['sync', 1, S(), [S()], S('sync'), 'Device sync'],
  ['backup', 1, S(), [S()], S('backup'), 'Backup & restore'],
  ['accounts', 1, S(), [S()], S('accounts'), 'Accounts'],
  ['network', 1, S(), [S()], S('network'), 'Network'],
  ['changelog', 1, S(), [S()], S('changelog'), 'Changelog'],
  ['about', 1, S(), [S()], S('about'), 'About'],
  ['about/license-information', 2, S('about'), [S('about')], S('about'), 'License Information'],
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

  it('treats the index as level 0 with no parent, keeping Player lit on the rail', () => {
    expect(settingsNode('/app/settings/')).toEqual({ path: S(), level: 0, parent: null, accepts: [], railHref: S('player'), title: null })
    expect(settingsParent(S())).toBeNull()
  })

  it.each(table)('%s: level %i, parent %s', (rest, level, parent, accepts, railHref, title) => {
    const path = S(rest)
    expect(settingsNode(path)).toEqual({ path, level, parent, accepts, railHref, title })
    expect(settingsNode(`${path}/`)).toEqual(settingsNode(path))
    expect(settingsParent(path)).toEqual({ href: parent, accepts })
    expect(settingsRailHref(path)).toBe(railHref)
    expect(settingsPageTitle(path)).toBe(title)
  })

  it('has a row for every Settings route that exists', () => {
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
    for (const rest of routes) expect(settingsPageTitle(S(rest)), rest).not.toBeNull()
    expect([...routes].sort()).toEqual(table.map(([rest]) => rest).sort())
  })

  it('drops the last segment for deeper routes it does not name', () => {
    expect(settingsNode(S('accounts/trakt/advanced'))).toMatchObject({ level: 3, parent: S('accounts/trakt'), accepts: [S('accounts/trakt')], railHref: S('accounts'), title: 'Accounts' })
    expect(settingsNode(S('sync/devices'))).toMatchObject({ level: 2, parent: S('sync'), accepts: [S('sync')], railHref: S('sync'), title: 'Device sync' })
  })

  it('ignores the query and the hash', () => {
    expect(settingsNode(S('sources/priority?x=1#top')).parent).toBe(S('sources?tab=ordering'))
    expect(settingsPageTitle(S('store?from=catalog'))).toBe('Store')
  })

  it('answers null outside Settings', () => {
    expect(settingsParent('/app/home')).toBeNull()
    expect(settingsRailHref('/app/home')).toBeNull()
    expect(settingsPageTitle('/app/home')).toBeNull()
  })
})
