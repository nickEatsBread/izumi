import { beforeEach, describe, expect, it } from 'vitest'
import { markDead, isDead, forgetDead, DEAD_MS, DEAD_REPEAT_MS } from './dead-sources'

const t0 = 1_700_000_000_000

beforeEach(() => forgetDead())

describe('failed-source memory', () => {
  it('does not consider an unseen source dead', () => {
    expect(isDead({ url: 'https://host/a.mkv' }, t0)).toBe(false)
  })

  it('remembers a source that failed', () => {
    const s = { url: 'https://host/a.mkv' }
    markDead(s, t0)
    expect(isDead(s, t0 + 1000)).toBe(true)
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
