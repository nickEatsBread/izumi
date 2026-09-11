// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { fetchThemeText, loadThemeCatalog, prepareThemeLink, verifyRelease } from './catalog'
import { MAX_THEME_BYTES, parseRelease } from './packages'
import { phttp } from '$lib/net/http'
vi.mock('$lib/net/http', () => ({ phttp: vi.fn() }))
const pkg = { app: 'izumi', kind: 'theme-package', schemaVersion: 1, themeApi: 1, id: 'test.cinema', name: 'Cinema', author: 'Test', description: 'Cinema presentation.', version: '1.0.0', design: {} }
async function release(body: string) {
  const bytes = new TextEncoder().encode(body), hash = await webcrypto.subtle.digest('SHA-256', bytes)
  return parseRelease({ ...pkg, tags: [], download: 'https://example.test/package.json', bytes: bytes.length, sha256: Buffer.from(hash).toString('hex') })
}
beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('theme downloads', () => {
  it('uses one verified install pipeline for release links', async () => {
    const body = JSON.stringify(pkg), entry = await release(body)
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ app: 'izumi', kind: 'theme-release', schemaVersion: 1, release: entry }))).mockResolvedValueOnce(new Response(body))
    vi.stubGlobal('fetch', request)
    const prepared = await prepareThemeLink('https://example.test/release.json')
    expect(prepared.package.id).toBe(pkg.id); expect(prepared.updateUrl).toBe('https://example.test/release.json')
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
  })
  it('rejects modified packages before activation', async () => {
    const body = JSON.stringify(pkg), entry = await release(body)
    await expect(verifyRelease(body.replace('Cinema', 'cinema'), entry)).rejects.toThrow('checksum')
    await expect(verifyRelease(body + ' ', entry)).rejects.toThrow('size')
  })
  it('keeps a last valid catalog for offline browsing', async () => {
    const catalog = { app: 'izumi', kind: 'theme-catalog', schemaVersion: 1, themes: [await release(JSON.stringify(pkg))] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(catalog))).mockRejectedValueOnce(new Error('offline')))
    expect((await loadThemeCatalog()).cached).toBe(false)
    const cached = await loadThemeCatalog(); expect(cached.cached).toBe(true); expect(cached.catalog.themes[0].id).toBe(pkg.id)
  })
  it('bounds downloads even when content-length is omitted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(MAX_THEME_BYTES + 1))))
    await expect(fetchThemeText('https://example.test/large.json')).rejects.toThrow('large')
  })
})

describe('theme downloads without AbortSignal.any', () => {
  let timeout: AbortController
  beforeEach(() => {
    timeout = new AbortController()
    vi.stubGlobal('AbortSignal', { timeout: vi.fn(() => timeout.signal) })
  })
  it.each([false, true])('downloads successfully and detaches caller listeners (caller signal: %s)', async (withCaller) => {
    const caller = new AbortController()
    let combined: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { combined = init.signal!; return new Response('ok') }))
    await expect(fetchThemeText('https://example.test/theme.json', 100, withCaller ? caller.signal : undefined)).resolves.toBe('ok')
    expect(AbortSignal.timeout).toHaveBeenCalledWith(20_000)
    caller.abort()
    expect(combined?.aborted).toBe(false)
    if (withCaller) { timeout.abort(); expect(combined?.aborted).toBe(false) }
  })
  it.each(['caller', 'timeout'])('rejects an already-aborted %s before starting either transport', async (source) => {
    const caller = new AbortController(), reason = new DOMException('Cancelled', 'AbortError')
    ;(source === 'caller' ? caller : timeout).abort(reason)
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    await expect(fetchThemeText('https://example.test/theme.json', 100, caller.signal)).rejects.toBe(reason)
    expect(request).not.toHaveBeenCalled()
    expect(phttp).not.toHaveBeenCalled()
  })
  it.each(['caller', 'timeout'])('propagates %s cancellation while consuming the body', async (source) => {
    const caller = new AbortController(), reason = new DOMException('Cancelled', source === 'timeout' ? 'TimeoutError' : 'AbortError')
    let reading!: () => void
    const started = new Promise<void>(resolve => { reading = resolve })
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Response(new ReadableStream({
      start(controller) { init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true }) },
      pull() { reading() },
    }))))
    const result = fetchThemeText('https://example.test/theme.json', 100, caller.signal)
    const rejected = expect(result).rejects.toBe(reason)
    await started
    ;(source === 'caller' ? caller : timeout).abort(reason)
    await rejected
  })
  it('detaches listeners after transport failure', async () => {
    const caller = new AbortController(), failure = new Error('offline')
    let combined: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { combined = init.signal!; throw failure }))
    await expect(fetchThemeText('https://example.test/theme.json', 100, caller.signal)).rejects.toBe(failure)
    caller.abort(); timeout.abort()
    expect(combined?.aborted).toBe(false)
  })
  it('keeps native downloads bounded and detaches fallback listeners', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {})
    const caller = new AbortController()
    const native = vi.mocked(phttp).mockResolvedValue(new Response('native theme'))
    await expect(fetchThemeText('https://example.test/theme.json', 100, caller.signal)).resolves.toBe('native theme')
    expect(native).toHaveBeenCalledWith('https://example.test/theme.json', expect.objectContaining({ maxBytes: 100, timeoutMs: 20_000, background: true }))
    const combined = native.mock.calls.at(-1)![1]!.signal!
    caller.abort(); timeout.abort()
    expect(combined.aborted).toBe(false)
  })
})
