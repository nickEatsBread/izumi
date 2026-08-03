import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('$lib/net/http', () => ({ invokeNativeHttp: httpFetch }))

import { serveJson, called, urlsOf } from '../../../../test/debrid-http'
import fixture from '../__fixtures__/easydebrid-responses.json'
import { edFiles, edCached, edCacheMap, easydebrid } from './easydebrid'

const HASH = 'e'.repeat(40)
const EP2 = 'https://cdn.easydebrid.example/f/show-02.mkv'
const EP3 = 'https://cdn.easydebrid.example/f/show-03.mkv'

/** One canned response for every request, so a specific status/body can be asserted on. */
const serveOnce = (status: number, json: unknown) =>
  httpFetch.mockImplementation(async () => ({ status, body: JSON.stringify(json) }))

describe('edFiles', () => {
  it('folds the directory chain onto the filename and keeps size/url', () => {
    const files = edFiles(fixture.generateBatch)
    expect(files).toHaveLength(6)
    expect(files[1]).toEqual({
      name: '[Group] Show (01-03) [1080p]/[Group] Show - 02 [1080p][AAC].mkv',
      bytes: 1395864371,
      url: EP2,
    })
  })
  it('drops entries with no URL to play', () => {
    expect(edFiles({ files: [{ filename: 'a.mkv', size: 1 }, { filename: 'b.mkv', size: 2, url: 'https://x/b' }] }))
      .toEqual([{ name: 'b.mkv', bytes: 2, url: 'https://x/b' }])
  })
  it('is empty for a payload without a files array', () => {
    expect(edFiles({})).toEqual([])
  })
})

describe('edCached', () => {
  it('reads the first positional slot', () => {
    expect(edCached(fixture.lookupCached)).toBe(true)
    expect(edCached(fixture.lookupUncached)).toBe(false)
  })
  it('fails closed on any other shape', () => {
    expect(edCached({})).toBe(false)
    expect(edCached({ cached: [] })).toBe(false)
    expect(edCached({ cached: [1] })).toBe(false)
  })
})

describe('edCacheMap', () => {
  it('maps the positional cache response to normalized hashes', () => {
    expect([...edCacheMap({ cached: [true, false] }, ['AAA', 'bbb'])]).toEqual([
      ['aaa', 'cached'],
      ['bbb', 'uncached'],
    ])
  })

  it('leaves malformed and missing positions unknown', () => {
    expect(edCacheMap({}, ['aaa']).size).toBe(0)
    expect([...edCacheMap({ cached: [true] }, ['aaa', 'bbb'])]).toEqual([['aaa', 'cached']])
  })
})

describe('easydebrid.checkCached', () => {
  beforeEach(() => httpFetch.mockReset())

  it('checks every hash in one non-adding lookup', async () => {
    serveJson(httpFetch, [['/link/lookup', { cached: [true, false] }]])
    const result = await easydebrid.checkCached!('key', ['a'.repeat(40), 'b'.repeat(40)])
    expect([...result.values()]).toEqual(['cached', 'uncached'])
    expect(called(httpFetch, '/link/generate')).toBe(false)
    const body = JSON.parse(httpFetch.mock.calls[0][1].body)
    expect(body.urls).toHaveLength(2)
  })
})

describe('easydebrid.resolveHash noAdd', () => {
  beforeEach(() => httpFetch.mockReset())

  it('never asks for a link when the release is not cached', async () => {
    serveJson(httpFetch, [['/link/lookup', fixture.lookupUncached]])
    await expect(easydebrid.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/link/generate')).toBe(false)
  })

  it('never asks for a link when the lookup itself fails', async () => {
    serveJson(httpFetch, [])
    await expect(easydebrid.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow()
    expect(called(httpFetch, '/link/generate')).toBe(false)
  })

  it('serves a release the cache already holds', async () => {
    serveJson(httpFetch, [
      ['/link/lookup', fixture.lookupCached],
      ['/link/generate', fixture.generateBatch],
    ])
    await expect(easydebrid.resolveHash('key', HASH, { noAdd: true, want: { episode: 2 } })).resolves.toBe(EP2)
  })

  it('still resolves in one round trip for a normal (user-initiated) resolve', async () => {
    serveJson(httpFetch, [['/link/generate', fixture.generateBatch]])
    await expect(easydebrid.resolveHash('key', HASH, { want: { episode: 2 } })).resolves.toBe(EP2)
    expect(called(httpFetch, '/link/lookup')).toBe(false)
    expect(urlsOf(httpFetch)).toHaveLength(1)
  })
})

describe('easydebrid.resolveHash file selection', () => {
  beforeEach(() => httpFetch.mockReset())

  it('picks the wanted episode, not the largest file in the batch', async () => {
    serveJson(httpFetch, [['/link/generate', fixture.generateBatch]])
    await expect(easydebrid.resolveHash('key', HASH, { want: { episode: 2 } })).resolves.toBe(EP2)
    await expect(easydebrid.resolveHash('key', HASH)).resolves.toBe(EP3) // no want = legacy largest
  })

  it('honours the addon filename hint', async () => {
    serveJson(httpFetch, [['/link/generate', fixture.generateBatch]])
    const want = { episode: 9, filename: '[Group] Show - 03 [1080p][AAC].mkv' }
    await expect(easydebrid.resolveHash('key', HASH, { want })).resolves.toBe(EP3)
  })

  it('never serves the poster when the batch holds no video', async () => {
    serveJson(httpFetch, [['/link/generate', { files: [{ filename: 'poster.jpg', size: 310380, url: 'https://x/p.jpg' }] }]])
    await expect(easydebrid.resolveHash('key', HASH)).rejects.toThrow(/No playable file/)
  })

  it('says the release is uncached rather than "no playable file"', async () => {
    serveJson(httpFetch, [['/link/generate', fixture.generateEmpty]])
    await expect(easydebrid.resolveHash('key', HASH)).rejects.toThrow(/no cached copy/)
  })

  it('declines before any request when no key is set', async () => {
    serveJson(httpFetch, [])
    await expect(easydebrid.resolveHash('', HASH)).rejects.toThrow(/Settings → Extensions/)
    expect(httpFetch).not.toHaveBeenCalled()
  })

  // The generate payload is kept for the sidecar pass, and the URL in it is signed and expiring.
  // Playback must always be handed a freshly minted one.
  it('mints a new link every time rather than replaying the kept payload', async () => {
    serveJson(httpFetch, [['/link/generate', fixture.generateBatch]])
    await easydebrid.resolveHash('key', 'f'.repeat(40))
    await easydebrid.resolveHash('key', 'f'.repeat(40))
    expect(urlsOf(httpFetch)).toHaveLength(2)
  })
})

describe('easydebrid auth failures', () => {
  beforeEach(() => httpFetch.mockReset())

  it('routes a 401 through the shared classifier as a key problem', async () => {
    serveOnce(401, fixture.unauthenticated)
    await expect(easydebrid.resolveHash('key', HASH)).rejects.toThrow(/access denied — your API key looks wrong or expired/)
  })

  it('reads the lapsed-subscription body even though it arrives on a 200', async () => {
    serveOnce(200, fixture.notPremium)
    await expect(easydebrid.resolveHash('key', HASH)).rejects.toThrow(/subscription looks inactive or expired/)
  })

  it('sends Accept: application/json, without which a bad key answers in HTML', async () => {
    serveJson(httpFetch, [['/link/generate', fixture.generateBatch]])
    await easydebrid.resolveHash('key', HASH)
    expect(httpFetch.mock.calls[0][1].headers).toMatchObject({ Accept: 'application/json' })
  })
})

describe('easydebrid.resolveSidecars', () => {
  // The kept generate payload is module-level and keyed by magnet, so a case that wants to observe
  // a real request uses its own hash. The reuse it exists for is asserted on directly below.
  beforeEach(() => httpFetch.mockReset())

  it('attaches only the subtitle belonging to the chosen episode', async () => {
    serveJson(httpFetch, [['/link/generate', fixture.generateBatch]])
    const subs = await easydebrid.resolveSidecars!('key', 'a'.repeat(40), { want: { episode: 2 } })
    expect(subs).toEqual([{
      url: 'https://cdn.easydebrid.example/f/show-02.eng.srt',
      name: '[Group] Show (01-03) [1080p]/Subs/[Group] Show - 02 [1080p][AAC].eng.srt',
      lang: 'eng',
      title: 'Subtitle',
    }])
  })

  it('makes no request at all for a background prefetch', async () => {
    serveJson(httpFetch, [['/link/generate', fixture.generateBatch]])
    await expect(easydebrid.resolveSidecars!('key', 'b'.repeat(40), { noAdd: true })).resolves.toEqual([])
    expect(httpFetch).not.toHaveBeenCalled()
  })

  it('answers with nothing rather than throwing when the service errors', async () => {
    serveJson(httpFetch, [])
    await expect(easydebrid.resolveSidecars!('key', 'c'.repeat(40))).resolves.toEqual([])
  })

  // One generate returns every file, so the resolve that just ran already holds the subtitles.
  it('reuses the payload the resolve just fetched instead of asking twice', async () => {
    serveJson(httpFetch, [['/link/generate', fixture.generateBatch]])
    const hash = 'd'.repeat(40)
    await expect(easydebrid.resolveHash('key', hash, { want: { episode: 2 } })).resolves.toBe(EP2)
    const subs = await easydebrid.resolveSidecars!('key', hash, { want: { episode: 2 } })
    expect(subs.map((s) => s.lang)).toEqual(['eng'])
    expect(urlsOf(httpFetch)).toHaveLength(1)
  })

  it('asks for itself when the last resolve was for a different account', async () => {
    serveJson(httpFetch, [['/link/generate', fixture.generateBatch]])
    const hash = '9'.repeat(40)
    await easydebrid.resolveHash('key', hash)
    await easydebrid.resolveSidecars!('other-key', hash, { want: { episode: 2 } })
    expect(urlsOf(httpFetch)).toHaveLength(2)
  })
})
