import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./GlobalSearch.svelte', import.meta.url)), 'utf8')

describe('global search focus styling', () => {
  it('suppresses the generic full-input focus outline while retaining the field-row focus state', () => {
    expect(source).toContain('class="global-search-input')
    expect(source).toContain('.global-search-input:focus-visible')
    expect(source).toContain('outline: none;')
    expect(source).toContain('focus-within:border-theme/70')
  })
})
