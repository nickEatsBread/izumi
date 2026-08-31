import { describe, expect, it } from 'vitest'
import {
  companionWorkerPlaybackPolicy,
  normalizeCompanionPairingCode,
  shouldProvisionCompanionWorkerRoute,
} from './client'

describe('TV Companion pairing code', () => {
  it('normalizes the formatted six-character code', () => {
    expect(normalizeCompanionPairingCode('a82 b04')).toBe('A82B04')
    expect(normalizeCompanionPairingCode(' A8-2_B04 ')).toBe('A82B04')
  })

  it('rejects incomplete or non-hex codes', () => {
    expect(normalizeCompanionPairingCode('A82')).toBeNull()
    expect(normalizeCompanionPairingCode('TVPAIR')).toBeNull()
  })
})

describe('TV Companion private Worker route', () => {
  it('provisions Android for wake-ups and an opted-in desktop for direct resolving', () => {
    expect(shouldProvisionCompanionWorkerRoute({ provider: 'cloudflare', android: true, tv: false, resolverEnabled: false })).toBe(true)
    expect(shouldProvisionCompanionWorkerRoute({ provider: 'cloudflare', android: false, tv: false, resolverEnabled: true })).toBe(true)
  })

  it('keeps Cloudflare-only as the default resolver policy', () => {
    expect(companionWorkerPlaybackPolicy({
      provider: 'cloudflare', android: true, tv: false,
      profile: { enabled: true, connectedDeviceFallback: false },
    })).toEqual({ provision: true, playbackMode: 'cloud-only', wakeWhenClosed: true })
  })

  it('uses a device only after Cloudflare when the owner explicitly opts in', () => {
    expect(companionWorkerPlaybackPolicy({
      provider: 'cloudflare', android: true, tv: false,
      profile: { enabled: true, connectedDeviceFallback: true },
    })).toEqual({ provision: true, playbackMode: 'cloud-and-device', wakeWhenClosed: true })
    expect(companionWorkerPlaybackPolicy({
      provider: 'cloudflare', android: false, tv: false,
      profile: { enabled: true, connectedDeviceFallback: true },
    })).toEqual({ provision: true, playbackMode: 'cloud-and-device', wakeWhenClosed: false })
  })

  it('does not provision an ordinary desktop, a TV client, or an Iroh pairing', () => {
    expect(shouldProvisionCompanionWorkerRoute({ provider: 'cloudflare', android: false, tv: false, resolverEnabled: false })).toBe(false)
    expect(shouldProvisionCompanionWorkerRoute({ provider: 'cloudflare', android: true, tv: true, resolverEnabled: true })).toBe(false)
    expect(shouldProvisionCompanionWorkerRoute({ provider: 'iroh', android: true, tv: false, resolverEnabled: true })).toBe(false)
  })
})
