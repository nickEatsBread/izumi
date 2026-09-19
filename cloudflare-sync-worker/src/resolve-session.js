import { sanitizeTvSourceStreams } from './tv-source-lookup.js'

export const RESOLVE_CHANNEL_VERSION = 1
export const RESOLVE_CHANNEL_BUDGET_MS = 45_000
const RETAIN_MS = 120_000
const MAX_MESSAGE_BYTES = 512 * 1024
const encoder = new TextEncoder()
const idPattern = /^[a-f0-9]{32}$/
const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('')
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join('')
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const sameIdentity = (a, b) => a?.pairingId === b?.pairingId && a?.tokenHash === b?.tokenHash && a?.profileHash === b?.profileHash && a?.profileId === b?.profileId

/** Dependency injection keeps the protocol testable without exposing an internal HTTP resolver. */
export function resolveSessionClass({ authorize, resolve }) {
  return class ResolveSession {
    constructor(ctx, env) {
      this.ctx = ctx
      this.env = env
      this.active = null
      this.messages = Promise.resolve()
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('izumi:ping', 'izumi:pong'))
    }

    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/admit' && request.method === 'POST') {
        // Only the authenticated outer Worker can call this internal route.
        const identity = await request.json()
        const now = Date.now()
        const previous = await this.ctx.storage.get('admission')
        if (previous && now - previous.issuedAt < 500) return json({ error: 'Wait before reconnecting.', code: 'CHANNEL_BUSY' }, 429)
        const ticket = randomId()
        await this.ctx.storage.put('admission', { identity, hash: await digest(ticket), issuedAt: now, expiresAt: now + 30_000 })
        await this.ctx.storage.setAlarm(now + RESOLVE_CHANNEL_BUDGET_MS + RETAIN_MS)
        return json({ protocol: RESOLVE_CHANNEL_VERSION, ticket, expiresAt: now + 30_000 })
      }
      if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket upgrade required.' }, 426)
      const ticket = url.searchParams.get('ticket') || ''
      if (!idPattern.test(ticket)) return json({ error: 'Invalid connection credential.' }, 401)
      const ticketHash = await digest(ticket)
      const admission = await this.ctx.storage.transaction(async tx => {
        const value = await tx.get('admission')
        if (!value || value.expiresAt <= Date.now() || value.hash !== ticketHash) return null
        await tx.delete('admission')
        return value
      })
      if (!admission || !await authorize(this.env, admission.identity)) return json({ error: 'Connection authorization expired.' }, 401)
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.ctx.acceptWebSocket(server)
      server.serializeAttachment({ identity: admission.identity, expiresAt: Date.now() + 30 * 60_000 })
      // A pairing needs only one control socket. The operation itself survives replacement.
      for (const socket of this.ctx.getWebSockets()) if (socket !== server) socket.close(4000, 'Connection replaced.')
      this.send(server, { type: 'channel.ready', protocol: RESOLVE_CHANNEL_VERSION })
      return new Response(null, { status: 101, webSocket: client })
    }

    send(socket, value) {
      const text = JSON.stringify({ protocol: RESOLVE_CHANNEL_VERSION, ...value })
      if (encoder.encode(text).length > MAX_MESSAGE_BYTES) throw new Error('Source results exceeded the channel limit.')
      try { socket?.send(text) } catch { /* A reconnect receives the retained snapshot. */ }
    }

    webSocketMessage(socket, data) {
      // Serialize admission/start/cancel commands, never the resolver's network waits.
      const command = this.messages.then(() => this.dispatch(socket, data))
      this.messages = command.catch(() => {})
      return command.catch(() => {
        this.send(socket, { type: 'channel.error', code: 'CHANNEL_INVALID', error: 'The source channel received an invalid message.' })
        socket.close(1008, 'Invalid message.')
      })
    }

    async dispatch(socket, data) {
      if (typeof data !== 'string' || encoder.encode(data).length > MAX_MESSAGE_BYTES) throw new Error('Invalid size.')
      const message = JSON.parse(data)
      if (message.protocol !== RESOLVE_CHANNEL_VERSION || !idPattern.test(message.requestId || '')) throw new Error('Invalid protocol.')
      const attachment = socket.deserializeAttachment()
      if (!attachment || attachment.expiresAt <= Date.now() || !await authorize(this.env, attachment.identity)) {
        if (this.active && sameIdentity(this.active.identity, attachment?.identity)) this.active.controller.abort(Object.assign(new Error('Profile authorization changed.'), { code: 'PROFILE_CHANGED' }))
        this.send(socket, { type: 'resolve.error', requestId: message.requestId, code: 'PROFILE_CHANGED', error: 'Choose and unlock your profile again.' })
        socket.close(4001, 'Authorization expired.')
        return
      }
      const identity = attachment.identity
      if (message.type === 'resolve.start') return this.start(socket, identity, message)
      if (message.type === 'resolve.resume') return this.resume(socket, identity, message.requestId)
      const active = this.active
      if (!active || active.record.requestId !== message.requestId || !sameIdentity(active.identity, identity)) return
      if (message.type === 'resolve.cancel') {
        active.controller.abort()
        return
      }
      if (message.type === 'fetch.result') {
        const pending = active.fetches.get(message.fetchId)
        if (!pending) return // Replayed/late results cannot be consumed twice.
        const streams = sanitizeTvSourceStreams(message.streams)
        const bytes = encoder.encode(JSON.stringify(streams)).length
        if (active.resultBytes + bytes > 360_000) throw new Error('TV results exceeded the operation limit.')
        active.resultBytes += bytes
        active.fetches.delete(message.fetchId)
        pending.finish(streams)
        return
      }
      throw new Error('Unknown message.')
    }

    async resume(socket, identity, requestId) {
      const active = this.active
      if (active?.record.requestId === requestId && sameIdentity(active.identity, identity)) {
        active.socket = socket
        this.send(socket, active.record.event)
        for (const [fetchId, pending] of active.fetches) this.send(socket, { type: 'fetch.request', requestId, fetchId, request: pending.request })
        return
      }
      const stored = await this.ctx.storage.get('operation')
      if (!stored || stored.requestId !== requestId) {
        // An evicted/expired record is not proof that no external work happened.
        this.send(socket, { type: 'resolve.error', requestId, code: 'RESOLVE_INTERRUPTED', error: 'The source lookup could not be recovered. Try again.' })
        return
      }
      if (!sameIdentity(stored.identity, identity)) throw new Error('Operation identity changed.')
      if (stored.state === 'running' || stored.expiresAt <= Date.now()) {
        this.send(socket, { type: 'resolve.error', requestId, code: 'RESOLVE_INTERRUPTED', error: 'The source lookup was interrupted. Try again.' })
        return
      }
      this.send(socket, stored.event)
    }

    async start(socket, identity, message) {
      const prior = this.active?.record ?? await this.ctx.storage.get('operation')
      if (prior?.requestId === message.requestId) return this.resume(socket, identity, message.requestId)
      if (this.active || prior?.state === 'running' && prior.deadline > Date.now()) {
        this.send(socket, { type: 'resolve.error', requestId: message.requestId, code: 'RESOLVE_BUSY', error: 'The previous source lookup is finishing. Try again shortly.' })
        return
      }
      if (!message.input || typeof message.input !== 'object' || Array.isArray(message.input)) throw new Error('Invalid resolve request.')
      const deadline = Date.now() + RESOLVE_CHANNEL_BUDGET_MS
      const record = { requestId: message.requestId, identity, state: 'running', deadline, expiresAt: deadline + RETAIN_MS,
        event: { type: 'resolve.accepted', requestId: message.requestId, sequence: 0, deadline } }
      const active = { record, identity, socket, controller: new AbortController(), fetches: new Map(), fetchQueue: [], fetchCount: 0, resultBytes: 0, sequence: 0 }
      this.active = active
      try {
        // Persist before any external work: a reset must never replay a possibly side-effecting job.
        await this.ctx.storage.put('operation', record)
        await this.ctx.storage.setAlarm(record.expiresAt)
      } catch (error) { this.active = null; throw error }
      this.send(socket, record.event)
      active.work = this.run(active, message.input)
      this.ctx.waitUntil(active.work)
      // Pending fetches/timers keep the object active; no global concurrency lock spans this job.
      active.work.catch(() => {})
    }

    async emit(active, type, payload) {
      if (this.active !== active) return
      if (!await authorize(this.env, active.identity)) {
        const error = Object.assign(new Error('Profile authorization changed.'), { code: 'PROFILE_CHANGED' })
        active.controller.abort(error)
        throw error
      }
      const event = { ...payload, type, requestId: active.record.requestId, sequence: ++active.sequence }
      // Check size before persisting so recovery never holds an unsendable response.
      if (encoder.encode(JSON.stringify(event)).length > MAX_MESSAGE_BYTES) throw new Error('Source results exceeded the channel limit.')
      active.record.event = event
      await this.ctx.storage.put('operation', active.record)
      this.send(active.socket, event)
    }

    fetchSource(active, request) {
      if (active.controller.signal.aborted || active.fetchCount >= 6) return Promise.resolve([])
      active.fetchCount++
      const fetchId = randomId()
      return new Promise(resolveResult => {
        // Start the response deadline only when a TV concurrency slot is available.
        active.fetchQueue.push(() => {
        if (active.controller.signal.aborted) { resolveResult([]); return }
        let finished = false
        const finish = streams => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          active.controller.signal.removeEventListener('abort', cancel)
          active.fetches.delete(fetchId)
          resolveResult(streams)
          this.drainFetches(active)
        }
        const cancel = () => finish([])
        const timer = setTimeout(cancel, Math.max(1, Math.min(13_000, active.record.deadline - Date.now())))
        active.controller.signal.addEventListener('abort', cancel, { once: true })
        active.fetches.set(fetchId, { finish, request })
        this.send(active.socket, { type: 'fetch.request', requestId: active.record.requestId, fetchId, request })
        })
        this.drainFetches(active)
      })
    }

    drainFetches(active) {
      while (active.fetches.size < 2 && active.fetchQueue.length) active.fetchQueue.shift()()
    }

    async run(active, input) {
      const timer = setTimeout(() => active.controller.abort(), Math.max(1, active.record.deadline - Date.now()))
      try {
        const result = await resolve(this.env, active.identity, input, {
          signal: active.controller.signal,
          onProgress: async result => {
            try { await this.emit(active, 'resolve.progress', { result }) }
            catch (error) { active.controller.abort(); throw error }
          },
          fetchSource: request => this.fetchSource(active, request),
        })
        if (active.controller.signal.aborted) throw new Error('Cancelled.')
        active.record.state = 'complete'
        await this.emit(active, 'resolve.complete', { result })
      } catch (error) {
        active.record.state = 'error'
        const cancelled = active.controller.signal.aborted
        const event = { type: 'resolve.error', requestId: active.record.requestId, sequence: ++active.sequence,
          code: active.controller.signal.reason?.code === 'PROFILE_CHANGED' ? 'PROFILE_CHANGED' : cancelled ? 'RESOLVE_CANCELLED' : error?.code || 'RESOLVE_FAILED',
          error: cancelled ? 'Source lookup cancelled or timed out.' : 'The source lookup could not finish. Try again.' }
        active.record.event = event
        try { await this.ctx.storage.put('operation', active.record) } catch { /* The persisted running marker prevents a replay. */ }
        this.send(active.socket, event)
      } finally {
        clearTimeout(timer)
        for (const pending of active.fetches.values()) pending.finish([])
        if (this.active === active) this.active = null
      }
    }

    webSocketClose(socket, code = 1000) {
      if (this.active?.socket === socket) this.active.socket = null
      try { socket.close(code === 1005 || code === 1006 ? 1000 : code, 'Channel closed.') } catch { /* Already closed. */ }
      // Keep bounded work alive for a brief reconnect; no permanent server heartbeat timer.
    }
    webSocketError(socket) { this.webSocketClose(socket) }

    async alarm() {
      const operation = await this.ctx.storage.get('operation')
      if (operation && operation.expiresAt > Date.now()) { await this.ctx.storage.setAlarm(operation.expiresAt); return }
      await this.ctx.storage.delete(['operation', 'admission'])
    }
  }
}
