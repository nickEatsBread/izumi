import { describe, expect, it } from 'vitest'
import { appendMagnetTrackers, normalizeStreamBehavior, safeProxyHeaders } from './stream-behavior'
import { hashOf } from './debrid/http'

describe('safeProxyHeaders', () => {
  it('keeps normal request headers and rejects injection', () => {
    expect(safeProxyHeaders({ Referer: ' https://example.com/ ', 'X-Bad\r\nInjected': 'yes', Empty: '' }))
      .toEqual({ Referer: 'https://example.com/' })
  })
})

describe('normalizeStreamBehavior', () => {
  it('maps proxyHeaders.request and preserves internal header overrides', () => {
    const out = normalizeStreamBehavior({
      url: 'https://video',
      behaviorHints: { proxyHeaders: { request: { Referer: 'https://addon', Origin: 'https://addon' } } },
      __headers: { Referer: 'https://internal' },
    })
    expect(out.__headers).toEqual({ Referer: 'https://internal', Origin: 'https://addon' })
  })

  it('injects unique tracker sources into the magnet', () => {
    const out = normalizeStreamBehavior({
      infoHash: 'a'.repeat(40),
      sources: ['tracker:udp://tracker.example:80', 'tracker:udp://tracker.example:80', 'dht:ignored'],
    })
    // Asserted on the raw string, not via `new URL().searchParams`: that decodes on read and so
    // reports a healthy `xt` even when the stored magnet has been mangled.
    expect(out.__magnet).toBe(`magnet:?xt=urn:btih:${'a'.repeat(40)}&tr=udp%3A%2F%2Ftracker.example%3A80`)
  })
})

const HASH = 'c'.repeat(40)

describe('appendMagnetTrackers', () => {
  it('keeps xt verbatim so the infoHash stays extractable', () => {
    const out = appendMagnetTrackers(`magnet:?xt=urn:btih:${HASH}`, ['udp://tracker.example:80'])
    expect(out).toContain(`xt=urn:btih:${HASH}`)
    expect(out).not.toContain('urn%3Abtih')
    expect(hashOf(out)).toBe(HASH)
  })

  it('leaves an existing display name and its spaces alone', () => {
    const magnet = `magnet:?xt=urn:btih:${HASH}&dn=Some Show`
    const out = appendMagnetTrackers(magnet, ['udp://tracker.example:80'])
    expect(out).toBe(`${magnet}&tr=udp%3A%2F%2Ftracker.example%3A80`)
    expect(out).not.toContain('Some+Show')
  })

  it('appends encoded trackers and dedupes against existing and repeated entries', () => {
    const magnet = `magnet:?xt=urn:btih:${HASH}&tr=udp%3A%2F%2Fold.example%3A80`
    const out = appendMagnetTrackers(magnet, [
      'udp://old.example:80',
      'https://new.example/announce',
      'https://new.example/announce',
    ])
    expect(out).toBe(`${magnet}&tr=https%3A%2F%2Fnew.example%2Fannounce`)
  })

  it('returns the magnet byte-identical when there are no trackers to add', () => {
    const magnet = `magnet:?xt=urn:btih:${HASH}&dn=Some Show&tr=udp%3A%2F%2Fold.example%3A80`
    expect(appendMagnetTrackers(magnet, [])).toBe(magnet)
    expect(normalizeStreamBehavior({ __magnet: magnet }).__magnet).toBe(magnet)
    expect(normalizeStreamBehavior({ __magnet: magnet, sources: ['dht:ignored'] }).__magnet).toBe(magnet)
  })

  it('leaves a non-magnet or query-less URI untouched', () => {
    expect(appendMagnetTrackers('https://example.com/f.mkv', ['udp://t:80'])).toBe('https://example.com/f.mkv')
    expect(appendMagnetTrackers('magnet:', ['udp://t:80'])).toBe('magnet:')
  })

  it('survives the round trip a debrid resolve makes through the magnet', () => {
    const out = normalizeStreamBehavior({
      infoHash: HASH,
      __magnet: `magnet:?xt=urn:btih:${HASH}&dn=Some Show`,
      sources: ['tracker:udp://tracker.example:80'],
    })
    // play.ts hands `__magnet ?? infoHash` to the debrid layer, which hashes it.
    expect(hashOf(out.__magnet ?? HASH)).toBe(HASH)
  })
})
