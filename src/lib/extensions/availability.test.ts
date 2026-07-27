import { describe, expect, it } from 'vitest'
import { extensionSourceConfigured, jvmSourceOwners, liveJvmSources } from './availability'

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

describe('liveJvmSources — nothing may reach the Java runtime unless it is enabled', () => {
  const installed = [
    { id: 'eu.kanade.one', backend: 'aniyomi-jvm' as const, sourceId: '101', sourceIds: ['101', '202'] },
    { id: 'eu.kanade.two', backend: 'aniyomi-jvm' as const, sourceId: '303', sourceIds: ['303'] },
  ]

  it('is empty when every installed package is disabled', () => {
    // The reported case: Java ran with no source enabled. Disabling filtered results AFTER the
    // runtime had already been asked to list its sources, so turning an extension off stopped it
    // being used but not being started.
    expect(liveJvmSources(installed, ['eu.kanade.one', 'eu.kanade.two']).size).toBe(0)
  })

  it('is empty when nothing is installed', () => {
    expect(liveJvmSources([], []).size).toBe(0)
  })

  it('drops only the sources of the disabled package', () => {
    expect(liveJvmSources(installed, ['eu.kanade.one'])).toEqual(new Map([['303', 'eu.kanade.two']]))
  })

  it('honours a single source being disabled by its own id', () => {
    expect(liveJvmSources(installed, ['202'])).toEqual(new Map([
      ['101', 'eu.kanade.one'],
      ['303', 'eu.kanade.two'],
    ]))
  })

  it('keeps everything when nothing is disabled', () => {
    expect(liveJvmSources(installed, []).size).toBe(3)
  })
})
