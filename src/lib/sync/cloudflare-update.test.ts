import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import {
  checkCloudflareWorkerUpdate,
  triggerCloudflareWorkerUpdate,
  workerUpdateFeedback,
  CLOUDFLARE_WORKER_VERSION,
  cloudflareSyncConfig,
  cloudflareWorkerUpdateAvailable,
  getCloudflareSyncStatus,
  startCloudflareWorkerUpdateChecks,
  type CloudflareSyncConfig,
} from './cloudflare'

const connection: CloudflareSyncConfig = {
  enabled: true,
  endpoint: 'https://private.example.workers.dev',
  deviceId: 'device_1234567890123456',
  deviceToken: 'D'.repeat(43),
  groupKey: 'G'.repeat(43),
  workerVersion: '1.0.0',
  deployment: { accountId: 'account', scriptName: 'izumi-sync-test', databaseId: 'database' },
}
const status = (version: unknown) => new Response(JSON.stringify({
  app: 'izumi-sync', protocol: 1, version, claimed: true,
}))

beforeEach(() => {
  cloudflareSyncConfig.set({ ...connection })
  cloudflareWorkerUpdateAvailable.set('')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Worker update checks', () => {
  it('uses authenticated update requests on capable Workers and falls back for older installations', async () => {
    const update = { version: '1.12.0', configured: true, automatic: true, phase: 'queued', latestVersion: '1.13.0', error: '' }
    const network = vi.fn().mockResolvedValueOnce(status('1.11.0'))
      .mockResolvedValueOnce(Response.json({ app: 'izumi-sync', protocol: 1, version: '1.12.0', workerUpdate: 1 }))
      .mockResolvedValueOnce(Response.json(update))
    vi.stubGlobal('fetch', network)
    expect(await triggerCloudflareWorkerUpdate()).toBeNull()
    expect(network).toHaveBeenCalledTimes(1)
    expect(await triggerCloudflareWorkerUpdate()).toEqual(update)
    expect(network.mock.calls[2][0]).toBe(`${connection.endpoint}/v1/worker-update`)
    expect(network.mock.calls[2][1].method).toBe('POST')
    expect(network.mock.calls[2][1].headers.get('Authorization')).toBe(`Bearer ${connection.deviceToken}`)
  })
  it.each([
    ['1.0.0', CLOUDFLARE_WORKER_VERSION],
    [CLOUDFLARE_WORKER_VERSION, ''],
    ['99.0.0', ''],
  ])('compares the live version %s with the version bundled in this app', async (version, available) => {
    const fetchMock = vi.fn().mockResolvedValue(status(version))
    vi.stubGlobal('fetch', fetchMock)
    expect(await checkCloudflareWorkerUpdate()).toBe(available)
    expect(get(cloudflareWorkerUpdateAvailable)).toBe(available)
    expect(get(cloudflareSyncConfig)).toEqual({ ...connection, workerVersion: version })
    expect(fetchMock).toHaveBeenCalledWith(`${connection.endpoint}/v1/status`, expect.objectContaining({ cache: 'no-store' }))
  })

  it('clears the update notice once the deployed version is current', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(status('1.0.0'))
      .mockResolvedValueOnce(status(CLOUDFLARE_WORKER_VERSION)))
    await checkCloudflareWorkerUpdate()
    expect(get(cloudflareWorkerUpdateAvailable)).toBe(CLOUDFLARE_WORKER_VERSION)
    await checkCloudflareWorkerUpdate({ throwOnError: true })
    expect(get(cloudflareWorkerUpdateAvailable)).toBe('')
  })

  it('keeps background failures quiet but reports failures to a manual check', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection failed')))
    cloudflareWorkerUpdateAvailable.set(CLOUDFLARE_WORKER_VERSION)
    await expect(checkCloudflareWorkerUpdate()).resolves.toBe('')
    await expect(checkCloudflareWorkerUpdate({ throwOnError: true })).rejects.toThrow('Connection failed')
    expect(get(cloudflareWorkerUpdateAvailable)).toBe(CLOUDFLARE_WORKER_VERSION)
    expect(get(cloudflareSyncConfig)).toEqual(connection)
  })

  it.each([undefined, 123, '', 'invalid'])('rejects a malformed reported version: %s', async version => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status(version)))
    await expect(checkCloudflareWorkerUpdate({ throwOnError: true })).rejects.toThrow('not an Izumi sync Worker')
    expect(get(cloudflareSyncConfig)).toEqual(connection)
  })

  it('does not check an unlinked device or leave its update notice visible', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    cloudflareSyncConfig.set({ ...connection, deviceToken: '' })
    cloudflareWorkerUpdateAvailable.set(CLOUDFLARE_WORKER_VERSION)
    await expect(checkCloudflareWorkerUpdate()).resolves.toBe('')
    await expect(checkCloudflareWorkerUpdate({ throwOnError: true })).rejects.toThrow('Connect this device')
    expect(get(cloudflareWorkerUpdateAvailable)).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([checkCloudflareWorkerUpdate, getCloudflareSyncStatus])('does not restore a replaced connection after a delayed response', async check => {
    let respond!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(new Promise<Response>(resolve => { respond = resolve }))
      .mockResolvedValue(new Response(JSON.stringify({ deviceId: connection.deviceId }))))
    const checking = check()
    const replacement = { ...connection, deviceToken: 'N'.repeat(43), groupKey: 'K'.repeat(43) }
    cloudflareSyncConfig.set(replacement)
    respond(status('1.1.0'))
    await checking
    expect(get(cloudflareSyncConfig)).toEqual(replacement)
    expect(get(cloudflareWorkerUpdateAvailable)).toBe('')
  })

  it('preserves settings changed while a version check is in flight', async () => {
    let respond!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(resolve => { respond = resolve })))
    const checking = checkCloudflareWorkerUpdate()
    cloudflareSyncConfig.update(config => ({ ...config, enabled: false }))
    respond(status(CLOUDFLARE_WORKER_VERSION))
    await checking
    expect(get(cloudflareSyncConfig)).toEqual({ ...connection, enabled: false, workerVersion: CLOUDFLARE_WORKER_VERSION })
  })

  it('starts only one check schedule, at 20 seconds and every six hours', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(status('1.0.0')))
    vi.stubGlobal('fetch', fetchMock)
    startCloudflareWorkerUpdateChecks()
    startCloudflareWorkerUpdateChecks()
    await vi.advanceTimersByTimeAsync(19_999)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000 - 20_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    vi.clearAllTimers()
  })
})

describe('workerUpdateFeedback', () => {
  const reply = (over: Record<string, unknown> = {}) => ({
    version: '1.0.0', configured: true, automatic: true, phase: 'error',
    latestVersion: '1.1.0', error: '', ...over,
  } as never)

  it('asks for deployment access only when the Worker has none', () => {
    expect(workerUpdateFeedback(reply({ configured: false, phase: 'setup-required' })))
      .toEqual({ needsAccess: true, failure: '' })
  })

  it('reports a failed install without claiming access is missing', () => {
    expect(workerUpdateFeedback(reply({ error: 'The update could not be confirmed.' })))
      .toEqual({ needsAccess: false, failure: 'The update could not be confirmed.' })
  })

  it('stays quiet for a healthy reply or an unsupported Worker', () => {
    expect(workerUpdateFeedback(reply({ phase: 'current' }))).toEqual({ needsAccess: false, failure: '' })
    expect(workerUpdateFeedback(null)).toEqual({ needsAccess: false, failure: '' })
  })
})
