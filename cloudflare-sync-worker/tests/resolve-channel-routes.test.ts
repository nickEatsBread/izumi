import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import worker, { CompanionResolveSession } from '../src/index.js'

const token = 't'.repeat(43), pairingId = 'p'.repeat(20)
const databases: DatabaseSync[] = []
afterEach(() => { databases.forEach(db => db.close()); databases.length = 0; vi.unstubAllGlobals() })
function fixture() {
  const sql = new DatabaseSync(':memory:'); databases.push(sql)
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(name, dir), 'utf8'))
  sql.prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?)').run('owner', 'owner-hash', 'Test', 1, 1)
  sql.prepare('INSERT INTO companion_pairings (pairing_id, owner_device_id, tv_token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .run(pairingId, 'owner', createHash('sha256').update(token).digest('base64url'), 1, 1)
  const salt = 'ab'.repeat(16)
  const profile = { enabled: true, addons: ['https://source.example'], household: { enabled: true, profiles: [{
    id: 'viewer', name: 'Viewer', ratingLimit: 18, allowAdult: false, pin: { salt, hash: createHash('sha256').update(`${salt}:1234`).digest('hex') },
  }] } }
  sql.prepare('INSERT INTO resolver_profiles (owner_device_id, profile_json, updated_at) VALUES (?, ?, ?)').run('owner', JSON.stringify(profile), 1)
  const admit = vi.fn(async () => Response.json({ protocol: 1, ticket: 'c'.repeat(32), expiresAt: Date.now() + 30_000 }))
  const env = { TV_RESOLVE_SESSIONS: { idFromName: (name: string) => name, get: () => ({ fetch: admit }) }, DB: { prepare(source: string) {
    let values: any[] = []
    return { bind(...v: any[]) { values = v; return this }, first: async () => sql.prepare(source).get(...values),
      run: async () => ({ meta: { changes: Number(sql.prepare(source).run(...values).changes) } }) }
  } } }
  const call = (payload: any, auth = token, environment: any = env) => worker.fetch(new Request(`https://worker.example/v1/companion/pairings/${pairingId}/resolve-channel`, {
    method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: JSON.stringify(payload),
  }), environment)
  return { sql, env, admit, call }
}
describe('resolve channel admission', () => {
  it('requires TV authorization and a valid PIN before issuing a short-lived ticket', async () => {
    const f = fixture()
    expect((await f.call({}, '')).status).toBe(401)
    expect((await f.call({ profileId: 'viewer' })).status).toBe(403)
    expect((await f.call({ profileId: 'viewer', profilePin: '0000' })).status).toBe(403)
    expect(f.admit).not.toHaveBeenCalled()
    const response = await f.call({ profileId: 'viewer', profilePin: '1234' })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.url).toBe(`wss://worker.example/v1/companion/pairings/${pairingId}/resolve-channel?ticket=${'c'.repeat(32)}`)
    const admission = await (f.admit.mock.calls[0][0] as Request).json()
    expect(admission).toMatchObject({ pairingId, ownerId: 'owner', profileId: 'viewer' })
    expect(JSON.stringify(admission)).not.toMatch(/profilePin|1234/)
    expect(JSON.stringify(admission)).not.toContain(token)
    expect(admission.tokenHash).toBe(createHash('sha256').update(token).digest('base64url'))
  })
  it('advertises HTTP when the binding is absent or the channel is disabled', async () => {
    const f = fixture()
    for (const env of [{ ...f.env, TV_RESOLVE_SESSIONS: undefined }, { ...f.env, TV_RESOLVE_WEBSOCKET: 'false' }]) {
      expect((await f.call({}, token, env)).status).toBe(404)
      const status = await (await worker.fetch(new Request('https://worker.example/v1/status'), env)).json()
      expect(status.resolveChannel).toBe(0)
    }
    expect(f.admit).not.toHaveBeenCalled()
  })
  it('rejects an admitted identity after a profile edit or pairing revocation', async () => {
    const f = fixture()
    await f.call({ profileId: 'viewer', profilePin: '1234' })
    const identity = await (f.admit.mock.calls[0][0] as Request).json()
    vi.stubGlobal('WebSocketRequestResponsePair', class {})
    const session = new CompanionResolveSession({ setWebSocketAutoResponse() {} }, f.env)
    const socket = { deserializeAttachment: () => ({ identity, expiresAt: Date.now() + 30_000 }), send: vi.fn(), close: vi.fn() }
    f.sql.prepare('UPDATE resolver_profiles SET profile_json = ?').run('{}')
    await session.webSocketMessage(socket, JSON.stringify({ protocol: 1, type: 'resolve.start', requestId: 'a'.repeat(32), input: {} }))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ code: 'PROFILE_CHANGED' })
    f.sql.prepare('DELETE FROM companion_pairings').run()
    expect((await f.call({ profileId: 'viewer', profilePin: '1234' })).status).toBe(401)
  })
})
