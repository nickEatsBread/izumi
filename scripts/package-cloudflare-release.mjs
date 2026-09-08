import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const worker = join(root, 'cloudflare-sync-worker')
const tag = process.argv[2]
const output = resolve(process.argv[3] || join(root, 'artifacts', 'worker'))
if (!/^(worker-)?v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('Pass a stable release tag: vX.Y.Z.')
const check = spawnSync(process.execPath, [join(root, 'scripts/build-cloudflare-direct-upload.mjs'), '--check'], { encoding: 'utf8' })
if (check.status !== 0) throw new Error('Rebuild the current Worker bundle before packaging a release.')
const version = JSON.parse(readFileSync(join(worker, 'package.json'), 'utf8')).version
if (tag.startsWith('worker-') && tag !== `worker-v${version}`) throw new Error('Worker release tag must match its version.')
const config = JSON.parse(readFileSync(join(worker, 'wrangler.jsonc'), 'utf8'))
// Windows checkouts materialize these files with CRLF; the published package must hash the same
// from every clone, so normalize to the repository's canonical LF before embedding.
const lf = text => text.replace(/\r\n/g, '\n')
const script = lf(readFileSync(join(root, 'src-tauri/src/cloudflare_worker_bundle.mjs'), 'utf8'))
const migrations = readdirSync(join(worker, 'migrations')).filter(name => name.endsWith('.sql')).sort()
  .map(name => ({ name, sql: lf(readFileSync(join(worker, 'migrations', name), 'utf8')) }))
const text = JSON.stringify({ schema: 1, version, compatibilityDate: config.compatibility_date, script, migrations })
const manifest = { schema: 1, version, tag, sha256: createHash('sha256').update(text).digest('hex') }
mkdirSync(output, { recursive: true })
writeFileSync(join(output, 'worker-package.json'), text)
writeFileSync(join(output, 'worker-update.json'), JSON.stringify(manifest))
console.log(`Packaged Worker ${version} for ${tag}.`)
