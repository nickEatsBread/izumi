import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { invokeNativeHttp, phttp } from './http'

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
})
