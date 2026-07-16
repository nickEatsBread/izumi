import { afterEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  MAX_REMEMBERED_SOURCES,
  mergeSourceOrigins,
  rememberSourceOrigin,
  sourceOrigins,
} from './source-origin'

describe('remembered source origins', () => {
  afterEach(() => sourceOrigins.set({}))

  it('stores only the origin fingerprint and release identity', () => {
    rememberSourceOrigin(101, { kind: 'addon', id: 'opaque-id', name: 'Torrent source' }, {
      infoHash: 'abc123', group: 'SubsPlease', bingeGroup: 'pack',
    })
    expect(get(sourceOrigins)[101]).toMatchObject({
      origin: { kind: 'addon', id: 'opaque-id', name: 'Torrent source' },
      release: { infoHash: 'abc123', group: 'SubsPlease', bingeGroup: 'pack' },
    })
  })

  it('keeps only the most recently used titles', () => {
    const entries = Object.fromEntries(Array.from({ length: MAX_REMEMBERED_SOURCES + 5 }, (_, i) => [
      i,
      { origin: { kind: 'addon' as const, id: `source-${i}` }, updatedAt: i },
    ]))
    sourceOrigins.set(entries)
    mergeSourceOrigins({
      999: { origin: { kind: 'addon', id: 'newest' }, updatedAt: 999 },
    })
    const remembered = get(sourceOrigins)
    expect(Object.keys(remembered)).toHaveLength(MAX_REMEMBERED_SOURCES)
    expect(remembered[999]).toBeDefined()
    expect(remembered[0]).toBeUndefined()
  })

  it('rejects malformed and older peer records', () => {
    sourceOrigins.set({
      5: { origin: { kind: 'addon', id: 'current' }, updatedAt: 20 },
    })
    expect(mergeSourceOrigins({
      5: { origin: { kind: 'addon', id: 'old' }, updatedAt: 10 },
      nope: { origin: { kind: 'addon', id: 'invalid-key' }, updatedAt: 30 },
      6: { origin: { kind: 'unknown', id: 'invalid-kind' }, updatedAt: 30 },
    })).toBe(0)
    expect(get(sourceOrigins)[5].origin.id).toBe('current')
  })
})
