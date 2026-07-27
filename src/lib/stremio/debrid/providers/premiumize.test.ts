import { beforeEach, describe, it, expect, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({ httpFetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: httpFetch }))

import { serveJson, called } from '../../../../test/debrid-http'
import { pmStatus, pmListItem, pmFile, premiumize } from './premiumize'

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
