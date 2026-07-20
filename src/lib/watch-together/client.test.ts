import { describe, expect, it } from 'vitest'
import { generateRoomCode, liveRoomHost } from './client'

describe('Watch Together room codes', () => {
  it('generates the six characters required by the join screen', () => {
    const code = generateRoomCode(new Uint8Array([0, 1, 2, 3, 4, 5]))
    expect(code).toBe('ABCDEF')
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)
  })

  it('rejects an undersized random input', () => {
    expect(() => generateRoomCode(new Uint8Array(3))).toThrow('Six random bytes')
  })
})

describe('Watch Together room validation', () => {
  const record = (role: 'host' | 'guest', roomCode: string, updatedAt: number) => ({
    deviceId: `${role}-device`,
    payload: JSON.stringify({
      app: 'izumi', kind: 'watch-party', version: 1,
      deviceId: `${role}-device`, name: role, role, roomCode, updatedAt,
    }),
  })

  it('finds a live host for the exact room', () => {
    const now = 100_000
    expect(liveRoomHost([
      record('guest', 'ABC234', now),
      record('host', 'ABC234', now - 1000),
      record('host', 'ZZZ999', now),
    ], 'ABC234', now)?.role).toBe('host')
  })

  it('rejects stale hosts', () => {
    const now = 100_000
    expect(liveRoomHost([record('host', 'ABC234', now - 30_000)], 'ABC234', now)).toBeNull()
  })
})
