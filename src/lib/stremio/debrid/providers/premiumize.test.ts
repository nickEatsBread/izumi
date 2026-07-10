import { describe, it, expect } from 'vitest'
import { pmStatus } from './premiumize'

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
