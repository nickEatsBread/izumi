import { describe, expect, it } from 'vitest'
import {
  generateRoomCode, liveRoomHost, nextHostTransferStep, participantFromWire,
  reactionRateError, validReaction,
} from './client'

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

describe('Watch Together participant readiness', () => {
  const base = {
    deviceId: 'peer',
    name: 'Peer',
    role: 'guest' as const,
    updatedAt: 1,
  }

  it('keeps explicit ready/loading states and exposes playback position', () => {
    expect(participantFromWire({
      ...base,
      readiness: 'ready',
      paused: true,
      position: 42,
      mediaId: 7,
      episode: 3,
    })).toMatchObject({ readiness: 'ready', paused: true, position: 42, mediaId: 7, episode: 3 })
  })

  it('lets the live buffering signal override a stale ready state', () => {
    expect(participantFromWire({
      ...base,
      readiness: 'ready',
      buffering: true,
    }).readiness).toBe('buffering')
  })

  it('maps old peers without readiness to a useful compatible status', () => {
    expect(participantFromWire(base).readiness).toBe('waiting')
    expect(participantFromWire({ ...base, mediaId: 9 }).readiness).toBe('ready')
  })
})

describe('Watch Together room validation', () => {
  const wire = (role: 'host' | 'guest', roomCode: string, updatedAt: number) =>
    JSON.stringify({
      app: 'izumi', kind: 'watch-party', version: 1,
      deviceId: `${role}-device`, name: role, role, roomCode, updatedAt,
    })

  it('finds a live host for the exact room', () => {
    const now = 100_000
    expect(liveRoomHost([
      wire('guest', 'ABC234', now),
      wire('host', 'ABC234', now - 1000),
      wire('host', 'ZZZ999', now),
    ], 'ABC234', now)?.role).toBe('host')
  })

  it('rejects stale hosts', () => {
    const now = 100_000
    expect(liveRoomHost([wire('host', 'ABC234', now - 30_000)], 'ABC234', now)).toBeNull()
  })

  it('pins authority to the expected device instead of accepting a newer host claim', () => {
    const now = 100_000
    const legitimate = wire('host', 'ABC234', now - 1_000)
    const impostor = JSON.stringify({
      ...JSON.parse(wire('host', 'ABC234', now)),
      deviceId: 'guest-claiming-host',
    })
    expect(liveRoomHost([legitimate, impostor], 'ABC234', now, 'host-device')?.deviceId)
      .toBe('host-device')
  })
})

describe('Watch Together host transfer', () => {
  const transfer = { id: 'transfer-123', phase: 'request' as const }

  it('requires the matching accept before commit', () => {
    expect(nextHostTransferStep(transfer)).toBe('wait')
    expect(nextHostTransferStep(transfer, { id: 'another-transfer', phase: 'accepted' })).toBe('wait')
    expect(nextHostTransferStep(transfer, { id: transfer.id, phase: 'ready' })).toBe('wait')
    expect(nextHostTransferStep(transfer, { id: transfer.id, phase: 'accepted' })).toBe('commit')
  })

  it('finalizes only after the selected guest saw the commit', () => {
    const committed = { ...transfer, phase: 'commit' as const }
    expect(nextHostTransferStep(committed, { id: transfer.id, phase: 'accepted' })).toBe('wait')
    expect(nextHostTransferStep(committed, { id: transfer.id, phase: 'ready' })).toBe('finalize')
  })
})

describe('Watch Together reactions', () => {
  const reaction = {
    id: 'device-event-1', sender: 'device', emoji: '🔥' as const, position: 42,
    mediaId: 7, episode: 3,
  }

  it('accepts only bounded, supported reaction events', () => {
    expect(validReaction(reaction)).toBe(true)
    expect(validReaction({ ...reaction, emoji: '💣' as '🔥' })).toBe(false)
    expect(validReaction({ ...reaction, position: Number.NaN })).toBe(false)
    expect(validReaction({ ...reaction, id: 'x' })).toBe(false)
  })

  it('limits bursts without blocking normal reaction timing', () => {
    const now = 20_000
    expect(reactionRateError([], now)).toBe('')
    expect(reactionRateError([now - 349], now)).toContain('too fast')
    expect(reactionRateError(Array.from({ length: 8 }, (_, index) => now - 9_000 + index * 1_000), now))
      .toContain('Take a breath')
    expect(reactionRateError([now - 10_001], now)).toBe('')
  })
})
