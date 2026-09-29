// No shebang: this is invoked as `node scripts/ci/librqbit-vendor.mjs`, never executed directly,
// and on a CRLF checkout a shebang line breaks the test transform (see next-beta-version.mjs).
//
// Builds src-tauri/vendor from upstream git revisions plus izumi's patches.
//
// izumi runs librqbit from the head of its upstream branch, not from the last crates.io release,
// and carries its own changes on top until upstream has an equivalent. src-tauri/vendor/upstream.json
// pins one commit per upstream repository; src-tauri/vendor/patches/<repo>/ holds izumi's changes
// as `git format-patch` files. From those two, this script:
//
//   - checks out each pinned commit and applies the patches (`git am`) on an `izumi` branch;
//   - packages every crate librqbit needs from those repositories with `cargo package`, which
//     produces exactly what crates.io would publish;
//   - vendors only the crates whose package differs from the crates.io release of the same
//     version. The rest keep coming from crates.io;
//   - rewrites the generated [patch.crates-io] block in src-tauri/Cargo.toml to match, and moves
//     only those crates in src-tauri/Cargo.lock.
//
//   node scripts/ci/librqbit-vendor.mjs sync     rebuild src-tauri/vendor from the pins
//   node scripts/ci/librqbit-vendor.mjs update   move the pins to the upstream branches' heads,
//                                               rebase the patches onto them, then sync
//   node scripts/ci/librqbit-vendor.mjs export   write the scratch clones' izumi branches back to
//                                               the patch files (after resolving an `update`
//                                               conflict, or editing a patch), then sync
//   node scripts/ci/librqbit-vendor.mjs check    change nothing in the repository; report upstream
//                                               movement, patch conflicts, patches upstream now
//                                               has, newer crates.io releases and vendor drift
//
// Options:
//   --work <dir>        scratch clones and cargo output (default tmp/librqbit-vendor)
//   --discard           throw away unexported work in the scratch clones (an unfinished update,
//                       commits not yet exported) instead of refusing to run
//   --report <file>     check: also write the markdown report here
//   --json <file>       check: also write the report as JSON here
//   --fail-on-drift     check: exit 1 when src-tauri/vendor is not what `sync` would build
//
// Needs git and cargo on PATH, and network access to GitHub and crates.io.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

export const BLOCK_BEGIN = '# BEGIN librqbit-vendor'
export const BLOCK_END = '# END librqbit-vendor'

// Files a crate package carries that say nothing about its source: the git commit it was packaged
// from, and a lockfile resolved against whatever the registry held at packaging time. Cargo never
// reads a dependency's lockfile.
export const PACKAGING_ONLY_FILES = Object.freeze(['.cargo_vcs_info.json', 'Cargo.lock'])

// The scratch clones' own commits (patches keep their authors).
const SCRATCH_ENV = Object.freeze({
  GIT_COMMITTER_NAME: 'librqbit-vendor',
  GIT_COMMITTER_EMAIL: 'librqbit-vendor@localhost',
})

// Settings that decide the bytes `git format-patch` writes, fixed so every machine exports the same
// patch files whatever its git config.
const FORMAT_PATCH_CONFIG = Object.freeze([
  'diff.algorithm=myers',
  'diff.noprefix=false',
  'diff.mnemonicPrefix=false',
  'diff.renames=true',
  'diff.relative=false',
  'format.signature=',
])

const CRATE_NAME = /^[A-Za-z0-9_-]+$/
const FULL_SHA = /^[0-9a-f]{40}$/

export function paths(root, work) {
  const vendor = join(root, 'src-tauri', 'vendor')
  const scratch = work ?? join(root, 'tmp', 'librqbit-vendor')
  return {
    root,
    vendor,
    pins: join(vendor, 'upstream.json'),
    patches: join(vendor, 'patches'),
    cargoToml: join(root, 'src-tauri', 'Cargo.toml'),
    cargoLock: join(root, 'src-tauri', 'Cargo.lock'),
    work: scratch,
    state: join(scratch, 'update-state.json'),
    applied: join(scratch, 'applied.json'),
    lock: join(scratch, '.lock'),
  }
}

// ---------------------------------------------------------------------------------------------
// Pure helpers (unit-tested)

/** Reads an uncompressed tar archive into a Map of path -> contents. Regular files only. */
export function untar(buffer) {
  const files = new Map()
  let offset = 0
  let longName = null
  let paxPath = null
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const field = (start, length) => {
      const bytes = header.subarray(start, start + length)
      const end = bytes.indexOf(0)
      return bytes.subarray(0, end < 0 ? length : end).toString('utf8')
    }
    let name = field(0, 100)
    // Only a POSIX ustar header has a name prefix at 345. In a GNU header (cargo writes those) the
    // same bytes hold atime and ctime.
    if (header.subarray(257, 263).toString('latin1') === 'ustar\0') {
      const prefix = field(345, 155)
      if (prefix) name = `${prefix}/${name}`
    }
    const size = Number.parseInt(field(124, 12).trim() || '0', 8)
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    const body = buffer.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0[\s\S]*$/, '')
      continue
    }
    if (type === 'x') {
      paxPath = parsePax(body).path ?? null
      continue
    }
    if (type === 'g') continue
    if (paxPath) name = paxPath
    else if (longName) name = longName
    longName = null
    paxPath = null
    if (type === '0' || type === '7') files.set(name, Buffer.from(body))
  }
  return files
}

function parsePax(body) {
  const records = {}
  let rest = body.toString('utf8')
  while (rest.length) {
    const space = rest.indexOf(' ')
    if (space < 0) break
    const length = Number.parseInt(rest.slice(0, space), 10)
    if (!length) break
    const record = rest.slice(space + 1, length - 1)
    const equals = record.indexOf('=')
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1)
    rest = rest.slice(length)
  }
  return records
}

/** A .crate archive's files, without the `<name>-<version>/` directory they sit in. */
export function crateFiles(gzipped) {
  const files = new Map()
  for (const [name, contents] of untar(gunzipSync(gzipped))) {
    const slash = name.indexOf('/')
    if (slash <= 0) continue
    const path = name.slice(slash + 1)
    if (!path || path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '')) {
      throw new Error(`crate archive entry escapes its directory: ${name}`)
    }
    files.set(path, contents)
  }
  return files
}

/** Drops packaging-only files and anything under an omitted prefix (e.g. `webui/`). */
export function sourceFiles(files, omit = []) {
  const kept = new Map()
  for (const [name, contents] of files) {
    if (PACKAGING_ONLY_FILES.includes(name)) continue
    if (omit.some((prefix) => name === prefix || name.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))) continue
    kept.set(name, contents)
  }
  return kept
}

// Cargo writes the packaged Cargo.toml itself, headed by a comment whose wording changes between
// Cargo versions. Compare what it declares, not how it is annotated.
function comparable(name, contents) {
  if (name !== 'Cargo.toml') return contents
  const lines = contents.toString('utf8').replace(/\r\n/g, '\n').split('\n')
  return Buffer.from(lines.filter((line) => line.trim() && !line.trimStart().startsWith('#')).join('\n'))
}

/** Paths that differ between two file maps (added, removed or changed), sorted. */
export function differingFiles(a, b) {
  const names = new Set([...a.keys(), ...b.keys()])
  return [...names]
    .filter((name) => !a.has(name) || !b.has(name) || !comparable(name, a.get(name)).equals(comparable(name, b.get(name))))
    .sort()
}

/** Names reachable from `root` through normal and build dependencies in `cargo metadata` output. */
export function dependencyClosure(metadata, root) {
  const names = new Map(metadata.packages.map((pkg) => [pkg.id, pkg.name]))
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]))
  const start = metadata.packages.find((pkg) => pkg.name === root && pkg.source == null)
  if (!start) throw new Error(`${root} is not a member of this workspace`)
  const seen = new Set([start.id])
  const queue = [start.id]
  while (queue.length) {
    const node = nodes.get(queue.shift())
    for (const dep of node?.deps ?? []) {
      const runtime = (dep.dep_kinds ?? [{ kind: null }]).some((kind) => kind.kind !== 'dev')
      if (runtime && !seen.has(dep.pkg)) {
        seen.add(dep.pkg)
        queue.push(dep.pkg)
      }
    }
  }
  return new Set([...seen].map((id) => names.get(id)))
}

/** Where a symlink with this target, stored at `linkPath` (repo-relative, POSIX), points. */
export function resolveLinkTarget(linkPath, target) {
  const resolved = posix.normalize(posix.join(posix.dirname(linkPath), target.trim()))
  return resolved.startsWith('../') ? null : resolved
}

export function renderPatchBlock(names) {
  if (!names.length) return ''
  return [
    `${BLOCK_BEGIN}: written by scripts/ci/librqbit-vendor.mjs from src-tauri/vendor/upstream.json.`,
    '# These crates are upstream git revisions, some with izumi patches, that crates.io does not have',
    '# yet. vendor/README.md explains how to update them. Edit upstream.json, not this block.',
    '[patch.crates-io]',
    ...names.map((name) => `${name} = { path = "vendor/${name}" }`),
    BLOCK_END,
  ].join('\n')
}

/** Replaces the generated block in Cargo.toml text (LF), or appends it. */
export function replacePatchBlock(text, names) {
  const begin = text.indexOf(BLOCK_BEGIN)
  const end = text.indexOf(BLOCK_END)
  if ((begin < 0) !== (end < 0) || end < begin) throw new Error('Cargo.toml has a broken librqbit-vendor block')
  const block = renderPatchBlock(names)
  if (begin < 0) {
    if (!block) return text
    if (/^\[patch\.crates-io\]/m.test(text)) {
      throw new Error('Cargo.toml has a [patch.crates-io] table outside the librqbit-vendor block')
    }
    return `${text.replace(/\n*$/, '')}\n\n${block}\n`
  }
  const lineEnd = text.indexOf('\n', end)
  const after = lineEnd < 0 ? '' : text.slice(lineEnd + 1)
  if (!block) return `${text.slice(0, begin).replace(/\n+$/, '\n')}${after}`
  return `${text.slice(0, begin)}${block}\n${after}`
}

export function readPatchBlock(text) {
  const begin = text.indexOf(BLOCK_BEGIN)
  const end = text.indexOf(BLOCK_END)
  if (begin < 0 || end < 0) return []
  return [...text.slice(begin, end).matchAll(/^([\w-]+) = \{ path = "vendor\/([\w-]+)" \}$/gm)].map((m) => m[1])
}

export function parseLockedPackageNames(lockText) {
  return new Set([...lockText.matchAll(/^\[\[package\]\]\r?\nname = "([^"]+)"/gm)].map((m) => m[1]))
}

/** How many times each package name is locked (a name locked twice needs `name@version` specs). */
export function lockedPackageCounts(lockText) {
  const counts = new Map()
  for (const match of lockText.matchAll(/^\[\[package\]\]\r?\nname = "([^"]+)"/gm)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  return counts
}

/**
 * Whether a commit's diff only adds or removes comments and blank lines. A patch whose code change
 * upstream has made shrinks to the "Modified for izumi" notices after a rebase, and never becomes
 * empty, so git keeps it.
 */
export function isNoticeOnlyDiff(diff) {
  const changed = diff
    .split('\n')
    .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'))
    .map((line) => line.slice(1).trim())
  return changed.length > 0 && changed.every((line) => !line || line.startsWith('//'))
}

function parseVersion(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/)
  if (!match) return null
  return { core: match.slice(1, 4).map(Number), pre: match[4] ? match[4].split('.') : [] }
}

/** Semver precedence: negative, zero or positive as `a` is older than, equal to or newer than `b`. */
export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)]
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i]
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)]
    if (pn && qn) return Number(p) - Number(q)
    if (pn !== qn) return pn ? -1 : 1
    return p < q ? -1 : 1
  }
  return 0
}

/** The path of a crate's file in the crates.io sparse index. */
export function indexPath(name) {
  const lower = name.toLowerCase()
  if (lower.length <= 2) return `${lower.length}/${lower}`
  if (lower.length === 3) return `3/${lower[0]}/${lower}`
  return `${lower.slice(0, 2)}/${lower.slice(2, 4)}/${lower}`
}

/** Inline code in GitHub markdown: no autolinked `#123` references or `@name` mentions inside. */
export function code(text) {
  const value = String(text).replace(/\r?\n/g, ' ')
  if (!value.includes('`')) return `\`${value}\``
  return `\`\` ${value} \`\``
}

export function renderReport(report) {
  const lines = ['## Vendored librqbit', '']
  const attention = report.drift.filter((d) => !d.minor)
  if (!report.needsAttention) {
    lines.push('src-tauri/vendor matches its pins, the pinned commits are the heads of their branches, and no newer crates.io release exists.')
  }
  for (const repo of report.repos) {
    const web = repo.url.replace(/\.git$/, '')
    const pinned = `[${code(repo.pinned.slice(0, 12))}](${web}/commit/${repo.pinned})`
    if (!repo.commits.length) {
      if (report.needsAttention) lines.push(`- **${repo.key}**: pinned at ${pinned}, the head of ${code(repo.branch)}.`)
      continue
    }
    lines.push(
      `- **${repo.key}**: ${code(repo.branch)} has ${repo.commits.length} commit(s) after the pin (${pinned} → [${code(repo.head.slice(0, 12))}](${web}/commit/${repo.head})):`,
    )
    for (const commit of repo.commits.slice(0, 30)) {
      lines.push(`  - [${code(commit.sha.slice(0, 7))}](${web}/commit/${commit.sha}) ${code(commit.subject)}`)
    }
    if (repo.commits.length > 30) lines.push(`  - … and ${repo.commits.length - 30} more`)
    if (repo.rebase?.clean) {
      lines.push(`  - izumi's ${repo.patches.length} patch(es) rebase cleanly onto it.`)
      for (const subject of repo.rebase.dropped) lines.push(`  - Upstream now has ${code(subject)}; \`update\` drops that patch.`)
      for (const subject of repo.rebase.noticeOnly ?? []) {
        lines.push(`  - After the rebase ${code(subject)} only adds izumi's notices: upstream seems to have its change. Drop it by hand (vendor/README.md).`)
      }
    } else if (repo.rebase) {
      lines.push(`  - izumi's patches conflict in ${repo.rebase.conflicts.map(code).join(', ')}; \`update\` stops there for a manual resolve.`)
    }
  }
  for (const release of report.releases) {
    lines.push(`- **crates.io**: ${code(`${release.name} ${release.latest}`)} is out; the pinned source is ${code(release.pinned)}.`)
  }
  if (attention.length) {
    lines.push('- **Drift**: src-tauri/vendor is not what `sync` builds from the pins and patches:')
    for (const item of attention) lines.push(`  - ${item.text}`)
  }
  const notes = report.drift.filter((d) => d.minor)
  if (notes.length) {
    lines.push('', 'Notes:')
    for (const item of notes) lines.push(`- ${item.text}`)
  }
  if (report.needsAttention) {
    lines.push(
      '',
      'To update: `node scripts/ci/librqbit-vendor.mjs update`, then `cargo check` in src-tauri, the vendored crate tests, and a direct-P2P playback check. src-tauri/vendor/README.md has the steps.',
    )
  }
  return `${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------------------------
// Processes

function run(command, args, { cwd, env, allowFail = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}) in ${cwd}\n${result.stderr}${result.stdout}`)
  }
  return result
}

const git = (cwd, args, options = {}) =>
  run('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, env: SCRATCH_ENV, ...options })

const gitLines = (cwd, args) => git(cwd, args).stdout.split('\n').filter(Boolean)

function log(message) {
  process.stderr.write(`${message}\n`)
}

function cargoVersion() {
  return run('cargo', ['--version']).stdout.trim().split(/\s+/)[1]
}

// ---------------------------------------------------------------------------------------------
// Pins, patches and the scratch work directory

export function readPins(p) {
  const pins = JSON.parse(readFileSync(p.pins, 'utf8'))
  if (!pins.root || !pins.repos?.[pins.rootRepo]) throw new Error(`${p.pins} needs root, rootRepo and repos`)
  for (const [key, repo] of Object.entries(pins.repos)) {
    if (!CRATE_NAME.test(key)) throw new Error(`upstream.json: bad repository key "${key}"`)
    if (!repo.url || !repo.branch) throw new Error(`upstream.json: ${key} needs url and branch`)
    if (!FULL_SHA.test(repo.rev ?? '')) throw new Error(`upstream.json: ${key}.rev must be a full 40-character commit hash`)
  }
  return pins
}

function writePins(p, pins) {
  writeFileSync(p.pins, `${JSON.stringify(pins, null, 2)}\n`)
}

function patchFiles(p, key) {
  const dir = join(p.patches, key)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.patch'))
    .sort()
    .map((name) => join(dir, name))
}

function hashPatches(files) {
  const hash = createHash('sha256')
  for (const file of files) hash.update(`${file.split(/[\\/]/).pop()}\0`).update(readFileSync(file))
  return hash.digest('hex')
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
}

function repoDir(p, key) {
  return join(p.work, 'src', key)
}

/** One run at a time per work directory: two would reset each other's clones. */
function takeWorkLock(p) {
  mkdirSync(p.work, { recursive: true })
  try {
    writeFileSync(p.lock, String(process.pid), { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const pid = Number(readFileSync(p.lock, 'utf8'))
    let alive = false
    try {
      process.kill(pid, 0)
      alive = pid !== process.pid
    } catch (probe) {
      alive = probe.code === 'EPERM'
    }
    if (alive) throw new Error(`Another librqbit-vendor run (pid ${pid}) is using ${p.work}.`)
    writeFileSync(p.lock, String(process.pid))
  }
  process.on('exit', () => {
    try {
      if (readFileSync(p.lock, 'utf8') === String(process.pid)) rmSync(p.lock)
    } catch {}
  })
}

/**
 * Commands other than `export` reset the scratch clones. Refuse when that would throw work away: an
 * update waiting for a conflict resolution, a rebase or am in progress, uncommitted changes, or
 * commits on an izumi branch that were never exported to the patch files.
 */
function guardClones(p, pins, discard) {
  const problems = []
  if (existsSync(p.state)) {
    const { key } = readJson(p.state, {})
    problems.push(`an update of ${key} is waiting for a conflict resolution (finish it with \`export\`)`)
  }
  const applied = readJson(p.applied, {})
  for (const key of Object.keys(pins.repos)) {
    const dir = repoDir(p, key)
    if (!existsSync(join(dir, '.git'))) continue
    if (existsSync(join(dir, '.git', 'rebase-merge')) || existsSync(join(dir, '.git', 'rebase-apply'))) {
      problems.push(`${dir} is in the middle of a rebase or am`)
      continue
    }
    if (git(dir, ['status', '--porcelain']).stdout.trim()) problems.push(`${dir} has uncommitted changes`)
    const head = git(dir, ['rev-parse', '--verify', '--quiet', 'refs/heads/izumi'], { allowFail: true }).stdout.trim()
    if (head && applied[key]?.head && head !== applied[key].head) {
      problems.push(`${dir} has commits on its izumi branch that are not in the patch files (\`export\` writes them)`)
    }
  }
  if (!problems.length) return
  if (!discard) {
    throw new Error(`This would throw away work in ${p.work}:\n- ${problems.join('\n- ')}\nPass --discard to go ahead anyway.`)
  }
  log(`Discarding: ${problems.join('; ')}`)
  rmSync(p.state, { force: true })
}

/** A clean checkout of `rev`, which must be on the pinned branch, with no rebase or am in progress. */
function checkout(p, key, repo, rev) {
  const dir = repoDir(p, key)
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dirname(dir), { recursive: true })
    // Symlinks are materialized by hand (see materializeSymlinks), so the checkout is the same
    // on every platform. No line-ending conversion: the patches and packages are byte-exact.
    run('git', ['-c', 'core.autocrlf=false', '-c', 'core.symlinks=false', 'clone', '--quiet', '--filter=blob:none', '--no-checkout', repo.url, dir])
    git(dir, ['config', 'core.autocrlf', 'false'])
    git(dir, ['config', 'core.symlinks', 'false'])
  }
  git(dir, ['rebase', '--abort'], { allowFail: true })
  git(dir, ['am', '--abort'], { allowFail: true })
  const onBranch = () => git(dir, ['merge-base', '--is-ancestor', rev, `refs/remotes/origin/${repo.branch}`], { allowFail: true }).status === 0
  if (!onBranch()) {
    git(dir, ['fetch', '--quiet', 'origin', `+refs/heads/${repo.branch}:refs/remotes/origin/${repo.branch}`])
    if (!onBranch()) throw new Error(`${key}: the pinned ${rev.slice(0, 12)} is not on ${repo.url} ${repo.branch}`)
  }
  git(dir, ['checkout', '--quiet', '--force', '--detach', rev])
  git(dir, ['reset', '--quiet', '--hard'])
  git(dir, ['clean', '--quiet', '-fdx'])
  return dir
}

/** Applies the repo's patches as commits on an `izumi` branch at the current checkout. */
function applyPatches(p, key, dir) {
  git(dir, ['checkout', '--quiet', '-B', 'izumi'])
  const files = patchFiles(p, key)
  if (files.length) {
    const result = git(dir, ['am', '--quiet', '--no-3way', '--committer-date-is-author-date', ...files], { allowFail: true })
    if (result.status !== 0) {
      git(dir, ['am', '--abort'], { allowFail: true })
      throw new Error(`src-tauri/vendor/patches/${key} does not apply to the pinned commit:\n${result.stderr}${result.stdout}`)
    }
  }
  const applied = readJson(p.applied, {})
  applied[key] = {
    base: git(dir, ['rev-parse', 'HEAD~' + files.length]).stdout.trim(),
    head: git(dir, ['rev-parse', 'HEAD']).stdout.trim(),
    patches: hashPatches(files),
  }
  writeFileSync(p.applied, `${JSON.stringify(applied, null, 2)}\n`)
  return files
}

/** Replaces each tracked symlink with a copy of the file it points to, so `cargo package` gets content. */
function materializeSymlinks(dir) {
  const listing = git(dir, ['ls-files', '-s', '-z']).stdout.split('\0').filter(Boolean)
  for (const entry of listing) {
    const [meta, path] = entry.split('\t')
    const [mode, blob] = meta.split(' ')
    if (mode !== '120000') continue
    const target = resolveLinkTarget(path, git(dir, ['cat-file', '-p', blob]).stdout)
    const source = target && join(dir, target)
    if (!source || !existsSync(source) || !statSync(source).isFile()) continue
    rmSync(join(dir, path), { force: true })
    copyFileSync(source, join(dir, path))
  }
}

function branchHead(dir, repo) {
  git(dir, ['fetch', '--quiet', 'origin', `+refs/heads/${repo.branch}:refs/remotes/origin/${repo.branch}`])
  return git(dir, ['rev-parse', `refs/remotes/origin/${repo.branch}`]).stdout.trim()
}

function subjects(dir, range) {
  return gitLines(dir, ['log', '--reverse', '--format=%s', range])
}

// ---------------------------------------------------------------------------------------------
// crates.io

const USER_AGENT = 'izumi-librqbit-vendor (https://github.com/nickEatsBread/izumi)'
const indexCache = new Map()

/** Every published version of a crate, from the sparse index (empty when the crate is unknown). */
async function publishedVersions(name) {
  if (!indexCache.has(name)) {
    const response = await fetch(`https://index.crates.io/${indexPath(name)}`, { headers: { 'user-agent': USER_AGENT } })
    if (response.status === 404) indexCache.set(name, [])
    else if (!response.ok) throw new Error(`crates.io index ${name}: HTTP ${response.status}`)
    else {
      const text = await response.text()
      indexCache.set(
        name,
        text
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .map((entry) => ({ version: entry.vers, yanked: Boolean(entry.yanked) })),
      )
    }
  }
  return indexCache.get(name)
}

async function cratesIoArchive(p, name, version) {
  if (!(await publishedVersions(name)).some((entry) => entry.version === version)) return null
  const cache = join(p.work, 'crates-io', `${name}-${version}.crate`)
  if (!existsSync(cache)) {
    const response = await fetch(`https://static.crates.io/crates/${name}/${name}-${version}.crate`, {
      headers: { 'user-agent': USER_AGENT },
    })
    if (!response.ok) throw new Error(`crates.io ${name} ${version}: HTTP ${response.status}`)
    mkdirSync(dirname(cache), { recursive: true })
    writeFileSync(cache, Buffer.from(await response.arrayBuffer()))
  }
  return crateFiles(readFileSync(cache))
}

async function latestRelease(name) {
  const stable = (await publishedVersions(name)).filter((entry) => !entry.yanked && parseVersion(entry.version)?.pre.length === 0)
  return stable.map((entry) => entry.version).sort(compareVersions).at(-1) ?? null
}

// ---------------------------------------------------------------------------------------------
// Packaging

function cargoJson(dir, args) {
  return JSON.parse(run('cargo', ['metadata', '--format-version', '1', ...args], { cwd: dir }).stdout)
}

function lockText(p) {
  return existsSync(p.cargoLock) ? readFileSync(p.cargoLock, 'utf8') : ''
}

/**
 * Checks out every pin with its patches and works out what src-tauri/vendor must hold: each crate
 * librqbit needs from the pinned repositories whose package differs from crates.io.
 */
async function buildVendor(p, pins) {
  const dirs = {}
  const licenses = {}
  const members = []
  const patchSubjects = {}
  for (const [key, repo] of Object.entries(pins.repos)) {
    const dir = checkout(p, key, repo, repo.rev)
    applyPatches(p, key, dir)
    patchSubjects[key] = subjects(dir, `${repo.rev}..izumi`)
    materializeSymlinks(dir)
    dirs[key] = dir
    if (existsSync(join(dir, 'LICENSE'))) licenses[key] = readFileSync(join(dir, 'LICENSE'))
    for (const pkg of cargoJson(dir, ['--no-deps']).packages) {
      if (Array.isArray(pkg.publish) && pkg.publish.length === 0) continue
      if (!CRATE_NAME.test(pkg.name)) throw new Error(`${key}: unexpected crate name ${pkg.name}`)
      members.push({ key, name: pkg.name, version: pkg.version })
    }
  }
  // Upstream's own graph includes crates that only its other workspace members or features pull in
  // (the UPnP media server, say). Take the ones izumi's lockfile has, plus any it will need that
  // crates.io does not have yet.
  const closure = dependencyClosure(cargoJson(dirs[pins.rootRepo], []), pins.root)
  const locked = parseLockedPackageNames(lockText(p))
  const needed = []
  for (const member of members) {
    if (!closure.has(member.name)) continue
    if (locked.has(member.name) || member.name === pins.root || !(await cratesIoArchive(p, member.name, member.version))) {
      needed.push(member)
    }
  }

  const crates = []
  for (const [key, dir] of Object.entries(dirs)) {
    const names = needed.filter((member) => member.key === key)
    if (!names.length) continue
    const target = join(p.work, 'target', key)
    rmSync(join(target, 'package'), { recursive: true, force: true })
    run('cargo', ['package', '--no-verify', '--allow-dirty', '--quiet', '--target-dir', target, ...names.flatMap((m) => ['-p', m.name])], { cwd: dir })
    for (const member of names) {
      const archive = join(target, 'package', `${member.name}-${member.version}.crate`)
      const omit = pins.omit?.[member.name] ?? []
      const files = sourceFiles(crateFiles(readFileSync(archive)), omit)
      const published = await cratesIoArchive(p, member.name, member.version)
      const changed = published ? differingFiles(files, sourceFiles(published, omit)) : null
      // A vendored copy carries its repository's licence notice, which the package may not.
      if (licenses[key] && ![...files.keys()].some((name) => /^LICEN[CS]E/i.test(name))) files.set('LICENSE', licenses[key])
      crates.push({ ...member, files, published: Boolean(published), changed })
    }
  }
  // Put the symlinks back, so each clone is its `izumi` branch exactly, ready for editing a patch.
  for (const dir of Object.values(dirs)) git(dir, ['reset', '--quiet', '--hard'])
  const vendored = crates.filter((c) => !c.published || c.changed.length).sort((a, b) => a.name.localeCompare(b.name))
  const reachable = members.filter((member) => closure.has(member.name)).map((member) => member.name)
  return { crates, vendored, reachable, patchSubjects }
}

function vendorCrateDirs(vendorDir) {
  if (!existsSync(vendorDir)) return []
  return readdirSync(vendorDir).filter((name) => CRATE_NAME.test(name) && existsSync(join(vendorDir, name, 'Cargo.toml')))
}

function readTree(dir) {
  const files = new Map()
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path)
      else files.set(path, readFileSync(join(dir, path)))
    }
  }
  walk('')
  return files
}

function writeVendor(p, pins, vendored) {
  const keep = new Set(vendored.map((c) => c.name))
  for (const name of vendorCrateDirs(p.vendor)) {
    if (!keep.has(name)) rmSync(join(p.vendor, name), { recursive: true, force: true })
  }
  for (const crate of vendored) {
    const dir = join(p.vendor, crate.name)
    rmSync(dir, { recursive: true, force: true })
    for (const [name, contents] of crate.files) {
      mkdirSync(dirname(join(dir, name)), { recursive: true })
      writeFileSync(join(dir, name), contents)
    }
  }
  const cargoToml = readFileSync(p.cargoToml, 'utf8')
  const crlf = cargoToml.includes('\r\n')
  const next = replacePatchBlock(cargoToml.replace(/\r\n/g, '\n'), [...keep].sort())
  writeFileSync(p.cargoToml, crlf ? next.replace(/\n/g, '\r\n') : next)
  // `cargo` records the Cargo that packaged the tree; the weekly check packages with the same one.
  writePins(p, { ...pins, cargo: cargoVersion(), vendored: [...keep].sort() })
}

/**
 * Moves only the given crates in Cargo.lock. A whole-graph resolve would also move unrelated
 * dependency edges to other versions already in the lockfile.
 */
function refreshLock(p, names) {
  if (!existsSync(p.cargoLock)) {
    run('cargo', ['generate-lockfile', '--manifest-path', p.cargoToml], { cwd: p.root })
  } else {
    const counts = lockedPackageCounts(lockText(p))
    const specs = [...new Set(names)].filter((name) => counts.get(name) === 1)
    if (specs.length) {
      run('cargo', ['update', '--manifest-path', p.cargoToml, ...specs.flatMap((name) => ['-p', name])], { cwd: p.root })
    }
  }
  if (lockText(p).includes('[[patch.unused]]')) {
    throw new Error(
      'Cargo.lock lists a vendored crate under [[patch.unused]]: Cargo is not using it. The version upstream is at no longer matches the librqbit requirement in src-tauri/Cargo.toml; raise that requirement and run `sync` again.',
    )
  }
}

/** Differences between what `sync` would write and what the repository holds. */
function vendorDrift(p, pins, vendored) {
  const drift = []
  const want = new Map(vendored.map((c) => [c.name, c.files]))
  for (const name of vendorCrateDirs(p.vendor)) {
    if (!want.has(name)) drift.push({ text: `src-tauri/vendor/${name} is vendored but no longer needs to be` })
  }
  for (const [name, files] of want) {
    const dir = join(p.vendor, name)
    if (!existsSync(dir)) {
      drift.push({ text: `src-tauri/vendor/${name} is missing` })
      continue
    }
    const differing = differingFiles(readTree(dir), files)
    if (differing.length === 1 && differing[0] === 'Cargo.toml') {
      drift.push({
        minor: true,
        text: `src-tauri/vendor/${name}/Cargo.toml is not what this Cargo (${cargoVersion()}) generates; the tree was packaged with ${pins.cargo ?? 'another version'}. \`sync\` rewrites it.`,
      })
    } else if (differing.length) {
      drift.push({ text: `src-tauri/vendor/${name} differs in ${differing.slice(0, 8).map(code).join(', ')}${differing.length > 8 ? ', …' : ''}` })
    }
  }
  const block = readPatchBlock(readFileSync(p.cargoToml, 'utf8').replace(/\r\n/g, '\n'))
  const names = [...want.keys()].sort()
  if (block.join() !== names.join()) drift.push({ text: `the [patch.crates-io] block lists ${block.join(', ') || 'nothing'}, not ${names.join(', ')}` })
  if ((pins.vendored ?? []).join() !== names.join()) drift.push({ text: `upstream.json "vendored" lists ${(pins.vendored ?? []).join(', ')}, not ${names.join(', ')}` })
  if (lockText(p).includes('[[patch.unused]]')) drift.push({ text: 'Cargo.lock lists a vendored crate under [[patch.unused]]' })
  return drift
}

// ---------------------------------------------------------------------------------------------
// Commands. The exported ones take the work-directory lock and refuse to discard work; the
// internal ones call each other freely.

async function doSync(p) {
  const pins = readPins(p)
  let { crates, vendored, reachable } = await buildVendor(p, pins)
  writeVendor(p, pins, vendored)
  const tracked = (names) => [...names].filter((name) => reachable.includes(name) || vendored.some((c) => c.name === name))
  refreshLock(p, tracked(parseLockedPackageNames(lockText(p))))
  // If the lockfile now has a crate from the pinned repositories that it did not have before,
  // decide about that one too.
  const missed = reachable.filter((name) => parseLockedPackageNames(lockText(p)).has(name) && !crates.some((c) => c.name === name))
  if (missed.length) {
    log(`Cargo.lock now also has ${missed.join(', ')}; packaging again.`)
    ;({ crates, vendored } = await buildVendor(p, pins))
    writeVendor(p, pins, vendored)
    refreshLock(p, tracked(parseLockedPackageNames(lockText(p))))
  }
  for (const crate of crates) {
    const status = !crate.published
      ? 'vendored (not on crates.io)'
      : crate.changed.length
        ? `vendored (${crate.changed.length} files differ from crates.io)`
        : 'from crates.io'
    log(`${crate.name} ${crate.version}: ${status}`)
  }
  log('Commit src-tauri/vendor, src-tauri/Cargo.toml and src-tauri/Cargo.lock together.')
  return { vendored: vendored.map((c) => c.name) }
}

/** Rebases one repo's patches from the pinned commit onto `head`. */
function rebasePatches(p, key, repo, head) {
  const dir = checkout(p, key, repo, repo.rev)
  applyPatches(p, key, dir)
  const before = subjects(dir, `${repo.rev}..izumi`)
  if (!before.length) return { dir, clean: true, dropped: [], noticeOnly: [] }
  const result = git(dir, ['rebase', '--quiet', '--committer-date-is-author-date', '--onto', head, repo.rev, 'izumi'], { allowFail: true })
  if (result.status !== 0) {
    const conflicts = gitLines(dir, ['diff', '--name-only', '--diff-filter=U'])
    return { dir, clean: false, conflicts }
  }
  // `git rebase` drops a patch whose change upstream already made (same patch-id, or now empty).
  const kept = subjects(dir, `${head}..izumi`)
  const dropped = before.filter((subject) => !kept.includes(subject))
  const noticeOnly = gitLines(dir, ['rev-list', '--reverse', `${head}..izumi`])
    .filter((sha) => isNoticeOnlyDiff(git(dir, ['show', '--format=', '--unified=0', sha]).stdout))
    .map((sha) => git(dir, ['log', '-1', '--format=%s', sha]).stdout.trim())
  return { dir, clean: true, dropped, noticeOnly }
}

function exportPatches(p, key, dir, base) {
  const out = join(p.patches, key)
  rmSync(out, { recursive: true, force: true })
  const count = Number(git(dir, ['rev-list', '--count', `${base}..HEAD`]).stdout.trim())
  if (!count) return []
  mkdirSync(out, { recursive: true })
  git(dir, [
    ...FORMAT_PATCH_CONFIG.flatMap((setting) => ['-c', setting]),
    'format-patch',
    '--quiet',
    '--zero-commit',
    '--no-signature',
    '--full-index',
    '--output-directory',
    out,
    `${base}..HEAD`,
  ])
  return patchFiles(p, key)
}

async function doUpdate(p) {
  const pins = readPins(p)
  for (const [key, repo] of Object.entries(pins.repos)) {
    const dir = checkout(p, key, repo, repo.rev)
    const head = branchHead(dir, repo)
    if (head === repo.rev) {
      log(`${key}: already at ${repo.branch} (${head.slice(0, 12)})`)
      continue
    }
    const rebase = rebasePatches(p, key, repo, head)
    if (!rebase.clean) {
      writeFileSync(p.state, `${JSON.stringify({ key, base: head }, null, 2)}\n`)
      throw new Error(
        [
          `${key}: izumi's patches conflict with ${repo.branch} ${head.slice(0, 12)} in ${rebase.conflicts.join(', ')}.`,
          `Resolve them in ${rebase.dir} (git add, then \`git rebase --continue\`), then run`,
          '  node scripts/ci/librqbit-vendor.mjs export',
          'or give up on this update with `node scripts/ci/librqbit-vendor.mjs sync --discard`.',
        ].join('\n'),
      )
    }
    exportPatches(p, key, rebase.dir, head)
    for (const subject of rebase.dropped) log(`${key}: upstream now has "${subject}", patch dropped`)
    for (const subject of rebase.noticeOnly) {
      log(`${key}: "${subject}" now only adds izumi's notices; upstream seems to have its change. Drop it by hand (vendor/README.md).`)
    }
    log(`${key}: ${repo.rev.slice(0, 12)} -> ${head.slice(0, 12)}`)
    pins.repos[key] = { ...repo, rev: head }
    writePins(p, pins)
  }
  return doSync(p)
}

function assertExportable(dir, base) {
  if (existsSync(join(dir, '.git', 'rebase-merge')) || existsSync(join(dir, '.git', 'rebase-apply'))) {
    throw new Error(`${dir} is still in the middle of a rebase. Finish it with \`git rebase --continue\`.`)
  }
  // The patches are the izumi branch. A detached checkout (of the bare pin, say) would export none.
  if (git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true }).stdout.trim() !== 'izumi') {
    throw new Error(`${dir} is not on its izumi branch. Run \`sync\` first.`)
  }
  if (git(dir, ['merge-base', '--is-ancestor', base, 'HEAD'], { allowFail: true }).status !== 0) {
    throw new Error(`${dir} HEAD is not on top of ${base}.`)
  }
  if (git(dir, ['status', '--porcelain']).stdout.trim()) {
    throw new Error(`${dir} has uncommitted changes. Commit them to the izumi branch first.`)
  }
}

async function doExport(p) {
  const pins = readPins(p)
  if (existsSync(p.state)) {
    const { key, base } = readJson(p.state, {})
    const repo = pins.repos[key]
    const dir = repoDir(p, key)
    assertExportable(dir, base)
    // The rebase was onto the branch head recorded in the state file, not some other commit.
    const forkPoint = git(dir, ['merge-base', 'HEAD', `refs/remotes/origin/${repo.branch}`]).stdout.trim()
    if (forkPoint !== base) throw new Error(`${dir} forks from ${repo.branch} at ${forkPoint.slice(0, 12)}, not at ${base.slice(0, 12)}.`)
    exportPatches(p, key, dir, base)
    pins.repos[key] = { ...repo, rev: base }
    writePins(p, pins)
    rmSync(p.state)
    log(`${key}: patches exported onto ${base.slice(0, 12)}`)
    return doUpdate(p)
  }
  const applied = readJson(p.applied, {})
  for (const [key, repo] of Object.entries(pins.repos)) {
    const dir = repoDir(p, key)
    if (!existsSync(join(dir, '.git'))) continue
    assertExportable(dir, repo.rev)
    // Only izumi's own commits may sit between the pin and HEAD, never newer upstream ones.
    const forkPoint = git(dir, ['merge-base', 'HEAD', `refs/remotes/origin/${repo.branch}`]).stdout.trim()
    if (forkPoint !== repo.rev) {
      throw new Error(`${dir} is not the pinned ${repo.rev.slice(0, 12)} plus patches (it forks from ${repo.branch} at ${forkPoint.slice(0, 12)}). Run \`sync\` first.`)
    }
    // The branch must have been built from the patch files as they are now, or exporting it would
    // quietly undo whatever changed them since (a pull, another checkout).
    if (applied[key]?.patches !== hashPatches(patchFiles(p, key))) {
      throw new Error(`src-tauri/vendor/patches/${key} changed since ${dir} was built from it. Run \`sync --discard\` and redo the edit.`)
    }
    const files = exportPatches(p, key, dir, repo.rev)
    log(`${key}: ${files.length} patch(es) exported onto the pinned ${repo.rev.slice(0, 12)}`)
  }
  return doSync(p)
}

async function doCheck(p) {
  const pins = readPins(p)
  const report = { needsAttention: false, repos: [], drift: [], releases: [] }

  // What sync would produce from the current pins, against what the repository holds.
  const { vendored, patchSubjects } = await buildVendor(p, pins)
  report.drift = vendorDrift(p, pins, vendored)

  for (const crate of vendored) {
    const latest = await latestRelease(crate.name)
    if (latest && compareVersions(latest, crate.version) > 0) {
      report.releases.push({ name: crate.name, pinned: crate.version, latest })
    }
  }

  for (const [key, repo] of Object.entries(pins.repos)) {
    // buildVendor left this clone at the pin plus patches, on its izumi branch.
    const dir = repoDir(p, key)
    const head = branchHead(dir, repo)
    const commits = gitLines(dir, ['log', '--format=%H %s', `${repo.rev}..${head}`]).map((line) => ({
      sha: line.slice(0, 40),
      subject: line.slice(41),
    }))
    const entry = { key, url: repo.url, branch: repo.branch, pinned: repo.rev, head, commits, patches: patchSubjects[key] ?? [] }
    if (commits.length && entry.patches.length) {
      const rebase = rebasePatches(p, key, repo, head)
      entry.rebase = rebase.clean
        ? { clean: true, dropped: rebase.dropped, noticeOnly: rebase.noticeOnly }
        : { clean: false, conflicts: rebase.conflicts }
      // Leave the clone at the pin plus patches, as `sync` does.
      checkout(p, key, repo, repo.rev)
      applyPatches(p, key, dir)
    }
    report.repos.push(entry)
  }

  report.needsAttention =
    report.drift.some((d) => !d.minor) || report.releases.length > 0 || report.repos.some((r) => r.commits.length > 0)
  return report
}

function entry(command, { discard = false } = {}) {
  return async (p) => {
    takeWorkLock(p)
    if (command !== 'export') guardClones(p, readPins(p), discard)
    if (command === 'sync') return doSync(p)
    if (command === 'update') return doUpdate(p)
    if (command === 'export') return doExport(p)
    return doCheck(p)
  }
}

export const sync = (p, options) => entry('sync', options)(p)
export const update = (p, options) => entry('update', options)(p)
export const exportResolved = (p, options) => entry('export', options)(p)
export const check = (p, options) => entry('check', options)(p)

// ---------------------------------------------------------------------------------------------

function option(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const command = args[0]
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const work = option(args, '--work')
  const p = paths(root, work && resolve(work))
  const options = { discard: args.includes('--discard') }
  try {
    if (command === 'sync') await sync(p, options)
    else if (command === 'update') await update(p, options)
    else if (command === 'export') await exportResolved(p, options)
    else if (command === 'check') {
      const report = await check(p, options)
      const markdown = renderReport(report)
      const reportPath = option(args, '--report')
      const jsonPath = option(args, '--json')
      if (reportPath) writeFileSync(reportPath, markdown)
      if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
      process.stdout.write(markdown)
      if (args.includes('--fail-on-drift') && report.drift.some((d) => !d.minor)) {
        throw new Error('src-tauri/vendor is not what `sync` builds from its pins and patches (see the report above).')
      }
    } else {
      throw new Error(
        'Usage: node scripts/ci/librqbit-vendor.mjs sync|update|export|check [--work dir] [--discard] [--report file] [--json file] [--fail-on-drift]',
      )
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exit(1)
  }
}
