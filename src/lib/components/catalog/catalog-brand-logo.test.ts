import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./CatalogBrandLogo.svelte', import.meta.url)), 'utf8')

describe('catalog picker Izumi mark', () => {
  it('always renders the original full-colour client logo', () => {
    expect(source).toContain('src="/brand/izumi-mark-color.svg"')
    expect(source).not.toContain('gradients')
    expect(source).not.toContain('mask:')
  })
})
