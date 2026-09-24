import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

// The worker set used to live for the WebView's lifetime once built. These pin the lifecycle that
// replaced that: an idle reaper, pending waits flushed on terminate, manifests memoized across
// rebuilds, and workers spawned one macrotask apart instead of in a single burst.

const MANIFEST_URL = 'https://example.test/manifest.json'
const moduleUrl = (id: string) => `https://example.test/${id}.js`

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  phttp: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('$lib/net/http', () => ({
  phttp: mocks.phttp,
  invokeNativeHttp: vi.fn(),
  isNativeTransportFailure: () => false,
}))
vi.mock('$lib/settings/ui', () => ({
  enabledExtensionUrls: writable<string[]>([MANIFEST_URL]),
  disabledPlugins: writable<string[]>([]),
}))
vi.mock('$lib/stremio/online-cache', () => ({ clearProviderCache: vi.fn() }))
// There is no IndexedDB under node, and the module cache is not what is under test here.
vi.mock('./module-cache', () => ({
  loadCachedExtensionModule: (_module: unknown, fetchFresh: () => Promise<string | null>) => fetchFresh(),
}))

/** Records what the manager posts, answers `load` so the extension becomes ready, and leaves a
 *  `query` unanswered so a pending call can be observed. */
class FakeWorker {
  static all: FakeWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  posted: { type: string; id: number }[] = []
  terminated = false
  constructor() { FakeWorker.all.push(this) }
  postMessage(message: { type: string; id: number }): void {
    this.posted.push(message)
    if (message.type === 'load') queueMicrotask(() => this.onmessage?.({ data: { type: 'loaded', id: message.id } }))
  }
  terminate(): void { this.terminated = true }
}

const manifest = [
  { id: 'src-a', name: 'Source A', type: 'onlinestream-provider', code: moduleUrl('src-a') },
  { id: 'src-b', name: 'Source B', type: 'onlinestream-provider', code: moduleUrl('src-b') },
]

const manifestFetches = () => mocks.phttp.mock.calls.filter(([url]) => url === MANIFEST_URL).length
const live = () => FakeWorker.all.filter((worker) => !worker.terminated)
/** A real macrotask boundary: every promise chain has settled and no fake timer has run. */
const flush = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.stubGlobal('Worker', FakeWorker)
  FakeWorker.all = []
  mocks.invoke.mockReset()
  mocks.phttp.mockReset()
  mocks.invoke.mockImplementation(async (command: string) => (command === 'extension_list' ? [] : undefined))
  mocks.phttp.mockImplementation(async (url: string) => (url === MANIFEST_URL
    ? { ok: true, status: 200, json: async () => manifest, text: async () => JSON.stringify(manifest) }
    : { ok: true, status: 200, json: async () => ({}), text: async () => `export default { id: '${url}' }` }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const load = () => import('./manager')

/** Build the set. The stagger between workers is a zero-delay timer, so the clock has to tick. */
async function build(manager: Awaited<ReturnType<typeof load>>) {
  const pending = manager.runningStreamExtensions()
  await vi.advanceTimersByTimeAsync(0)
  return pending
}

describe('extension worker lifecycle', () => {
  it('spawns workers one macrotask apart', async () => {
    const manager = await load()
    const pending = manager.runningStreamExtensions()
    await flush()
    // Only the first worker exists until the main thread has been yielded once.
    expect(FakeWorker.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeWorker.all).toHaveLength(2)
    expect((await pending).map((ext) => ext.id)).toEqual(['src-a', 'src-b'])
  })

  it('terminates an idle set and rebuilds it for the next caller without refetching the manifest', async () => {
    const manager = await load()
    await build(manager)
    expect(live()).toHaveLength(2)
    expect(manifestFetches()).toBe(1)

    await vi.advanceTimersByTimeAsync(manager.EXTENSION_WORKER_IDLE_MS)
    expect(live()).toHaveLength(0)

    const rebuilt = await build(manager)
    expect(rebuilt.map((ext) => ext.id)).toEqual(['src-a', 'src-b'])
    expect(FakeWorker.all).toHaveLength(4)
    expect(live()).toHaveLength(2)
    // The respawn is worker creation only: the manifest round-trip is what the memo exists for.
    expect(manifestFetches()).toBe(1)
  })

  it('does not reap while a call keeps the set busy', async () => {
    const manager = await load()
    const [ext] = await build(manager)
    await vi.advanceTimersByTimeAsync(manager.EXTENSION_WORKER_IDLE_MS - 1_000)
    const call = ext.call('search', { query: 'x' })
    await flush()
    await vi.advanceTimersByTimeAsync(1_000)
    // The original deadline has passed; the late call restarted the quiet period.
    expect(live()).toHaveLength(2)
    // Nothing ever answers the query, so its own 20s cap settles it, and the quiet period then
    // runs out counted from that call.
    await vi.advanceTimersByTimeAsync(manager.EXTENSION_WORKER_IDLE_MS)
    expect(await call).toBeNull()
    expect(live()).toHaveLength(0)
  })

  it('answers a pending call at once when its worker is torn down', async () => {
    const manager = await load()
    const [ext] = await build(manager)
    const call = ext.call('search', { query: 'x' })
    await flush()
    // A configuration change replaces the whole set. The caller must not sit on its 20s timer.
    await manager.removeInstalledExtension('gone')
    expect(await Promise.race([call, flush().then(() => 'hung')])).toEqual([])
    expect(live()).toHaveLength(0)
    // The memo belongs to the previous configuration and goes with it.
    await build(manager)
    expect(manifestFetches()).toBe(2)
  })
})
