import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANDROID_DEPINFO,
  ANDROID_SOURCE_REPO,
  PIN_FILES,
  parseDepinfo,
  resolveTagCommit,
  syncAndroidPins,
  syncFlatpakSourceCommits,
  syncUpstreamPins,
  syncWindowsLibmpv,
} from './sync-upstream-pins.mjs'

// Renovate bumps the primary half of each native-build pin (a release tag, a git tag, a commit);
// this script derives the other half. These cases pin the exact line shapes the real files use,
// and the last group runs the parsers over the real files so a reshuffle there fails here.

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

type Api = {
  json: (path: string) => Promise<unknown>
  text: (repo: string, ref: string, path: string) => Promise<string>
  bytes: (url: string) => Promise<Uint8Array>
}

/** A GitHub stub answering only the routes the script is allowed to touch. */
function stubApi(routes: {
  json?: Record<string, unknown>
  text?: Record<string, string>
  bytes?: Record<string, Uint8Array>
}): Api & { calls: string[] } {
  const calls: string[] = []
  const lookup = <T>(table: Record<string, T> | undefined, key: string): T => {
    calls.push(key)
    if (!table || !(key in table)) throw new Error(`unexpected request: ${key}`)
    return table[key]
  }
  return {
    calls,
    json: async (path) => lookup(routes.json, path),
    text: async (repo, ref, path) => lookup(routes.text, `${repo}@${ref}:${path}`),
    bytes: async (url) => lookup(routes.bytes, url),
  }
}

const windowsScript = [
  '$dir = "$env:RUNNER_TEMP\\libmpv"',
  "$PinnedTag = '20260829'",
  "$PinnedAsset = 'mpv-dev-x86_64-20260829-git-e8673660ab.7z'",
  `$PinnedSha256 = '${'e'.repeat(64)}'`,
  'Invoke-WebRequest $asset.browser_download_url',
  '',
].join('\n')

const releaseAssets = (tag: string, hash: string) => ({
  assets: [
    { name: `mpv-x86_64-${tag}-git-${hash}.7z`, browser_download_url: `https://dl/mpv-${tag}.7z` },
    { name: `mpv-dev-x86_64-${tag}-git-${hash}.7z`, browser_download_url: `https://dl/mpv-dev-${tag}.7z` },
    { name: `mpv-dev-x86_64-v3-${tag}-git-${hash}.7z`, browser_download_url: `https://dl/mpv-dev-v3-${tag}.7z` },
  ],
})

describe('syncWindowsLibmpv', () => {
  it('derives the dev asset name and its SHA-256 from a moved release tag', async () => {
    const bumped = windowsScript.replace("$PinnedTag = '20260829'", "$PinnedTag = '20260903'")
    const payload = new TextEncoder().encode('libmpv archive bytes')
    const api = stubApi({
      json: { 'repos/shinchiro/mpv-winbuild-cmake/releases/tags/20260903': releaseAssets('20260903', '69e63f425a') },
      bytes: { 'https://dl/mpv-dev-20260903.7z': payload },
    })
    const result = await syncWindowsLibmpv(bumped, api)
    expect(result.source).toContain("$PinnedAsset = 'mpv-dev-x86_64-20260903-git-69e63f425a.7z'")
    expect(result.source).toContain(`$PinnedSha256 = '${sha256(payload)}'`)
    // Everything else, including the tag Renovate wrote, is untouched.
    expect(result.source.replace(/^\$Pinned(Asset|Sha256) = '[^']+'$/gm, '')).toBe(
      bumped.replace(/^\$Pinned(Asset|Sha256) = '[^']+'$/gm, ''),
    )
    expect(result.notes).toEqual([
      `${PIN_FILES.windows}: mpv-dev-x86_64-20260829-git-e8673660ab.7z → mpv-dev-x86_64-20260903-git-69e63f425a.7z (sha256 ${sha256(payload)})`,
    ])
  })

  it('does not download when the pinned asset already belongs to the tag', async () => {
    const api = stubApi({
      json: { 'repos/shinchiro/mpv-winbuild-cmake/releases/tags/20260829': releaseAssets('20260829', 'e8673660ab') },
    })
    const result = await syncWindowsLibmpv(windowsScript, api)
    expect(result.source).toBe(windowsScript)
    expect(result.notes).toEqual([])
    expect(api.calls).toEqual(['repos/shinchiro/mpv-winbuild-cmake/releases/tags/20260829'])
  })

  it('refuses a release without exactly one x86_64 dev archive', async () => {
    const api = stubApi({
      json: { 'repos/shinchiro/mpv-winbuild-cmake/releases/tags/20260829': { assets: [{ name: 'mpv-x86_64-20260829-git-e8673660ab.7z' }] } },
    })
    await expect(syncWindowsLibmpv(windowsScript, api)).rejects.toThrow('has 0 x86_64 dev assets')
  })

  it('refuses a script whose pin lines have moved', async () => {
    await expect(syncWindowsLibmpv('$Tag = 1', stubApi({}))).rejects.toThrow('cannot find $PinnedTag')
  })
})

const manifest = `modules:
  - name: libass
    sources:
      - type: git
        url: https://github.com/libass/libass.git
        tag: '0.17.5'

  - name: libplacebo
    sources:
      - type: git
        url: https://github.com/haasn/libplacebo.git
        tag: v7.360.1
        commit: ${'c'.repeat(40)}

  - name: mpv
    sources:
      - type: git
        url: https://github.com/mpv-player/mpv.git
        tag: v0.41.0
`

describe('syncFlatpakSourceCommits', () => {
  it('peels an annotated tag down to the commit the manifest must pin', async () => {
    const api = stubApi({
      json: {
        'repos/haasn/libplacebo/git/ref/tags/v7.360.1': { object: { type: 'tag', sha: 'a'.repeat(40) } },
        [`repos/haasn/libplacebo/git/tags/${'a'.repeat(40)}`]: { object: { type: 'commit', sha: 'b'.repeat(40) } },
      },
    })
    const result = await syncFlatpakSourceCommits(manifest, api)
    expect(result.source).toContain(`tag: v7.360.1\n        commit: ${'b'.repeat(40)}`)
    expect(result.source).not.toContain('c'.repeat(40))
    expect(result.notes).toEqual([`${PIN_FILES.flatpak}: haasn/libplacebo v7.360.1 is ${'b'.repeat(40)}, manifest said ${'c'.repeat(40)}`])
    // Tag-only sources have no derived half and are never queried.
    expect(api.calls.some((call) => call.includes('libass') || call.includes('mpv-player'))).toBe(false)
  })

  it('accepts a lightweight tag and leaves a correct manifest alone', async () => {
    const api = stubApi({
      json: { 'repos/haasn/libplacebo/git/ref/tags/v7.360.1': { object: { type: 'commit', sha: 'c'.repeat(40) } } },
    })
    const result = await syncFlatpakSourceCommits(manifest, api)
    expect(result.source).toBe(manifest)
    expect(result.notes).toEqual([])
  })

  it('rejects a tag that does not resolve to a commit', async () => {
    const api = stubApi({ json: { 'repos/o/r/git/ref/tags/x': { object: { type: 'blob', sha: 'd'.repeat(40) } } } })
    await expect(resolveTagCommit(api, 'o/r', 'x')).rejects.toThrow('resolves to a blob')
  })
})

const androidScript = `readonly REPO="https://github.com/jarnedemeulemeester/libmpv-android.git"
readonly COMMIT="${'f'.repeat(40)}"
readonly MPV_VERSION="0.41.0"
readonly FFMPEG_VERSION="8.1.2"
readonly LIBPLACEBO_VERSION="7.360.1"
readonly LIBASS_VERSION="0.17.5"
`
const toolchain = '# pins\nNDK_VERSION=29.0.14206865\nBUILD_TOOLS=36.0.0\n'
const depinfo = (overrides: Record<string, string> = {}) => Object.entries({
  v_ndk: '29.0.14206865', v_mpv: '0.41.0', v_ffmpeg: '8.1.2', v_libplacebo: '7.360.1', v_libass: '0.17.5', v_lua: '5.2.4', ...overrides,
}).map(([key, value]) => `${key}=${value}`).join('\n')

describe('syncAndroidPins', () => {
  it('mirrors the versions and NDK upstream declares at the pinned commit', async () => {
    const api = stubApi({
      text: { [`${ANDROID_SOURCE_REPO}@${'f'.repeat(40)}:${ANDROID_DEPINFO}`]: depinfo({ v_ffmpeg: '9.0.1', v_ndk: '30.0.1', v_libass: '0.17.6' }) },
    })
    const result = await syncAndroidPins(androidScript, toolchain, api)
    expect(result.script).toContain('readonly FFMPEG_VERSION="9.0.1"')
    expect(result.script).toContain('readonly LIBASS_VERSION="0.17.6"')
    expect(result.script).toContain('readonly MPV_VERSION="0.41.0"')
    expect(result.toolchain).toBe('# pins\nNDK_VERSION=30.0.1\nBUILD_TOOLS=36.0.0\n')
    expect(result.notes).toEqual([
      `${PIN_FILES.android}: FFMPEG_VERSION 8.1.2 → 9.0.1 (v_ffmpeg at ffffffffffff)`,
      `${PIN_FILES.android}: LIBASS_VERSION 0.17.5 → 0.17.6 (v_libass at ffffffffffff)`,
      `${PIN_FILES.toolchain}: NDK_VERSION 29.0.14206865 → 30.0.1 (v_ndk at ffffffffffff)`,
    ])
  })

  it('leaves a script that already matches upstream alone', async () => {
    const api = stubApi({ text: { [`${ANDROID_SOURCE_REPO}@${'f'.repeat(40)}:${ANDROID_DEPINFO}`]: depinfo() } })
    const result = await syncAndroidPins(androidScript, toolchain, api)
    expect(result.script).toBe(androidScript)
    expect(result.toolchain).toBe(toolchain)
    expect(result.notes).toEqual([])
  })

  it('fails loudly when upstream stops declaring a version the build asserts', async () => {
    const withoutLibass = depinfo().replace(/^v_libass=.*\n?/m, '')
    const api = stubApi({ text: { [`${ANDROID_SOURCE_REPO}@${'f'.repeat(40)}:${ANDROID_DEPINFO}`]: withoutLibass } })
    await expect(syncAndroidPins(androidScript, toolchain, api)).rejects.toThrow('declares no v_libass')
  })

  it('parses depinfo.sh as plain KEY=value lines', () => {
    expect(parseDepinfo('v_ndk=29.0.14206865\n# comment\nv_mpv=0.41.0\nexport X=1\n')).toEqual({ v_ndk: '29.0.14206865', v_mpv: '0.41.0' })
  })
})

describe('syncUpstreamPins', () => {
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  function fixtureRoot(files: Partial<Record<keyof typeof PIN_FILES, string>> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'izumi-pins-'))
    roots.push(root)
    const contents = { windows: windowsScript, android: androidScript, toolchain, flatpak: manifest, ...files }
    for (const [key, relative] of Object.entries(PIN_FILES)) {
      mkdirSync(join(root, relative, '..'), { recursive: true })
      writeFileSync(join(root, relative), contents[key as keyof typeof PIN_FILES])
    }
    return root
  }

  const inStepApi = () => stubApi({
    json: {
      'repos/shinchiro/mpv-winbuild-cmake/releases/tags/20260829': releaseAssets('20260829', 'e8673660ab'),
      'repos/haasn/libplacebo/git/ref/tags/v7.360.1': { object: { type: 'commit', sha: 'c'.repeat(40) } },
    },
    text: { [`${ANDROID_SOURCE_REPO}@${'f'.repeat(40)}:${ANDROID_DEPINFO}`]: depinfo() },
  })

  it('reports an in-step tree and writes nothing', async () => {
    const root = fixtureRoot()
    const log = vi.fn()
    expect(await syncUpstreamPins({ root, api: inStepApi(), check: true, log })).toEqual({ changed: [], notes: [] })
    expect(log).toHaveBeenCalledWith('Upstream pins are in step (4 files).')
    expect(await syncUpstreamPins({ root, api: inStepApi(), log })).toEqual({ changed: [], notes: [] })
  })

  it('rewrites only the files that moved, preserving each file\'s line endings', async () => {
    const crlfToolchain = toolchain.replace(/\n/g, '\r\n')
    const root = fixtureRoot({ toolchain: crlfToolchain })
    const api = stubApi({
      json: {
        'repos/shinchiro/mpv-winbuild-cmake/releases/tags/20260829': releaseAssets('20260829', 'e8673660ab'),
        'repos/haasn/libplacebo/git/ref/tags/v7.360.1': { object: { type: 'commit', sha: 'c'.repeat(40) } },
      },
      text: { [`${ANDROID_SOURCE_REPO}@${'f'.repeat(40)}:${ANDROID_DEPINFO}`]: depinfo({ v_ndk: '30.0.1' }) },
    })
    const log = vi.fn()
    const result = await syncUpstreamPins({ root, api, log })
    expect(result.changed).toEqual([PIN_FILES.toolchain])
    expect(readFileSync(join(root, PIN_FILES.toolchain), 'utf8')).toBe('# pins\r\nNDK_VERSION=30.0.1\r\nBUILD_TOOLS=36.0.0\r\n')
    expect(readFileSync(join(root, PIN_FILES.android), 'utf8')).toBe(androidScript)
    expect(log).toHaveBeenCalledWith('Rewrote 1 file(s).')
  })

  it('fails --check with the pending edits and the command that applies them', async () => {
    const root = fixtureRoot({ windows: windowsScript.replace("$PinnedTag = '20260829'", "$PinnedTag = '20260903'") })
    const payload = new TextEncoder().encode('new archive')
    const api = stubApi({
      json: {
        'repos/shinchiro/mpv-winbuild-cmake/releases/tags/20260903': releaseAssets('20260903', '69e63f425a'),
        'repos/haasn/libplacebo/git/ref/tags/v7.360.1': { object: { type: 'commit', sha: 'c'.repeat(40) } },
      },
      text: { [`${ANDROID_SOURCE_REPO}@${'f'.repeat(40)}:${ANDROID_DEPINFO}`]: depinfo() },
      bytes: { 'https://dl/mpv-dev-20260903.7z': payload },
    })
    await expect(syncUpstreamPins({ root, api, check: true, log: () => {} })).rejects.toThrow(
      /out of step:\n.*mpv-dev-x86_64-20260903-git-69e63f425a\.7z.*\nRun: node scripts\/ci\/sync-upstream-pins\.mjs/,
    )
    // Check mode never writes.
    expect(readFileSync(join(root, PIN_FILES.windows), 'utf8')).toContain("$PinnedAsset = 'mpv-dev-x86_64-20260829-git-e8673660ab.7z'")
  })
})

describe('the real pin files', () => {
  const read = (key: keyof typeof PIN_FILES) => readFileSync(join(repoRoot, PIN_FILES[key]), 'utf8').replace(/\r\n/g, '\n')
  const value = (source: string, pattern: RegExp) => {
    const match = pattern.exec(source)
    if (!match) throw new Error(`no match for ${pattern}`)
    return match[1]
  }

  it('still have the line shapes the parsers and Renovate managers expect', async () => {
    const windows = read('windows')
    const android = read('android')
    const tag = value(windows, /^\$PinnedTag = '(\d{8})'$/m)
    const asset = value(windows, /^\$PinnedAsset = '([^']+)'$/m)
    expect(asset).toMatch(new RegExp(`^mpv-dev-x86_64-${tag}-git-[0-9a-f]+\\.7z$`))
    const commit = value(android, /^readonly COMMIT="([0-9a-f]{40})"$/m)
    const libplacebo = value(read('flatpak'), /url: https:\/\/github\.com\/haasn\/libplacebo\.git\n\s*tag: (\S+)\n\s*commit: ([0-9a-f]{40})/)
    const libplaceboCommit = value(read('flatpak'), /url: https:\/\/github\.com\/haasn\/libplacebo\.git\n\s*tag: \S+\n\s*commit: ([0-9a-f]{40})/)

    // An API stub that mirrors what the files already say: the tree must come back in step, which
    // proves every parser found its line in the real files rather than silently matching nothing.
    const api = stubApi({
      json: {
        [`repos/shinchiro/mpv-winbuild-cmake/releases/tags/${tag}`]: { assets: [{ name: asset, browser_download_url: 'https://dl/x' }] },
        [`repos/haasn/libplacebo/git/ref/tags/${libplacebo}`]: { object: { type: 'commit', sha: libplaceboCommit } },
      },
      text: {
        [`${ANDROID_SOURCE_REPO}@${commit}:${ANDROID_DEPINFO}`]: [
          `v_ndk=${value(read('toolchain'), /^NDK_VERSION=(\S+)$/m)}`,
          `v_mpv=${value(android, /^readonly MPV_VERSION="([^"]+)"$/m)}`,
          `v_ffmpeg=${value(android, /^readonly FFMPEG_VERSION="([^"]+)"$/m)}`,
          `v_libplacebo=${value(android, /^readonly LIBPLACEBO_VERSION="([^"]+)"$/m)}`,
          `v_libass=${value(android, /^readonly LIBASS_VERSION="([^"]+)"$/m)}`,
        ].join('\n'),
      },
    })
    expect(await syncUpstreamPins({ root: repoRoot, api, check: true, log: () => {} })).toEqual({ changed: [], notes: [] })
  })

  it('agree with each other where two files describe one build', () => {
    // The Android build script asserts upstream's NDK against the one every Android job installs.
    expect(read('android')).toContain('grep -q "^v_ndk=${NDK_VERSION}$"')
    expect(read('android')).toContain('source scripts/ci/android-toolchain.env')
    // Linux CI and the Flatpak build the same mpv release (one Renovate group).
    const linux = readFileSync(join(repoRoot, 'scripts/ci/libmpv-linux.sh'), 'utf8')
    expect(read('flatpak')).toContain(`url: https://github.com/mpv-player/mpv.git\n        tag: v${value(linux, /^readonly MPV_VERSION="([^"]+)"$/m)}`)
  })
})
