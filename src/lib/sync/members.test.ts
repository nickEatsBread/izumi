import { describe, expect, it } from 'vitest'
import { collectSyncMembers, fallbackDeviceName } from './members'

describe('collectSyncMembers', () => {
  it('always includes this device first, then others by name', () => {
    expect(collectSyncMembers('aaa', 'Deck', [
      { deviceId: 'bbb', name: 'Phone' },
      { deviceId: 'aaa', name: 'Stale name' },
    ])).toEqual([
      { deviceId: 'aaa', name: 'Deck', isThisDevice: true },
      { deviceId: 'bbb', name: 'Phone', isThisDevice: false },
    ])
  })

  it('falls back to a short id when this device has no name', () => {
    const id = 'abcdef123456'
    expect(collectSyncMembers(id, '', [])).toEqual([
      { deviceId: id, name: fallbackDeviceName(id), isThisDevice: true },
    ])
  })

  it('ignores blank names from other devices', () => {
    expect(collectSyncMembers('aaa', 'Deck', [{ deviceId: 'bbb', name: '   ' }])).toEqual([
      { deviceId: 'aaa', name: 'Deck', isThisDevice: true },
    ])
  })
})
