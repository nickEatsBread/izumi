import { describe, expect, it } from 'vitest'
import { CONNECT_SERVICES, idleConnectStates, tileBusy } from './connect-state'

describe('connect tile state', () => {
  it('draws the four services in a fixed order', () => {
    expect(CONNECT_SERVICES).toEqual(['stremio', 'nuvio', 'anilist', 'mal'])
  })

  it('starts every service idle', () => {
    const idle = idleConnectStates()
    expect(Object.keys(idle)).toEqual([...CONNECT_SERVICES])
    expect(Object.values(idle).every((state) => state.status === 'idle')).toBe(true)
  })

  it('treats waiting on an approval code as busy so the tile cannot be re-fired', () => {
    expect(tileBusy({ status: 'busy' })).toBe(true)
    expect(tileBusy({ status: 'code', code: 'ABC-123', url: 'https://example.invalid/link', completing: true })).toBe(true)
    expect(tileBusy({ status: 'idle' })).toBe(false)
    expect(tileBusy({ status: 'connected', identity: 'alex' })).toBe(false)
    expect(tileBusy({ status: 'error', message: 'nope' })).toBe(false)
  })
})
