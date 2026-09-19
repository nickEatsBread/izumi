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

  it('builds in an image carrying the runtime the manifest asks for', () => {
    // Derived from the manifest, never written out twice. Pinning the tag literally is what let the
    // manifest move to GNOME 50 against a gnome-49 image: nothing but the release job builds the
    // Flatpak, so the mismatch surfaced only at release time, as
    //   error: org.gnome.Sdk/x86_64/50 not installed
    const runtime = manifest.match(/^runtime-version: '(\d+)'/m)![1]
    expect(workflow).toContain(`ghcr.io/flathub-infra/flatpak-github-actions:gnome-${runtime}`)
  })

  it('installs only the Node extension, from the runtime it is built against', () => {
    expect(workflow).toContain('flatpak install -y --noninteractive flathub org.freedesktop.Sdk.Extension.node22//25.08')
    expect(workflow).not.toContain('scripts/ci/flatpak-install-sdk-deps.sh')
    expect(workflow).not.toContain('flatpak-builder --user --install-deps-from=flathub')

    // Keep the retry helper covered for older/local builders that still need to provision an SDK.
    expect(deps).toContain('org.gnome.Sdk//49')
    expect(deps).toContain('org.freedesktop.Sdk.Extension.node22//25.08')
    expect(deps).toContain('retrying')
    expect(deps).not.toContain('install_ref org.freedesktop.Sdk.Extension.rust-stable')
  })

  it('stages Nunito as a hash-pinned Flatpak source in clean checkouts', () => {
    expect(manifest).toContain('dest-filename: Nunito-flatpak.ttf')
    expect(manifest).toContain('sha256: bb55a5ca5c2042335b3991af27c4d0705d0ef41cac6164ac737fd8f2a1e85207')
    expect(manifest).toContain('install -Dm644 Nunito-flatpak.ttf')
    expect(manifest).not.toContain('assets/fonts/Nunito.ttf /app/share/fonts')
  })

  it('publishes stable and beta releases to matching Flatpak branches', () => {
    expect(workflow).toContain('echo "branch=beta" >> "$GITHUB_OUTPUT"')
    expect(workflow).toContain('echo "branch=stable" >> "$GITHUB_OUTPUT"')
    expect(workflow).toContain('--default-branch="${{ steps.meta.outputs.branch }}"')
    expect(workflow).toContain('Branch=${{ steps.meta.outputs.branch }}')
    expect(workflow).toContain('Url=https://flatpak.izumi.watch/${{ steps.meta.outputs.branch }}/')
    expect(workflow).toContain('destination_dir: ${{ steps.meta.outputs.branch }}')
    expect(workflow).not.toContain('Branch=master')
  })

  it('keeps old master installs updating through the signed channel redirect', () => {
    expect(workflow).toContain('flatpak build-commit-from')
    expect(workflow).toContain('"app/$app/$arch/master"')
    expect(workflow).toContain('--default-branch=master')
    expect(workflow).toContain('--redirect-url="https://flatpak.izumi.watch/stable/"')
    expect(workflow).toContain("if: steps.meta.outputs.branch == 'stable'")
    expect(workflow).toContain('"izumi-${{ steps.meta.outputs.tag }}-steamdeck.flatpakref"')
  })
})
