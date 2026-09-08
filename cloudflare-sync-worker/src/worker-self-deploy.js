export const UPDATE_MANIFEST = 'https://raw.githubusercontent.com/nickEatsBread/izumi/worker-updates/stable.json'
const RELEASES = 'https://github.com/nickEatsBread/izumi/releases/download/'

/** Provisioned by the normal installer; never accepted from a device request. */
export function deploymentAccess(value) {
  try {
    const auth = JSON.parse(value)
    if (!/^[A-Za-z0-9_-]{40,256}$/.test(auth.apiToken || '')
      || !/^[a-f0-9]{32}$/i.test(auth.accountId || '')
      || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(auth.scriptName || '')
      || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(auth.databaseId || '')
      || auth.databaseId === '00000000-0000-0000-0000-000000000000') return null
    return auth
  } catch { return null }
}

export function validateManifest(value) {
  if (value?.schema !== 1 || !/^(worker-)?v\d+\.\d+\.\d+$/.test(value.tag || '')
    || !/^\d+\.\d+\.\d+$/.test(value.version || '') || !/^[a-f0-9]{64}$/.test(value.sha256 || '')
    || (value.tag.startsWith('worker-') && value.tag !== `worker-v${value.version}`)) {
    throw new Error('Invalid stable Worker manifest.')
  }
  return value
}

export async function downloadText(fetcher, url, init = {}, maximum = 16_384) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal })
    if (!response.ok) throw new Error('Update service unavailable.')
    // Bound streaming reads as well as Content-Length; do not buffer an unbounded response.
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Empty update response.')
    const chunks = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maximum) throw new Error('Update response too large.')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder().decode(bytes)
  } finally { clearTimeout(timeout) }
}

export async function deployWorkerRelease(auth, manifest, fetcher) {
  const deadline = Date.now() + 90_000
  const checkDeadline = () => { if (Date.now() > deadline) throw new Error('Deployment will continue on the next check.') }
  validateManifest(manifest)
  const text = await downloadText(fetcher, `${RELEASES}${manifest.tag}/worker-package.json`, {}, 4 * 1024 * 1024)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const checksum = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  if (checksum !== manifest.sha256) throw new Error('Worker package checksum mismatch.')
  const pkg = JSON.parse(text)
  if (pkg.schema !== 1 || pkg.version !== manifest.version || typeof pkg.script !== 'string'
    || !pkg.script.includes('export') || !/^\d{4}-\d{2}-\d{2}$/.test(pkg.compatibilityDate || '')
    || !Array.isArray(pkg.migrations) || !pkg.migrations.length || pkg.migrations.length > 100
    || pkg.migrations.some(m => !/^\d{4}_[a-z0-9_]+\.sql$/.test(m.name) || typeof m.sql !== 'string' || !m.sql.trim())
    || new Set(pkg.migrations.map(m => m.name)).size !== pkg.migrations.length) throw new Error('Invalid Worker package.')

  const account = `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}`
  const api = async (path, init) => {
    const value = JSON.parse(await downloadText(fetcher, account + path, {
      ...init, redirect: 'error', headers: { ...init.headers, Authorization: `Bearer ${auth.apiToken}` },
    }, 256 * 1024))
    if (value.success !== true) throw new Error('Worker deployment failed.')
    return value.result
  }
  const query = async sql => {
    const result = await api(`/d1/database/${auth.databaseId}/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }),
    })
    if (!Array.isArray(result) || result.some(r => r.success === false)) throw new Error('Worker migration failed.')
    return result.flatMap(r => r.results || [])
  }
  await query('CREATE TABLE IF NOT EXISTS izumi_deploy_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const native = await query('SELECT name FROM izumi_deploy_migrations')
  const hasWrangler = await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'")
  const legacy = hasWrangler.length ? await query('SELECT name FROM d1_migrations') : []
  const applied = new Set([...native, ...legacy].map(r => r.name.replace(/\.sql$/, '')))
  const pending = pkg.migrations.filter(m => !applied.has(m.name.replace(/\.sql$/, ''))).sort((a, b) => a.name.localeCompare(b.name))
  // Remain within the Free plan's subrequest allowance, even across many missed releases.
  // Migration progress is durable; a later check continues before any code is replaced.
  for (const migration of pending.slice(0, 15)) {
    // Leave time to record this migration before the shared deployment lease expires.
    checkDeadline()
    await query(migration.sql)
    await query(`INSERT INTO izumi_deploy_migrations (name, applied_at) VALUES ('${migration.name.replace(/\.sql$/, '')}', unixepoch())`)
  }
  if (pending.length > 15) throw new Error('Remaining migrations will continue on the next check.')
  checkDeadline()
  if (legacy.length) {
    await query('INSERT OR IGNORE INTO izumi_deploy_migrations (name, applied_at) VALUES ' + pkg.migrations.map(m => `('${m.name.replace(/\.sql$/, '')}', unixepoch())`).join(','))
  }
  const form = new FormData()
  form.set('metadata', new Blob([JSON.stringify({
    main_module: 'worker.mjs', compatibility_date: pkg.compatibilityDate, compatibility_flags: ['nodejs_compat'],
    bindings: [{ type: 'd1', name: 'DB', id: auth.databaseId }], keep_bindings: ['secret_text', 'plain_text'],
    annotations: { 'workers/message': `Automatic Izumi Worker update ${pkg.version}` },
  })], { type: 'application/json' }))
  form.set('worker.mjs', new Blob([pkg.script], { type: 'application/javascript+module' }), 'worker.mjs')
  checkDeadline()
  await api(`/workers/scripts/${auth.scriptName}`, { method: 'PUT', body: form })
}
