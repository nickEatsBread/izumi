import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { invokeNativeHttp, isNativeTransportFailure, phttp } from './http'

describe('native HTTP lifecycle bridge', () => {
  beforeEach(() => { mocks.invoke.mockReset() })

  it('attaches an opaque request id and caller-selected bounds', async () => {
    mocks.invoke.mockResolvedValue({ status: 200, body: '{"ok":true}' })

    const response = await phttp('https://example.com/data', {
      requestId: 'get-1',
      timeoutMs: 5_000,
      maxBytes: 2_048,
    })

    expect(mocks.invoke).toHaveBeenCalledWith('http_get', {
      url: 'https://example.com/data',
      headers: undefined,
      requestId: 'get-1',
      timeoutMs: 5_000,
      maxBytes: 2_048,
    })
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('propagates AbortSignal cancellation to Rust and rejects immediately', async () => {
    mocks.invoke.mockImplementation((command: string) =>
      command === 'http_cancel' ? Promise.resolve(true) : new Promise(() => {}),
    )
    const controller = new AbortController()
    const request = invokeNativeHttp('http_get', { url: 'https://example.com' }, {
      requestId: 'abort-1',
      signal: controller.signal,
    })

    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.invoke).toHaveBeenCalledWith('http_cancel', { requestId: 'abort-1' })
  })

  it('cancels native work when the IPC deadline expires', async () => {
    mocks.invoke.mockImplementation((command: string) =>
      command === 'http_cancel' ? Promise.resolve(true) : new Promise(() => {}),
    )

    await expect(invokeNativeHttp('ext_fetch', { url: 'https://example.com' }, {
      requestId: 'timeout-1',
      timeoutMs: 5,
    })).rejects.toThrow('request timed out')
    expect(mocks.invoke).toHaveBeenCalledWith('http_cancel', { requestId: 'timeout-1' })
  })

  it('retries one failed GET transport without retrying a deadline or HTTP response', async () => {
    mocks.invoke
      .mockRejectedValueOnce('request failed')
      .mockResolvedValueOnce({ status: 200, body: '{"rows":1}' })

    const response = await phttp('https://example.com/stream.json')

    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    await expect(response.json()).resolves.toEqual({ rows: 1 })
  })

  it('recognises native transport failures returned as strings or Error objects', () => {
    expect(isNativeTransportFailure('request failed')).toBe(true)
    expect(isNativeTransportFailure(new Error('request failed'))).toBe(true)
    expect(isNativeTransportFailure(new Error('request timed out'))).toBe(false)
  })

  it('does not retry an aborted GET', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(phttp('https://example.com/stream.json', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('lane selection', () => {
  beforeEach(() => { mocks.invoke.mockReset() })

  it('can ask for the background lane, so bulk traffic stays off the metadata lane', async () => {
    // Rust has had a background lane since the lifecycle rework specifically so bulk downloads
    // "can never starve the metadata lane the UI's queries ride" — but nothing could request it, so
    // every frontend call landed in the metadata lane. The id map is the largest download the app
    // makes and it happens on a first-ever launch, competing with the covers on screen.
    mocks.invoke.mockResolvedValue({ status: 200, body: '[]' })
    await phttp('https://example.com/big.json', { requestId: 'g', background: true })
    expect(mocks.invoke).toHaveBeenCalledWith('http_get', expect.objectContaining({ background: true }))
  })

  it('sends no lane flag at all by default', async () => {
    mocks.invoke.mockResolvedValue({ status: 200, body: '{}' })
    await phttp('https://example.com/small.json', { requestId: 'g' })
    const args = mocks.invoke.mock.calls[0][1] as Record<string, unknown>
    expect(args.background).toBeUndefined()
    expect(args.priority).toBeUndefined()
  })

  it('keeps the playback lane available for the click-to-play path', async () => {
    mocks.invoke.mockResolvedValue({ status: 200, body: '{}' })
    await phttp('https://example.com/pick', { requestId: 'g', priority: true })
    expect(mocks.invoke).toHaveBeenCalledWith('http_get', expect.objectContaining({ priority: true }))
  })
})

describe('the id map rides the background lane', () => {
  it('asks for it at the call site', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const idmap = readFileSync(fileURLToPath(new URL('../stremio/idmap.ts', import.meta.url)), 'utf8')
    expect(idmap).toContain('phttp(URL, { background: true })')
  })
})
