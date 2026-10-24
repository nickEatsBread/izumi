import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const interfacePage = read('./+page.svelte')

describe('interface settings', () => {
  it('leaves the app and title language rows to Settings › Languages', () => {
    expect(interfacePage).not.toContain('data-setting-key="title-language"')
    expect(interfacePage).not.toContain('data-setting-key="app-language"')
    expect(interfacePage).not.toContain('$titleLanguage')
  })

  it('drops the UI scale slider on the phone layout, where zoom is fixed at 1, and anchors it for search', () => {
    const page = interfacePage.replace(/\r\n/g, '\n')
    expect(read('../../+layout.svelte')).toContain("rootStyle.zoom = $isMobile ? '1' : String($uiScale)")
    expect(page).toContain("import { isAndroid, isAndroidTv, isMobile } from '$lib/platform'")
    expect(page).toMatch(/\{#if !\$isMobile\}\n\s*<label data-setting-key="ui-scale" [^>]*>[\s\S]*?bind:value=\{\$uiScale\}[\s\S]*?<\/label>\n\s*\{\/if\}/)
  })
})
