import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(new URL('../package.json', import.meta.url))
const { Miniflare, convertV4MiniflareOptions = options => options } = require('miniflare')
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({ bundle: true, write: false, format: 'esm', platform: 'neutral',
  stdin: { resolveDir: root, contents: `
    import { resolveSessionClass } from './src/resolve-session.js';
    export class Session extends resolveSessionClass({
      authorize: async () => true,
      resolve: async (_env, _identity, _input, options) => {
        const result = { ok: true, candidates: [{ id: 'one', url: 'https://media.example/video.mp4' }] };
        await options.onProgress(result);
        const streams = await options.fetchSource({ id: 'source', url: 'https://source.example/public.json' });
        return { ...result, received: streams.length };
      }
    }) {}
    export default { fetch(request, env) { return env.SESSION.get(env.SESSION.idFromName('pairing')).fetch(request); } };
  ` } })
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-08-28',
  durableObjects: { SESSION: { className: 'Session', useSQLite: true } } }))
const identity = { pairingId: 'pairing', profileId: 'default', profileHash: 'profile', tokenHash: 'token' }
const requestId = 'a'.repeat(32)
const sockets = []
async function connect() {
  const admission = await mf.dispatchFetch('https://internal/admit', { method: 'POST', body: JSON.stringify(identity) })
  assert.equal(admission.status, 200)
  const { ticket } = await admission.json()
  const response = await mf.dispatchFetch('https://internal/channel?ticket=' + ticket, { headers: { Upgrade: 'websocket' } })
  assert.equal(response.status, 101)
  const socket = response.webSocket
  const events = []
  socket.addEventListener('message', event => events.push(event.data === 'izumi:pong' ? event.data : JSON.parse(event.data)))
  socket.accept(); sockets.push(socket)
  return { socket, events, send: value => socket.send(JSON.stringify({ protocol: 1, requestId, ...value })) }
}
async function until(predicate) {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a channel event.')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
try {
  const first = await connect()
  await until(() => first.events.some(event => event.type === 'channel.ready'))
  first.socket.send('izumi:ping')
  await until(() => first.events.includes('izumi:pong'))
  first.send({ type: 'resolve.start', input: {} })
  await until(() => first.events.some(event => event.type === 'fetch.request'))
  assert(first.events.some(event => event.type === 'resolve.progress'))
  const query = first.events.find(event => event.type === 'fetch.request')
  first.socket.close(1000)
  const second = await connect()
  await until(() => second.events.some(event => event.type === 'channel.ready'))
  second.send({ type: 'resolve.resume' })
  await until(() => second.events.some(event => event.type === 'fetch.request'))
  assert.equal(second.events.find(event => event.type === 'fetch.request').fetchId, query.fetchId)
  second.send({ type: 'fetch.result', fetchId: query.fetchId, streams: [{ infoHash: 'a'.repeat(40) }] })
  await until(() => second.events.some(event => event.type === 'resolve.complete'))
  assert.equal(second.events.find(event => event.type === 'resolve.complete').result.received, 1)
  second.socket.close(1000)
  const third = await connect()
  await until(() => third.events.some(event => event.type === 'channel.ready'))
  third.send({ type: 'resolve.resume' })
  await until(() => third.events.some(event => event.type === 'resolve.complete'))
  assert.equal(third.events.filter(event => event.type === 'fetch.request').length, 0)
  console.log('Native Worker runtime: upgrade, hibernation heartbeat, progressive events, fetch delegation and reconnect passed.')
} finally {
  for (const socket of sockets) try { socket.close(1000) } catch {}
  await mf.dispose()
}
