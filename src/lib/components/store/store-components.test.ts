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

  it('shows the new key before re-trusting a store, asks before removing one, and announces errors', () => {
    const dialog = read('StoresDialog.svelte')
    expect(dialog).toContain('result.trust.fingerprint?.slice(0, 16)')
    expect(dialog).toContain('preview.fingerprint?.slice(0, 16)')
    expect(dialog).toContain('Remove?')
    expect(dialog).toContain('role="alert"')
  })

  it('never checks a store just because the dialog opened', () => {
    const dialog = read('StoresDialog.svelte')
    expect(dialog).not.toContain('onMount')
    expect(dialog).not.toContain('$effect')
  })

  it('closes Store dialogs with the controller B button instead of leaving the page', () => {
    expect(read('StoreEntrySheet.svelte')).toContain('data-nav-trap data-nav-escape')
    expect(read('StoresDialog.svelte')).toContain('data-nav-trap data-nav-escape')
    expect(read('StoreEntrySheet.svelte')).toContain('aria-pressed={enabled}')
    const gamepad = readFileSync(fileURLToPath(new URL('../../nav/gamepad.ts', import.meta.url)), 'utf8')
    expect(gamepad).toContain("document.querySelector('[data-nav-trap][data-nav-escape]')")
  })

  it('previews a store before adding it and says adding installs nothing', () => {
    const dialog = read('StoresDialog.svelte')
    expect(dialog).toContain('previewStore(input)')
    expect(dialog).toContain('Adding it installs nothing.')
    expect(dialog).toContain('Trust new key')
  })
})
