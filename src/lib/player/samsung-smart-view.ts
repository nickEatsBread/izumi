/**
 * Minimal client for Samsung's Smart View channel transport.
 *
 * Samsung's TV service owns the WebSocket hub on port 8001. Izumi only needs the documented
 * channel connect/publish surface, not the SDK's cloud-backed browser discovery iframe: the TV's
 * address has already been found locally through SSDP.
 */

export const IZUMI_TIZEN_CHANNEL = 'com.nicho.izumi.cast'

export interface SamsungChannelPeer {
  id: string
  attributes?: Record<string, unknown>
  isHost?: boolean
}

type SamsungChannelHandler = (data: unknown, from?: SamsungChannelPeer) => void

type ChannelMessage = {
  event?: string
  data?: any
  from?: string
}

export class SamsungSmartViewChannel {
  private socket: WebSocket | null = null
  private listeners = new Map<string, Set<SamsungChannelHandler>>()
  private peers = new Map<string, SamsungChannelPeer>()
  private connectPromise: Promise<void> | null = null
  clientId = ''

  constructor(
    private address: string,
    private attributes: Record<string, string>,
    private channelId = IZUMI_TIZEN_CHANNEL,
  ) {}

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN && !!this.clientId
  }

  /** A local TV-app channel is marked as the host by Samsung's service. */
  get hasReceiver() {
    return [...this.peers.values()].some((peer) => peer.isHost && peer.id !== this.clientId)
  }

  connect(timeoutMs = 2_500): Promise<void> {
    if (this.connected) return Promise.resolve()
    if (this.connectPromise) return this.connectPromise
    const query = Object.entries(this.attributes)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&')
    const url = `ws://${this.address}:8001/api/v2/channels/${encodeURIComponent(this.channelId)}${query ? `?${query}` : ''}`

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.connectPromise = null
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(() => {
        this.disconnect()
        finish(new Error('Samsung receiver connection timed out'))
      }, timeoutMs)
      try {
        const socket = new WebSocket(url)
        this.socket = socket
        socket.onmessage = (event) => {
          if (typeof event.data !== 'string') return
          let message: ChannelMessage
          try { message = JSON.parse(event.data) as ChannelMessage } catch { return }
          if (message.event === 'ms.channel.connect') {
            this.clientId = typeof message.data?.id === 'string' ? message.data.id : ''
            this.peers.clear()
            for (const peer of Array.isArray(message.data?.clients) ? message.data.clients : []) {
              if (peer && typeof peer.id === 'string') this.peers.set(peer.id, peer)
            }
            finish(this.clientId ? undefined : new Error('Samsung receiver returned an invalid channel identity'))
            return
          }
          if (message.event === 'ms.channel.clientConnect' && typeof message.data?.id === 'string') {
            this.peers.set(message.data.id, message.data)
            return
          }
          if (message.event === 'ms.channel.clientDisconnect' && typeof message.data?.id === 'string') {
            this.peers.delete(message.data.id)
            return
          }
          if (!message.event || message.event.startsWith('ms.channel.')) return
          const from = message.from ? this.peers.get(message.from) : undefined
          for (const handler of this.listeners.get(message.event) ?? []) handler(message.data, from)
        }
        socket.onerror = () => finish(new Error('Could not connect to the Samsung TV service'))
        socket.onclose = () => {
          this.clientId = ''
          this.peers.clear()
          finish(new Error('Samsung TV channel closed before connecting'))
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Could not open the Samsung TV channel'))
      }
    })
    return this.connectPromise
  }

  on(event: string, handler: SamsungChannelHandler): () => void {
    const handlers = this.listeners.get(event) ?? new Set<SamsungChannelHandler>()
    handlers.add(handler)
    this.listeners.set(event, handlers)
    return () => handlers.delete(handler)
  }

  publish(event: string, data: unknown, target: string | string[] = 'broadcast') {
    if (!this.connected || !this.socket) throw new Error('Samsung TV channel is not connected')
    this.socket.send(JSON.stringify({
      method: 'ms.channel.emit',
      params: { event, data, to: target },
    }))
  }

  disconnect() {
    const socket = this.socket
    this.socket = null
    this.clientId = ''
    this.peers.clear()
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
  }
}
