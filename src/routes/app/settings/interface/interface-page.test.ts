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
})
