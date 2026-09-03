import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('reproducible Dolby playback engine floor', () => {
  it('pins stable mpv 0.41 on Flatpak and Linux CI', () => {
    expect(read('flatpak/com.nicho.izumi.yml')).toContain('tag: v0.41.0')
    const linux = read('scripts/ci/libmpv-linux.sh')
    expect(linux).toContain('MPV_VERSION="0.41.0"')
    expect(read('.github/workflows/release.yml')).toContain('bash scripts/ci/libmpv-linux.sh')
    expect(read('.github/workflows/ci.yml')).toContain('bash scripts/ci/libmpv-linux.sh')
  })

  it('pins and hashes the reviewed Windows snapshot', () => {
    const windows = read('scripts/ci/libmpv-windows.ps1')
    expect(windows).not.toContain('/releases/latest')
    expect(windows).toContain("$PinnedTag = '20260829'")
    expect(windows).toContain("$PinnedSha256 = 'e99b8c85e184463571088c79732f7e1e09ed4524c2945cdca177a4df70ba6f2e'")
    expect(windows).toContain('Get-FileHash')
  })

  it('rejects an old Homebrew mpv and pins stable Media3', () => {
    expect(read('.github/workflows/release.yml')).toContain("grep -Eq '^mpv v?0\\.(4[1-9]|[5-9][0-9])'")
    expect(read('src-tauri/tauri-plugin-mpv/android/build.gradle.kts')).toContain('media3Version = "1.11.0"')
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
