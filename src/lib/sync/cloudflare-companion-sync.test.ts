import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompanionHomeSnapshot, CompanionMedia } from '$lib/companion/protocol'
import {
  cloudflareSyncConfig,
  publishCloudflareCompanionSnapshot,
  readCloudflareCompanionProgress,
  type CloudflareCompanionTransport,
} from './cloudflare'

const endpoint = 'https://private.example.workers.dev'
const transport: CloudflareCompanionTransport = {
  protocol: 1,
  endpoint,
  pairingId: 'companion_pairing_123456',
  tvToken: 'T'.repeat(43),
  playbackMode: 'cloud-only',
  wakeWhenClosed: false,
}

function configure(): void {
  cloudflareSyncConfig.set({
    enabled: true,
    endpoint,
    deviceId: '0123456789abcdef01234567',
    deviceToken: 'D'.repeat(43),
    groupKey: 'G'.repeat(43),
    workerVersion: '1.6.0',
  })
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

function encoded(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function encryptProgress(mediaKey: string, value: unknown): Promise<string> {
  const iv = new Uint8Array(12).fill(7)
  const key = await crypto.subtle.importKey('raw', bytes(transport.tvToken), { name: 'AES-GCM' }, false, ['encrypt'])
  const data = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv,
    additionalData: new TextEncoder().encode(`izumi-companion:${transport.pairingId}:progress:${mediaKey}`),
  }, key, new TextEncoder().encode(JSON.stringify(value)))
  return JSON.stringify({ v: 1, iv: encoded(iv), data: encoded(new Uint8Array(data)) })
}

describe('encrypted TV materialization', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('publishes a TV snapshot as ciphertext using owner authentication', async () => {
    configure()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const snapshot: CompanionHomeSnapshot = {
      app: 'izumi', kind: 'companion-home', version: 1, revision: 'one', generatedAt: 1,
      catalog: { screen: 'anilist', label: 'AniList' }, spoilersHidden: false,
      hero: { ref: { provider: 'anilist', type: 'anime', id: '21' }, title: 'Private title' },
      rows: [],
    }

    await publishCloudflareCompanionSnapshot(transport, snapshot)

    expect(fetchMock.mock.calls[0][0]).toBe(`${endpoint}/v1/companion/pairings/${transport.pairingId}/snapshots`)
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('authorization')).toBe(`Bearer ${'D'.repeat(43)}`)
    const body = String(fetchMock.mock.calls[0][1]?.body)
    expect(body).not.toContain('Private title')
    expect(JSON.parse(body)).toMatchObject({ screen: 'anilist' })
  })

  it('decrypts a TV checkpoint back into the normal client sync path', async () => {
    configure()
    const mediaKey = 'M'.repeat(43)
    const media: CompanionMedia = {
      mediaId: 21, ref: { provider: 'anilist', type: 'anime', id: '21' }, title: 'One Piece', episode: 12,
    }
    const payload = await encryptProgress(mediaKey, {
      media, sessionId: 'cloud-playback', positionSeconds: 600, durationSeconds: 1_440,
      state: 'paused', completed: false, updatedAt: 1234,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      records: [{ mediaKey, payload }],
    }))))

    await expect(readCloudflareCompanionProgress(transport)).resolves.toMatchObject([{
      recordKey: mediaKey, media: { mediaId: 21, episode: 12 }, positionSeconds: 600, state: 'paused',
    }])
  })
})
