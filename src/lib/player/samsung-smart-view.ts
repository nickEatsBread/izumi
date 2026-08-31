/**
 * Minimal client for Samsung's Smart View channel transport.
 *
 * Samsung's TV service owns the WebSocket hub on port 8001. Izumi only needs the documented
 * channel connect/publish surface, not the SDK's cloud-backed browser discovery iframe: the TV's
 * address has already been found locally through SSDP.
 */

export const IZUMI_TIZEN_CHANNEL = 'com.nicho.izumi.cast'
export const IZUMI_TIZEN_APPLICATION_ID = 'IzumiTV001.IzumiTV'

export interface SamsungChannelPeer {
  id: string
  attributes?: Record<string, unknown>
  isHost?: boolean
}

type SamsungChannelHandler = (data: unknown, from?: SamsungChannelPeer) => void
type SamsungConnectionHandler = (reconnected: boolean) => void

type ChannelMessage = {
  event?: string
  data?: any
  from?: string
}

export class SamsungSmartViewChannel {
  private socket: WebSocket | null = null
  private listeners = new Map<string, Set<SamsungChannelHandler>>()
  private peers = new Map<string, SamsungChannelPeer>()
  private receiverWaiters = new Set<(available: boolean) => void>()
  private connectionHandlers = new Set<SamsungConnectionHandler>()
  private connectPromise: Promise<void> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private everConnected = false
  private closedByUser = false
  clientId = ''

  constructor(
    private address: string,
    private attributes: Record<string, string>,
    private channelId = IZUMI_TIZEN_CHANNEL,
    private applicationId?: string,
  ) {}

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN && !!this.clientId
  }

  /** A local TV-app channel is marked as the host by Samsung's service. */
  get hasReceiver() {
    return [...this.peers.values()].some((peer) => peer.isHost && peer.id !== this.clientId)
  }

  /** Samsung can acknowledge the sender before it reports the already-open TV app as a peer. */
  waitForReceiver(timeoutMs = 1_200): Promise<boolean> {
    if (this.hasReceiver) return Promise.resolve(true)
    if (!this.connected) return Promise.resolve(false)
    return new Promise((resolve) => {
      let settled = false
      const finish = (available: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.receiverWaiters.delete(finish)
        resolve(available)
      }
      const timer = setTimeout(() => finish(false), timeoutMs)
      this.receiverWaiters.add(finish)
      // Close the gap between the initial check and registering the waiter.
      if (this.hasReceiver) finish(true)
    })
  }

  private notifyReceiverWaiters(available: boolean) {
    if (!available) {
      for (const waiter of [...this.receiverWaiters]) waiter(false)
      return
    }
    if (this.hasReceiver) {
      for (const waiter of [...this.receiverWaiters]) waiter(true)
    }
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.connected || this.connectPromise || this.reconnectTimer) return
    const delay = Math.min(5_000, 500 * (2 ** Math.min(this.reconnectAttempts, 4)))
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.closedByUser || this.connected) return
      void this.connect().catch(() => this.scheduleReconnect())
    }, delay)
  }

  connect(timeoutMs = 2_500): Promise<void> {
    if (this.connected) return Promise.resolve()
    if (this.connectPromise) return this.connectPromise
    this.closedByUser = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const query = Object.entries(this.attributes)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&')
    const url = `ws://${this.address}:8001/api/v2/channels/${encodeURIComponent(this.channelId)}${query ? `?${query}` : ''}`

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false
      let channelTimer: ReturnType<typeof setTimeout> | null = null
      let launchTimer: ReturnType<typeof setTimeout> | null = null
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        if (channelTimer) clearTimeout(channelTimer)
        if (launchTimer) clearTimeout(launchTimer)
        this.connectPromise = null
        if (error) reject(error)
        else resolve()
      }
      const startChannelTimer = () => {
        channelTimer = setTimeout(() => {
          const expiredSocket = this.socket
          this.socket = null
          this.clientId = ''
          this.peers.clear()
          this.notifyReceiverWaiters(false)
          if (expiredSocket && expiredSocket.readyState < WebSocket.CLOSING) expiredSocket.close()
          finish(new Error('Samsung receiver connection timed out'))
          if (this.everConnected && !this.closedByUser) this.scheduleReconnect()
        }, timeoutMs)
      }
      const openSocket = () => {
        if (settled || this.closedByUser) return
        try {
        const socket = new WebSocket(url)
        this.socket = socket
        socket.onopen = () => {}
        socket.onmessage = (event) => {
          if (this.socket !== socket) return
          if (typeof event.data !== 'string') return
          let message: ChannelMessage
          try { message = JSON.parse(event.data) as ChannelMessage } catch { return }
          if (message.event === 'ms.channel.connect') {
            const reconnected = this.everConnected
            this.clientId = typeof message.data?.id === 'string' ? message.data.id : ''
            this.peers.clear()
            for (const peer of Array.isArray(message.data?.clients) ? message.data.clients : []) {
              if (peer && typeof peer.id === 'string') this.peers.set(peer.id, peer)
            }
            this.notifyReceiverWaiters(true)
            if (this.clientId) {
              this.everConnected = true
              this.reconnectAttempts = 0
              for (const handler of [...this.connectionHandlers]) {
                try { handler(reconnected) } catch { /* one observer must not break the channel */ }
              }
            }
            finish(this.clientId ? undefined : new Error('Samsung receiver returned an invalid channel identity'))
            return
          }
          if (message.event === 'ms.channel.clientConnect' && typeof message.data?.id === 'string') {
            this.peers.set(message.data.id, message.data)
            this.notifyReceiverWaiters(true)
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
          if (this.socket !== socket) {
            finish(new Error('Samsung TV channel closed before connecting'))
            return
          }
          const shouldRecover = this.everConnected && !this.closedByUser
          this.socket = null
          this.clientId = ''
          this.peers.clear()
          this.notifyReceiverWaiters(false)
          finish(new Error('Samsung TV channel closed before connecting'))
          if (shouldRecover) this.scheduleReconnect()
        }
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Could not open the Samsung TV channel'))
        }
      }
      if (this.applicationId) {
        // Samsung's Application.connect flow launches the installed application over HTTP before
        // opening its WebSocket channel. Sending ms.application.start inside that socket is rejected
        // by 2018 firmware because the client has not joined a channel yet.
        launchTimer = setTimeout(() => {
          finish(new Error('Samsung receiver launch timed out'))
        }, 12_000)
        void fetch(`http://${this.address}:8001/api/v2/applications/${encodeURIComponent(this.applicationId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
          body: '{}',
        }).then((response) => {
          if (!response.ok) throw new Error(`Samsung could not launch the TV receiver (${response.status})`)
          if (settled) return
          if (launchTimer) clearTimeout(launchTimer)
          launchTimer = null
          startChannelTimer()
          openSocket()
        }).catch((error) => {
          finish(error instanceof Error ? error : new Error('Could not launch the Samsung TV receiver'))
        })
      } else {
        startChannelTimer()
        openSocket()
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

  onConnected(handler: SamsungConnectionHandler): () => void {
    this.connectionHandlers.add(handler)
    return () => this.connectionHandlers.delete(handler)
  }

  publish(event: string, data: unknown, target: string | string[] = 'broadcast') {
    if (!this.connected || !this.socket) throw new Error('Samsung TV channel is not connected')
    let resolvedTarget = target
    // Samsung's 2018 service advertises the TV app as a host but does not route the SDK's newer
    // `host` convenience alias. Address the concrete host peer(s) returned by ms.channel.connect.
    if (target === 'host') {
      const hosts = [...this.peers.values()]
        .filter((peer) => peer.isHost && peer.id !== this.clientId)
        .map((peer) => peer.id)
      if (!hosts.length) throw new Error('Samsung TV receiver host is not connected')
      resolvedTarget = hosts.length === 1 ? hosts[0] : hosts
    }
    this.socket.send(JSON.stringify({
      method: 'ms.channel.emit',
      params: { event, data, to: resolvedTarget },
    }))
  }

  disconnect() {
    this.closedByUser = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    this.socket = null
    this.clientId = ''
    this.peers.clear()
    this.notifyReceiverWaiters(false)
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
  }
}
