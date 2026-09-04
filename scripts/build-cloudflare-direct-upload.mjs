import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(import.meta.dirname, '..')
const workerRoot = join(repositoryRoot, 'cloudflare-sync-worker')
const outputPath = join(repositoryRoot, 'src-tauri', 'src', 'cloudflare_worker_bundle.mjs')
const hashPrefix = '// izumi-cloudflare-source-sha256:'
const checkOnly = process.argv.includes('--check')

function filesBelow(root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...filesBelow(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

const inputs = [
  ...filesBelow(join(workerRoot, 'src')),
  ...filesBelow(join(workerRoot, 'migrations')),
  join(workerRoot, 'package.json'),
  join(workerRoot, 'package-lock.json'),
  join(workerRoot, 'wrangler.jsonc'),
  fileURLToPath(import.meta.url),
].sort()

const sourceHash = createHash('sha256')
for (const path of inputs) {
  sourceHash.update(relative(repositoryRoot, path).replaceAll('\\', '/'))
  sourceHash.update('\0')
  sourceHash.update(readFileSync(path))
  sourceHash.update('\0')
}
const digest = sourceHash.digest('hex')

function bundledHash() {
  if (!existsSync(outputPath)) return ''
  const firstLine = readFileSync(outputPath, 'utf8').split(/\r?\n/, 1)[0]
  return firstLine.startsWith(hashPrefix) ? firstLine.slice(hashPrefix.length) : ''
}

if (bundledHash() === digest) {
  console.log(`Cloudflare direct-upload bundle is current (${digest.slice(0, 12)}).`)
  process.exit(0)
}

if (checkOnly) {
  console.error('Cloudflare direct-upload bundle is stale. Run: npm run cloudflare:bundle')
  process.exit(1)
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'izumi-cloudflare-bundle-'))
try {
  const wrangler = join(workerRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  const result = spawnSync(process.execPath, [
    wrangler, 'deploy', '--dry-run', '--minify', '--outdir', temporaryDirectory,
  ], { cwd: workerRoot, encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.error) process.stderr.write(`${result.error.message}\n`)
    process.exit(result.status ?? 1)
  }
  const bundlePath = join(temporaryDirectory, 'index.js')
  const bundle = readFileSync(bundlePath, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n')
  writeFileSync(outputPath, `${hashPrefix}${digest}\n${bundle}\n`)
  console.log(`Generated ${basename(outputPath)} (${Buffer.byteLength(bundle)} bytes).`)
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
