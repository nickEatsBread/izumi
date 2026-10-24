import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const mocks = vi.hoisted(() => ({ goto: vi.fn(), getCurrent: vi.fn(), onOpenUrl: vi.fn(), invoke: vi.fn(), complete: vi.fn() }))
vi.mock('$app/navigation', () => ({ goto: mocks.goto }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ getCurrent: mocks.getCurrent, onOpenUrl: mocks.onOpenUrl }))
vi.mock('$lib/trakt/browser-auth', () => ({ completeTraktBrowserAuth: mocks.complete }))
import { deepLinkNotice, initDeepLinks } from './deep-links'

const link = `izumi://auth/trakt#state=${'a'.repeat(64)}&code=private-code`
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

describe('Trakt native deep-link dispatch', () => {
  it('finishes a cold-launch callback and navigates without credential parameters', async () => {
    vi.useFakeTimers()
    mocks.getCurrent.mockResolvedValue([link])
    mocks.invoke.mockResolvedValue(null)
    mocks.complete.mockResolvedValue(undefined)
    const stop = vi.fn()
    mocks.onOpenUrl.mockResolvedValue(stop)
    expect(await initDeepLinks()).toBe(stop)
    expect(mocks.complete).toHaveBeenCalledWith(link)
    expect(mocks.goto).toHaveBeenCalledWith('/app/settings/accounts#trackers')
    expect(get(deepLinkNotice)).toBe('Trakt connected')
    expect(JSON.stringify(mocks.goto.mock.calls)).not.toContain('private-code')
  })

  it('handles a running-app callback and shows safe failures rather than success', async () => {
    vi.useFakeTimers()
    mocks.getCurrent.mockResolvedValue(null)
    mocks.invoke.mockResolvedValue(null)
    mocks.complete.mockRejectedValue(new Error('This Trakt link expired. Start again.'))
    mocks.onOpenUrl.mockResolvedValue(() => {})
    await initDeepLinks()
    mocks.onOpenUrl.mock.calls[0][0]([link])
    await vi.waitFor(() => expect(mocks.goto).toHaveBeenCalled())
    expect(get(deepLinkNotice)).toBe('This Trakt link expired. Start again.')
    expect(mocks.goto).toHaveBeenCalledWith('/app/settings/accounts#trackers')
  })

  it('preserves the existing first-understood-link policy for mixed batches', async () => {
    mocks.getCurrent.mockResolvedValue(['junk', 'izumi://anime/21', link])
    mocks.invoke.mockResolvedValue(null)
    mocks.onOpenUrl.mockResolvedValue(() => {})
    await initDeepLinks()
    expect(mocks.goto).toHaveBeenCalledWith('/app/anime/21')
    expect(mocks.complete).not.toHaveBeenCalled()
  })
})
