import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveSessionClass } from '../src/resolve-session.js'

const identity = { pairingId: 'p'.repeat(20), ownerId: 'owner', tokenHash: 'hash', profileHash: 'profile', profileId: 'default' }
const requestId = 'a'.repeat(32)
const result = { ok: true, candidates: [{ id: 'direct', url: 'https://media.example/video.mp4' }] }
class Socket {
  sent: any[] = []
  attachment: any
  close = vi.fn()
  send(text: string) { this.sent.push(JSON.parse(text)) }
  serializeAttachment(value: any) { this.attachment = structuredClone(value) }
  deserializeAttachment() { return this.attachment }
}
function fixture(resolve: (...args: any[]) => any = async () => result) {
  const data = new Map<string, any>()
  const sockets: Socket[] = []
  const storage: any = {
    get: async (key: string) => structuredClone(data.get(key)),
    put: async (key: string, value: any) => { data.set(key, structuredClone(value)) },
    delete: async (key: string | string[]) => { for (const k of Array.isArray(key) ? key : [key]) data.delete(k) },
    setAlarm: vi.fn(async () => {}), transaction: async (fn: any) => fn(storage),
  }
  const ctx = { storage, acceptWebSocket: (socket: Socket) => sockets.push(socket), getWebSockets: () => sockets,
    setWebSocketAutoResponse: vi.fn(), waitUntil: vi.fn() }
  const authorize = vi.fn(async () => true)
  const work = vi.fn(resolve)
  const Session = resolveSessionClass({ authorize, resolve: work })
  const session = new Session(ctx, {})
  const connect = async (target = session) => {
    const admission = await target.fetch(new Request('https://internal/admit', { method: 'POST', body: JSON.stringify(identity) }))
    const { ticket } = await admission.json()
    const response = await target.fetch(new Request(`https://internal/channel?ticket=${ticket}`, { headers: { Upgrade: 'websocket' } }))
    expect(response.status).toBe(101)
    return sockets.at(-1)!
  }
  const command = (socket: Socket, value: any, target = session) => target.webSocketMessage(socket, JSON.stringify({ protocol: 1, requestId, ...value }))
  return { ctx, data, Session, session, authorize, work, connect, command }
}
beforeEach(() => {
  vi.stubGlobal('WebSocketRequestResponsePair', class { constructor(public request: string, public response: string) {} })
  vi.stubGlobal('WebSocketPair', class { 0 = new Socket(); 1 = new Socket() })
  const Original = Response
  vi.stubGlobal('Response', class extends Original {
    constructor(body: any, init: any = {}) {
      super(body, init.status === 101 ? { status: 200 } : init)
      if (init.status === 101) Object.defineProperty(this, 'status', { value: 101 })
    }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('hibernating resolve session', () => {
  it('uses single-use admission and rejects revoked authorization', async () => {
    const f = fixture()
    const admission = await f.session.fetch(new Request('https://internal/admit', { method: 'POST', body: JSON.stringify(identity) }))
    const { ticket } = await admission.json()
    expect(f.data.get('admission').hash).not.toBe(ticket)
    const upgrade = () => f.session.fetch(new Request(`https://internal/channel?ticket=${ticket}`, { headers: { Upgrade: 'websocket' } }))
    expect((await upgrade()).status).toBe(101)
    expect((await upgrade()).status).toBe(401)
    f.authorize.mockResolvedValue(false)
    await expect(f.connect()).rejects.toThrow()
  })
  it('streams a snapshot, resumes the same work, and replays completion after reconstruction', async () => {
    let finish!: (value: any) => void
    const f = fixture(async (_env, _identity, _input, options) => {
      await options.onProgress(result)
      return new Promise(resolve => { finish = resolve })
    })
    const first = await f.connect()
    await f.command(first, { type: 'resolve.start', input: {} })
    await vi.waitFor(() => expect(first.sent.some(m => m.type === 'resolve.progress')).toBe(true))
    f.session.webSocketClose(first)
    const second = await f.connect()
    await f.command(second, { type: 'resolve.resume' })
    expect(second.sent.at(-1)).toMatchObject({ type: 'resolve.progress', result })
    await f.command(second, { type: 'resolve.start', input: { different: true } })
    expect(f.work).toHaveBeenCalledTimes(1)
    const active = f.session.active
    finish(result); await active.work
    const restarted = new f.Session(f.ctx, {})
    const third = await f.connect(restarted)
    await f.command(third, { type: 'resolve.resume' }, restarted)
    expect(third.sent.at(-1)).toMatchObject({ type: 'resolve.complete', result })
    expect(f.work).toHaveBeenCalledTimes(1)
  })
  it('does not repeat an interrupted job or permit HTTP replay after a reset or retention expiry', async () => {
    const f = fixture()
    const socket = await f.connect()
    f.data.set('operation', { requestId, identity, state: 'running', deadline: Date.now() + 45_000, expiresAt: Date.now() + 120_000 })
    for (const id of [requestId, 'b'.repeat(32)]) {
      await f.command(socket, { type: 'resolve.resume', requestId: id })
      expect(socket.sent.at(-1)).toMatchObject({ type: 'resolve.error', code: 'RESOLVE_INTERRUPTED' })
      expect(socket.sent.at(-1)).not.toHaveProperty('fallback')
    }
    await f.command(socket, { type: 'resolve.start', requestId: 'b'.repeat(32), input: {} })
    expect(socket.sent.at(-1).code).toBe('RESOLVE_BUSY')
    f.data.clear()
    await f.command(socket, { type: 'resolve.resume' })
    expect(socket.sent.at(-1).code).toBe('RESOLVE_INTERRUPTED')
    expect(f.work).not.toHaveBeenCalled()
  })
  it('delegates metadata while resolving, consumes results once, and strips caller authority', async () => {
    let received: any
    const f = fixture(async (_env, _identity, _input, options) => {
      received = await options.fetchSource({ id: 'source', url: 'https://source.example/public.json' })
      return result
    })
    const first = await f.connect()
    await f.command(first, { type: 'resolve.start', input: {} })
    const active = f.session.active
    const query = first.sent.find(m => m.type === 'fetch.request')
    const second = await f.connect()
    await f.command(second, { type: 'resolve.resume' })
    expect(second.sent.at(-1)).toEqual(query)
    const reply = { type: 'fetch.result', fetchId: query.fetchId, streams: [{ infoHash: 'a'.repeat(40), url: 'https://unsafe.example', __cache: 'cached', cookies: 'secret', behaviorHints: { filename: 'movie.mkv', proxyHeaders: { request: { Authorization: 'private' } } } }] }
    await f.command(second, reply)
    await f.command(second, reply)
    await active.work
    expect(received).toHaveLength(1)
    expect(JSON.stringify(received)).not.toMatch(/unsafe|secret|private|__cache|proxyHeaders/)
  })
  it('aborts on cancel and rejects subsequent data after a profile change', async () => {
    const f = fixture(async (_env, _identity, _input, options) => {
      await options.fetchSource({ id: 'source', url: 'https://source.example/public.json' })
      options.signal.throwIfAborted()
      return result
    })
    const socket = await f.connect()
    await f.command(socket, { type: 'resolve.start', input: {} })
    const active = f.session.active
    await f.command(socket, { type: 'resolve.cancel' })
    await active.work
    expect(active.controller.signal.aborted).toBe(true)
    expect(socket.sent.at(-1).type).toBe('resolve.error')
    f.authorize.mockResolvedValue(false)
    await f.command(socket, { type: 'resolve.resume' })
    expect(socket.sent.at(-1).code).toBe('PROFILE_CHANGED')
  })
  it('starts delegated response deadlines only when a TV fetch slot is available', async () => {
    const f = fixture(async (_env, _identity, _input, options) => {
      await Promise.all(Array.from({ length: 7 }, (_, id) => options.fetchSource({ id: String(id), url: 'https://source.example/public.json' })))
      return result
    })
    const socket = await f.connect()
    await f.command(socket, { type: 'resolve.start', input: {} })
    const active = f.session.active
    expect(socket.sent.filter(m => m.type === 'fetch.request')).toHaveLength(2)
    const handled = new Set()
    for (let i = 0; i < 6; i++) {
      const request = socket.sent.find(m => m.type === 'fetch.request' && !handled.has(m.fetchId))
      handled.add(request.fetchId)
      await f.command(socket, { type: 'fetch.result', fetchId: request.fetchId, streams: [] })
      expect(active.fetches.size).toBeLessThanOrEqual(2)
    }
    await active.work
    expect(socket.sent.filter(m => m.type === 'fetch.request')).toHaveLength(6)
  })
})
