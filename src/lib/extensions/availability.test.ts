import { describe, expect, it } from 'vitest'
import { extensionSourceConfigured } from './availability'

describe('extension source availability', () => {
  it('counts an installed package without a manifest URL', () => {
    expect(extensionSourceConfigured([], [{ id: 'allanime' }], [])).toBe(true)
  })

  it('does not count a disabled installed package', () => {
    expect(extensionSourceConfigured([], [{ id: 'allanime' }], ['allanime'])).toBe(false)
  })

  it('keeps remote extension manifests working', () => {
    expect(extensionSourceConfigured(['https://example.test/manifest.json'], [], [])).toBe(true)
  })

  it('reports no source only when both forms are absent', () => {
    expect(extensionSourceConfigured([], [], [])).toBe(false)
  })
})
