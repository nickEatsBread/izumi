import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = join(repositoryRoot, 'src', 'lib', 'stremio')
const outputRoot = join(repositoryRoot, 'cloudflare-sync-worker', 'src', 'generated', 'resolver-core')
const entryFile = join(sourceRoot, 'resolver-core.ts')
const checkOnly = process.argv.includes('--check')
const importPattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"](\.[^'"]+)['"]/g

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

async function sourceClosure() {
  const pending = [entryFile]
  const sources = new Map()
  while (pending.length) {
    const path = pending.shift()
    if (!path || sources.has(path)) continue
    if (!inside(sourceRoot, path)) throw new Error(`Resolver dependency escaped its pure source directory: ${path}`)
    const source = await readFile(path, 'utf8')
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
