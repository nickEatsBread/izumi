import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const page = readFileSync(fileURLToPath(new URL('./+page.svelte', import.meta.url)), 'utf8')

describe('home-theatre capability diagnostics', () => {
  it('only renders the raw capability report when developer logging is enabled', () => {
    expect(page).toContain('developerLogging,')
    expect(page).toMatch(/\{#if \$developerLogging\}\s*<section[^>]*>[\s\S]*?Home-theatre capability diagnostics[\s\S]*?<\/section>\s*\{\/if\}/)
  })
})
