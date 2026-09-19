import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(new URL('../package.json', import.meta.url))
const { Miniflare, convertV4MiniflareOptions = options => options } = require('miniflare')
const root = fileURLToPath(new URL('../', import.meta.url))
const access = { apiToken: 't'.repeat(40), accountId: 'a'.repeat(32), scriptName: 'private-worker', databaseId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }
const pkg = JSON.stringify({ schema: 1, resolveChannel: 1, version: '9.0.0', compatibilityDate: '2026-08-28', script: 'export default {}',
  migrations: [{ name: '0001_initial.sql', sql: 'CREATE TABLE fixture (id INTEGER);' }] })
const manifest = { schema: 1, version: '9.0.0', tag: 'worker-v9.0.0', sha256: createHash('sha256').update(pkg).digest('hex') }
const built = await build({ bundle: true, write: false, format: 'esm', platform: 'neutral', stdin: { resolveDir: root, contents: `
  import { runWorkerUpdate, workerUpdateStatus } from './src/worker-update.js';
  export default { async fetch(request, env) {
    const hook = new URL(request.url).pathname === '/hook';
    const target = { ...env, TV_RESOLVE_SESSIONS: {}, WORKER_UPDATE_AUTH: hook ? '' : ${JSON.stringify(JSON.stringify(access))},
      WORKER_DEPLOY_HOOK: hook ? 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/aaaaaaaaaaaaaaaa' : '' };
    if (new URL(request.url).pathname === '/installed') return Response.json(await workerUpdateStatus(target, '9.0.0'));
    // Construct the outbound Request in workerd, then route it to a local fixture.
    // Node fetch mocks alone miss unsupported Workers RequestInit options.
    return Response.json(await runWorkerUpdate(target, '1.13.1', { fetcher: (url, init) => {
      const outbound = new Request(url, init);
      if (new URL(url).hostname === 'api.cloudflare.com' && outbound.redirect !== 'manual') throw new Error('Unsafe deployment redirect mode');
      return env.RELEASES.fetch(outbound);
    } }));
  } };
` } })
let scenario = 'success'
const calls = []
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-08-28',
  d1Databases: { DB: 'update-test' }, serviceBindings: { RELEASES: async request => {
    const url = new URL(request.url)
    calls.push({ host: url.hostname, path: url.pathname, method: request.method })
    if (url.hostname === 'raw.githubusercontent.com') return Response.json(manifest)
    if (url.hostname === 'github.com') return new Response(pkg)
    assert.equal(url.hostname, 'api.cloudflare.com')
    if (url.pathname.includes('/deploy_hooks/')) {
      assert.equal(request.headers.get('Authorization'), null)
      return scenario === 'redirect' ? new Response(null, { status: 307, headers: { Location: 'https://untrusted.example/' } })
        : Response.json({ success: true, result: { build_uuid: 'build' } })
    }
    assert.equal(request.headers.get('Authorization'), `Bearer ${access.apiToken}`)
    if (scenario === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } })
    if (url.pathname.endsWith('/query')) return Response.json({ success: true, result: [{ success: true, results: [] }] })
    assert.equal(request.method, 'PUT')
    const form = await request.formData()
    const metadata = JSON.parse(await form.get('metadata').text())
    assert.deepEqual(metadata.bindings, [{ type: 'd1', name: 'DB', id: access.databaseId },
      { type: 'durable_object_namespace', name: 'TV_RESOLVE_SESSIONS', class_name: 'CompanionResolveSession' }])
    assert.deepEqual(metadata.keep_bindings, ['secret_text', 'plain_text'])
    assert.equal(await form.get('worker.mjs').text(), 'export default {}')
    return Response.json({ success: true })
  } } }))
try {
  const db = await mf.getD1Database('DB')
  await db.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);')
  const run = async path => (await mf.dispatchFetch('https://worker.test' + path)).json()
  assert.equal((await run('/update')).phase, 'queued')
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1)
  assert.equal((await run('/installed')).phase, 'current')
  for (const path of ['/update', '/hook']) {
    await db.exec('DELETE FROM metadata;')
    calls.length = 0; scenario = 'redirect'
    assert.equal((await run(path)).phase, 'error')
    assert(!calls.some(call => call.host === 'untrusted.example' || call.method === 'PUT'))
    assert.equal(calls.filter(call => call.host === 'api.cloudflare.com').length, 1)
  }
  await db.exec('DELETE FROM metadata;')
  scenario = 'success'
  assert.equal((await run('/hook')).phase, 'queued')
  console.log('Native Worker runtime: automatic deployment, installed-version confirmation, legacy hook and redirect rejection passed.')
} finally { await mf.dispose() }
