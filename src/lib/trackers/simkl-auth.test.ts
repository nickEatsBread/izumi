import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import packageJson from '../../../package.json'

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(async () => {}),
  trackerHttpFetch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.openUrl }))
vi.mock('./tracker-http', () => ({ trackerHttpFetch: mocks.trackerHttpFetch }))

import {
  connectSimkl,
  resetSimklRequestPolicyForTests,
  SIMKL_APP_VERSION,
  SIMKL_USER_AGENT,
  simklFetch,
} from './simkl-auth'
import { simklToken, simklUserAvatar, simklUserName } from './config'

const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
})

describe('SIMKL API client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'))
    vi.spyOn(Math, 'random').mockReturnValue(0)
    mocks.openUrl.mockClear()
    mocks.trackerHttpFetch.mockReset()
    resetSimklRequestPolicyForTests()
    simklToken.set('user-token')
    simklUserName.set('Viewer')
    simklUserAvatar.set('avatar')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('derives app-version and User-Agent from package.json and identifies every request', async () => {
    mocks.trackerHttpFetch.mockResolvedValue(json({ ok: true }))

    const pending = simklFetch('/sync/activities')
    await vi.runAllTimersAsync()
    await pending

    expect(SIMKL_APP_VERSION).toBe(packageJson.version)
    expect(SIMKL_USER_AGENT).toContain(`izumi/${packageJson.version}`)
    const [rawUrl, init] = mocks.trackerHttpFetch.mock.calls[0]
    const url = new URL(rawUrl)
    expect(url.searchParams.get('client_id')).toBe('simkl-test-client-id')
    expect(url.searchParams.get('app-name')).toBe('izumi')
    expect(url.searchParams.get('app-version')).toBe(packageJson.version)
    expect(init.headers).toMatchObject({
      'User-Agent': SIMKL_USER_AGENT,
      Authorization: 'Bearer user-token',
    })
  })

  it('serializes writes far enough apart for SIMKL’s one-POST-per-second limit', async () => {
    mocks.trackerHttpFetch.mockResolvedValue(json({ ok: true }, 201))

    const first = simklFetch('/sync/history', { method: 'POST', body: '{}' })
    await vi.advanceTimersByTimeAsync(0)
    await first
    const second = simklFetch('/sync/add-to-list', { method: 'POST', body: '{}' })
    await vi.advanceTimersByTimeAsync(1_049)
    expect(mocks.trackerHttpFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await second
    expect(mocks.trackerHttpFetch).toHaveBeenCalledTimes(2)
  })

  it('retries transient GET failures with exponential backoff', async () => {
    mocks.trackerHttpFetch
      .mockResolvedValueOnce(json({ error: 'temporary' }, 503))
      .mockResolvedValueOnce(json({ error: 'rate_limit' }, 429))
      .mockResolvedValueOnce(json({ ok: true }))

    const pending = simklFetch('/sync/activities')
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toMatchObject({ status: 200 })
    expect(mocks.trackerHttpFetch).toHaveBeenCalledTimes(3)
  })

  it('disconnects a revoked token instead of retrying a deterministic 401', async () => {
    mocks.trackerHttpFetch.mockResolvedValue(json({ error: 'user_token_failed' }, 401))

    const pending = simklFetch('/sync/activities')
    await vi.runAllTimersAsync()
    await pending

    expect(mocks.trackerHttpFetch).toHaveBeenCalledTimes(1)
    expect(get(simklToken)).toBeNull()
    expect(get(simklUserName)).toBe('')
    expect(get(simklUserAvatar)).toBe('')
  })
})

describe('SIMKL PIN authentication', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'))
    vi.spyOn(Math, 'random').mockReturnValue(0)
    mocks.openUrl.mockClear()
    mocks.trackerHttpFetch.mockReset()
    resetSimklRequestPolicyForTests()
    simklToken.set(null)
    simklUserName.set('')
    simklUserAvatar.set('')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('prefers RFC verification_uri, respects the interval, and stores an approved token', async () => {
    mocks.trackerHttpFetch
      .mockResolvedValueOnce(json({
        device_code: 'DEVICE_CODE',
        user_code: 'ABCDE',
        verification_uri: 'https://simkl.com/pin',
        verification_url: 'https://legacy.simkl.com/pin',
        expires_in: 60,
        interval: 5,
      }))
      .mockResolvedValueOnce(json({ result: 'OK', access_token: 'approved-token' }))
      .mockResolvedValueOnce(json({ user: { name: 'SIMKL Viewer', avatar: 'viewer.png' } }))

    const seen: string[] = []
    const pending = connectSimkl((pin) => seen.push(`${pin.code}:${pin.verificationUrl}`))
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toEqual(['ABCDE:https://simkl.com/pin'])
    expect(mocks.openUrl).toHaveBeenCalledWith('https://simkl.com/pin')
    expect(mocks.trackerHttpFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(mocks.trackerHttpFetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await pending

    expect(get(simklToken)).toBe('approved-token')
    expect(get(simklUserName)).toBe('SIMKL Viewer')
  })

  it('stops when polling returns a replacement PIN for a consumed or expired code', async () => {
    mocks.trackerHttpFetch
      .mockResolvedValueOnce(json({
        device_code: 'DEVICE_CODE', user_code: 'ABCDE', verification_uri: 'https://simkl.com/pin',
        expires_in: 60, interval: 1,
      }))
      .mockResolvedValueOnce(json({ device_code: 'DEVICE_CODE', user_code: 'FGHIJ' }))

    // Attach the rejection assertion immediately. Waiting to attach it until after the fake
    // timer fires makes Node report the intentional rejection as temporarily unhandled.
    const pending = expect(connectSimkl()).rejects.toThrow('code expired')
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    await pending
    expect(mocks.trackerHttpFetch).toHaveBeenCalledTimes(2)
  })
})
