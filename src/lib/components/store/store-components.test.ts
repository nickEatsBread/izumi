import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')

describe('Store components', () => {
  it('keeps cards inside phone-width grid tracks and offers updates on installed entries', () => {
    const card = read('StoreEntryCard.svelte')
    expect(card).toContain('flex w-full min-w-0 max-w-full gap-3 overflow-hidden rounded-xl')
    expect(card).toContain("{installed ? 'Update' : action}")
  })

  it('shows who a sheet entry comes from, where it downloads from, and its signing status', () => {
    const sheet = read('StoreEntrySheet.svelte')
    expect(sheet).toContain('third-party, not reviewed by izumi')
    expect(sheet).toContain('Downloads from')
    expect(sheet).toContain('{trustLabel}')
    expect(sheet).toContain('role="dialog"')
  })

  it('previews a store before adding it and says adding installs nothing', () => {
    const dialog = read('StoresDialog.svelte')
    expect(dialog).toContain('previewStore(input)')
    expect(dialog).toContain('Adding it installs nothing.')
    expect(dialog).toContain('Trust new key')
  })
})
