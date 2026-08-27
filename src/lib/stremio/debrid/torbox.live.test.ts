import { describe, expect, it, vi } from 'vitest'

const { nativeHttp } = vi.hoisted(() => ({
  nativeHttp: async (
    command: 'http_get' | 'http_post' | 'ext_fetch',
    args: { url: string; headers?: Record<string, string>; body?: string; method?: string },
  ) => {
    const method = command === 'http_get' ? 'GET' : command === 'http_post' ? 'POST' : (args.method ?? 'GET')
    const response = await fetch(args.url, {
      method,
      headers: args.headers,
      body: method === 'GET' ? undefined : args.body,
      signal: AbortSignal.timeout(30_000),
    })
    return { status: response.status, body: await response.text() }
  },
}))

vi.mock('$lib/net/http', () => ({ invokeNativeHttp: nativeHttp }))

import { torbox } from './providers/torbox'

const enabled = process.env.IZUMI_LIVE_TORBOX_TEST === '1'
const key = process.env.IZUMI_TORBOX_KEY ?? ''
const live = describe.skipIf(!enabled)
const TORRENTIO = 'https://torrentio.strem.fun/stream/series/tt22248376:1:1.json'

live('TorBox live provider integration', () => {
  it('authenticates, resolves an existing hash, and serves playable bytes', async () => {
    expect(key, 'IZUMI_TORBOX_KEY is required for the opt-in live test').not.toBe('')
    const items = await torbox.listItems!(key)
    const ready = items.filter((item) => item.status === 'ready' && item.hash)
    expect(ready.length, 'TorBox account has no ready hash-addressable torrents').toBeGreaterThan(0)

    let target: { hash: string; filename: string } | undefined
    for (const item of ready.slice(0, 12)) {
      const files = await torbox.listFiles!(key, item)
      const playable = files.find((file) => file.playable)
      if (playable && item.hash) {
        target = { hash: item.hash, filename: playable.name }
        break
      }
    }
    expect(target, 'No playable video was found in the first 12 ready account entries').toBeDefined()

    const url = await torbox.resolveHash(key, target!.hash, {
      noAdd: true,
      priority: true,
      timeoutMs: 30_000,
      want: { filename: target!.filename },
    })
    expect(new URL(url).protocol).toBe('https:')

    const response = await fetch(url, {
      headers: { Range: 'bytes=0-65535' },
      signal: AbortSignal.timeout(30_000),
    })
    expect([200, 206]).toContain(response.status)
    const reader = response.body?.getReader()
    const first = await reader?.read()
    await reader?.cancel()
    expect(first?.value?.byteLength ?? 0).toBeGreaterThan(0)
    console.info(`[torbox-live] account=${items.length} ready=${ready.length} cdn-status=${response.status} first-chunk=${first?.value?.byteLength ?? 0}`)
  }, 60_000)

  it('returns definitive cache state for live Stremio addon hashes', async () => {
    expect(key, 'IZUMI_TORBOX_KEY is required for the opt-in live test').not.toBe('')
    const response = await fetch(TORRENTIO, { signal: AbortSignal.timeout(30_000) })
    expect(response.ok).toBe(true)
    const payload = await response.json() as { streams?: Array<{ infoHash?: string }> }
    const hashes = [...new Set((payload.streams ?? []).map((stream) => stream.infoHash?.toLowerCase())
      .filter((hash): hash is string => /^[a-f\d]{40}$/.test(hash ?? ''))) ].slice(0, 100)
    expect(hashes.length).toBeGreaterThan(0)

    const states = await torbox.checkCached!(key, hashes)
    expect(states.size).toBe(hashes.length)
    const cached = [...states.values()].filter((state) => state === 'cached').length
    expect(cached, 'TorBox marked none of the live Torrentio results as cached').toBeGreaterThan(0)
    console.info(`[torbox-live] addon-hashes=${hashes.length} cached=${cached} uncached=${hashes.length - cached}`)
  }, 60_000)
})
