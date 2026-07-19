import { describe, it, expect } from 'vitest'
import { nextOfflineMode } from './offline'

describe('nextOfflineMode', () => {
  it('launch offline ⇒ on; launch online ⇒ off', () => {
    expect(nextOfflineMode(false, { force: false, online: false, event: 'boot' })).toBe(true)
    expect(nextOfflineMode(false, { force: false, online: true, event: 'boot' })).toBe(false)
  })

  it('force always wins, regardless of connectivity or event', () => {
    for (const online of [true, false]) {
      for (const event of ['boot', 'force-change', 'connectivity'] as const) {
        expect(nextOfflineMode(false, { force: true, online, event })).toBe(true)
      }
    }
  })

  it('un-forcing (force-change) reflects live connectivity', () => {
    expect(nextOfflineMode(true, { force: false, online: true, event: 'force-change' })).toBe(false) // online ⇒ leave
    expect(nextOfflineMode(true, { force: false, online: false, event: 'force-change' })).toBe(true) // offline ⇒ re-latch
  })

  it('reconnect exits offline mode when not forced', () => {
    expect(nextOfflineMode(true, { force: false, online: true, event: 'connectivity' })).toBe(false)
  })

  it('a mid-session drop does NOT auto-enter — keeps prev', () => {
    expect(nextOfflineMode(false, { force: false, online: false, event: 'connectivity' })).toBe(false)
    expect(nextOfflineMode(true, { force: false, online: false, event: 'connectivity' })).toBe(true)
  })
})
