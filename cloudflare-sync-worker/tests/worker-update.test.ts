import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import worker from '../src/index.js'
import { newerVersion, runWorkerUpdate, validDeployHook, workerUpdateStatus, UPDATE_MANIFEST } from '../src/worker-update.js'
import { deployStable, deploymentConfig, pendingMigrations, validateManifest, validatePackage } from '../scripts/deploy-stable.mjs'
import { deploymentAccess, deployWorkerRelease, downloadText } from '../src/worker-self-deploy.js'

const hook = 'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/' + 'a'.repeat(32)
const manifest = { schema: 1, version: '9.0.0', tag: 'v2.0.0', sha256: 'a'.repeat(64) }
const now = 1_800_000_000_000
const token = 't'.repeat(43), pairing = 'p'.repeat(20)
const databases: DatabaseSync[] = []
afterEach(() => { databases.forEach(db => db.close()); databases.length = 0; vi.unstubAllGlobals(); vi.restoreAllMocks() })
function fixture() {
  const sql = new DatabaseSync(':memory:'); databases.push(sql)
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) sql.exec(readFileSync(new URL(name, dir), 'utf8'))
  sql.prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?)').run('owner', 'owner-hash', 'Test', 1, 1)
  sql.prepare('INSERT INTO companion_pairings (pairing_id, owner_device_id, tv_token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
    .run(pairing, 'owner', createHash('sha256').update(token).digest('base64url'), 1, 1)
  const env = { WORKER_DEPLOY_HOOK: hook, DB: { prepare(source: string) {
    let values: (string | number)[] = []
    return { bind(...v: (string | number)[]) { values = v; return this },
      async first() { return sql.prepare(source).get(...values) },
      async run() { return { meta: { changes: Number(sql.prepare(source).run(...values).changes) } } },
    }
  } } }
  const fetcher = vi.fn(async (url: string) => Response.json(url === UPDATE_MANIFEST ? manifest : { success: true, result: { build_uuid: 'build-id' } }))
  return { env, sql, fetcher }
}

describe('private Worker updates', () => {
  it('rejects unauthenticated, unrelated and revoked TV requests without contacting a build service', async () => {
    const { env, sql, fetcher } = fixture(); vi.stubGlobal('fetch', fetcher)
    const call = (id = pairing, auth = '') => worker.fetch(new Request(`https://worker.example/v1/companion/pairings/${id}/worker-update`, {
      method: 'POST', headers: { authorization: `Bearer ${auth}` },
    }), env)
    expect((await call()).status).toBe(401)
    expect((await call('q'.repeat(20), token)).status).toBe(401)
    sql.prepare('DELETE FROM companion_pairings').run()
    expect((await call(pairing, token)).status).toBe(401)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('allows the paired TV to request a fixed build without disclosing or forwarding credentials', async () => {
    const { env, fetcher } = fixture(); vi.stubGlobal('fetch', fetcher)
    const response = await worker.fetch(new Request(`https://worker.example/v1/companion/pairings/${pairing}/worker-update`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ url: 'https://untrusted.example' }),
    }), env)
    const result = await response.json()
    expect(result).toMatchObject({ configured: true, automatic: true, phase: 'queued', latestVersion: '9.0.0' })
    expect(JSON.stringify(result)).not.toContain(hook)
    expect(fetcher).toHaveBeenLastCalledWith(hook, expect.objectContaining({ method: 'POST', redirect: 'error' }))
    expect(fetcher.mock.calls[1][1]).not.toHaveProperty('headers')
  })
  it('coalesces concurrent requests across separate invocations and waits for the installed version', async () => {
    const { env, fetcher } = fixture()
    await Promise.all(Array.from({ length: 8 }, () => runWorkerUpdate(env, '1.0.0', { now, fetcher })))
    expect(fetcher.mock.calls.filter(([url]) => url === hook)).toHaveLength(1)
    expect(await workerUpdateStatus(env, '1.0.0', now + 60_000)).toMatchObject({ phase: 'queued' })
    expect(await workerUpdateStatus(env, '9.0.0', now + 60_000)).toMatchObject({ phase: 'current', version: '9.0.0' })
  })
  it('runs automatically without a TV and honors the automatic-update pause', async () => {
    const { env, fetcher } = fixture(); vi.stubGlobal('fetch', fetcher)
    await worker.scheduled({}, { ...env, WORKER_AUTO_UPDATE: 'false' })
    expect(fetcher).not.toHaveBeenCalled()
    await worker.scheduled({}, env)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('never downgrades, rebuilds a current release, or selects a prerelease', async () => {
    const { env, fetcher } = fixture()
    await runWorkerUpdate(env, '10.0.0', { now, fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockResolvedValue(Response.json({ ...manifest, tag: 'v2.0.0-beta.1' }))
    expect(await runWorkerUpdate(env, '1.0.0', { now: now + 360_000, fetcher })).toMatchObject({ phase: 'error' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(newerVersion('1.12.0', '1.9.0')).toBe(true)
    expect(newerVersion('1.12.0-beta.1', '1.9.0')).toBe(false)
  })
  it('redacts failures, backs off uncertain requests and eventually retries', async () => {
    const { env, fetcher } = fixture()
    fetcher.mockImplementation(async (url: string) => { if (url === hook) throw new Error(hook); return Response.json(manifest) })
    const result = await runWorkerUpdate(env, '1.0.0', { now, fetcher })
    expect(result.phase).toBe('error'); expect(JSON.stringify(result)).not.toContain(hook)
    await runWorkerUpdate(env, '1.0.0', { now: now + 360_000, fetcher })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await runWorkerUpdate(env, '1.0.0', { now: now + 6 * 3600_000, fetcher })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('reports a delayed build without continuously triggering new builds', async () => {
    const { env, fetcher } = fixture()
    await runWorkerUpdate(env, '1.0.0', { now, fetcher })
    expect(await runWorkerUpdate(env, '1.0.0', { now: now + 3600_000, fetcher })).toMatchObject({ phase: 'delayed' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each(['', 'http://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/abcdefghijklmnop', hook + '?redirect=1', hook + '/extra', hook.replace('api.cloudflare.com', 'elsewhere.example')])('requires one valid private deploy hook: %s', async value => {
    const { env, fetcher } = fixture()
    expect(validDeployHook(value)).toBe(false)
    expect(await runWorkerUpdate({ ...env, WORKER_DEPLOY_HOOK: value }, '1.0.0', { now, fetcher })).toMatchObject({ phase: 'setup-required' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('automatic deployment from the official release feed', () => {
  const access = { apiToken: 's'.repeat(40), accountId: 'a'.repeat(32), scriptName: 'private-worker', databaseId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }
  const migrations = [{ name: '0001_first.sql', sql: 'CREATE TABLE migration_fixture (id INTEGER);' },
    { name: '0002_second.sql', sql: 'ALTER TABLE migration_fixture ADD value TEXT;' }]
  function releaseFixture() {
    const { env, sql } = fixture()
    const text = JSON.stringify({ schema: 1, version: '9.0.0', compatibilityDate: '2026-08-28', script: 'export default {}', migrations })
    const descriptor = { schema: 1, version: '9.0.0', tag: 'worker-v9.0.0', sha256: createHash('sha256').update(text).digest('hex') }
    const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === UPDATE_MANIFEST) return Response.json(descriptor)
      if (url.endsWith('/worker-package.json')) return new Response(text)
      expect(url).toMatch(new RegExp(`^https://api\\.cloudflare\\.com/client/v4/accounts/${access.accountId}/`))
      expect(init.redirect).toBe('error')
      expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${access.apiToken}`)
      if (url.endsWith('/query')) {
        const source = JSON.parse(init.body as string).sql
        if (source.startsWith('SELECT')) return Response.json({ success: true, result: [{ success: true, results: sql.prepare(source).all() }] })
        sql.exec(source)
        return Response.json({ success: true, result: [{ success: true, results: [] }] })
      }
      expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${access.accountId}/workers/scripts/${access.scriptName}`)
      expect(init.method).toBe('PUT')
      const form = init.body as FormData
      const metadata = JSON.parse(await (form.get('metadata') as Blob).text())
      expect(metadata).toMatchObject({ bindings: [{ type: 'd1', name: 'DB', id: access.databaseId }], keep_bindings: ['secret_text', 'plain_text'] })
      expect(await (form.get('worker.mjs') as Blob).text()).toBe('export default {}')
      return Response.json({ success: true })
    })
    return { env: { ...env, WORKER_DEPLOY_HOOK: '', WORKER_UPDATE_AUTH: JSON.stringify(access) }, sql, text, descriptor, fetcher }
  }
  it('installs through the fixed account and database with no build hook or TV present', async () => {
    const { env, sql, fetcher } = releaseFixture()
    vi.stubGlobal('fetch', fetcher)
    await worker.scheduled({}, env)
    expect(sql.prepare('SELECT name FROM izumi_deploy_migrations ORDER BY name').all()).toEqual([{ name: '0001_first' }, { name: '0002_second' }])
    expect(await workerUpdateStatus(env, '1.0.0')).toMatchObject({ configured: true, automatic: true, phase: 'queued' })
    const installed = await workerUpdateStatus(env, '9.0.0')
    expect(installed).toMatchObject({ phase: 'current' })
    expect(JSON.stringify(installed)).not.toContain(access.apiToken)
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(1)
  })
  it('uses both ledgers and preserves the existing database while moving from a git deployment', async () => {
    const { env, sql, fetcher } = releaseFixture()
    sql.exec("CREATE TABLE d1_migrations (name TEXT); INSERT INTO d1_migrations VALUES ('0001_first.sql'); CREATE TABLE migration_fixture (id INTEGER); INSERT INTO migration_fixture VALUES (42)")
    await runWorkerUpdate(env, '1.0.0', { now, fetcher })
    expect(sql.prepare('SELECT * FROM migration_fixture').all()).toEqual([{ id: 42, value: null }])
    expect(sql.prepare('SELECT COUNT(*) AS count FROM izumi_deploy_migrations').get()).toEqual({ count: 2 })
  })
  it('does not execute migrations or upload after checksum failure', async () => {
    const { descriptor } = releaseFixture()
    const fetcher = vi.fn(async () => new Response('unverified program'))
    await expect(deployWorkerRelease(access, descriptor, fetcher)).rejects.toThrow('checksum')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('leaves failed migrations unrecorded and never replaces code after a database failure', async () => {
    const { env, sql, fetcher } = releaseFixture()
    const original = fetcher.getMockImplementation()!
    fetcher.mockImplementation(async (url, init = {}) => {
      if (url.endsWith('/query') && String(init.body).includes('ALTER TABLE')) return Response.json({ success: true, result: [{ success: false }] })
      return original(url, init)
    })
    expect(await runWorkerUpdate(env, '1.0.0', { now, fetcher })).toMatchObject({ phase: 'error' })
    expect(sql.prepare('SELECT name FROM izumi_deploy_migrations').all()).toEqual([{ name: '0001_first' }])
    expect(fetcher.mock.calls.some(([, init]) => init.method === 'PUT')).toBe(false)
  })
  it('redacts expired deployment access and retries later without a deployment storm', async () => {
    const { env, fetcher } = releaseFixture()
    const original = fetcher.getMockImplementation()!
    fetcher.mockImplementation(async (url, init = {}) => url.startsWith('https://api.cloudflare.com/')
      ? Response.json({ success: false, errors: [{ message: access.apiToken }] }, { status: 401 }) : original(url, init))
    const results = await Promise.all(Array.from({ length: 5 }, () => runWorkerUpdate(env, '1.0.0', { now, fetcher })))
    expect(JSON.stringify(results)).not.toContain(access.apiToken)
    expect(await workerUpdateStatus(env, '1.0.0', now)).toMatchObject({ phase: 'error' })
    expect(fetcher.mock.calls.filter(([url]) => url.startsWith('https://api.cloudflare.com/'))).toHaveLength(1)
  })
  it('rejects malformed secret targets and oversized downloads', async () => {
    expect(deploymentAccess(JSON.stringify(access))).toEqual(access)
    expect(deploymentAccess(JSON.stringify({ ...access, scriptName: '../another' }))).toBeNull()
    expect(deploymentAccess('invalid')).toBeNull()
    await expect(downloadText(async () => new Response('x'.repeat(32)), 'https://example.test', {}, 16)).rejects.toThrow('too large')
  })
})

describe('stable release deployment', () => {
  const migrations = [{ name: '0001_initial.sql', sql: 'CREATE TABLE test (id INTEGER);' }, { name: '0002_next.sql', sql: 'ALTER TABLE test ADD value TEXT;' }]
  it('verifies the package checksum and stable descriptor before accepting code', () => {
    const text = JSON.stringify({ schema: 1, version: manifest.version, compatibilityDate: '2026-08-28', script: 'export default {}', migrations })
    const checked = validateManifest({ ...manifest, sha256: createHash('sha256').update(text).digest('hex') })
    expect(validatePackage(text, checked).version).toBe(manifest.version)
    expect(() => validatePackage(text + ' ', checked)).toThrow('checksum')
    expect(() => validateManifest({ ...checked, tag: 'beta' })).toThrow('manifest')
  })
  it('uses both migration ledgers when updating existing direct and git installations', () => {
    expect(pendingMigrations(migrations, ['0001_initial'], [])).toEqual([migrations[1]])
    expect(pendingMigrations(migrations, [], ['0001_initial.sql'])).toEqual([migrations[1]])
    expect(pendingMigrations(migrations, ['0002_next'], ['0001_initial.sql'])).toEqual([])
  })
  it('requires the existing deployment identity and keeps automatic triggers and dashboard variables', () => {
    const env = { IZUMI_WORKER_NAME: 'private-worker', IZUMI_DATABASE_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }
    expect(deploymentConfig(env, '2026-08-28')).toMatchObject({ name: env.IZUMI_WORKER_NAME, keep_vars: true, triggers: { crons: ['17 */6 * * *'] }, d1_databases: [{ binding: 'DB', database_id: env.IZUMI_DATABASE_ID }] })
    expect(() => deploymentConfig({ ...env, WORKERS_CI_SCRIPT_NAME: 'another-worker' }, '2026-08-28')).toThrow('does not match')
    expect(() => deploymentConfig({ ...env, IZUMI_DATABASE_ID: '' }, '2026-08-28')).toThrow('existing Worker')
  })
  it.each([false, true])('runs only pending migrations before deploying, and stops on failure: %s', async failMigration => {
    const pkg = JSON.stringify({ schema: 1, version: manifest.version, compatibilityDate: '2026-08-28', script: 'export default {}', migrations })
    const descriptor = { ...manifest, sha256: createHash('sha256').update(pkg).digest('hex') }
    const download = vi.fn(async (url: string) => url === UPDATE_MANIFEST ? Response.json(descriptor) : new Response(pkg))
    const statements: string[] = [], migrated: string[] = []
    let deployed = false
    const execute = vi.fn((_command: string, args: string[]) => {
      if (args[1] === 'deploy') { deployed = true; return { status: 0, stdout: '' } }
      if (args.includes('--file')) {
        migrated.push(readFileSync(args[args.indexOf('--file') + 1], 'utf8'))
        return { status: failMigration ? 1 : 0, stdout: '' }
      }
      const sql = args[args.indexOf('--command') + 1]; statements.push(sql)
      const results = sql === 'SELECT name FROM izumi_deploy_migrations' ? [{ name: '0001_initial' }] : []
      return { status: 0, stdout: JSON.stringify([{ success: true, results }]) }
    })
    const result = deployStable({ fetcher: download, execute, env: { IZUMI_WORKER_NAME: 'private-worker', IZUMI_DATABASE_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } })
    if (failMigration) await expect(result).rejects.toThrow('deployment failed')
    else await result
    expect(migrated).toEqual([migrations[1].sql])
    expect(deployed).toBe(!failMigration)
    expect(statements.some(sql => sql.startsWith('INSERT INTO') && sql.includes('0002_next'))).toBe(!failMigration)
    expect(download.mock.calls[1][0]).toBe('https://github.com/nickEatsBread/izumi/releases/download/v2.0.0/worker-package.json')
  })
})
