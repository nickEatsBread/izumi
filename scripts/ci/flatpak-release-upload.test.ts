import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
const section = workflow.split('- name: Attach the Flatpak to the release')[1].split('\n  # Android')[0]
const script = section.split('script: |')[1].replace('${{ needs.create-release.outputs.release_id }}', '7')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction('github', 'context', 'require', script)

describe('Flatpak release attachment', () => {
  it.each([true, false])('uploads only to the existing draft without editing release metadata: %s', async draft => {
    const api = {
      getRelease: vi.fn(async () => ({ data: { draft, assets: [] } })),
      uploadReleaseAsset: vi.fn(async (_request: { name: string; release_id: number }) => ({})),
      updateRelease: vi.fn(async () => { throw new Error('Metadata edits are not required for an upload.') }),
    }
    const files = ['izumi-v1.0.0-steamdeck.flatpak', 'izumi-v1.0.0-steamdeck.flatpakref']
    const fs = { readdirSync: () => [...files, 'unrelated.txt'], readFileSync: () => Buffer.from('verified build output') }
    const result = run({ rest: { repos: api } }, { repo: { owner: 'owner', repo: 'app' } }, () => fs)
    if (draft) {
      await result
      expect(api.uploadReleaseAsset.mock.calls.map(([request]) => request.name)).toEqual(files)
      expect(api.uploadReleaseAsset.mock.calls.every(([request]) => request.release_id === 7)).toBe(true)
    } else {
      await expect(result).rejects.toThrow('draft release')
      expect(api.uploadReleaseAsset).not.toHaveBeenCalled()
    }
    expect(api.updateRelease).not.toHaveBeenCalled()
  })

  it('uploads the Deck installer launcher alongside the bundle when the stable job staged one', async () => {
    const api = {
      getRelease: vi.fn(async () => ({ data: { draft: true, assets: [] } })),
      uploadReleaseAsset: vi.fn(async (_request: { name: string }) => ({})),
      updateRelease: vi.fn(async () => ({})),
    }
    const files = [
      'izumi-v1.0.0-steamdeck.flatpak',
      'izumi-v1.0.0-steamdeck.flatpakref',
      'izumi-v1.0.0-steamdeck-installer.desktop',
    ]
    const fs = { readdirSync: () => [...files, 'notes.txt'], readFileSync: () => Buffer.from('build output') }
    await run({ rest: { repos: api } }, { repo: { owner: 'owner', repo: 'app' } }, () => fs)
    expect(api.uploadReleaseAsset.mock.calls.map(([request]) => request.name)).toEqual(files)
  })

  it('fails the release rather than publishing without the Flatpak itself', async () => {
    const api = {
      getRelease: vi.fn(async () => ({ data: { draft: true, assets: [] } })),
      uploadReleaseAsset: vi.fn(async () => ({})),
      updateRelease: vi.fn(async () => ({})),
    }
    // Only the descriptor and the launcher built: installing either one without the bundle behind
    // it leaves the user on an older izumi with no error.
    const fs = {
      readdirSync: () => ['izumi-v1.0.0-steamdeck.flatpakref', 'izumi-v1.0.0-steamdeck-installer.desktop'],
      readFileSync: () => Buffer.from(''),
    }
    await expect(run({ rest: { repos: api } }, { repo: { owner: 'owner', repo: 'app' } }, () => fs))
      .rejects.toThrow('.flatpak')
    expect(api.uploadReleaseAsset).not.toHaveBeenCalled()
  })
})
