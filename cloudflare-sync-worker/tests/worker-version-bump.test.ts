import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { bumpedWorkerSources } from '../../scripts/bump-cloudflare-worker.mjs'
import { workerReleaseNeedsBump } from '../../scripts/worker-release-needs-bump.mjs'

const sources = () => ({
  packageJson: '{\n  "name": "izumi-sync-worker",\n  "version": "1.13.0",\n  "private": true\n}\n',
  packageLock: JSON.stringify({ name: 'izumi-sync-worker', version: '1.13.0', lockfileVersion: 3, packages: { '': { name: 'izumi-sync-worker', version: '1.13.0' } } }, null, 2) + '\n',
  indexJs: "const VERSION = '1.13.0'\nexport default {}\n",
  cloudflareTs: "export const CLOUDFLARE_WORKER_VERSION = '1.13.0'\nexport const CLOUDFLARE_WORKER_PROTOCOL = 1\n",
})

describe('bumpedWorkerSources', () => {
  it('bumps the patch version in every carrier in one step', () => {
    const bumped = bumpedWorkerSources(sources())
    expect(bumped.version).toBe('1.13.0')
    expect(bumped.next).toBe('1.13.1')
    expect(JSON.parse(bumped.packageJson).version).toBe('1.13.1')
    expect(bumped.packageJson).toContain('"name": "izumi-sync-worker"')
    const lock = JSON.parse(bumped.packageLock)
    expect(lock.version).toBe('1.13.1')
    expect(lock.packages[''].version).toBe('1.13.1')
    expect(bumped.indexJs).toContain("const VERSION = '1.13.1'")
    expect(bumped.cloudflareTs).toContain("export const CLOUDFLARE_WORKER_VERSION = '1.13.1'")
    expect(bumped.cloudflareTs).toContain('CLOUDFLARE_WORKER_PROTOCOL')
  })

  it('refuses to bump when the version carriers disagree', () => {
    const stale = { ...sources(), indexJs: "const VERSION = '1.12.0'\n" }
    expect(() => bumpedWorkerSources(stale)).toThrow(/VERSION constant/)
    const drifted = { ...sources(), cloudflareTs: "export const CLOUDFLARE_WORKER_VERSION = '1.12.9'\n" }
    expect(() => bumpedWorkerSources(drifted)).toThrow(/CLOUDFLARE_WORKER_VERSION/)
  })

  it('refuses a non release-shaped version', () => {
    const beta = sources()
    beta.packageJson = beta.packageJson.replace('1.13.0', '1.13.0-beta.1')
    expect(() => bumpedWorkerSources(beta)).toThrow(/X\.Y\.Z/)
  })
})

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes('izumi-bump-test-')) rmSync(directory, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

function packaged({ release = 'matching' as 'absent' | 'matching' | 'differing' | 'missing-asset' | 'failing' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'izumi-bump-test-')); directories.push(directory)
  const pkg = Buffer.from('{"schema":1,"version":"1.13.0"}')
  const sha256 = createHash('sha256').update(pkg).digest('hex')
  writeFileSync(join(directory, 'worker-update.json'), JSON.stringify({ schema: 1, version: '1.13.0', tag: 'worker-v1.13.0', sha256 }))
  const fetcher = vi.fn(async (url: string) => {
    const path = new URL(url).pathname
    if (path.includes('/releases/tags/')) {
      if (release === 'absent') return new Response('', { status: 404 })
      if (release === 'failing') return new Response('', { status: 500 })
      return Response.json({ id: 1, assets: release === 'missing-asset' ? [] : [{ id: 7, name: 'worker-update.json' }] })
    }
    if (path.endsWith('/releases/assets/7')) {
      return new Response(JSON.stringify({ schema: 1, version: '1.13.0', tag: 'worker-v1.13.0', sha256: release === 'differing' ? 'f'.repeat(64) : sha256 }))
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  return { directory, fetcher }
}

describe('workerReleaseNeedsBump', () => {
  it('needs no bump when no release exists for the version', async () => {
    const { directory, fetcher } = packaged({ release: 'absent' })
    await expect(workerReleaseNeedsBump({ directory, env: {}, fetcher })).resolves.toBe(false)
  })

  it('needs no bump when the published manifest matches', async () => {
    const { directory, fetcher } = packaged({ release: 'matching' })
    await expect(workerReleaseNeedsBump({ directory, env: { GH_TOKEN: 't' }, fetcher })).resolves.toBe(false)
  })

  it('needs a bump when the published manifest differs', async () => {
    const { directory, fetcher } = packaged({ release: 'differing' })
    await expect(workerReleaseNeedsBump({ directory, env: { GH_TOKEN: 't' }, fetcher })).resolves.toBe(true)
  })

  it('resumes a crashed draft instead of bumping when the asset is missing', async () => {
    const { directory, fetcher } = packaged({ release: 'missing-asset' })
    await expect(workerReleaseNeedsBump({ directory, env: {}, fetcher })).resolves.toBe(false)
  })

  it('propagates lookup failures instead of guessing', async () => {
    const { directory, fetcher } = packaged({ release: 'failing' })
    await expect(workerReleaseNeedsBump({ directory, env: {}, fetcher })).rejects.toThrow(/lookup failed \(500\)/)
  })
})
