import { describe, expect, it } from 'vitest'
import { inferAddonConfigureUrl } from './configure'

describe('inferAddonConfigureUrl', () => {
  it('uses the public origin for configured manifest paths', () => {
    expect(inferAddonConfigureUrl('https://addon.example/private-settings', {
      id: 'example',
      name: 'Example RD',
      version: '1',
      behaviorHints: { configurable: true },
    })).toBe('https://addon.example/configure')
  })

  it('does not invent a page for a non-configurable addon', () => {
    expect(inferAddonConfigureUrl('https://addon.example', {
      id: 'example',
      name: 'Example',
      version: '1',
    })).toBeNull()
  })
})
