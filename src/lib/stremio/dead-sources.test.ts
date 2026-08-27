import { beforeEach, describe, expect, it } from 'vitest'
import { markDead, markRouteDead, markAlive, isDead, forgetDead, fingerprint, routeFingerprint, DEAD_MS, DEAD_REPEAT_MS } from './dead-sources'

const t0 = 1_700_000_000_000
const KEY = 'SUPERSECRETAPIKEY123'
const RESOLVER = `https://torrentio.strem.fun/resolve/realdebrid/${KEY}/aabbccddeeff00112233445566778899aabbccdd/null/1/Show.mkv`

beforeEach(() => forgetDead())

describe('fingerprints never persist a credential', () => {
  it('does not write a debrid api key into the record', () => {
    // These rows are resolver URLs with the user's own debrid key embedded in the path, and this
    // record is persisted to localStorage for days. Keying on the raw URL stored the key.
    expect(fingerprint({ url: RESOLVER })).not.toContain(KEY)
  })

  it('recognises the torrent behind a resolver url, so one failure covers every copy', () => {
    expect(fingerprint({ url: RESOLVER }))
      .toBe(fingerprint({ infoHash: 'AABBCCDDEEFF00112233445566778899AABBCCDD' }))
  })

  it('never stores an opaque url verbatim either', () => {
    const url = 'https://host/stream/abcdef123456token'
    expect(fingerprint({ url })).not.toContain('abcdef123456token')
  })

  it('still keys two different urls apart, and one url stably', () => {
    expect(fingerprint({ url: 'https://host/a' })).not.toBe(fingerprint({ url: 'https://host/b' }))
    expect(fingerprint({ url: 'https://host/a' })).toBe(fingerprint({ url: 'https://host/a' }))
  })
})

describe('failed-source memory', () => {
  it('does not consider an unseen source dead', () => {
    expect(isDead({ url: 'https://host/a.mkv' }, t0)).toBe(false)
  })

  it('remembers a source that failed', () => {
    const s = { url: 'https://host/a.mkv' }
    markDead(s, t0)
    expect(isDead(s, t0 + 1000)).toBe(true)
  })

  it('rehabilitates a source once it proves it can show a frame', () => {
    const s = { infoHash: 'ABC123', url: 'http://127.0.0.1/video' }
    markDead(s, t0)
    markAlive({ infoHash: 'abc123', url: 'http://127.0.0.1/other' }, t0 + 1000)
    expect(isDead(s, t0 + 2000)).toBe(false)
  })

  it('does not tar a different source with the same brush', () => {
    markDead({ url: 'https://host/a.mkv' }, t0)
    expect(isDead({ url: 'https://host/b.mkv' }, t0)).toBe(false)
  })

  it('forgets a source once its window has passed', () => {
    const s = { url: 'https://host/a.mkv' }
    markDead(s, t0)
    expect(isDead(s, t0 + DEAD_MS + 1)).toBe(false)
  })

  it('remembers a repeat offender for much longer', () => {
    const s = { url: 'https://host/a.mkv' }
    markDead(s, t0)
    markDead(s, t0 + 1000)
    expect(isDead(s, t0 + DEAD_MS + 1)).toBe(true)
    expect(isDead(s, t0 + DEAD_REPEAT_MS + 2000)).toBe(false)
  })

  it('remembers a torrent by hash, across the addons and urls that offer it', () => {
    // The same release comes back from several addons under different resolve URLs, and a debrid
    // failure is torrent-level, so keying on the URL would let every other copy fail in turn.
    markDead({ infoHash: 'ABC123', url: 'https://one/resolve' }, t0)
    expect(isDead({ infoHash: 'abc123', url: 'https://two/resolve' }, t0)).toBe(true)
  })

  it('can remember one opaque route without tarring another offer of the release', () => {
    const first = {
      infoHash: 'ABC123',
      __candidate: { releaseId: 'release', offerId: 'one', routeId: 'route-one', offerCount: 2, routeCount: 2 },
    }
    const alternate = {
      infoHash: 'ABC123',
      __candidate: { releaseId: 'release', offerId: 'two', routeId: 'route-two', offerCount: 2, routeCount: 2 },
    }
    expect(routeFingerprint(first)).toBe('r:route-one')
    markRouteDead(first, t0)
    expect(isDead(first, t0)).toBe(true)
    expect(isDead(alternate, t0)).toBe(false)
    markAlive(first, t0 + 1)
    expect(isDead(first, t0 + 2)).toBe(false)
  })

  it('still marks every route when the release itself is wrong', () => {
    const first = {
      infoHash: 'ABC123',
      __candidate: { releaseId: 'release', offerId: 'one', routeId: 'route-one', offerCount: 2, routeCount: 2 },
    }
    const alternate = {
      infoHash: 'ABC123',
      __candidate: { releaseId: 'release', offerId: 'two', routeId: 'route-two', offerCount: 2, routeCount: 2 },
    }
    markDead(first, t0)
    expect(isDead(alternate, t0)).toBe(true)
  })

  it('keys a source with neither hash nor url by its origin and label', () => {
    const s = { name: 'Provider', title: 'Show - 01', __origin: { kind: 'online-extension' as const, id: 'p1' } }
    markDead(s, t0)
    expect(isDead(s, t0)).toBe(true)
    expect(isDead({ ...s, title: 'Show - 02' }, t0)).toBe(false)
  })

  it('ignores a source it cannot fingerprint at all', () => {
    expect(isDead({}, t0)).toBe(false)
    markDead({}, t0)
    expect(isDead({}, t0)).toBe(false)
  })
})
