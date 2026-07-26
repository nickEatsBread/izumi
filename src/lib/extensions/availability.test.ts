import { describe, expect, it } from 'vitest'
import { extensionSourceConfigured, jvmSourceOwners } from './availability'

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

describe('JVM source ownership', () => {
  it('owns every source from a multi-source package by stable source ID', () => {
    expect(jvmSourceOwners([
      {
        id: 'eu.kanade.multi',
        backend: 'aniyomi-jvm',
        sourceId: '101',
        sourceIds: ['101', '202'],
      },
      {
        id: 'native',
        backend: 'izumi-js',
        sourceId: '303',
        sourceIds: ['303'],
      },
    ])).toEqual(new Map([
      ['101', 'eu.kanade.multi'],
      ['202', 'eu.kanade.multi'],
    ]))
  })

  it('supports packages installed before sourceIds was added', () => {
    expect(jvmSourceOwners([
      { id: 'legacy', backend: 'aniyomi-jvm', sourceId: '404' },
    ])).toEqual(new Map([['404', 'legacy']]))
  })
})
