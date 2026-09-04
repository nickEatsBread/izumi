import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cloudflareSyncConfig,
  createCloudflareCompanionPairing,
  saveCloudflareResolverProfile,
  normalizeCloudflareEndpoint,
  parseCloudflareInvite,
  readCloudflareCompanionRequest,
} from './cloudflare'

function ticket(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `izumi-cloudflare:${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`
}

describe('Cloudflare self-hosted sync', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('accepts only root HTTPS Worker endpoints', () => {
    expect(normalizeCloudflareEndpoint(' https://izumi-sync.example.workers.dev/ '))
      .toBe('https://izumi-sync.example.workers.dev')
    expect(() => normalizeCloudflareEndpoint('http://izumi-sync.example.workers.dev')).toThrow(/HTTPS/)
    expect(() => normalizeCloudflareEndpoint('https://example.com/sync')).toThrow(/root URL/)
    expect(() => normalizeCloudflareEndpoint('https://user:secret@example.com')).toThrow(/credentials/)
  })

  it('parses an invite carrying an endpoint, one-use code, and 256-bit group key', () => {
    const key = 'A'.repeat(43)
    expect(parseCloudflareInvite(ticket({
      v: 1,
      endpoint: 'https://izumi-sync.example.workers.dev',
      code: 'invite_code_123456789012',
      key,
    }))).toEqual({
      v: 1,
      endpoint: 'https://izumi-sync.example.workers.dev',
      code: 'invite_code_123456789012',
      key,
    })
  })

  it('rejects malformed and short-key invites', () => {
    expect(() => parseCloudflareInvite('iroh-ticket')).toThrow(/not a Cloudflare/)
    expect(() => parseCloudflareInvite(ticket({
      v: 1,
      endpoint: 'https://example.com',
      code: 'invite_code_123456789012',
      key: 'short',
    }))).toThrow(/malformed/)
  })

  it('creates TV capabilities only in the configured private Worker', async () => {
    cloudflareSyncConfig.set({
      enabled: true,
      endpoint: 'https://private.example.workers.dev',
      deviceId: '0123456789abcdef01234567',
      deviceToken: 'D'.repeat(43),
      groupKey: 'G'.repeat(43),
      workerVersion: '1.1.0',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        app: 'izumi-sync', version: '1.1.0', protocol: 1, claimed: true,
        features: ['companion-wake-v1', 'web-push-v1'],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const pairing = await createCloudflareCompanionPairing()
    expect(pairing.endpoint).toBe('https://private.example.workers.dev')
    expect(pairing.pairingId).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(pairing).toMatchObject({ playbackMode: 'device-only', wakeWhenClosed: false })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://private.example.workers.dev/v1/companion/pairings')
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('izumi.app')
  })

  it('authenticates and decrypts a private-Worker TV request', async () => {
    const pairingId = 'abcdefghijklmnopqrstuvwx'
    const requestId = '0123456789abcdefghijklmn'
    const credential = 'ab'.repeat(32)
    const issuedAt = Date.now()
    const expiresAt = issuedAt + 300_000
    const plain = new TextEncoder().encode(JSON.stringify({
      v: 1,
      pairingId,
      requestId,
      ref: { provider: 'anilist', type: 'anime', id: '21' },
      episode: 4,
      season: 2,
      resolver: { streamType: 'series' },
      playback: { selection: 'manual', positionSeconds: 523.75 },
      issuedAt,
      expiresAt,
    }))
    const keyBytes = Uint8Array.from({ length: 32 }, () => 0xab)
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt({
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(`izumi-companion:${pairingId}:${requestId}`),
    }, key, plain)
    const encode = (bytes: Uint8Array) => {
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    }
    const payload = JSON.stringify({ v: 1, iv: encode(iv), data: encode(new Uint8Array(encrypted)) })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ payload, state: 'queued', issuedAt, expiresAt })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const request = await readCloudflareCompanionRequest(pairingId, requestId, credential)
    expect(request.media).toEqual({
      ref: { provider: 'anilist', type: 'anime', id: '21' },
      resolver: { streamType: 'series' },
      playback: { selection: 'manual', positionSeconds: 523.75 },
      title: '',
      episode: 4,
      season: 2,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uploads the explicit resolver profile only to the configured private Worker', async () => {
    cloudflareSyncConfig.set({
      enabled: true,
      endpoint: 'https://private.example.workers.dev',
      deviceId: '0123456789abcdef01234567',
      deviceToken: 'D'.repeat(43),
      groupKey: 'G'.repeat(43),
      workerVersion: '1.2.0',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        app: 'izumi-sync', version: '1.2.0', protocol: 1, claimed: true,
        features: ['companion-wake-v1', 'web-push-v1', 'cloud-resolver-v1'],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, updatedAt: 123 })))
    vi.stubGlobal('fetch', fetchMock)
    await saveCloudflareResolverProfile({
      enabled: true,
      addons: ['https://addon.example/config'],
      quality: '1080',
      sort: 'quality',
      audioLang: 'jpn',
      connectedDeviceFallback: false,
      debrid: null,
    })
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://private.example.workers.dev/v1/resolver/profile')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ debrid: null })
  })

  it('requires the updated private Worker before enabling connected-device fallback', async () => {
    cloudflareSyncConfig.set({
      enabled: true,
      endpoint: 'https://private.example.workers.dev',
      deviceId: '0123456789abcdef01234567',
      deviceToken: 'D'.repeat(43),
      groupKey: 'G'.repeat(43),
      workerVersion: '1.2.0',
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      app: 'izumi-sync', version: '1.2.0', protocol: 1, claimed: true,
      features: ['companion-wake-v1', 'web-push-v1', 'cloud-resolver-v1'],
    })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(saveCloudflareResolverProfile({
      enabled: true,
      addons: ['https://addon.example/config'],
      quality: '1080',
      sort: 'quality',
      audioLang: 'jpn',
      connectedDeviceFallback: true,
      debrid: null,
    })).rejects.toThrow(/Update your Izumi Cloudflare Worker/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uploads the configured debrid provider only to a Worker advertising native debrid resolution', async () => {
    cloudflareSyncConfig.set({
      enabled: true,
      endpoint: 'https://private.example.workers.dev',
      deviceId: '0123456789abcdef01234567',
      deviceToken: 'D'.repeat(43),
      groupKey: 'G'.repeat(43),
      workerVersion: '1.6.0',
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        app: 'izumi-sync', version: '1.6.0', protocol: 1, claimed: true,
        features: ['cloud-resolver-v1', 'cloud-resolver-v2', 'cloud-resolver-debrid-v1'],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, updatedAt: 456 })))
    vi.stubGlobal('fetch', fetchMock)

    await saveCloudflareResolverProfile({
      enabled: true,
      addons: ['https://addon.example/config'],
      quality: '1080',
      sort: 'quality',
      audioLang: 'jpn',
      connectedDeviceFallback: false,
      debrid: { provider: 'torbox', credential: 'T'.repeat(32) },
    })

    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(body.debrid).toEqual({ provider: 'torbox', credential: 'T'.repeat(32) })
  })

  it('refuses to upload a debrid credential to an older Worker', async () => {
    cloudflareSyncConfig.set({
      enabled: true,
      endpoint: 'https://private.example.workers.dev',
      deviceId: '0123456789abcdef01234567',
      deviceToken: 'D'.repeat(43),
      groupKey: 'G'.repeat(43),
      workerVersion: '1.4.0',
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      app: 'izumi-sync', version: '1.4.0', protocol: 1, claimed: true,
      features: ['cloud-resolver-v1', 'cloud-resolver-v2'],
    })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(saveCloudflareResolverProfile({
      enabled: true,
      addons: ['https://addon.example/config'],
      quality: '1080',
      sort: 'quality',
      audioLang: 'jpn',
      connectedDeviceFallback: false,
      debrid: { provider: 'alldebrid', credential: 'A'.repeat(32) },
    })).rejects.toThrow(/Update your Izumi Cloudflare Worker/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
