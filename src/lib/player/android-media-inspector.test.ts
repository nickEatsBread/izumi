import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  addPluginListener: vi.fn(),
}))

import { inspectAndroidMediaSource } from './android-mpv'

describe('Android Media3 bounded inspector', () => {
  beforeEach(() => invoke.mockReset())

  it('is a bounded explicit diagnostic call', async () => {
    invoke.mockResolvedValue({ status: 'timeout', bounded: true, redacted: true })

    await expect(inspectAndroidMediaSource({
      url: 'https://example.test/video.mp4',
      headers: { Authorization: 'redacted-by-native-result' },
      timeoutMs: 20_000,
      byteBudget: 100,
    })).resolves.toEqual({ status: 'timeout', bounded: true, redacted: true })

    expect(invoke).toHaveBeenCalledWith('plugin:mpv|mpv_inspect_source', {
      payload: {
        url: 'https://example.test/video.mp4',
        headers: { Authorization: 'redacted-by-native-result' },
        timeoutMs: 1_000,
        byteBudget: 256 * 1024,
      },
    })
  })
})
