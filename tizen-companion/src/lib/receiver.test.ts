import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionMedia } from '../types'
import { CompanionReceiver, type ReceiverEvents } from './receiver'

const credential = 'ab'.repeat(32)
const transport = {
  protocol: 1,
  endpoint: 'https://private-worker.example',
  pairingId: 'private_pairing_1',
  tvToken: 'private_tv_token_12345678901234567890',
}

const media: CompanionMedia = {
  ref: { provider: 'tmdb', type: 'movie', id: '550' },
  resolver: { streamType: 'movie' },
  title: 'Fight Club',
}

class MemoryStorage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

interface SentRequest {
  method: string
  url: string
  timeout: number
  headers: Record<string, string>
  body: unknown
}

class FakeXmlHttpRequest {
  static responder: (request: SentRequest) => { status: number; body: unknown }
  static sent: SentRequest[] = []
  method = ''
  url = ''
  timeout = 0
  status = 0
  responseText = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  private readonly headers: Record<string, string> = {}

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body: string | null) {
    const request = {
      method: this.method,
      url: this.url,
      timeout: this.timeout,
      headers: this.headers,
      body: body ? JSON.parse(body) : null,
    }
    FakeXmlHttpRequest.sent.push(request)
    const response = FakeXmlHttpRequest.responder(request)
    this.status = response.status
    this.responseText = JSON.stringify(response.body)
    queueMicrotask(() => this.onload?.())
  }
}

const events = (): ReceiverEvents => ({
  onConnection: vi.fn(),
  onPaired: vi.fn(),
  onPairingInfo: vi.fn(),
  onSnapshot: vi.fn(),
  onSearchResults: vi.fn(),
  onLoad: vi.fn(),
  onControl: vi.fn(),
})

beforeEach(() => {
  vi.useFakeTimers()
  FakeXmlHttpRequest.sent = []
  const storage = new MemoryStorage()
  storage.setItem('izumi.companion.credential', credential)
  storage.setItem('izumi.companion.cloudflare', JSON.stringify(transport))
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('location', { hostname: '192.168.1.20' })
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest)
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint8Array) => {
      values.fill(7)
      return values
    },
    subtle: {
      importKey: vi.fn(async () => ({})),
      encrypt: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('companion play routing', () => {
  it('plays a resolved source on the TV without creating a phone request', async () => {
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: {
        ok: true,
        selectedId: 'direct',
        candidates: [{ id: 'direct', url: 'https://media.example/video.mp4', subtitles: [] }],
      },
    })
    const pending = new CompanionReceiver(events()).requestPlay(media)
    await vi.advanceTimersByTimeAsync(1_200)
    const result = await pending

    expect(result).toMatchObject({ kind: 'resolved', request: { url: 'https://media.example/video.mp4', title: 'Fight Club' } })
    expect(FakeXmlHttpRequest.sent).toHaveLength(1)
    expect(FakeXmlHttpRequest.sent[0]).toMatchObject({
      method: 'POST',
      url: 'https://private-worker.example/v1/companion/pairings/private_pairing_1/resolve',
      timeout: 30_000,
      headers: { Authorization: `Bearer ${transport.tvToken}` },
      body: { ref: media.ref, streamType: 'movie' },
    })
  })

  it('falls back to the encrypted mobile notification when resolving is disabled', async () => {
    FakeXmlHttpRequest.responder = (request) => request.url.endsWith('/resolve')
      ? { status: 409, body: { error: 'Cloud source resolving is disabled for this TV.' } }
      : { status: 201, body: { ok: true, notified: 1 } }
    const pending = new CompanionReceiver(events()).requestPlay(media)
    await vi.advanceTimersByTimeAsync(1_200)

    expect(await pending).toBe('notified')
    expect(FakeXmlHttpRequest.sent.map((request) => request.url)).toEqual([
      'https://private-worker.example/v1/companion/pairings/private_pairing_1/resolve',
      expect.stringMatching(/^https:\/\/private-worker\.example\/v1\/companion\/pairings\/private_pairing_1\/requests\//),
    ])
  })
})
