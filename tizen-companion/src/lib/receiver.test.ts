import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionMedia } from '../types'
import { CompanionReceiver, type ReceiverEvents } from './receiver'

const credential = 'ab'.repeat(32)
const transport = {
  protocol: 1,
  endpoint: 'https://private-worker.example',
  pairingId: 'private_pairing_1',
  tvToken: 'private_tv_token_12345678901234567890',
  playbackMode: 'cloud-only',
  wakeWhenClosed: false,
}

const media: CompanionMedia = {
  ref: { provider: 'tmdb', type: 'movie', id: '550' },
  resolver: { streamType: 'movie' },
  title: 'Fight Club',
  season: 0,
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

let encryptedPlaintext = ''
let storage: MemoryStorage

class FakeSmartViewChannel {
  readonly handlers = new Map<string, (...args: unknown[]) => void>()
  readonly publish = vi.fn()
  readonly disconnect = vi.fn()
  on(event: string, callback: (...args: unknown[]) => void) {
    this.handlers.set(event, callback)
  }
  connect(_options: unknown, callback: (error?: unknown) => void) {
    callback()
  }
  emit(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.(...args)
  }
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
  encryptedPlaintext = ''
  storage = new MemoryStorage()
  storage.setItem('izumi.companion.credential', credential)
  storage.setItem('izumi.companion.cloudflare', JSON.stringify(transport))
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('location', { hostname: '192.168.1.20' })
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval })
  vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest)
  vi.stubGlobal('crypto', {
    getRandomValues: (values: Uint8Array) => {
      values.fill(7)
      return values
    },
    subtle: {
      importKey: vi.fn(async () => ({})),
      encrypt: vi.fn(async (_algorithm: unknown, _key: unknown, data: Uint8Array) => {
        encryptedPlaintext = new TextDecoder().decode(data)
        return new Uint8Array([1, 2, 3]).buffer
      }),
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('companion play routing', () => {
  it('accepts a credential-authenticated Worker route for an already-paired TV', async () => {
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: {
        local: (callback: (error: unknown, service: unknown) => void) => callback(null, {
          channel: () => channel,
        }),
      },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()
    const replacement = { ...transport, pairingId: 'replacement_pair', tvToken: 'x'.repeat(40) }

    channel.emit('izumi.companion.transport', { credential: 'wrong', cloudflare: replacement }, 'client')
    expect(JSON.parse(storage.getItem('izumi.companion.cloudflare') || '{}').pairingId).toBe(transport.pairingId)
    channel.emit('izumi.companion.transport', { credential, cloudflare: replacement }, 'client')
    expect(JSON.parse(storage.getItem('izumi.companion.cloudflare') || '{}')).toEqual(replacement)
    expect(channel.publish).toHaveBeenCalledWith('izumi.companion.transport-ready', {
      pairingId: replacement.pairingId,
    }, 'client')
    receiver.disconnect()
  })

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
      body: { ref: media.ref, season: 0, streamType: 'movie' },
    })
  })

  it('falls back to the encrypted mobile notification when resolving is disabled', async () => {
    storage.setItem('izumi.companion.cloudflare', JSON.stringify({
      ...transport,
      playbackMode: 'cloud-and-device',
      wakeWhenClosed: true,
    }))
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
    expect(JSON.parse(encryptedPlaintext)).toMatchObject({
      ref: media.ref,
      resolver: { streamType: 'movie' },
      season: 0,
    })
  })

  it('does not contact or wake a linked device in Cloudflare-only mode', async () => {
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: { ok: true, selectedId: null, candidates: [], fallback: null },
    })

    await expect(new CompanionReceiver(events()).requestPlay(media)).resolves.toBe('no-source')
    expect(FakeXmlHttpRequest.sent.map((request) => request.url)).toEqual([
      'https://private-worker.example/v1/companion/pairings/private_pairing_1/resolve',
    ])
  })

  it('asks an open linked device after the Worker in combined mode', async () => {
    storage.setItem('izumi.companion.cloudflare', JSON.stringify({
      ...transport,
      playbackMode: 'cloud-and-device',
      wakeWhenClosed: false,
    }))
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: { ok: true, selectedId: null, candidates: [], fallback: 'paired-device' },
    })
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()
    const pending = receiver.requestPlay(media)
    await vi.advanceTimersByTimeAsync(0)
    const play = channel.publish.mock.calls.find(([event]) => event === 'izumi.companion.play')?.[1] as {
      pairingId: string
      requestId: string
    }
    expect(play).toBeTruthy()
    channel.emit('izumi.companion.play-accepted', { pairingId: play.pairingId, requestId: play.requestId })

    await expect(pending).resolves.toBe('local')
    expect(FakeXmlHttpRequest.sent).toHaveLength(1)
    receiver.disconnect()
  })

  it('opens the linked-device picker for source changes without resolving again', async () => {
    storage.setItem('izumi.companion.cloudflare', JSON.stringify({
      ...transport,
      playbackMode: 'cloud-and-device',
      wakeWhenClosed: false,
    }))
    const channel = new FakeSmartViewChannel()
    Object.assign(window, {
      msf: { local: (callback: (error: unknown, service: unknown) => void) => callback(null, { channel: () => channel }) },
    })
    const receiver = new CompanionReceiver(events())
    await receiver.connect()

    const pending = receiver.requestDeviceSourceChange(media, 523.75)
    await vi.advanceTimersByTimeAsync(0)
    const play = channel.publish.mock.calls.find(([event]) => event === 'izumi.companion.play')?.[1] as {
      pairingId: string
      requestId: string
      playback: { selection: string; positionSeconds: number }
    }
    expect(play.playback).toEqual({ selection: 'manual', positionSeconds: 523.75 })
    expect(FakeXmlHttpRequest.sent).toHaveLength(0)
    channel.emit('izumi.companion.play-accepted', { pairingId: play.pairingId, requestId: play.requestId })

    await expect(pending).resolves.toBe('local')
    receiver.disconnect()
  })

  it('does not offer linked-device source changes in Cloudflare-only mode', async () => {
    const receiver = new CompanionReceiver(events())
    expect(receiver.canRequestDeviceSourceChange()).toBe(false)
    await expect(receiver.requestDeviceSourceChange(media, 30)).resolves.toBe('no-source')
    expect(FakeXmlHttpRequest.sent).toHaveLength(0)
  })

  it('never queues a closed desktop request in combined mode', async () => {
    storage.setItem('izumi.companion.cloudflare', JSON.stringify({
      ...transport,
      playbackMode: 'cloud-and-device',
      wakeWhenClosed: false,
    }))
    FakeXmlHttpRequest.responder = () => ({
      status: 200,
      body: { ok: true, selectedId: null, candidates: [], fallback: 'paired-device' },
    })
    const pending = new CompanionReceiver(events()).requestPlay(media)
    await vi.advanceTimersByTimeAsync(1_200)

    await expect(pending).resolves.toBe('open-client')
    expect(FakeXmlHttpRequest.sent).toHaveLength(1)
  })

  it('does not assume a legacy Worker route may wake a closed desktop', async () => {
    const { playbackMode: _playbackMode, wakeWhenClosed: _wakeWhenClosed, ...legacy } = transport
    storage.setItem('izumi.companion.cloudflare', JSON.stringify(legacy))
    const pending = new CompanionReceiver(events()).requestPlay(media)
    await vi.advanceTimersByTimeAsync(1_200)

    await expect(pending).resolves.toBe('open-client')
    expect(FakeXmlHttpRequest.sent).toHaveLength(0)
  })
})
