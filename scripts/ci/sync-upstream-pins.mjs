// No shebang: this is invoked as `node scripts/ci/sync-upstream-pins.mjs`, never executed directly,
// and on a CRLF checkout a shebang line breaks the test transform (see next-beta-version.mjs).
//
// Keeps the DERIVED halves of the native-build pins in step with their PRIMARY halves.
//
// Renovate (.github/renovate.json5) bumps the primary values — a shinchiro release tag, a git
// tag in the Flatpak manifest, the libmpv-android commit — but each of those drags values along
// that no dependency bot can compute on its own:
//
//   - libmpv-windows.ps1: the exact asset name behind the release tag (it embeds a git hash) and
//     the SHA-256 the script verifies the download against;
//   - flatpak/com.nicho.izumi.yml: the commit a pinned tag resolves to, where a source pins both
//     (flatpak-builder refuses a tag/commit pair that disagrees);
//   - libmpv-android.sh + android-toolchain.env: the mpv / ffmpeg / libplacebo / libass versions
//     and the NDK that libmpv-android's depinfo.sh declares at the pinned commit — the script
//     asserts them before spending 40 minutes compiling, and the app must use the same NDK.
//
// Renovate runs this as a postUpgradeTask so each PR arrives complete; ci.yml runs `--check` so a
// hand edit that forgets the other half fails at PR time instead of at release time.
//
//   node scripts/ci/sync-upstream-pins.mjs          rewrite whatever is out of step
//   node scripts/ci/sync-upstream-pins.mjs --check  exit 1 (saying what) if anything is
//
// GITHUB_TOKEN / GH_TOKEN is optional; it keeps the handful of API calls off the anonymous limit
// that shared runner IPs exhaust.

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PIN_FILES = Object.freeze({
  windows: 'scripts/ci/libmpv-windows.ps1',
  android: 'scripts/ci/libmpv-android.sh',
  toolchain: 'scripts/ci/android-toolchain.env',
  flatpak: 'flatpak/com.nicho.izumi.yml',
})

export const WINDOWS_RELEASE_REPO = 'shinchiro/mpv-winbuild-cmake'
export const ANDROID_SOURCE_REPO = 'jarnedemeulemeester/libmpv-android'
export const ANDROID_DEPINFO = 'buildscripts/include/depinfo.sh'

/** depinfo.sh variables the Android build script asserts, keyed by the constant that mirrors each. */
export const ANDROID_VERSION_KEYS = Object.freeze({
  MPV_VERSION: 'v_mpv',
  FFMPEG_VERSION: 'v_ffmpeg',
  LIBPLACEBO_VERSION: 'v_libplacebo',
  LIBASS_VERSION: 'v_libass',
})

/**
 * The three GitHub reads this script needs. Tests pass a stub with the same shape.
 * @param {{ fetch?: typeof fetch, token?: string }} [options]
 */
export function createGitHubApi({ fetch = globalThis.fetch, token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN } = {}) {
  const base = { 'User-Agent': 'izumi-ci', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  async function get(url, accept) {
    const response = await fetch(url, { headers: { ...base, Accept: accept } })
    if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`)
    return response
  }
  return {
    /** @param {string} path API path without the leading slash, e.g. `repos/o/r/releases/tags/x` */
    json: async (path) => (await get(`https://api.github.com/${path}`, 'application/vnd.github+json')).json(),
    /** Raw file contents at a ref. */
    text: async (repo, ref, path) => (await get(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`, 'text/plain')).text(),
    /** A release asset, for hashing. */
    bytes: async (url) => new Uint8Array(await (await get(url, 'application/octet-stream')).arrayBuffer()),
  }
}

function required(source, pattern, what) {
  const match = pattern.exec(source)
  if (!match) throw new Error(`cannot find ${what}`)
  return match
}

/**
 * libmpv-windows.ps1: `$PinnedTag` is the primary; the asset name and SHA-256 follow from it.
 * Only downloads when the asset name actually changed, so a run with nothing to do is one API call.
 */
export async function syncWindowsLibmpv(source, api) {
  const [, tag] = required(source, /^\$PinnedTag = '(\d{8})'$/m, '$PinnedTag in libmpv-windows.ps1')
  const [, asset] = required(source, /^\$PinnedAsset = '([^']+)'$/m, '$PinnedAsset in libmpv-windows.ps1')
  required(source, /^\$PinnedSha256 = '[0-9a-f]{64}'$/m, '$PinnedSha256 in libmpv-windows.ps1')
  const release = await api.json(`repos/${WINDOWS_RELEASE_REPO}/releases/tags/${tag}`)
  const wanted = new RegExp(`^mpv-dev-x86_64-${tag}-git-[0-9a-f]+\\.7z$`)
  const candidates = (release.assets ?? []).filter((entry) => wanted.test(entry.name))
  if (candidates.length !== 1) {
    throw new Error(`release ${tag} of ${WINDOWS_RELEASE_REPO} has ${candidates.length} x86_64 dev assets, expected exactly one`)
  }
  const [{ name, browser_download_url: url }] = candidates
  if (name === asset) return { source, notes: [] }
  const sha256 = createHash('sha256').update(await api.bytes(url)).digest('hex')
  return {
    source: source
      .replace(/^\$PinnedAsset = '[^']+'$/m, () => `$PinnedAsset = '${name}'`)
      .replace(/^\$PinnedSha256 = '[0-9a-f]{64}'$/m, () => `$PinnedSha256 = '${sha256}'`),
    notes: [`${PIN_FILES.windows}: ${asset} → ${name} (sha256 ${sha256})`],
  }
}

/** The commit a tag points at, peeling annotated tag objects until a commit comes out. */
export async function resolveTagCommit(api, repo, tag) {
  let { object } = await api.json(`repos/${repo}/git/ref/tags/${tag}`)
  while (object.type === 'tag') ({ object } = await api.json(`repos/${repo}/git/tags/${object.sha}`))
  if (object.type !== 'commit') throw new Error(`${repo} tag ${tag} resolves to a ${object.type}, not a commit`)
  return object.sha
}

// A GitHub git source that pins BOTH a tag and a commit. Sources that pin only a tag are left to
// Renovate alone; they have no derived half.
const FLATPAK_PINNED_SOURCE = /(url: https:\/\/github\.com\/(?<repo>[\w.-]+\/[\w.-]+)\.git\n[ \t]*tag: '?(?<tag>[^'\n]+)'?\n[ \t]*commit: )(?<commit>[0-9a-f]{40})/g

/** flatpak/com.nicho.izumi.yml: every tag+commit source's commit follows from its tag. */
export async function syncFlatpakSourceCommits(manifest, api) {
  const notes = []
  let source = manifest
  for (const match of manifest.matchAll(FLATPAK_PINNED_SOURCE)) {
    const { repo, tag, commit } = match.groups
    const actual = await resolveTagCommit(api, repo, tag)
    if (actual === commit) continue
    source = source.replace(match[0], () => `${match[1]}${actual}`)
    notes.push(`${PIN_FILES.flatpak}: ${repo} ${tag} is ${actual}, manifest said ${commit}`)
  }
  return { source, notes }
}

/** @param {string} text libmpv-android's buildscripts/include/depinfo.sh */
export function parseDepinfo(text) {
  const values = {}
  for (const [, key, value] of text.matchAll(/^(v_\w+)=(\S+)$/gm)) values[key] = value
  return values
}

/**
 * libmpv-android.sh: `COMMIT` is the primary; the four *_VERSION constants and the NDK in
 * android-toolchain.env mirror what upstream's depinfo.sh declares at that commit.
 */
export async function syncAndroidPins(script, toolchain, api) {
  const [, commit] = required(script, /^readonly COMMIT="([0-9a-f]{40})"$/m, 'readonly COMMIT in libmpv-android.sh')
  const short = commit.slice(0, 12)
  const upstream = parseDepinfo(await api.text(ANDROID_SOURCE_REPO, commit, ANDROID_DEPINFO))
  const notes = []
  let nextScript = script
  for (const [constant, key] of Object.entries(ANDROID_VERSION_KEYS)) {
    const value = upstream[key]
    if (!value) throw new Error(`${ANDROID_DEPINFO} at ${short} declares no ${key}`)
    const line = new RegExp(`^readonly ${constant}="([^"]*)"$`, 'm')
    const [, current] = required(nextScript, line, `readonly ${constant} in libmpv-android.sh`)
    if (current === value) continue
    nextScript = nextScript.replace(line, () => `readonly ${constant}="${value}"`)
    notes.push(`${PIN_FILES.android}: ${constant} ${current} → ${value} (${key} at ${short})`)
  }
  const ndk = upstream.v_ndk
  if (!ndk) throw new Error(`${ANDROID_DEPINFO} at ${short} declares no v_ndk`)
  const [, currentNdk] = required(toolchain, /^NDK_VERSION=(\S+)$/m, 'NDK_VERSION in android-toolchain.env')
  let nextToolchain = toolchain
  if (currentNdk !== ndk) {
    nextToolchain = toolchain.replace(/^NDK_VERSION=\S+$/m, () => `NDK_VERSION=${ndk}`)
    notes.push(`${PIN_FILES.toolchain}: NDK_VERSION ${currentNdk} → ${ndk} (v_ndk at ${short})`)
  }
  return { script: nextScript, toolchain: nextToolchain, notes }
}

/**
 * Read the four pin files under `root`, derive, and either rewrite them or (check mode) fail if
 * any would change. Line endings are preserved per file.
 * @returns {Promise<{ changed: string[], notes: string[] }>} repo-relative paths that were rewritten
 */
export async function syncUpstreamPins({ root, api, check = false, log = (line) => process.stdout.write(`${line}\n`) }) {
  const files = new Map()
  const load = async (key) => {
    const raw = await readFile(resolve(root, PIN_FILES[key]), 'utf8')
    const text = raw.replace(/\r\n/g, '\n')
    files.set(key, { crlf: raw !== text, text })
    return text
  }
  const windows = await syncWindowsLibmpv(await load('windows'), api)
  const flatpak = await syncFlatpakSourceCommits(await load('flatpak'), api)
  const android = await syncAndroidPins(await load('android'), await load('toolchain'), api)

  const results = [
    ['windows', windows.source],
    ['flatpak', flatpak.source],
    ['android', android.script],
    ['toolchain', android.toolchain],
  ]
  const notes = [...windows.notes, ...flatpak.notes, ...android.notes]
  const changed = results.filter(([key, text]) => text !== files.get(key).text)

  if (check) {
    if (changed.length) {
      throw new Error(`Upstream pins are out of step:\n${notes.join('\n')}\nRun: node scripts/ci/sync-upstream-pins.mjs`)
    }
    log(`Upstream pins are in step (${results.length} files).`)
    return { changed: [], notes }
  }
  for (const [key, text] of changed) {
    const { crlf } = files.get(key)
    await writeFile(resolve(root, PIN_FILES[key]), crlf ? text.replace(/\n/g, '\r\n') : text)
  }
  for (const note of notes) log(note)
  log(changed.length ? `Rewrote ${changed.length} file(s).` : 'Upstream pins already in step.')
  return { changed: changed.map(([key]) => PIN_FILES[key]), notes }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  try {
    await syncUpstreamPins({ root, api: createGitHubApi(), check })
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
    process.exit(1)
  }
}
