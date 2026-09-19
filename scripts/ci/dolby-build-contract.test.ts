import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

// Renovate moves these pins (.github/renovate.json5), so the cases assert the FLOOR each pin must
// stay above and that the files describing one build agree, never a literal version.
const version = (source: string, pattern: RegExp) => {
  const match = pattern.exec(source)
  if (!match) throw new Error(`no match for ${pattern}`)
  return { text: match[1], parts: match[1].split('.').map(Number) }
}
const atLeast = (parts: number[], floor: number[]) => {
  for (let index = 0; index < floor.length; index += 1) {
    if ((parts[index] ?? 0) !== floor[index]) return (parts[index] ?? 0) > floor[index]
  }
  return true
}

describe('reproducible Dolby playback engine floor', () => {
  it('pins one stable mpv, 0.41 or newer, on Flatpak and Linux CI', () => {
    const linux = read('scripts/ci/libmpv-linux.sh')
    const mpv = version(linux, /^readonly MPV_VERSION="(\d+\.\d+\.\d+)"$/m)
    expect(atLeast(mpv.parts, [0, 41, 0]), `mpv ${mpv.text}`).toBe(true)
    expect(read('flatpak/com.nicho.izumi.yml')).toContain(`url: https://github.com/mpv-player/mpv.git\n        tag: v${mpv.text}\n`)
    expect(read('.github/workflows/release.yml')).toContain('bash scripts/ci/libmpv-linux.sh')
    expect(read('.github/workflows/ci.yml')).toContain('bash scripts/ci/libmpv-linux.sh')
  })

  it('pins and hashes the reviewed Windows snapshot', () => {
    const windows = read('scripts/ci/libmpv-windows.ps1')
    expect(windows).not.toContain('/releases/latest')
    const tag = version(windows, /^\$PinnedTag = '(\d{8})'$/m)
    // 20260829 is the first snapshot reviewed for the Dolby floor; never regress behind it.
    expect(Number(tag.text)).toBeGreaterThanOrEqual(20260829)
    expect(windows).toMatch(new RegExp(`^\\$PinnedAsset = 'mpv-dev-x86_64-${tag.text}-git-[0-9a-f]+\\.7z'$`, 'm'))
    expect(windows).toMatch(/^\$PinnedSha256 = '[0-9a-f]{64}'$/m)
    expect(windows).toContain('Get-FileHash')
  })

  it('rejects an old Homebrew mpv and pins stable Media3 1.11 or newer', () => {
    expect(read('.github/workflows/release.yml')).toContain("grep -Eq '^mpv v?0\\.(4[1-9]|[5-9][0-9])'")
    const media3 = version(read('src-tauri/tauri-plugin-mpv/android/build.gradle.kts'), /val media3Version = "(\d+\.\d+\.\d+)"/)
    expect(atLeast(media3.parts, [1, 11, 0]), `media3 ${media3.text}`).toBe(true)
  })

  it('publishes evidence for the actual native artifacts', () => {
    const release = read('.github/workflows/release.yml')
    expect(release).toContain('player-capability-manifest.mjs')
    expect(release).toContain('--artifact src-tauri/libmpv-2.dll')
    expect(release).toContain('--windows-script scripts/ci/libmpv-windows.ps1')
    expect(release).toContain('--artifact src-tauri/tauri-plugin-mpv/android/libs/libmpv.aar')
    expect(release).toContain('gh release upload "$T" "$MANIFEST"')
    expect(release).toContain("tr '[:upper:]' '[:lower:]'")
    expect(release).not.toContain('${RUNNER_OS,,}')
  })
})
