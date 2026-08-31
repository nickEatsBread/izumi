import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tauri = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/api/core', () => tauri)

import {
  controlTizenReceiver,
  getTizenReceiverStatus,
  hasActiveTizenReceiverCast,
  probeTizenReceiver,
  setTizenReceiverRelayForeground,
  startTizenReceiverCast,
  stopTizenReceiverCast,
  subscribeTizenReceiverStatus,
} from './tizen-receiver-cast'

class FakeWebSocket {
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  constructor(public url: string) { FakeWebSocket.instances.push(this) }
  send(value: string) { this.sent.push(value) }
  open() { this.onopen?.() }
  close() { this.readyState = FakeWebSocket.CLOSING }
  serverClose() { this.readyState = FakeWebSocket.CLOSED; this.onclose?.() }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}

const device = { id: 'tv-one', name: 'Living room', address: '192.168.1.40' }
const connect = (socket: FakeWebSocket, withReceiver = true) => socket.receive({
  event: 'ms.channel.connect',
  data: {
    id: 'sender-one',
    clients: [
      { id: 'sender-one', isHost: false },
      ...(withReceiver ? [{ id: 'receiver-one', isHost: true }] : []),
    ],
  },
})
const nextSocket = async () => {
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
  return FakeWebSocket.instances[0]
}

describe('Tizen receiver sender', () => {
  beforeEach(() => {
    tauri.invoke.mockClear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
  })

  afterEach(async () => {
    await stopTizenReceiverCast()
    FakeWebSocket.instances = []
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('probes for the receiver host and disconnects cleanly', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const result = probeTizenReceiver(device)
    connect(FakeWebSocket.instances[0])
    await expect(result).resolves.toBe(true)
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSING)
  })

  it('uses the native relay service only for an active phone-hosted TV session', async () => {
    await setTizenReceiverRelayForeground(true, 'Episode 1')
    expect(tauri.invoke).toHaveBeenLastCalledWith('plugin:extplayer|companion_cast_foreground', {
      payload: { active: true, title: 'Episode 1' },
    })
    await setTizenReceiverRelayForeground(false)
    expect(tauri.invoke).toHaveBeenLastCalledWith('plugin:extplayer|companion_cast_foreground', {
      payload: { active: false, title: undefined },
    })
  })

  it('waits for Samsung to announce the open receiver after sender connection', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const result = probeTizenReceiver(device)
    const socket = FakeWebSocket.instances[0]
    connect(socket, false)
    await Promise.resolve()
    socket.receive({
      event: 'ms.channel.clientConnect',
      data: { id: 'receiver-one', isHost: true, attributes: { name: 'izumi Companion' } },
    })
    await expect(result).resolves.toBe(true)
  })

  it('starts a session only after the receiver acknowledges it, then sends controls', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const started = startTizenReceiverCast(device, {
      url: 'http://192.168.1.20:44200/media',
      contentType: 'video/mp4',
      title: 'Episode 1',
      contentRating: 'TV-14',
      positionSeconds: 12,
      subtitles: [{
        url: 'http://192.168.1.20:44200/subtitle/1',
        contentType: 'text/x-ssa',
        title: 'English',
        lang: 'en',
      }],
      activeTrackIds: [1],
      subtitleStyle: {
        enabled: true,
        scope: 'dialogue',
        font: 'Arial',
        bold: false,
        fontSize: 42,
        textColor: '#ffffff',
        borderColor: '#000000',
        borderSize: 3,
        shadow: 1,
        position: 92,
      },
    })
    const socket = await nextSocket()
    socket.open()
    connect(socket)
    await vi.waitFor(() => expect(socket.sent.some((value) => JSON.parse(value).params?.event === 'izumi.load')).toBe(true))
    expect(fetch).toHaveBeenCalledWith(
      'http://192.168.1.40:8001/api/v2/applications/IzumiTV001.IzumiTV',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    )
    const load = socket.sent.map((value) => JSON.parse(value))
      .find((value) => value.params?.event === 'izumi.load')
    expect(load.params.event).toBe('izumi.load')
    expect(load.params.to).toBe('receiver-one')
    expect(load.params.data.senderId).toBe('sender-one')
    expect(load.params.data.contentRating).toBe('TV-14')
    expect(load.params.data.subtitles[0].contentType).toBe('text/x-ssa')
    expect(load.params.data.subtitleStyle.fontSize).toBe(42)

    socket.receive({
      event: 'izumi.status',
      from: 'receiver-one',
      data: {
        sessionId: load.params.data.sessionId,
        state: 'playing',
        positionSeconds: 12,
        durationSeconds: 1_400,
      },
    })
    await expect(started).resolves.toMatchObject({ state: 'playing', positionSeconds: 12 })
    expect(hasActiveTizenReceiverCast()).toBe(true)

    expect(controlTizenReceiver({ action: 'pause' }).state).toBe('paused')
    expect(JSON.parse(socket.sent.at(-1)!).params).toMatchObject({
      event: 'izumi.control',
      to: 'receiver-one',
      data: { action: 'pause', sessionId: load.params.data.sessionId, senderId: 'sender-one' },
    })

    const statusUpdates: number[] = []
    const unsubscribe = subscribeTizenReceiverStatus((status) => statusUpdates.push(status.positionSeconds))
    expect(controlTizenReceiver({ action: 'seek', positionSeconds: 615 }).positionSeconds).toBe(615)
    socket.receive({
      event: 'izumi.status',
      from: 'receiver-one',
      data: {
        sessionId: load.params.data.sessionId,
        state: 'playing',
        positionSeconds: 14,
        durationSeconds: 1_400,
      },
    })
    expect(getTizenReceiverStatus().positionSeconds).toBe(615)
    socket.receive({
      event: 'izumi.status',
      from: 'receiver-one',
      data: {
        sessionId: load.params.data.sessionId,
        state: 'playing',
        positionSeconds: 615,
        durationSeconds: 1_400,
        activeTrackIds: [1],
      },
    })
    expect(statusUpdates.at(-1)).toBe(615)
    expect(getTizenReceiverStatus().activeTrackIds).toEqual([1])
    unsubscribe()

    await stopTizenReceiverCast()
    expect(hasActiveTizenReceiverCast()).toBe(false)
    expect(JSON.parse(socket.sent.at(-1)!).params.data).toMatchObject({
      action: 'stop',
      exitApp: true,
    })
  })

  it('launches a closed receiver and waits for its host before loading media', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const started = startTizenReceiverCast(device, {
      url: 'https://media.example/video.mp4',
      contentType: 'video/mp4',
      positionSeconds: 0,
      subtitles: [],
      activeTrackIds: [],
    })
    const socket = await nextSocket()
    socket.open()
    connect(socket, false)
    expect(socket.sent).toEqual([])
    expect(fetch).toHaveBeenCalledWith(
      'http://192.168.1.40:8001/api/v2/applications/IzumiTV001.IzumiTV',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    )
    socket.receive({
      event: 'ms.channel.clientConnect',
      data: { id: 'receiver-one', isHost: true },
    })
    await vi.waitFor(() => expect(socket.sent.length).toBe(1))
    const load = JSON.parse(socket.sent[0])
    socket.receive({
      event: 'izumi.status',
      from: 'receiver-one',
      data: {
        sessionId: load.params.data.sessionId,
        state: 'playing',
        positionSeconds: 0,
      },
    })
    await expect(started).resolves.toMatchObject({ state: 'playing' })
  })

  it('keeps the cast session and reattaches it after a transient Samsung channel close', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const started = startTizenReceiverCast(device, {
      url: 'https://media.example/video.mp4',
      contentType: 'video/mp4',
      positionSeconds: 87,
      subtitles: [],
      activeTrackIds: [],
    })
    const first = await nextSocket()
    first.open()
    connect(first)
    await vi.waitFor(() => expect(first.sent.some((value) => JSON.parse(value).params?.event === 'izumi.load')).toBe(true))
    const load = first.sent.map((value) => JSON.parse(value))
      .find((value) => value.params?.event === 'izumi.load')
    first.receive({
      event: 'izumi.status',
      from: 'receiver-one',
      data: {
        sessionId: load.params.data.sessionId,
        state: 'playing',
        positionSeconds: 87,
      },
    })
    await started

    vi.useFakeTimers()
    first.serverClose()
    expect(hasActiveTizenReceiverCast()).toBe(true)
    expect(first.sent.map((value) => JSON.parse(value)).some((value) => (
      value.params?.event === 'izumi.control' && value.params?.data?.action === 'stop'
    ))).toBe(false)
    expect(() => getTizenReceiverStatus()).toThrow('receiver is reconnecting')
    await vi.advanceTimersByTimeAsync(500)
    const second = FakeWebSocket.instances[1]
    second.open()
    second.receive({
      event: 'ms.channel.connect',
      data: {
        id: 'sender-two',
        clients: [
          { id: 'sender-two', isHost: false },
          { id: 'receiver-one', isHost: true },
        ],
      },
    })
    await Promise.resolve()

    const resume = second.sent.map((value) => JSON.parse(value))
      .find((value) => value.params?.event === 'izumi.resume')
    expect(resume.params).toMatchObject({
      to: 'receiver-one',
      data: { sessionId: load.params.data.sessionId, senderId: 'sender-two' },
    })
    second.receive({
      event: 'izumi.status',
      from: 'receiver-one',
      data: {
        sessionId: load.params.data.sessionId,
        state: 'playing',
        positionSeconds: 91,
      },
    })
    expect(getTizenReceiverStatus().positionSeconds).toBe(91)
  })

  it('stops an old item without exiting the TV app when replacing it', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const firstStarted = startTizenReceiverCast(device, {
      url: 'https://media.example/episode-1.mp4',
      contentType: 'video/mp4',
      positionSeconds: 0,
      subtitles: [],
      activeTrackIds: [],
    })
    const first = await nextSocket()
    first.open()
    connect(first)
    await vi.waitFor(() => expect(first.sent.length).toBeGreaterThan(0))
    const firstLoad = first.sent.map((value) => JSON.parse(value))
      .find((value) => value.params?.event === 'izumi.load')
    first.receive({
      event: 'izumi.status',
      from: 'receiver-one',
      data: { sessionId: firstLoad.params.data.sessionId, state: 'playing', positionSeconds: 0 },
    })
    await firstStarted

    const secondStarted = startTizenReceiverCast(device, {
      url: 'https://media.example/episode-2.mp4',
      contentType: 'video/mp4',
      positionSeconds: 0,
      subtitles: [],
      activeTrackIds: [],
    })
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(2))
    expect(JSON.parse(first.sent.at(-1)!).params.data).toMatchObject({
      action: 'stop',
      exitApp: false,
    })
    const second = FakeWebSocket.instances[1]
    second.open()
    connect(second)
    await vi.waitFor(() => expect(second.sent.length).toBeGreaterThan(0))
    const secondLoad = second.sent.map((value) => JSON.parse(value))
      .find((value) => value.params?.event === 'izumi.load')
    second.receive({
      event: 'izumi.status',
      from: 'receiver-one',
      data: { sessionId: secondLoad.params.data.sessionId, state: 'playing', positionSeconds: 0 },
    })
    await secondStarted
  })
})
