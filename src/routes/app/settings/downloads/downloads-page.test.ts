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
const caches = read('../../../../lib/components/settings/CacheStorageSettings.svelte')
const subcategories = subcategoriesOf(file)
const block = (id: string) => subcategories.find((sub) => sub.id === id)?.source ?? ''

const ROWS: Record<string, string> = {
  'offline-mode': 'offline',
  'download-folder': 'folder',
  'download-quality': 'folder',
  'automatic-downloads': 'folder',
  'storage-used': 'storage',
  'cache-total': 'storage',
  'simultaneous-downloads': 'advanced',
  'new-episode-delay': 'advanced',
  'download-codec': 'advanced',
  'only-download-cached-sources': 'advanced',
}

describe('Downloads and storage section', () => {
  it('is a SettingsSection page with no title of its own', () => {
    expect(sectionOf(file)).toBe('downloads')
    expect(source).not.toContain('data-settings-page-title')
  })

  it('renders the registry subcategories in order with Advanced last', () => {
    const ids = subcategories.map((sub) => sub.id)
    expect(ids).toEqual(['offline', 'folder', 'storage', 'advanced'])
    expect(ids).toEqual(settingsSection('downloads').subcategories.map((sub) => sub.id))
  })

  it('folds Advanced behind a summary of its first rows, and folds nothing else', () => {
    expect(subcategories.at(-1)).toMatchObject({ id: 'advanced', summary: 'Simultaneous downloads, new-episode delay, codec, +1', collapsible: false, plain: false })
    expect(subcategories.filter((sub) => sub.collapsible || sub.summary !== undefined).map((sub) => sub.id)).toEqual(['advanced'])
  })

  it('renders every row key through the page and the cache component', () => {
    const keys = renderedSettingKeys(file)
    for (const key of Object.keys(ROWS)) expect(keys, key).toContain(key)
  })

  it.each(Object.entries(ROWS))('%s sits in %s and search sends it there', (key, subcategory) => {
    if (key === 'cache-total') {
      expect(block('storage')).toContain('<CacheStorageSettings />')
      expect(caches).toContain(`settingKey="${key}"`)
    } else {
      expect(block(subcategory)).toContain(`settingKey="${key}"`)
    }
    const entries = SETTINGS_SEARCH_INDEX.filter((item) => item.key === key)
    expect(entries.length, key).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry, key).toMatchObject({ section: 'downloads', subcategory, href: '/app/settings/downloads' })
      expect(entry.advanced === true, key).toBe(subcategory === 'advanced')
    }
  })

  it('sends every cache bucket hit to its own row', () => {
    for (const id of ['thumbs', 'direct-torrents', 'torrent-metadata', 'subs']) {
      expect(SETTINGS_SEARCH_INDEX.find((item) => item.key === `cache-${id}`), id).toMatchObject({ section: 'downloads', subcategory: 'storage' })
    }
  })

  it('keeps the folder read-only on Android and the picker on desktop', () => {
    expect(source).toContain('readonly={$isAndroid}')
    expect(source).toMatch(/\{#if !\$isAndroid\}<button data-focusable onclick=\{browse\}/)
    expect(source).toContain("if (!$downloadDir) { try { $downloadDir = await invoke<string>('download_dir_default') } catch { /* not in Tauri */ } }")
  })

  it('keeps the automatic-download check and rule list', () => {
    expect(source).toContain('onRefresh={checkAutoDownloads}')
    expect(source).toContain('updateAutoDownloadRule(rule.id, { enabled: e.currentTarget.checked })')
    expect(source).toContain('onclick={() => removeAutoDownloadRule(rule.id)}')
  })

  it('leaves download audio to Languages and uses only the row recipes', () => {
    expect(source).not.toContain('downloadAudio')
    expect(source).not.toContain('<Toggle')
    expect(source).not.toContain('<SelectMenu')
    expect(source).not.toMatch(/text-\[1[01]px\]/)
    for (const text of [...source.matchAll(/\sdescription="([^"]*)"/g)].map((match) => match[1])) {
      expect(text.length, text).toBeLessThanOrEqual(80)
    }
  })
})
