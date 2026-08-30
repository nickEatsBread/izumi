import { afterEach, describe, expect, it, vi } from 'vitest'
import { SamsungSmartViewChannel } from './samsung-smart-view'

class FakeWebSocket {
  static OPEN = 1
  static CLOSING = 2
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.OPEN
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  constructor(public url: string) { FakeWebSocket.instances.push(this) }
  send(value: string) { this.sent.push(value) }
  close() { this.readyState = FakeWebSocket.CLOSING }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}

describe('Samsung Smart View channel', () => {
  afterEach(() => {
    FakeWebSocket.instances = []
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
    socket.receive({ event: 'ms.channel.connect', data: { id: 'sender', clients: [{ id: 'sender' }] } })
    await connected
    channel.publish('izumi.load', { sessionId: 'one' }, 'host')
    expect(JSON.parse(socket.sent[0])).toEqual({
      method: 'ms.channel.emit',
      params: { event: 'izumi.load', data: { sessionId: 'one' }, to: 'host' },
    })
  })
})
