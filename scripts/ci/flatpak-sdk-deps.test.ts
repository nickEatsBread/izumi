import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = readFileSync(new URL('../../flatpak/com.nicho.izumi.yml', import.meta.url), 'utf8')
const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')
const rust = readFileSync(new URL('./ensure-flatpak-rust.sh', import.meta.url), 'utf8')
const deps = readFileSync(new URL('./flatpak-install-sdk-deps.sh', import.meta.url), 'utf8')

describe('Flatpak SDK deps', () => {
  it('does not require Flathub rust-stable (that extension 404s during republish)', () => {
    expect(manifest).not.toContain('- org.freedesktop.Sdk.Extension.rust-stable')
    expect(manifest).toContain('- org.freedesktop.Sdk.Extension.node22')
    expect(manifest).toContain('scripts/ci/ensure-flatpak-rust.sh')
    expect(rust).toContain('sh.rustup.rs')
    expect(rust).toContain('command -v rustc')
  })

  it('pre-installs GNOME/node with retries instead of a single --install-deps-from shot', () => {
    expect(workflow).toContain('scripts/ci/flatpak-install-sdk-deps.sh')
    expect(workflow).not.toContain('flatpak-builder --user --install-deps-from=flathub')
    expect(deps).toContain('org.gnome.Sdk//49')
    expect(deps).toContain('org.freedesktop.Sdk.Extension.node22//25.08')
    expect(deps).toContain('retrying')
    expect(deps).not.toContain('install_ref org.freedesktop.Sdk.Extension.rust-stable')
  })
})
