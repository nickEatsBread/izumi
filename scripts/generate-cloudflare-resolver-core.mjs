import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(repositoryRoot, 'src', 'lib', 'stremio')
const outputRoot = join(repositoryRoot, 'cloudflare-sync-worker', 'src', 'generated', 'resolver-core')
const entryFiles = [
  join(sourceRoot, 'resolver-core.ts'),
  join(sourceRoot, 'debrid', 'index.ts'),
]
const debridHttpFile = join(sourceRoot, 'debrid', 'http.ts')
const checkOnly = process.argv.includes('--check')
const importPattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g
const cloudflareJfetch = `export async function jfetch(url: string, init?: any): Promise<{ ok: boolean; status: number; json: any }> {
  const controller = new AbortController()
  const parentSignal = init?.signal as AbortSignal | undefined
  const onAbort = () => controller.abort()
  if (parentSignal?.aborted) controller.abort()
  else parentSignal?.addEventListener?.('abort', onAbort, { once: true })
  const timeoutMs = Math.max(1_000, Math.min(20_000, Number(init?.timeoutMs) || 8_000))
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const { priority: _priority, timeoutMs: _timeoutMs, signal: _signal, ...requestInit } = init ?? {}
  try {
    const response = await fetch(url, { ...requestInit, signal: controller.signal })
    const text = await response.text()
    if (text.length > 4 * 1024 * 1024) throw new Error('Debrid response exceeded the Worker limit.')
    let json: unknown = {}
    try { json = text ? JSON.parse(text) : {} } catch { json = {} }
    return { ok: response.ok, status: response.status, json }
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener?.('abort', onAbort)
  }
}`

function inside(root, candidate) {
  const path = resolve(candidate)
  return path === root || path.startsWith(`${root}${sep}`)
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function resolveImport(importer, specifier) {
  const base = resolve(dirname(importer), specifier)
  const candidates = [base, `${base}.ts`, join(base, 'index.ts')]
  for (const candidate of candidates) {
    if (inside(sourceRoot, candidate) && await exists(candidate)) return candidate
  }
  throw new Error(`Resolver core import cannot be vendored: ${relative(repositoryRoot, importer)} -> ${specifier}`)
}

function cloudflareSource(path, source) {
  if (path !== debridHttpFile) return source
  const withoutNativeImport = source.replace(/^import\s+\{\s*invokeNativeHttp\s*\}\s+from\s+['"]\$lib\/net\/http['"]\r?\n/m, '')
  const start = withoutNativeImport.indexOf('// CLOUDFLARE_HTTP_ADAPTER_START')
  const endMarker = '// CLOUDFLARE_HTTP_ADAPTER_END'
  const end = withoutNativeImport.indexOf(endMarker)
  if (start < 0 || end < start) throw new Error('Cloudflare HTTP adapter markers are missing from debrid/http.ts')
  return `${withoutNativeImport.slice(0, start)}${cloudflareJfetch}\n${withoutNativeImport.slice(end + endMarker.length)}`
}

async function sourceClosure() {
  const pending = [...entryFiles]
  const sources = new Map()
  while (pending.length) {
    const path = pending.shift()
    if (!path || sources.has(path)) continue
    if (!inside(sourceRoot, path)) throw new Error(`Resolver dependency escaped its pure source directory: ${path}`)
    const source = cloudflareSource(path, await readFile(path, 'utf8'))
    sources.set(path, source)
    for (const match of source.matchAll(importPattern)) pending.push(await resolveImport(path, match[1]))
  }
  return sources
}

async function filesBelow(root) {
  if (!await exists(root)) return []
  const output = []
  const pending = [root]
  while (pending.length) {
    const directory = pending.shift()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else output.push(path)
    }
  }
  return output
}

function generatedSource(path, source) {
  const origin = relative(repositoryRoot, path).replaceAll('\\', '/')
  return `// GENERATED from ${origin} by scripts/generate-cloudflare-resolver-core.mjs.\n// Edit the canonical source, then regenerate; do not edit this vendored copy.\n${source}`
}

async function expectedFiles() {
  const expected = new Map()
  for (const [sourcePath, source] of await sourceClosure()) {
    const outputPath = join(outputRoot, relative(sourceRoot, sourcePath))
    expected.set(outputPath, generatedSource(sourcePath, source))
  }
  return expected
}

async function check(expected) {
  const problems = []
  const actualFiles = await filesBelow(outputRoot)
  for (const path of actualFiles) {
    if (!expected.has(path)) problems.push(`stale: ${relative(repositoryRoot, path)}`)
  }
  for (const [path, content] of expected) {
    if (!await exists(path)) problems.push(`missing: ${relative(repositoryRoot, path)}`)
    else if (await readFile(path, 'utf8') !== content) problems.push(`outdated: ${relative(repositoryRoot, path)}`)
  }
  if (problems.length) {
    throw new Error(`Generated Cloudflare resolver core is not current:\n${problems.join('\n')}\nRun: node scripts/generate-cloudflare-resolver-core.mjs`)
  }
}

async function generate(expected) {
  await mkdir(outputRoot, { recursive: true })
  for (const path of await filesBelow(outputRoot)) {
    if (!expected.has(path)) await unlink(path)
  }
  for (const [path, content] of expected) {
    await mkdir(dirname(path), { recursive: true })
    if (!await exists(path) || await readFile(path, 'utf8') !== content) await writeFile(path, content)
  }
}

const expected = await expectedFiles()
if (checkOnly) {
  await check(expected)
  console.log(`Cloudflare resolver core is current (${expected.size} files).`)
} else {
  await generate(expected)
  await check(expected)
  console.log(`Generated Cloudflare resolver core (${expected.size} files).`)
}
