import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const interfacePage = read('./+page.svelte')
const playerPage = read('../player/+page.svelte')

describe('interface settings', () => {
  it('owns the app-wide title language preference', () => {
    expect(interfacePage).toContain('data-setting-key="title-language"')
    expect(interfacePage).toContain('bind:value={$titleLanguage}')
    expect(playerPage).not.toContain('bind:value={$titleLanguage}')
    expect(playerPage).not.toContain('How titles and lists are shown.')
  })

  it('drops the UI scale slider on the phone layout, where zoom is fixed at 1, and anchors it for search', () => {
    const page = interfacePage.replace(/\r\n/g, '\n')
    expect(read('../../+layout.svelte')).toContain("rootStyle.zoom = $isMobile ? '1' : String($uiScale)")
    expect(page).toContain("import { isAndroid, isAndroidTv, isMobile } from '$lib/platform'")
    expect(page).toMatch(/\{#if !\$isMobile\}\n\s*<label data-setting-key="ui-scale" [^>]*>[\s\S]*?bind:value=\{\$uiScale\}[\s\S]*?<\/label>\n\s*\{\/if\}/)
  })

  it('anchors the app language row for search', () => {
    expect(interfacePage).toContain('<label data-setting-key="app-language" class="mb-5 flex items-center justify-between gap-3 rounded-md border border-border p-4 sm:p-3">')
  })
})
