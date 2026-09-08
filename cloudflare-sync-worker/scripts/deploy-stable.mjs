import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { UPDATE_MANIFEST } from '../src/worker-self-deploy.js'
const releases = 'https://github.com/nickEatsBread/izumi/releases'
export function validateManifest(value) {
  if (value?.schema !== 1 || !/^(worker-)?v\d+\.\d+\.\d+$/.test(value.tag || '')
    || !/^\d+\.\d+\.\d+$/.test(value.version || '') || !/^[a-f0-9]{64}$/.test(value.sha256 || '')) {
    throw new Error('The stable Worker release manifest is invalid.')
  }
  return value
}

export function validatePackage(text, manifest) {
  if (createHash('sha256').update(text).digest('hex') !== manifest.sha256) throw new Error('Worker release checksum mismatch.')
  const value = JSON.parse(text)
  if (value.schema !== 1 || value.version !== manifest.version || typeof value.script !== 'string'
    || !value.script.includes('export') || !/^\d{4}-\d{2}-\d{2}$/.test(value.compatibilityDate || '')
    || !Array.isArray(value.migrations) || !value.migrations.length
    || value.migrations.some(m => !/^\d{4}_[a-z0-9_]+\.sql$/.test(m.name) || typeof m.sql !== 'string' || !m.sql.trim())
    || new Set(value.migrations.map(m => m.name)).size !== value.migrations.length) {
    throw new Error('The stable Worker package is invalid.')
  }
  return value
}

export function pendingMigrations(migrations, nativeNames, wranglerNames) {
  const applied = new Set([...nativeNames, ...wranglerNames].map(name => name.replace(/\.sql$/, '')))
  return migrations.filter(m => !applied.has(m.name.replace(/\.sql$/, ''))).sort((a, b) => a.name.localeCompare(b.name))
}

export function deploymentConfig(env, compatibilityDate) {
  const name = env.IZUMI_WORKER_NAME || env.WORKERS_CI_SCRIPT_NAME
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name || '')
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(env.IZUMI_DATABASE_ID || '')
    || env.IZUMI_DATABASE_ID === '00000000-0000-0000-0000-000000000000') {
    throw new Error('Set IZUMI_WORKER_NAME and IZUMI_DATABASE_ID to the existing Worker and D1 database in Cloudflare Builds.')
  }
  if (env.WORKERS_CI_SCRIPT_NAME && env.WORKERS_CI_SCRIPT_NAME !== name) throw new Error('The build target does not match the existing Worker.')
  return { name, main: 'worker.mjs', no_bundle: true, compatibility_date: compatibilityDate,
    compatibility_flags: ['nodejs_compat'], workers_dev: true, keep_vars: true,
    triggers: { crons: ['17 */6 * * *'] },
    d1_databases: [{ binding: 'DB', database_id: env.IZUMI_DATABASE_ID }],
  }
}

async function download(url, maximum, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error('The stable Worker release is not available yet.')
  const text = await response.text()
  if (Buffer.byteLength(text) > maximum) throw new Error('Worker release exceeds the supported size.')
  return text
}

export async function deployStable({ fetcher = fetch, execute = spawnSync, env = process.env } = {}) {
  const manifest = validateManifest(JSON.parse(await download(UPDATE_MANIFEST, 16_384, fetcher)))
  const pkg = validatePackage(await download(`${releases}/download/${manifest.tag}/worker-package.json`, 20 * 1024 * 1024, fetcher), manifest)
  const config = deploymentConfig(env, pkg.compatibilityDate)
  const stage = mkdtempSync(join(tmpdir(), 'izumi-stable-worker-'))
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
  const configPath = join(stage, 'wrangler.json')
  const run = args => {
    const result = execute(process.execPath, [wrangler, ...args, '--config', configPath], {
      cwd: stage, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    })
    if (result.status !== 0) throw new Error('Cloudflare deployment failed. Check the build permissions and existing database configuration.')
    return result.stdout
  }
  const query = sql => {
    const output = JSON.parse(run(['d1', 'execute', 'DB', '--remote', '--json', '--command', sql]))
    if (!Array.isArray(output) || output.some(r => r.success === false)) throw new Error('Cloudflare database query failed.')
    return output.flatMap(r => r.results || [])
  }
  try {
    writeFileSync(configPath, JSON.stringify(config))
    writeFileSync(join(stage, 'worker.mjs'), pkg.script)
    query('CREATE TABLE IF NOT EXISTS izumi_deploy_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
    const native = query('SELECT name FROM izumi_deploy_migrations').map(r => r.name)
    const hasWrangler = query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").length > 0
    const wranglerNames = hasWrangler ? query('SELECT name FROM d1_migrations').map(r => r.name) : []
    const pending = pendingMigrations(pkg.migrations, native, wranglerNames)
    for (const migration of pending) {
      writeFileSync(join(stage, migration.name), migration.sql)
      run(['d1', 'execute', 'DB', '--remote', '--file', join(stage, migration.name)])
      query(`INSERT INTO izumi_deploy_migrations (name, applied_at) VALUES ('${migration.name.replace(/\.sql$/, '')}', unixepoch())`)
    }
    // Keep both installers' ledgers in agreement when taking over a git-created database.
    for (const migration of pkg.migrations) {
      query(`INSERT OR IGNORE INTO izumi_deploy_migrations (name, applied_at) VALUES ('${migration.name.replace(/\.sql$/, '')}', unixepoch())`)
    }
    run(['deploy'])
    console.log(`Deployed stable Worker ${pkg.version}; preserved the existing database and secrets.`)
  } finally {
    // mkdtemp creates this exact task-owned directory beneath the system temporary directory.
    if (resolve(stage).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) rmSync(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deployStable().catch(error => { console.error(error.message); process.exitCode = 1 })
}
