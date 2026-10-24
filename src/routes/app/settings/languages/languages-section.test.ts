import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETTINGS_SEARCH_INDEX } from '$lib/settings/search'
import { settingsSection } from '$lib/settings/sections'
import { renderedSettingKeys, sectionOf, subcategoriesOf } from '../../../../test/settings-sections'

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (relative: string) => readFileSync(here(relative), 'utf8').replace(/\r\n/g, '\n')
const file = here('./+page.svelte')
const page = read('./+page.svelte')

describe('Languages section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('languages')
    expect(page).not.toContain('data-settings-page-title')
  })

  it('renders the registry subcategories in order, with no folded Advanced', () => {
    const subcategories = subcategoriesOf(file)
    expect(subcategories.map((sub) => sub.id)).toEqual(['app', 'playback', 'sources', 'downloads'])
    expect(subcategories.map((sub) => sub.id)).toEqual(settingsSection('languages').subcategories.map((sub) => sub.id))
    expect(subcategories.filter((sub) => sub.collapsible || sub.summary !== undefined)).toEqual([])
  })

  it('shows every language row on every build', () => {
    expect(page).not.toMatch(/\{#if \$(?:isAndroid|isAndroidTv|isMobile|inAppPlayerAvailable)/)
  })

  it('renders each moved row with its key', () => {
    const keys = renderedSettingKeys(file)
    for (const key of ['app-language', 'title-language', 'audio-language', 'subtitle-language', 'sub-or-dub-results', 'source-languages', 'download-audio']) {
      expect(keys, key).toContain(key)
    }
  })

  it('writes the same stores the old rows wrote', () => {
    for (const store of ['$titleLanguage', '$preferredAudioLang', '$preferredSubLang', '$providerAudio', '$providerLanguages', '$downloadAudio']) {
      expect(page).toContain(`(${store} = `)
    }
    expect(page).toContain('onChange={changeLocale}')
    expect(page).toContain("{ value: 'none', label: m.cast_subtitles_off() }")
    expect(page).toContain('<MultiSelect label="Languages" options={langOptions}')
  })

  it('keeps row descriptions to one line', () => {
    for (const [, text] of page.matchAll(/\sdescription="([^"]*)"/g)) expect(text.length, text).toBeLessThanOrEqual(80)
    expect(page).not.toMatch(/text-\[1[01]px\]/)
  })

  it('points each language search hit at its subcategory', () => {
    const expected: Record<string, { subcategory: string; key: string }> = {
      'App language': { subcategory: 'app', key: 'app-language' },
      'Title language': { subcategory: 'app', key: 'title-language' },
      'Audio language': { subcategory: 'playback', key: 'audio-language' },
      'Subtitle language': { subcategory: 'playback', key: 'subtitle-language' },
      'Download audio': { subcategory: 'downloads', key: 'download-audio' },
    }
    for (const [title, { subcategory, key }] of Object.entries(expected)) {
      const item = SETTINGS_SEARCH_INDEX.find((entry) => entry.title === title)
      expect(item, title).toMatchObject({ category: 'Languages', section: 'languages', subcategory, href: '/app/settings/languages', key })
      expect(item?.advanced, title).toBeUndefined()
    }
  })

  it('leaves no copy of a moved row on its old page', () => {
    const interfacePage = read('../interface/+page.svelte')
    expect(interfacePage).not.toContain('$titleLanguage')
    expect(interfacePage).not.toContain('data-setting-key="app-language"')
    expect(read('../downloads/+page.svelte')).not.toContain('$downloadAudio')
    const communitySources = read('../extensions/+page.svelte')
    expect(communitySources).not.toContain('$providerAudio')
    expect(communitySources).not.toContain('$providerLanguages')
    expect(read('../sources/+page.svelte')).not.toContain('community-results')
  })
})
