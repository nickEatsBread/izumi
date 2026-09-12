import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { readFileSync } from 'node:fs'
import type { CloudflareResolverProfile } from '$lib/sync/cloudflare'
import type { ManualDevice } from '$lib/sync/types'

const observations = vi.hoisted(() => ({ writes: [] as string[] }))
vi.mock('svelte-persisted-store', async () => {
  const { writable } = await import('svelte/store')
  const registry = new Map()
  return { persisted: (key: string, initial: unknown) => {
    if (!registry.has(key)) {
      const store = writable(initial)
      registry.set(key, { subscribe: store.subscribe,
        set: (value: unknown) => { observations.writes.push(key); store.set(value) },
        update: (fn: (value: unknown) => unknown) => { observations.writes.push(key); store.update(fn) },
      })
    }
    return registry.get(key)
  } }
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/sync/cloudflare', async importOriginal => ({
  ...await importOriginal<typeof import('$lib/sync/cloudflare')>(),
  saveCloudflareCompanionRecovery: vi.fn().mockResolvedValue(true),
}))
vi.mock('$lib/sync/client', async () => {
  const cf = await import('$lib/sync/cloudflare')
  vi.mocked(cf.saveCloudflareCompanionRecovery).mockReset().mockResolvedValue(true)
  return { cloudflareSyncConfig: cf.cloudflareSyncConfig, syncProvider: cf.syncProvider,
    pullWatchProgress: vi.fn().mockResolvedValue(2), listManualDevices: vi.fn().mockResolvedValue([]), receiveManualSnapshot: vi.fn(),
  }
})
vi.mock('./client', async () => {
  const { persisted } = await import('svelte-persisted-store')
  return { pairedCompanions: persisted('paired-tizen-companions-v1', []), syncCompanionProgress: vi.fn().mockResolvedValue(true) }
})
vi.mock('$lib/profiles/store', async () => {
  const { writable, derived } = await import('svelte/store')
  const { persisted } = await import('svelte-persisted-store')
  const household = persisted('izumi-profiles-v1', { profiles: [{ id: 'default', name: 'Main profile' }] })
  return { activeProfileId: writable('default'), activeProfileLocked: writable(false), profileSwitcherOpen: writable(false),
    profiles: derived(household, value => value.profiles), normalizeProfileState: (value: unknown) => value,
  }
})
vi.mock('$lib/settings/ui', async () => {
  const { persisted } = await import('svelte-persisted-store')
  return Object.fromEntries(['debridKey', 'debridProvider', 'preferredQuality', 'preferredAudioLang', 'preferredStreamSort', 'showAdult', 'hideSpoilers']
    .map(key => [key, persisted(key, '')]))
})

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const endpoint = 'https://restore.example.com'
const code = 'ABCDEFGHJKLMNPQRSTV2'
const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64url')
const key = (byte: number) => b64(new Uint8Array(32).fill(byte))
const identity = { deviceId: 'fresh-client-identity-123456', deviceToken: key(5) }
const transport = {
  protocol: 1, endpoint, pairingId: 'pairing-abcdefghijklmnop', tvToken: key(1), recoveryKey: key(2),
  playbackMode: 'cloud-only', wakeWhenClosed: false,
}
const pin = { salt: 'a'.repeat(32), hash: 'b'.repeat(64) }
const profile: CloudflareResolverProfile = {
  enabled: true, addons: ['https://sources.example.com/config/manifest.json'], quality: '1080', sort: 'size', audioLang: 'ja',
  connectedDeviceFallback: true, debrid: { provider: 'premium', credential: 'saved-secret' },
  catalog: { screens: ['auto', 'tmdb', 'merged'], defaultScreen: 'merged', showAdult: false, hideSpoilers: true, tmdbToken: 'catalog-secret' },
  collections: [{ id: 'saved', title: 'Saved collection', pinToTop: false, viewMode: 'ROWS', showAllTab: true, folders: [] }],
  household: { enabled: true, profiles: [
    { id: 'default', name: 'Parent', color: '#ef476f', createdAt: 1, ratingLimit: 18, allowAdult: true, pin },
    { id: 'child', name: 'Child', color: '#2a9d8f', createdAt: 2, ratingLimit: 7, allowAdult: false },
  ] },
}
async function encrypt(value: unknown, keyBytes: Uint8Array<ArrayBuffer>, aad: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, cryptoKey, new TextEncoder().encode(JSON.stringify(value)))
  return JSON.stringify({ v: 1, iv: b64(iv), data: b64(new Uint8Array(encrypted)) })
}
async function fixture(options: { transport?: Record<string, unknown>; payload?: Record<string, unknown>; recovery?: unknown; profile?: unknown; code?: string; aad?: string; wrapKey?: number } = {}) {
  const payload = { v: 1, deviceId: 'a'.repeat(24), credential: 'c'.repeat(64), transport: { ...transport, ...options.transport }, ...options.payload }
  const secret = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`izumi-client-link-key-v1:${options.code ?? code}`)))
  return {
    payload: await encrypt(payload, secret, options.aad ?? `izumi-client-link-v1:${endpoint}`),
    recovery: Object.hasOwn(options, 'recovery') ? options.recovery : await encrypt({ v: 1, groupKey: key(3) }, new Uint8Array(32).fill(options.wrapKey ?? 2), `izumi-companion:${transport.pairingId}:client-recovery`),
    profile: Object.hasOwn(options, 'profile') ? options.profile : structuredClone(profile), ownerDeviceId: 'original-owner', version: '1.11.0',
  }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  observations.writes = []
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  vi.stubGlobal('fetch', vi.fn())
  // Persisted mocks share their registry just like the real library; reset live values explicitly.
  const cf = await import('$lib/sync/cloudflare')
  cf.cloudflareSyncConfig.set({ enabled: true, endpoint: 'https://previous.example.com', deviceId: 'previous-client', deviceToken: key(8), groupKey: key(9), workerVersion: '1.0.0' })
  cf.syncProvider.set('iroh')
  const companion = await import('./client')
  companion.pairedCompanions.set([])
  vi.mocked(companion.syncCompanionProgress).mockResolvedValue(true)
  const sync = await import('$lib/sync/client')
  vi.mocked(sync.pullWatchProgress).mockResolvedValue(2)
  vi.mocked(sync.listManualDevices).mockResolvedValue([])
  const profiles = await import('$lib/profiles/store')
  profiles.activeProfileId.set('default')
  // Mocked readables intentionally expose setters for simulating the existing PIN overlay.
  ;(profiles.activeProfileLocked as unknown as { set(value: boolean): void }).set(false)
  profiles.profileSwitcherOpen.set(false)
  ;(await import('$lib/settings/onboarding')).onboardingComplete.set(false)
  observations.writes = []
})

describe('TV restore validation and cryptography', () => {
  it('normalizes only spaces, hyphens and ASCII letter case', async () => {
    const { normalizeRestoreCode } = await import('./restore')
    expect(normalizeRestoreCode('abcd-efgh jklm-npqr stv2')).toBe(code)
    for (const input of ['', code.slice(1), `${code}A`, code.replace('A', '0'), code.replace('B', 'I'), code.replace('C', 'O'), code.replace('S', 'ſ'), code.replace('A', '!'), `${code}.`]) {
      expect(() => normalizeRestoreCode(input)).toThrow()
    }
  })

  it.each(['http://restore.example.com', 'https://localhost', 'https://127.1', 'https://0x7f000001', 'https://2130706433', 'https://10.1.2.3', 'https://172.18.0.1', 'https://192.168.1.2', 'https://169.254.169.254', 'https://100.64.1.2', 'https://[::1]', 'https://[::ffff:7f00:1]', 'https://tv.local', 'https://tv.home.arpa', 'https://user:secret@restore.example.com', `${endpoint}/api`, `${endpoint}?secret=x`, `${endpoint}#secret=x`])('rejects non-public or malformed endpoint %s', async (input) => {
    const { normalizeRestoreEndpoint } = await import('./restore')
    expect(() => normalizeRestoreEndpoint(input)).toThrow('public HTTPS')
  })

  it('decrypts the full contract with a separate recovery key and fresh identity without changing live state', async () => {
    const { validateRestoreClaim } = await import('./restore')
    const result = await validateRestoreClaim(await fixture(), ' HTTPS://RESTORE.EXAMPLE.COM/ ', code.toLowerCase(), identity)
    expect(result.config).toEqual({ enabled: true, endpoint, ...identity, groupKey: key(3), workerVersion: '1.11.0' })
    expect(result.device).toMatchObject({ name: 'Samsung TV', address: '', deviceId: 'a'.repeat(24), credential: 'c'.repeat(64), cloudflare: transport })
    expect(result.profile?.household?.profiles[0].pin).toEqual(pin)
    expect(result.limitedRecovery).toBe(false)
    expect(observations.writes).toEqual([])
    expect(localStorage.length).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { code: '22222222222222222222' }, { aad: 'izumi-client-link-v1:https://other.example.com' },
    { wrapKey: 1 }, { transport: { endpoint: 'https://other.example.com' } }, { transport: { tvToken: key(1).slice(1) } },
    { transport: { recoveryKey: key(2).slice(1) } }, { transport: { pairingId: 'bad/id' } },
    { payload: { v: 2 } }, { payload: { deviceId: 'tv' } }, { payload: { credential: 'bad' } },
    { profile: { ...profile, household: { profiles: [{ ...profile.household!.profiles[0], pin: {} }] } } },
    { profile: { ...profile, household: { profiles: [profile.household!.profiles[1]] } } },
  ])('rejects authentication/schema failure before live mutations: %j', async options => {
    const { validateRestoreClaim } = await import('./restore')
    await expect(validateRestoreClaim(await fixture(options), endpoint, code, identity)).rejects.toThrow()
    expect(observations.writes).toEqual([])
  })

  it('rejects invalid envelope IV, unsupported version, bad tag and noncanonical key encodings', async () => {
    const { validateRestoreClaim } = await import('./restore')
    const body = await fixture()
    const envelope = JSON.parse(body.payload)
    for (const patch of [{ v: 2 }, { iv: key(4) }, { data: b64(new Uint8Array(16)) }, { iv: `${envelope.iv}=` }]) {
      await expect(validateRestoreClaim({ ...body, payload: JSON.stringify({ ...envelope, ...patch }) }, endpoint, code, identity)).rejects.toThrow()
    }
    const recovery = await encrypt({ v: 1, groupKey: key(3).slice(1) }, new Uint8Array(32).fill(2), `izumi-companion:${transport.pairingId}:client-recovery`)
    await expect(validateRestoreClaim({ ...body, recovery }, endpoint, code, identity)).rejects.toThrow()
    await expect(validateRestoreClaim(body, endpoint, code, { ...identity, deviceToken: `${key(5)}=` })).rejects.toThrow()
  })

  it.each([{ recovery: null }, { recovery: undefined }, { transport: { recoveryKey: undefined } }, { transport: { recoveryKey: undefined }, recovery: 'unreadable legacy envelope' }])('keeps legacy full sync disabled with an empty key: %j', async options => {
    const { validateRestoreClaim, LIMITED_RECOVERY_WARNING } = await import('./restore')
    const result = await validateRestoreClaim(await fixture(options), endpoint, code, identity)
    expect(result.limitedRecovery).toBe(true)
    expect(result.config).toMatchObject({ enabled: false, groupKey: '', deviceToken: identity.deviceToken })
    expect(result.device.cloudflare?.tvToken).toBe(key(1))
    expect(LIMITED_RECOVERY_WARNING).toContain('Full encrypted sync is disabled')
  })
})

describe('one-use claim durability', () => {
  it('persists the identity before POST and sends the hash, never the code or TV token', async () => {
    const body = await fixture()
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const journal = JSON.parse(sessionStorage.getItem('companion-client-claim-v1')!)
      const request = JSON.parse(init!.body as string)
      expect(request).toMatchObject({ ...journal.identity, token: journal.token, deviceName: 'New laptop' })
      expect(journal).not.toHaveProperty('code')
      expect(request.deviceId).not.toBe(body.ownerDeviceId)
      expect(Buffer.from(request.deviceToken, 'base64url')).toHaveLength(32)
      expect(JSON.stringify(request)).not.toContain(code)
      expect(init).toMatchObject({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' })
      expect(observations.writes).toEqual([])
      return new Response(JSON.stringify(body))
    })
    const restore = await import('./restore')
    const result = await restore.linkAndRestoreTv(endpoint, code, 'New laptop')
    expect(fetch).toHaveBeenCalledTimes(1)
    const expected = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))))
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).token).toBe(expected)
    expect(JSON.parse(localStorage.getItem('companion-client-restore-v1')!).config).toEqual(result.config)
    expect(observations.writes).toEqual([])
  })

  it('reuses the identity after an uncertain response and a module reload', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network disconnected')).mockResolvedValueOnce(new Response(JSON.stringify(await fixture())))
    const restore = await import('./restore')
    await expect(restore.linkAndRestoreTv(endpoint, code, 'Laptop')).rejects.toThrow('Network disconnected')
    const first = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    vi.resetModules()
    await (await import('./restore')).linkAndRestoreTv(endpoint, code, 'Laptop')
    const second = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)
    expect(second).toEqual(first)
  })

  it('retains a successful response across decryption failures and reload, without reclaiming', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(await fixture({ wrapKey: 1 }))))
    await expect((await import('./restore')).linkAndRestoreTv(endpoint, code, 'Laptop')).rejects.toThrow()
    expect(JSON.parse(sessionStorage.getItem('companion-client-claim-v1')!).response).toBeTruthy()
    vi.resetModules()
    await expect((await import('./restore')).linkAndRestoreTv(endpoint, code, 'Laptop')).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(observations.writes).toEqual([])
  })

  it('retries a durable-save failure without losing the successful claim', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(await fixture())))
    const write = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('Storage full') })
    const restore = await import('./restore')
    await expect(restore.linkAndRestoreTv(endpoint, code, 'Laptop')).rejects.toThrow('Storage full')
    write.mockRestore()
    await restore.linkAndRestoreTv(endpoint, code, 'Laptop')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('companion-client-restore-v1')).toBeTruthy()
    expect(observations.writes).toEqual([])
  })

  it('does not contact the Worker for malformed input or unsupported redirects/errors', async () => {
    const restore = await import('./restore')
    await expect(restore.linkAndRestoreTv('https://localhost', code, 'Laptop')).rejects.toThrow()
    await expect(restore.linkAndRestoreTv(endpoint, `${code}!`, 'Laptop')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 410 }))
    await expect(restore.linkAndRestoreTv(endpoint, code, 'Laptop')).rejects.toThrow('unavailable or already used')
    expect(observations.writes).toEqual([])
  })
})

async function prepare(legacy = false) {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(await fixture(legacy ? { recovery: null } : {}))))
  const restore = await import('./restore')
  await restore.linkAndRestoreTv(endpoint, code, 'Laptop')
  await restore.prepareRestoreProfiles()
  return restore
}
async function unlock() {
  const profiles = await import('$lib/profiles/store')
  ;(profiles.activeProfileLocked as unknown as { set(value: boolean): void }).set(false)
  profiles.profileSwitcherOpen.set(false)
}

describe('secure recovery enrollment from an existing full client', () => {
  async function configureExisting(patch: Partial<import('$lib/sync/cloudflare').CloudflareSyncConfig> = {}) {
    const cf = await import('$lib/sync/cloudflare')
    cf.cloudflareSyncConfig.update(config => ({ ...config, endpoint, enabled: true, groupKey: key(9), ...patch }))
    cf.syncProvider.set('cloudflare')
    observations.writes = []
    return cf
  }

  it('captures the old key before the claim, reuses it after validation, and seeds only after config installation and unlock', async () => {
    const cf = await configureExisting({ endpoint: 'HTTPS://RESTORE.EXAMPLE.COM/' })
    const body = await fixture({ recovery: null })
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      const request = JSON.parse(init!.body as string)
      expect(request).not.toHaveProperty('existingGroupKey')
      expect(JSON.stringify(request)).not.toContain(key(9))
      expect(JSON.stringify(request)).not.toContain(transport.recoveryKey)
      expect(JSON.parse(sessionStorage.getItem('companion-client-claim-v1')!).existingGroupKey).toBe(key(9))
      // An in-flight config change cannot substitute a different candidate into this claim.
      cf.cloudflareSyncConfig.update(config => ({ ...config, groupKey: key(7) }))
      return new Response(JSON.stringify(body))
    })
    const restore = await import('./restore')
    const session = await restore.linkAndRestoreTv(endpoint, code, 'Existing laptop')
    expect(session).toMatchObject({ limitedRecovery: false, recoverySeedPending: true, stage: 'validated', config: { enabled: true, groupKey: key(9) } })
    expect(get(cf.cloudflareSyncConfig).groupKey).toBe(key(7))
    expect(cf.saveCloudflareCompanionRecovery).not.toHaveBeenCalled()
    await restore.prepareRestoreProfiles()
    expect(cf.saveCloudflareCompanionRecovery).not.toHaveBeenCalled()
    await expect(restore.finishTvRestore()).rejects.toThrow('Select and unlock')
    await unlock()
    vi.mocked(cf.saveCloudflareCompanionRecovery).mockImplementationOnce(async received => {
      expect(received).toEqual(transport)
      expect(get(cf.cloudflareSyncConfig)).toEqual(session.config)
      expect(get(cf.syncProvider)).toBe('cloudflare')
      expect(JSON.parse(localStorage.getItem('companion-client-restore-v1')!).recoverySeedPending).toBe(true)
      return true
    })
    const finished = await restore.finishTvRestore()
    expect(finished.stage).toBe('linked')
    expect(finished.recoverySeedPending).toBe(false)
    expect(get(cf.cloudflareSyncConfig).deviceId).not.toBe('previous-client')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(cf.saveCloudflareCompanionRecovery).toHaveBeenCalledTimes(1)
  })

  it.each([
    { endpoint: 'https://another.example.com' }, { enabled: false }, { groupKey: '' },
    { groupKey: key(9).slice(1) }, { groupKey: `${key(9)}=` },
  ])('never substitutes an ineligible previous key: %j', async patch => {
    const cf = await configureExisting(patch)
    const restore = await prepare(true)
    expect(restore.pendingTvRestore()).toMatchObject({ limitedRecovery: true, config: { enabled: false, groupKey: '' } })
    await unlock(); await restore.finishTvRestore()
    expect(cf.saveCloudflareCompanionRecovery).not.toHaveBeenCalled()
  })

  it('does not enable recovery without a TV recovery key received in the encrypted reverse link', async () => {
    const cf = await configureExisting()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(await fixture({ recovery: null, transport: { recoveryKey: undefined } }))))
    const restore = await import('./restore')
    const session = await restore.linkAndRestoreTv(endpoint, code, 'Laptop')
    expect(session.config).toMatchObject({ enabled: false, groupKey: '' })
    expect(session.recoverySeedPending).toBeUndefined()
    expect(cf.saveCloudflareCompanionRecovery).not.toHaveBeenCalled()
    expect(observations.writes).toEqual([])
  })

  it('prefers an authenticated recovery envelope over a different local key', async () => {
    const cf = await configureExisting()
    const restore = await prepare()
    expect(restore.pendingTvRestore()?.config.groupKey).toBe(key(3))
    expect(restore.pendingTvRestore()?.recoverySeedPending).toBeUndefined()
    await unlock(); await restore.finishTvRestore()
    expect(cf.saveCloudflareCompanionRecovery).not.toHaveBeenCalled()
  })

  it('does not fall back to a local candidate when the recovery envelope fails authentication', async () => {
    const cf = await configureExisting()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(await fixture({ wrapKey: 1 }))))
    await expect((await import('./restore')).linkAndRestoreTv(endpoint, code, 'Laptop')).rejects.toThrow()
    expect(observations.writes).toEqual([])
    expect(get(cf.cloudflareSyncConfig).deviceId).toBe('previous-client')
    expect(cf.saveCloudflareCompanionRecovery).not.toHaveBeenCalled()
  })

  it('retains the captured candidate across an uncertain claim and reload', async () => {
    const cf = await configureExisting()
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Connection lost'))
    await expect((await import('./restore')).linkAndRestoreTv(endpoint, code, 'Laptop')).rejects.toThrow('Connection lost')
    cf.cloudflareSyncConfig.update(config => ({ ...config, groupKey: key(7) }))
    vi.resetModules()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(await fixture({ recovery: null }))))
    const session = await (await import('./restore')).linkAndRestoreTv(endpoint, code, 'Laptop')
    expect(session.config.groupKey).toBe(key(9))
    expect(session.recoverySeedPending).toBe(true)
  })

  it.each(['error', 'unverified'] as const)('keeps failed seeding retryable across reload without reclaiming: %s', async failure => {
    const cf = await configureExisting()
    let restore = await prepare(true)
    await unlock()
    if (failure === 'error') vi.mocked(cf.saveCloudflareCompanionRecovery).mockRejectedValueOnce(new Error('Worker offline'))
    else vi.mocked(cf.saveCloudflareCompanionRecovery).mockResolvedValueOnce(false)
    await expect(restore.finishTvRestore()).rejects.toThrow('Retry finishing secure recovery')
    expect(restore.pendingTvRestore()).toMatchObject({ stage: 'profile', recoverySeedPending: true, config: { groupKey: key(9) } })
    expect(JSON.parse(localStorage.getItem('companion-client-restore-v1')!).recoverySeedPending).toBe(true)
    expect(get(cf.cloudflareSyncConfig).groupKey).toBe(key(9))
    vi.resetModules()
    restore = await import('./restore')
    await restore.finishTvRestore()
    expect(restore.pendingTvRestore()).toMatchObject({ stage: 'linked', recoverySeedPending: false })
    expect(cf.saveCloudflareCompanionRecovery).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not seed another connection or report success if a profile locks during seeding', async () => {
    const cf = await configureExisting()
    const restore = await prepare(true)
    await unlock()
    const config = get(cf.cloudflareSyncConfig)
    cf.cloudflareSyncConfig.update(value => ({ ...value, endpoint: 'https://different.example.com' }))
    await expect(restore.finishTvRestore()).rejects.toThrow('connection changed')
    expect(cf.saveCloudflareCompanionRecovery).not.toHaveBeenCalled()
    cf.cloudflareSyncConfig.set(config)
    const profiles = await import('$lib/profiles/store')
    vi.mocked(cf.saveCloudflareCompanionRecovery).mockImplementationOnce(async () => {
      profiles.profileSwitcherOpen.set(true)
      return true
    })
    await expect(restore.finishTvRestore()).rejects.toThrow('Select and unlock')
    expect(restore.pendingTvRestore()).toMatchObject({ stage: 'profile', recoverySeedPending: true })
  })

  it('keeps the durable barrier after seeding succeeds but the final journal write fails', async () => {
    const cf = await configureExisting()
    const restore = await prepare(true)
    await unlock()
    const { companionRestorePending } = await import('./restore-state')
    const write = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('Storage full') })
    await expect(restore.finishTvRestore()).rejects.toThrow('Storage full')
    expect(get(companionRestorePending)).toBe(true)
    expect(restore.pendingTvRestore()).toMatchObject({ stage: 'profile', recoverySeedPending: true })
    expect(JSON.parse(localStorage.getItem('companion-client-restore-v1')!).stage).toBe('profile')
    write.mockRestore()
    await restore.finishTvRestore()
    expect(get(companionRestorePending)).toBe(false)
    expect(cf.saveCloudflareCompanionRecovery).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('durable pending restore barrier', () => {
  it.each(['validated', 'profile'])('blocks startup before the restore page mounts for stage %s', async stage => {
    localStorage.setItem('companion-client-restore-v1', JSON.stringify({ v: 1, stage }))
    expect(get((await import('./restore-state')).companionRestorePending)).toBe(true)
  })

  it('stays blocked when the picker closes and clears only after a successful finish', async () => {
    const restore = await prepare()
    const { companionRestorePending } = await import('./restore-state')
    expect(get(companionRestorePending)).toBe(true)
    await unlock()
    expect(get(companionRestorePending)).toBe(true)
    await restore.finishTvRestore()
    expect(get(companionRestorePending)).toBe(false)
    vi.resetModules()
    expect(get((await import('./restore-state')).companionRestorePending)).toBe(false)
  })

  it('fails closed for a corrupt or inconsistent unfinished journal', async () => {
    localStorage.setItem('companion-client-restore-v1', 'corrupt')
    expect(get((await import('./restore-state')).companionRestorePending)).toBe(true)
    localStorage.setItem('companion-client-restore-v1', JSON.stringify({ v: 1, stage: 'linked', recoverySeedPending: true }))
    vi.resetModules()
    expect(get((await import('./restore-state')).companionRestorePending)).toBe(true)
  })
})

describe('restore staging and profile isolation', () => {
  it.each([
    { screens: ['tmdb'], defaultScreen: 'tmdb', expectedProviders: ['tmdb'], expectedScreen: 'tmdb' },
    { screens: [], defaultScreen: 'tmdb', expectedProviders: ['tmdb'], expectedScreen: 'tmdb' },
    { screens: ['auto'], defaultScreen: 'tmdb', expectedProviders: ['auto', 'tmdb'], expectedScreen: 'tmdb' },
    { screens: ['unknown', 'tmdb', 'tmdb'], defaultScreen: 'unknown', expectedProviders: ['tmdb'], expectedScreen: 'tmdb' },
    { screens: ['auto', 'tmdb', 'merged'], defaultScreen: 'merged', expectedProviders: ['auto', 'tmdb'], expectedScreen: 'merged' },
    { screens: ['auto', 'anilist', 'merged'], defaultScreen: 'merged', expectedProviders: ['auto', 'anilist'], expectedScreen: 'auto' },
  ])('restores validated catalog providers and startup selection: %j', async ({ screens, defaultScreen, expectedProviders, expectedScreen }) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(await fixture({
      profile: { ...profile, catalog: { ...profile.catalog!, screens, defaultScreen } },
    }))))
    const restore = await import('./restore')
    await restore.linkAndRestoreTv(endpoint, code, 'Laptop')
    await restore.prepareRestoreProfiles()
    const catalog = await import('$lib/settings/catalog')
    expect(get(catalog.catalogProviders)).toEqual(expectedProviders)
    expect(get(catalog.catalogDefaultProvider)).toBe(expectedScreen)
    expect(get(catalog.catalogScreen)).toBe(expectedScreen)
    expect(get(catalog.catalogLastScreen)).toBe(expectedScreen)
    if (expectedScreen === 'tmdb') expect(get(catalog.catalogProvider)).toBe('tmdb')
    expect(catalog.resolveCatalogScreenStartup(get(catalog.catalogDefaultProvider), get(catalog.catalogLastScreen), get(catalog.catalogProviders))).toBe(expectedScreen)
  })

  it('keeps restored collections in the real shared store across profile selection and module reload', async () => {
    const restore = await prepare()
    const collections = await import('$lib/catalog/collections/store')
    expect(get(collections.homeCollections)).toEqual(profile.collections)
    const profiles = await import('$lib/profiles/store')
    profiles.activeProfileId.set('child')
    await unlock()
    await restore.finishTvRestore()
    vi.resetModules()
    const reloaded = await import('$lib/catalog/collections/store')
    expect(get(reloaded.homeCollections)).toEqual(profile.collections)
    expect(observations.writes.filter(key => key.includes('catalog-collections'))).toEqual(['catalog-collections-v1'])
  })

  it('applies the complete TV setup and PIN household before config/provider, with no progress import', async () => {
    const restore = await prepare()
    const cf = await import('$lib/sync/cloudflare')
    const sync = await import('$lib/sync/client')
    const companion = await import('./client')
    const ui = await import('$lib/settings/ui')
    const catalog = await import('$lib/settings/catalog')
    const sources = await import('$lib/stremio/sources')
    const profiles = await import('$lib/profiles/store')
    expect(get(ui.debridKey)).toBe('saved-secret')
    expect(get(ui.preferredQuality)).toBe('1080')
    expect(get(ui.preferredAudioLang)).toBe('jpn')
    expect(get(ui.preferredStreamSort)).toBe('size')
    expect(get(catalog.catalogScreen)).toBe('merged')
    expect(get(catalog.tmdbReadToken)).toBe('catalog-secret')
    expect(get(sources.addonUrls)).toEqual(['https://sources.example.com/config'])
    expect(get(sources.disabledSources)).toEqual([])
    expect(get(profiles.profiles)[0].pin).toEqual(pin)
    expect(get(profiles.profileSwitcherOpen)).toBe(true)
    expect(get(cf.cloudflareSyncConfig).groupKey).toBe(key(3))
    expect(observations.writes.slice(-3)).toEqual(['cloudflare-sync-config-v1', 'sync-provider-v1', 'onboarding-complete-v1'])
    expect(get((await import('$lib/settings/onboarding')).onboardingComplete)).toBe(true)
    expect(sync.pullWatchProgress).not.toHaveBeenCalled()
    expect(sync.listManualDevices).not.toHaveBeenCalled()
    expect(companion.syncCompanionProgress).not.toHaveBeenCalled()
    expect(restore.pendingTvRestore()?.stage).toBe('profile')
    await expect(restore.finishTvRestore()).rejects.toThrow('Select and unlock')
  })

  it('will not import for a locked profile or an open picker', async () => {
    const restore = await prepare()
    await unlock(); await restore.finishTvRestore()
    const profiles = await import('$lib/profiles/store')
    ;(profiles.activeProfileLocked as unknown as { set(value: boolean): void }).set(true)
    await expect(restore.restoreTvProgress()).rejects.toThrow('Select and unlock')
    await expect(restore.listTvRestoreSetups()).rejects.toThrow('Select and unlock')
    expect((await import('$lib/sync/client')).pullWatchProgress).not.toHaveBeenCalled()
  })

  it('keeps a completed pairing after progress failure and retries without reclaiming', async () => {
    const restore = await prepare()
    await unlock(); await restore.finishTvRestore()
    const companion = await import('./client')
    vi.mocked(companion.syncCompanionProgress).mockRejectedValueOnce(new Error('TV offline'))
    await expect(restore.restoreTvProgress()).rejects.toThrow('TV offline')
    expect(restore.pendingTvRestore()?.stage).toBe('linked')
    expect(get((await import('$lib/sync/cloudflare')).cloudflareSyncConfig).groupKey).toBe(key(3))
    await restore.restoreTvProgress()
    expect(restore.pendingTvRestore()?.progressRestored).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('runs only TV progress in legacy mode and never reads incompatible group records', async () => {
    const restore = await prepare(true)
    await unlock(); await restore.finishTvRestore(); await restore.restoreTvProgress()
    const sync = await import('$lib/sync/client')
    expect(get(sync.cloudflareSyncConfig)).toMatchObject({ enabled: false, groupKey: '' })
    expect(get(sync.syncProvider)).toBe('cloudflare')
    expect(sync.pullWatchProgress).not.toHaveBeenCalled()
    expect((await import('./client')).syncCompanionProgress).toHaveBeenCalledTimes(1)
    expect(await restore.listTvRestoreSetups()).toEqual([])
    expect(sync.listManualDevices).not.toHaveBeenCalled()
  })

  it('lists and imports only manually selected snapshots matching the unlocked active profile', async () => {
    const restore = await prepare()
    await unlock(); await restore.finishTvRestore()
    const sync = await import('$lib/sync/client')
    const snapshot = (deviceId: string, profileId?: string, isThisDevice = false) => ({ deviceId, profileId, isThisDevice }) as ManualDevice
    const own = snapshot('own', 'default', true), other = snapshot('other', 'child'), legacy = snapshot('legacy'), matching = snapshot('matching', 'default')
    vi.mocked(sync.listManualDevices).mockResolvedValue([own, other, legacy, matching])
    expect(await restore.listTvRestoreSetups()).toEqual([legacy, matching])
    expect(sync.receiveManualSnapshot).not.toHaveBeenCalled()
    await expect(restore.restoreTvSetup(other)).rejects.toThrow('active profile')
    await restore.restoreTvSetup(matching)
    expect(sync.receiveManualSnapshot).toHaveBeenCalledExactlyOnceWith(matching)
  })

  it('aborts follow-on imports if the profile changes during a shared watch pull', async () => {
    const restore = await prepare()
    await unlock(); await restore.finishTvRestore()
    const profiles = await import('$lib/profiles/store')
    vi.mocked((await import('$lib/sync/client')).pullWatchProgress).mockImplementationOnce(async () => { profiles.activeProfileId.set('child'); return 0 })
    await expect(restore.restoreTvProgress()).rejects.toThrow('Select and unlock')
    expect((await import('./client')).syncCompanionProgress).not.toHaveBeenCalled()
  })

  it('requires the original restored PIN protection and connection to remain intact', async () => {
    const restore = await prepare()
    await unlock(); await restore.finishTvRestore()
    const { persisted } = await import('svelte-persisted-store')
    persisted('izumi-profiles-v1', {}).set({ profiles: [{ ...profile.household!.profiles[0], pin: undefined }] })
    await expect(restore.restoreTvProgress()).rejects.toThrow('protection changed')
    const cf = await import('$lib/sync/cloudflare')
    cf.cloudflareSyncConfig.update(config => ({ ...config, endpoint: 'https://different.example.com' }))
    await expect(restore.listTvRestoreSetups()).rejects.toThrow('connection changed')
  })
})

describe('restore entry points', () => {
  it('offers restore under the TV tab before any configured-sync condition', () => {
    const page = readFileSync(new URL('../../routes/app/settings/sync/+page.svelte', import.meta.url), 'utf8')
    const tvTab = page.slice(page.indexOf("{#if syncSection === 'tv'}"))
    expect(tvTab.indexOf('href="/app/companion-restore"')).toBeGreaterThan(0)
    expect(tvTab.indexOf('href="/app/companion-restore"')).toBeLessThan(tvTab.indexOf("{#if $syncProvider === 'cloudflare' && paired}"))
  })

  it('requires deliberate consent and uses the existing profile overlay, without claiming on mount', () => {
    const page = readFileSync(new URL('../../routes/app/companion-restore/+page.svelte', import.meta.url), 'utf8')
    expect(page).toContain('Link and restore')
    expect(page).toContain('profileSwitcherOpen.set(true)')
    const mount = page.slice(page.indexOf('onMount(() =>'), page.indexOf('</script>'))
    expect(mount).not.toContain('linkAndRestoreTv(')
    expect(mount).not.toContain('restoreTvProgress(')
    expect(page).toContain('Account logins that were not synced')
    expect(page).toContain('Settings → Connection → Link phone or desktop')
    expect(page).toContain('with your phone’s camera')
    const layout = readFileSync(new URL('../../routes/app/+layout.svelte', import.meta.url), 'utf8')
    expect(layout).toContain("{#if !$onboardingComplete && page.url.pathname !== '/app/companion-restore'}<Lazy load={loadFirstRunSetup} />{/if}")
  })
})
