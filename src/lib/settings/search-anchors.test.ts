import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importClosure } from '../../test/svelte-markup'
import { SETTINGS_SEARCH_INDEX, type SettingSearchItem } from './search'
import { sectionForPath, subcategoryDef } from './sections'

// Every search hit that names a row (`key`, `fallbackKey`) must land on markup that renders that
// `data-setting-key`, searched through the destination page's transitive .svelte imports. Keys built
// at runtime are listed in DYNAMIC_KEYS with the template that builds them.

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const LIB = here('../')
const ROUTES = here('../../routes/')
const BASE = 'https://izumi.invalid'

const routeFile = (href: string) => resolve(ROUTES, `.${new URL(href, BASE).pathname}`, '+page.svelte')

/** Keys a file renders as literal text: `data-setting-key="…"` and `settingKey="…"` props. */
function staticKeys(source: string): string[] {
  return [...source.matchAll(/(?:data-setting-key|settingKey)="([^"]+)"/g)].map((match) => match[1])
}

/** Keys built at runtime, with the template (pinned in its file) and the ids it is built from. */
const DYNAMIC_KEYS: Array<{ file: string; template: string; ids: string[]; key: (id: string) => string }> = [
  {
    file: routeFile('/app/settings/library'),
    template: 'settingKey={`catalog-platform-${platform.id}`}',
    ids: ['auto', 'anilist', 'kitsu', 'tmdb', 'stremio', 'jvm'],
    key: (id) => `catalog-platform-${id}`,
  },
  {
    file: resolve(LIB, 'components/settings/CacheStorageSettings.svelte'),
    template: 'settingKey={`cache-${bucket.id}`}',
    ids: ['thumbs', 'direct-torrents', 'torrent-metadata', 'subs', 'gif-capture'],
    key: (id) => `cache-${id}`,
  },
]

function renderedKeys(page: string): Set<string> {
  const files = new Set([page, ...importClosure([page])].map((file) => resolve(file)))
  const keys = new Set<string>()
  for (const file of files) for (const key of staticKeys(read(file))) keys.add(key)
  for (const dynamic of DYNAMIC_KEYS) {
    if (files.has(resolve(dynamic.file))) for (const id of dynamic.ids) keys.add(dynamic.key(id))
  }
  return keys
}

const keyed = SETTINGS_SEARCH_INDEX.filter((item) => item.key || item.fallbackKey)

describe('settings search anchors', () => {
  it('opens a real route for every hit', () => {
    for (const item of SETTINGS_SEARCH_INDEX) expect(existsSync(routeFile(item.href)), item.href).toBe(true)
  })

  it("opens every anchored hit on a subcategory block of its page's section", () => {
    const anchored = SETTINGS_SEARCH_INDEX.filter((item) => new URL(item.href, BASE).hash)
    expect(anchored.length).toBeGreaterThan(0)
    for (const item of anchored) {
      const url = new URL(item.href, BASE)
      const hash = url.hash.slice(1)
      const section = sectionForPath(url.pathname)
      expect(section && subcategoryDef(section.id, hash), `${item.href}: registry subcategory`).toBeTruthy()
      expect(read(routeFile(item.href)), item.href).toMatch(new RegExp(`<SettingsSubcategory id="${hash}"[\\s/>]`))
    }
  })

  it.each(keyed.map((item): [string, SettingSearchItem] => [`${item.category}: ${item.title}`, item]))('%s lands on a rendered row', (_label, item) => {
    const keys = [...renderedKeys(routeFile(item.href))]
    if (item.key) expect(keys, `${item.key} on ${item.href}`).toContain(item.key)
    if (item.fallbackKey) expect(keys, `${item.fallbackKey} on ${item.href}`).toContain(item.fallbackKey)
  })

  it('keeps the runtime key templates in their files', () => {
    for (const dynamic of DYNAMIC_KEYS) {
      const source = read(dynamic.file)
      expect(source).toContain(dynamic.template)
      for (const id of dynamic.ids) expect(source).toContain(`{ id: '${id}'`)
    }
  })
})

describe('SettingsSearch', () => {
  it('filters hits for this device and opens them through settingHref', () => {
    const search = read(here('../components/settings/SettingsSearch.svelte'))
    expect(search).toContain("import { searchSettings, settingHref, type SettingSearchItem } from '$lib/settings/search'")
    expect(search).toContain("import { inAppPlayerAvailable } from '$lib/player/in-app-player'")
    expect(search).toContain("import { gameMode } from '$lib/player/session'")
    expect(search).toContain('searchSettings(query, { android: $isAndroid, phone: $isMobile, tv: $isTv, lite: !$inAppPlayerAvailable, gamemode: $gameMode })')
    expect(search).toContain('await goto(settingHref(item))')
    expect(search).not.toContain('item.anchored')
  })
})
