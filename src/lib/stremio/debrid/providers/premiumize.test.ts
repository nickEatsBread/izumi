import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: httpFetch }))

import { serveJson, called } from '../../../../test/debrid-http'
import { pmStatus, pmListItem, pmFile, pmCacheMap, pmCacheBody, premiumize } from './premiumize'

const HASH = '1'.repeat(40)

describe('pmStatus', () => {
  it('finished/seeding = ready', () => {
    expect(pmStatus({ status: 'finished' }).stage).toBe('ready')
    expect(pmStatus({ status: 'seeding' }).stage).toBe('ready')
  })
  it('error/timeout = error', () => {
    expect(pmStatus({ status: 'error' }).stage).toBe('error')
    expect(pmStatus({ status: 'timeout' }).stage).toBe('error')
  })
  it('running maps progress 0..1 -> 0..100', () => {
    const r = pmStatus({ status: 'running', progress: 0.4 })
    expect(r.stage).toBe('downloading')
    expect(r.progress).toBeCloseTo(40)
  })
  it('queued', () => {
    expect(pmStatus({ status: 'queued' }).stage).toBe('queued')
  })
  it('undefined status is downloading with 0%', () => {
    expect(pmStatus({}).stage).toBe('downloading')
  })
})

describe('pmListItem', () => {
  it('maps a finished transfer and derives the hash from src', () => {
    const it_ = pmListItem({ id: 'T1', name: 'Movie', status: 'finished', progress: 1, src: 'magnet:?xt=urn:btih:ABCDEF&dn=x' })
    expect(it_).toMatchObject({ id: 'T1', name: 'Movie', size: 0, status: 'ready', hash: 'abcdef' })
  })
  it('maps a running transfer', () => {
    expect(pmListItem({ id: 'T2', name: 'x', status: 'running', progress: 0.5 }).status).toBe('downloading')
  })
})

describe('pmFile', () => {
  it('uses the direct link as the id and flags videos', () => {
    expect(pmFile({ name: 'ep01.mkv', bytes: 60, link: 'https://p/ep01.mkv' })).toEqual({ id: 'https://p/ep01.mkv', name: 'ep01.mkv', size: 60, playable: true })
  })
})

describe('premiumize.resolveHash noAdd', () => {
  beforeEach(() => httpFetch.mockReset())

  it('never creates a transfer when the release is not already cached', async () => {
    serveJson(httpFetch, [['/transfer/directdl', { status: 'error', message: 'not cached' }]])
    await expect(premiumize.resolveHash('key', HASH, { noAdd: true })).rejects.toThrow(/background prefetch/)
    expect(called(httpFetch, '/transfer/create')).toBe(false)
  })

  it('keeps the directdl fast path, which creates nothing', async () => {
    serveJson(httpFetch, [['/transfer/directdl', { status: 'success', content: [{ path: 'Show_01.mkv', size: 100, link: 'https://cdn.premiumize/Show_01.mkv' }] }]])
    await expect(premiumize.resolveHash('key', HASH, { noAdd: true })).resolves.toBe('https://cdn.premiumize/Show_01.mkv')
    expect(called(httpFetch, '/transfer/create')).toBe(false)
  })

  it('still creates a transfer for a normal (user-initiated) resolve', async () => {
    serveJson(httpFetch, [
      ['/transfer/directdl', { status: 'error', message: 'not cached' }],
      ['/transfer/create', { status: 'success', id: 'T1' }],
      ['/transfer/list', { transfers: [{ id: 'T1', status: 'finished', folder_id: 'F1' }] }],
      ['/folder/list', { content: [{ type: 'file', path: 'Show_01.mkv', size: 100, link: 'https://cdn.premiumize/Show_01.mkv' }] }],
    ])
    await expect(premiumize.resolveHash('key', HASH)).resolves.toBe('https://cdn.premiumize/Show_01.mkv')
    expect(called(httpFetch, '/transfer/create')).toBe(true)
  })
})

describe('pmCacheMap', () => {
  const asked = ['aaa', 'bbb', 'ccc']

  it('zips the positional response array against the asked order', () => {
    const m = pmCacheMap({ status: 'success', response: [true, false, true] }, asked)
    expect(m.get('aaa')).toBe('cached')
    expect(m.get('bbb')).toBe('uncached')
    expect(m.get('ccc')).toBe('cached')
  })
  it('returns an empty map when status is not success', () => {
    expect(pmCacheMap({ status: 'error', message: 'bad' }, asked).size).toBe(0)
  })
  it('returns an empty map when response is not an array', () => {
    expect(pmCacheMap({ status: 'success', response: 'yes' }, asked).size).toBe(0)
    expect(pmCacheMap({ status: 'success' }, asked).size).toBe(0)
  })
  it('maps only the overlap when the response is SHORTER than the request', () => {
    const m = pmCacheMap({ status: 'success', response: [true] }, asked)
    expect(m.get('aaa')).toBe('cached')
    expect(m.has('bbb')).toBe(false)
    expect(m.has('ccc')).toBe(false)
  })
  it('lower-cases the hash keys', () => {
    expect(pmCacheMap({ status: 'success', response: [true] }, ['AAA']).get('aaa')).toBe('cached')
  })
})

// REGRESSION GUARD. FormData.set collapses duplicate keys; FormData.append does not.
// Using `set` here would silently reduce a 100-hash batch to ONE item, and because the response is
// positional every other row would come back as uncached — a silent, plausible-looking wrong answer.
describe('pmCacheBody', () => {
  it('appends one items[] entry PER hash', () => {
    const fd = pmCacheBody(['aaa', 'bbb', 'ccc'])
    expect(fd.getAll('items[]')).toHaveLength(3)
  })
  it('sends magnets, not bare hashes', () => {
    expect(String(pmCacheBody(['aaa']).getAll('items[]')[0])).toMatch(/^magnet:\?xt=urn:btih:aaa/)
  })
  it('preserves order so the positional response zips correctly', () => {
    const got = pmCacheBody(['aaa', 'bbb']).getAll('items[]').map(String)
    expect(got[0]).toContain('aaa')
    expect(got[1]).toContain('bbb')
  })
})
