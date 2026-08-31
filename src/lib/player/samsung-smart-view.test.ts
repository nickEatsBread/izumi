import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IZUMI_TIZEN_APPLICATION_ID, SamsungSmartViewChannel } from './samsung-smart-view'

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

describe('Samsung Smart View channel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
  })

  afterEach(() => {
    FakeWebSocket.instances = []
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('detects an open Izumi TV receiver from the host peer', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const channel = new SamsungSmartViewChannel('192.168.1.40', { name: 'Izumi Desktop' })
    const connected = channel.connect()
    const socket = FakeWebSocket.instances[0]
    expect(socket.url).toContain('ws://192.168.1.40:8001/api/v2/channels/com.nicho.izumi.cast')
    socket.receive({
      event: 'ms.channel.connect',
      data: { id: 'sender', clients: [
        { id: 'tv', isHost: true, attributes: { name: 'Izumi TV' } },
        { id: 'sender', isHost: false },
      ] },
    })
    await connected
    expect(channel.hasReceiver).toBe(true)
  })

  it('publishes receiver-targeted Izumi events with Samsung channel RPC', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const channel = new SamsungSmartViewChannel('192.168.1.40', { name: 'Desktop' })
    const connected = channel.connect()
    const socket = FakeWebSocket.instances[0]
    socket.receive({
      event: 'ms.channel.connect',
      data: { id: 'sender', clients: [{ id: 'tv', isHost: true }, { id: 'sender' }] },
    })
    await connected
    channel.publish('izumi.load', { sessionId: 'one' }, 'host')
    expect(JSON.parse(socket.sent[0])).toEqual({
      method: 'ms.channel.emit',
      params: { event: 'izumi.load', data: { sessionId: 'one' }, to: 'tv' },
    })
  })

  it('observes a receiver that Samsung announces after the sender connects', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const channel = new SamsungSmartViewChannel('192.168.1.40', { name: 'Desktop' })
    const connected = channel.connect()
    const socket = FakeWebSocket.instances[0]
    socket.receive({ event: 'ms.channel.connect', data: { id: 'sender', clients: [{ id: 'sender' }] } })
    await connected
    const receiver = channel.waitForReceiver()
    socket.receive({ event: 'ms.channel.clientConnect', data: { id: 'tv', isHost: true } })
    await expect(receiver).resolves.toBe(true)
  })

  it('asks Samsung to launch an installed application before opening its channel', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const channel = new SamsungSmartViewChannel(
      '192.168.1.40',
      { name: 'Desktop' },
      'com.nicho.izumi.cast',
      IZUMI_TIZEN_APPLICATION_ID,
    )
    channel.connect()
    expect(FakeWebSocket.instances).toHaveLength(0)
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const socket = FakeWebSocket.instances[0]
    expect(fetch).toHaveBeenCalledWith('http://192.168.1.40:8001/api/v2/applications/IzumiTV001.IzumiTV', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: '{}',
    })
    socket.open()
    expect(socket.sent).toEqual([])
    channel.disconnect()
  })

  it('does not spend the channel timeout while a cold TV application is still launching', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    let finishLaunch!: (response: Response) => void
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((resolve) => { finishLaunch = resolve }))
    const channel = new SamsungSmartViewChannel(
      '192.168.1.40',
      { name: 'Desktop' },
      'com.nicho.izumi.cast',
      IZUMI_TIZEN_APPLICATION_ID,
    )

    const connected = channel.connect(5_000)
    await vi.advanceTimersByTimeAsync(5_500)
    expect(FakeWebSocket.instances).toHaveLength(0)
    finishLaunch({ ok: true, status: 200 } as Response)
    await vi.advanceTimersByTimeAsync(0)
    const socket = FakeWebSocket.instances[0]
    socket.receive({
      event: 'ms.channel.connect',
      data: { id: 'sender', clients: [{ id: 'tv', isHost: true }, { id: 'sender' }] },
    })
    await expect(connected).resolves.toBeUndefined()
    channel.disconnect()
  })

  it('reconnects a channel that Samsung closes after it was established', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const channel = new SamsungSmartViewChannel(
      '192.168.1.40',
      { name: 'Desktop' },
      'com.nicho.izumi.cast',
      IZUMI_TIZEN_APPLICATION_ID,
    )
    const connections: boolean[] = []
    channel.onConnected((reconnected) => connections.push(reconnected))
    const connected = channel.connect()
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    const first = FakeWebSocket.instances[0]
    first.receive({
      event: 'ms.channel.connect',
      data: { id: 'sender-one', clients: [{ id: 'tv', isHost: true }, { id: 'sender-one' }] },
    })
    await connected

    vi.useFakeTimers()
    first.serverClose()
    expect(channel.connected).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    const second = FakeWebSocket.instances[1]
    second.open()
    second.receive({
      event: 'ms.channel.connect',
      data: { id: 'sender-two', clients: [{ id: 'tv', isHost: true }, { id: 'sender-two' }] },
    })

    expect(channel.clientId).toBe('sender-two')
    expect(connections).toEqual([false, true])
    expect(second.sent).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(2)
    channel.disconnect()
  })
})
