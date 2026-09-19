import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildUpdaterManifest, platformKeysFor } from './merge-updater-json.mjs'

const workflow = readFileSync('.github/workflows/release.yml', 'utf8')

const asset = (name: string, id: number) => ({ name, url: `https://api.github.com/repos/o/r/releases/assets/${id}` })

describe('updater manifest rebuild', () => {
  it('maps every Tauri installer name to the keys the clients ask for', () => {
    expect(platformKeysFor('izumi_0.1.64_x64-setup.exe')).toEqual(['windows-x86_64-nsis'])
    expect(platformKeysFor('izumi_0.1.64_x64_en-US.msi')).toEqual(['windows-x86_64', 'windows-x86_64-msi'])
    expect(platformKeysFor('izumi_0.1.64_aarch64.app.tar.gz')).toEqual(['darwin-aarch64', 'darwin-aarch64-app'])
    expect(platformKeysFor('izumi_0.1.64_amd64.AppImage')).toEqual(['linux-x86_64', 'linux-x86_64-appimage'])
    expect(platformKeysFor('izumi_0.1.64_amd64.deb')).toEqual(['linux-x86_64-deb'])
    expect(platformKeysFor('izumi-0.1.64-1.x86_64.rpm')).toEqual(['linux-x86_64-rpm'])
    // APKs, the Deck bundle and the manifest itself are not updater targets. (Stable-named copies
    // would map, but they never carry a `.sig`, so they never enter the manifest.)
    for (const name of ['izumi-android-full.apk', 'izumi-v0.1.64-steamdeck.flatpak', 'latest.json']) {
      expect(platformKeysFor(name)).toEqual([])
    }
  })

  it('rebuilds every platform from the .sig assets regardless of which job finished last', () => {
    const assets = [
      asset('izumi_0.1.64_amd64.AppImage', 1), asset('izumi_0.1.64_amd64.AppImage.sig', 2),
      asset('izumi_0.1.64_x64_en-US.msi', 3), asset('izumi_0.1.64_x64_en-US.msi.sig', 4),
      asset('izumi_0.1.64_x64-setup.exe', 5), asset('izumi_0.1.64_x64-setup.exe.sig', 6),
      asset('izumi_0.1.64_aarch64.app.tar.gz', 7), asset('izumi_0.1.64_aarch64.app.tar.gz.sig', 8),
      asset('izumi-x64-setup.exe', 9), asset('latest.json', 10),
    ]
    const signatures = {
      'izumi_0.1.64_amd64.AppImage.sig': 'SIG-APPIMAGE\n',
      'izumi_0.1.64_x64_en-US.msi.sig': 'SIG-MSI',
      'izumi_0.1.64_x64-setup.exe.sig': 'SIG-NSIS',
      'izumi_0.1.64_aarch64.app.tar.gz.sig': 'SIG-MAC',
    }
    // The race left only Linux in the published file.
    const existing = {
      notes: '', pub_date: '2026-09-12T17:00:00.000Z',
      platforms: { 'linux-x86_64': { signature: 'OLD', url: 'https://api.github.com/repos/o/r/releases/assets/1' } },
    }
    const { manifest, rebuilt } = buildUpdaterManifest({ version: '0.1.64', existing, assets, signatures, now: '2026-09-12T18:00:00.000Z' })
    expect(Object.keys(manifest.platforms).sort()).toEqual([
      'darwin-aarch64', 'darwin-aarch64-app', 'linux-x86_64', 'linux-x86_64-appimage',
      'windows-x86_64', 'windows-x86_64-msi', 'windows-x86_64-nsis',
    ])
    expect(manifest.platforms['windows-x86_64-nsis']).toEqual({ signature: 'SIG-NSIS', url: 'https://api.github.com/repos/o/r/releases/assets/5' })
    expect(manifest.platforms['windows-x86_64']).toEqual({ signature: 'SIG-MSI', url: 'https://api.github.com/repos/o/r/releases/assets/3' })
    expect(manifest.platforms['linux-x86_64'].signature).toBe('SIG-APPIMAGE')
    expect(manifest.version).toBe('0.1.64')
    expect(manifest.pub_date).toBe('2026-09-12T17:00:00.000Z')
    expect(rebuilt).toHaveLength(7)
  })

  it('keeps existing entries whose signature asset is missing and never invents one', () => {
    const existing = { platforms: { 'linux-x86_64-deb': { signature: 'KEEP', url: 'u' } } }
    const { manifest, rebuilt } = buildUpdaterManifest({
      version: '0.1.64', existing, now: '2026-09-12T18:00:00.000Z',
      assets: [asset('izumi_0.1.64_x64-setup.exe.sig', 1)], // installer itself absent
      signatures: { 'izumi_0.1.64_x64-setup.exe.sig': 'SIG' },
    })
    expect(manifest.platforms).toEqual({ 'linux-x86_64-deb': { signature: 'KEEP', url: 'u' } })
    expect(rebuilt).toEqual([])
    expect(manifest.notes).toBe('')
    expect(manifest.pub_date).toBe('2026-09-12T18:00:00.000Z')
  })

  it('runs after every build and before the signature assets are deleted', () => {
    const job = workflow.split('  cleanup-release-signatures:')[1].split('\n  # ')[0]
    expect(job).toContain('needs: [create-release, build]')
    const rebuild = job.indexOf('node scripts/ci/merge-updater-json.mjs')
    const upload = job.indexOf('latest.json --repo')
    const cleanup = job.indexOf('Remove standalone updater signature assets')
    expect(rebuild).toBeGreaterThan(0)
    expect(upload).toBeGreaterThan(rebuild)
    expect(cleanup).toBeGreaterThan(upload)
  })
})
