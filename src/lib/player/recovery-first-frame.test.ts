import { describe, expect, it, vi } from 'vitest'
import { waitForRecoveryFirstFrame } from './recovery-first-frame'

describe('recovery first-frame verification', () => {
  it('waits for Android PLAYBACK_RESTART instead of desktop player events', async () => {
    const waitForAndroid = vi.fn(async () => true)
    const waitForDesktop = vi.fn(async () => 'timeout' as const)

    await expect(waitForRecoveryFirstFrame({
      androidEmbedded: true,
      androidTimeoutMs: 60_000,
      waitForAndroid,
      waitForDesktop,
    })).resolves.toBe('ready')

    expect(waitForAndroid).toHaveBeenCalledWith(60_000)
    expect(waitForDesktop).not.toHaveBeenCalled()
  })

  it('preserves the desktop first-frame and load-error path', async () => {
    const waitForAndroid = vi.fn(async () => false)
    const waitForDesktop = vi.fn(async () => 'load-error' as const)

    await expect(waitForRecoveryFirstFrame({
      androidEmbedded: false,
      androidTimeoutMs: 60_000,
      waitForAndroid,
      waitForDesktop,
    })).resolves.toBe('load-error')

    expect(waitForAndroid).not.toHaveBeenCalled()
    expect(waitForDesktop).toHaveBeenCalledOnce()
  })

  it('reports an Android first-frame timeout without falling through to desktop', async () => {
    const waitForAndroid = vi.fn(async () => false)
    const waitForDesktop = vi.fn(async () => 'ready' as const)

    await expect(waitForRecoveryFirstFrame({
      androidEmbedded: true,
      androidTimeoutMs: 60_000,
      waitForAndroid,
      waitForDesktop,
    })).resolves.toBe('timeout')

    expect(waitForDesktop).not.toHaveBeenCalled()
  })
})
