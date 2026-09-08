import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { publishWorkerRelease } from '../../scripts/publish-cloudflare-release.mjs'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep) && directory.includes('izumi-publication-test-')) rmSync(directory, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})
const env = { GH_TOKEN: 'test-workflow-token', GITHUB_REPOSITORY: 'nickEatsBread/izumi', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'b'.repeat(40) }

function fixture({ existing = false, tampered = false, unavailable = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'izumi-publication-test-')); directories.push(directory)
  const pkg = Buffer.from('{"schema":1,"version":"1.13.0"}')
  const manifest = JSON.stringify({ schema: 1, version: '1.13.0', tag: 'worker-v1.13.0', sha256: createHash('sha256').update(pkg).digest('hex') })
  writeFileSync(join(directory, 'worker-package.json'), pkg)
  writeFileSync(join(directory, 'worker-update.json'), manifest)
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname
    if (path.includes('/releases/tags/')) return existing ? Response.json({ id: 1, draft: false, assets: [{ id: 2, name: 'worker-update.json' }, { id: 3, name: 'worker-package.json' }] }) : new Response('', { status: 404 })
    if (path.includes('/git/ref/tags/') || path.endsWith('/git/ref/heads/worker-updates')) return new Response('', { status: 404 })
    if (path.endsWith('/releases') && init.method === 'POST') return Response.json({ id: 1, draft: true, assets: [] })
    if (path.endsWith('/releases/assets/2')) return new Response(tampered ? 'changed' : manifest)
    if (path.endsWith('/releases/assets/3')) return new Response(pkg)
    if (path.includes('/releases/download/')) {
      if (unavailable) return new Response('', { status: 404 })
      return new Response(path.endsWith('worker-package.json') ? pkg : manifest)
    }
    return Response.json({ sha: 'c'.repeat(40) })
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  return { directory, fetcher, manifest }
}

describe('stable Worker publication', () => {
  it('publishes both verified assets before updating the stable feed, without becoming the latest app release', async () => {
    const { directory, fetcher, manifest } = fixture()
    await publishWorkerRelease({ directory, env, fetcher })
    const calls = fetcher.mock.calls
    const release = calls.find(([url, init]) => url.endsWith('/releases') && init.method === 'POST')!
    expect(JSON.parse(release[1].body as string)).toMatchObject({ draft: true, prerelease: false, make_latest: 'false', target_commitish: env.GITHUB_SHA })
    expect(calls.filter(([url]) => url.startsWith('https://uploads.github.com/'))).toHaveLength(2)
    const publicChecks = calls.map(([url], index) => url.includes('/releases/download/') ? index : -1).filter(index => index >= 0)
    const feedWrite = calls.findIndex(([url]) => url.endsWith('/git/trees'))
    expect(feedWrite).toBeGreaterThan(Math.max(...publicChecks))
    expect(JSON.parse(calls[feedWrite][1].body as string).tree).toEqual([{ path: 'stable.json', mode: '100644', type: 'blob', content: manifest }])
    expect(calls.some(([url]) => url.includes('cloudflare.com'))).toBe(false)
  })
  it('does not advertise assets that have not become publicly downloadable', async () => {
    const { directory, fetcher } = fixture({ unavailable: true })
    await expect(publishWorkerRelease({ directory, env, fetcher })).rejects.toThrow('publicly available')
    expect(fetcher.mock.calls.some(([url]) => url.includes('/git/trees'))).toBe(false)
  })
  it('never overwrites an existing version with different code', async () => {
    const { directory, fetcher } = fixture({ existing: true, tampered: true })
    await expect(publishWorkerRelease({ directory, env, fetcher })).rejects.toThrow('bump the Worker version')
    expect(fetcher.mock.calls.some(([, init]) => init.method && init.method !== 'GET')).toBe(false)
  })
  it('rejects fork and non-main publication before contacting GitHub', async () => {
    const { directory, fetcher } = fixture()
    await expect(publishWorkerRelease({ directory, fetcher, env: { ...env, GITHUB_REF: 'refs/heads/other' } })).rejects.toThrow('main repository')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
