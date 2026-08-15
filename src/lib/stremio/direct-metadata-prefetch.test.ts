import { describe, expect, it } from 'vitest'
import { directMetadataPrefetchKey, directMetadataPrefetchRequest } from './direct-metadata-prefetch'
import type { Stream } from './addon'

const HASH = '0123456789abcdef0123456789abcdef01234567'

describe('direct torrent metadata prefetch requests', () => {
  it('prefers a hash-pinned torrent URL with a short fallback budget', () => {
    const request = directMetadataPrefetchRequest({
      infoHash: HASH,
      __torrentUrl: 'https://example.test/release.torrent',
      __magnet: `magnet:?xt=urn:btih:${HASH}`,
    } as Stream)

    expect(request).toEqual({
      magnet: 'https://example.test/release.torrent',
      expectedInfoHash: HASH,
      timeoutMs: 5_000,
    })
    expect(directMetadataPrefetchKey(request!)).toBe(`${HASH}:torrent`)
  })

  it('falls back to a magnet and rejects already-resolved streams', () => {
    expect(directMetadataPrefetchRequest({ infoHash: HASH } as Stream)).toEqual({
      magnet: `magnet:?xt=urn:btih:${HASH}`,
      expectedInfoHash: HASH,
    })
    expect(directMetadataPrefetchRequest({ url: 'https://example.test/video', infoHash: HASH } as Stream))
      .toBeUndefined()
  })
})
