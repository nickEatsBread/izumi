import { afterEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  MAX_REMEMBERED_SOURCES,
  episodeSourceOrigins,
  forgetSourceOrigin,
  mergeEpisodeSourceOrigins,
  mergeSourceOrigins,
  rememberSourceOrigin,
  sourceOrigins,
} from './source-origin'

describe('remembered source origins', () => {
  afterEach(() => {
    sourceOrigins.set({})
    episodeSourceOrigins.set({})
  })

  it('stores only the origin fingerprint and release identity', () => {
    rememberSourceOrigin(101, { kind: 'addon', id: 'opaque-id', name: 'Torrent source' }, {
      infoHash: 'abc123', group: 'SubsPlease', bingeGroup: 'pack',
    })
    expect(get(sourceOrigins)[101]).toMatchObject({
      origin: { kind: 'addon', id: 'opaque-id', name: 'Torrent source' },
      release: { infoHash: 'abc123', group: 'SubsPlease', bingeGroup: 'pack' },
    })
  })

  it('stores an exact episode source alongside the title source', () => {
    rememberSourceOrigin(101, { kind: 'addon', id: 'opaque-id' }, { group: 'Group' }, 4)

    expect(get(episodeSourceOrigins)['101:4']).toMatchObject({
      origin: { kind: 'addon', id: 'opaque-id' },
      release: { group: 'Group' },
    })
  })

  it('forgets title and episode source memory together', () => {
    rememberSourceOrigin(101, { kind: 'addon', id: 'opaque-id' }, { group: 'Group' }, 4)
    rememberSourceOrigin(102, { kind: 'addon', id: 'other-id' }, { group: 'Other' }, 1)

    forgetSourceOrigin(101)

    expect(get(sourceOrigins)[101]).toBeUndefined()
    expect(get(episodeSourceOrigins)['101:4']).toBeUndefined()
    expect(get(episodeSourceOrigins)['102:1']).toBeDefined()
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

  it('merges only valid newer episode records', () => {
    episodeSourceOrigins.set({
      '5:2': { origin: { kind: 'addon', id: 'current' }, updatedAt: 20 },
    })

    expect(mergeEpisodeSourceOrigins({
      '5:2': { origin: { kind: 'addon', id: 'old' }, updatedAt: 10 },
      '5:3': { origin: { kind: 'addon', id: 'new' }, updatedAt: 30 },
      invalid: { origin: { kind: 'addon', id: 'invalid' }, updatedAt: 40 },
    })).toBe(1)
    expect(get(episodeSourceOrigins)['5:2'].origin.id).toBe('current')
    expect(get(episodeSourceOrigins)['5:3'].origin.id).toBe('new')
  })
})
