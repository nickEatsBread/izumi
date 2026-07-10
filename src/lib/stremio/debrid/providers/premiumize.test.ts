import { describe, it, expect } from 'vitest'
import { pmStatus, pmListItem, pmFile } from './premiumize'

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
