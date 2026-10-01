import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { importClosure } from '../../test/svelte-markup'
import { openingTagAt } from '../../test/svelte-source'
import { SETTINGS_SEARCH_INDEX, settingKey, type SettingSearchItem } from './search'

// Every search hit that names a row (`key`, `fallbackKey`) must land on markup that renders that
// `data-setting-key`, searched through the destination page's transitive .svelte imports. Keys built
// at runtime are listed in DYNAMIC_KEYS with the template that builds them. Accounts hits also name
// the section (`?section=`) whose hidden block holds their row.

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const LIB = here('../')
const ROUTES = here('../../routes/')
const BASE = 'https://izumi.invalid'
const messages = JSON.parse(read(here('../../../messages/en.json'))) as Record<string, string>

const routeFile = (href: string) => resolve(ROUTES, `.${new URL(href, BASE).pathname}`, '+page.svelte')

/** Keys a file renders as literal text: `data-setting-key="…"`, `settingKey="…"` props, and Toggle
 *  rows without a settingKey prop, keyed settingKey(label) (label literal, {'…'} or {m.key()} in English). */
function staticKeys(source: string): string[] {
  const keys = [...source.matchAll(/(?:data-setting-key|settingKey)="([^"]+)"/g)].map((match) => match[1])
  for (const match of source.matchAll(/<Toggle\b/g)) {
    const tag = openingTagAt(source, match.index)
    if (/\ssettingKey[=\s>]/.test(tag)) continue
    const label = /\slabel=(?:"([^"]*)"|\{'([^']*)'\}|\{m\.(\w+)\(\)\})/.exec(tag)
    const text = label?.[1] ?? label?.[2] ?? (label?.[3] ? messages[label[3]] : undefined)
    if (text) keys.push(settingKey(text))
  }
  return keys
}

/** Keys built at runtime, with the template (pinned in its file) and the ids it is built from. */
const DYNAMIC_KEYS: Array<{ file: string; template: string; ids: string[]; key: (id: string) => string }> = [
  {
    file: routeFile('/app/settings/catalog'),
    template: 'settingKey={`catalog-platform-${platform.id}`}',
    ids: ['auto', 'anilist', 'kitsu', 'tmdb', 'stremio', 'jvm'],
    key: (id) => `catalog-platform-${id}`,
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

/** The keys inside each `<div hidden={section !== '…'}>` block of the Accounts page, including the
 *  keys of the components (and their imports) rendered in that block. */
function accountsSections(): Map<string, Set<string>> {
  const file = routeFile('/app/settings/accounts')
  const source = read(file)
  const markers = [...source.matchAll(/<div hidden=\{section !== '(\w+)'\}>/g)]
  const sections = new Map<string, Set<string>>()
  markers.forEach((marker, index) => {
    const block = source.slice(marker.index, markers[index + 1]?.index ?? source.length)
    const keys = new Set(staticKeys(block))
    for (const [, name] of block.matchAll(/<([A-Z]\w*)[\s/>]/g)) {
      const specifier = new RegExp(`import ${name} from '([^']+\\.svelte)'`).exec(source)?.[1]
      if (!specifier) continue
      const component = specifier.startsWith('$lib/') ? resolve(LIB, specifier.slice(5)) : resolve(dirname(file), specifier)
      for (const nested of [component, ...importClosure([component])]) for (const key of staticKeys(read(nested))) keys.add(key)
    }
    sections.set(marker[1], keys)
  })
  return sections
}

const keyed = SETTINGS_SEARCH_INDEX.filter((item) => item.key || item.fallbackKey)

describe('settings search anchors', () => {
  it('opens a real route for every hit', () => {
    for (const item of SETTINGS_SEARCH_INDEX) expect(existsSync(routeFile(item.href)), item.href).toBe(true)
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

  it('sends every Accounts hit to the section whose hidden block holds its row', () => {
    const sections = accountsSections()
    expect([...sections.keys()].sort()).toEqual(['behaviour', 'connections', 'libraries'])
    const accounts = SETTINGS_SEARCH_INDEX.filter((item) => new URL(item.href, BASE).pathname === '/app/settings/accounts')
    expect(accounts.length).toBeGreaterThanOrEqual(11)
    for (const item of accounts) {
      const section = new URL(item.href, BASE).searchParams.get('section')
      expect(section, item.title).not.toBeNull()
      expect(item.key, item.title).toBeTruthy()
      expect([...(sections.get(section!) ?? [])], `${item.title} in ${section}`).toContain(item.key)
    }
  })

  it('opens the section named in the URL on the Accounts page', () => {
    const page = read(routeFile('/app/settings/accounts'))
    expect(page).toContain("const requested = page.url.searchParams.get('section')")
    expect(page).toContain("if (requested === 'libraries' || requested === 'behaviour' || requested === 'connections') section = requested")
  })
})

describe('SettingsSearch', () => {
  it('filters hits for this device and opens them through settingHref', () => {
    const search = read(here('../components/settings/SettingsSearch.svelte'))
    expect(search).toContain("import { searchSettings, settingHref, type SettingSearchItem } from '$lib/settings/search'")
    expect(search).toContain("import { inAppPlayerAvailable } from '$lib/player/in-app-player'")
    expect(search).toContain('searchSettings(query, { android: $isAndroid, phone: $isMobile, tv: $isTv, lite: !$inAppPlayerAvailable })')
    expect(search).toContain('await goto(settingHref(item))')
    expect(search).not.toContain('item.anchored')
  })
})
