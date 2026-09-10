import { describe, expect, it } from 'vitest'
import {
  anyConnected,
  connectedServices,
  idleConnectStates,
  tileBusy,
  type ConnectStates,
} from './connect-state'

const states = (overrides: Partial<ConnectStates>): ConnectStates => ({ ...idleConnectStates(), ...overrides })

describe('connect tile state', () => {
  it('starts every service idle', () => {
    expect(connectedServices(idleConnectStates())).toEqual([])
    expect(anyConnected(idleConnectStates())).toBe(false)
  })

  it('reports connected services in a stable order', () => {
    const value = states({
      mal: { status: 'connected', identity: 'alex' },
      stremio: { status: 'connected', identity: 'alex@example.com' },
    })
    expect(connectedServices(value)).toEqual(['stremio', 'mal'])
    expect(anyConnected(value)).toBe(true)
  })

  it('does not count a failed or waiting service as connected', () => {
    const value = states({
      stremio: { status: 'error', message: 'Wrong password.' },
      nuvio: { status: 'code', code: 'ABC-123', url: 'https://example.invalid/link', completing: false },
      anilist: { status: 'busy' },
    })
    expect(connectedServices(value)).toEqual([])
    expect(anyConnected(value)).toBe(false)
  })

  it('treats waiting on an approval code as busy so the tile cannot be re-fired', () => {
    expect(tileBusy({ status: 'busy' })).toBe(true)
    expect(tileBusy({ status: 'code', code: 'ABC-123', url: 'https://example.invalid/link', completing: true })).toBe(true)
    expect(tileBusy({ status: 'idle' })).toBe(false)
    expect(tileBusy({ status: 'connected', identity: 'alex' })).toBe(false)
    expect(tileBusy({ status: 'error', message: 'nope' })).toBe(false)
  })
})
