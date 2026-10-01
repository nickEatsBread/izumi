import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'
import { contentRatingAge, profileAllowsMedia } from './content'
import { DEFAULT_PROFILE_ID, profileStorageKey, normalizeProfileState, type IzumiProfile, type ProfileState } from './store'

const child: IzumiProfile = {
  id: 'child', name: 'Mina', color: '#457b9d', createdAt: 1, ratingLimit: 12, allowAdult: false,
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

type StoreModule = typeof import('./store')

/** A new module instance, as after an app restart. The PIN throttle reads the stubbed localStorage,
 *  which survives; the household is a persisted store (memory-only in the node environment). */
async function freshStore(): Promise<StoreModule> {
  vi.resetModules()
  return import('./store')
}

/** The main profile plus a child, with optional PINs. Lookups are live: setProfilePin replaces records. */
async function household(store: StoreModule, pins: { main?: string; child?: string } = {}) {
  const childId = store.createProfile({ name: 'Mina', color: '#457b9d', ratingLimit: 12, allowAdult: false, avatar: 'fox' })
  if (pins.main) await store.setProfilePin(store.DEFAULT_PROFILE_ID, pins.main)
  if (pins.child) await store.setProfilePin(childId, pins.child)
  const find = (id: string) => get(store.profiles).find((profile) => profile.id === id)!
  return { childId, main: () => find(store.DEFAULT_PROFILE_ID), child: () => find(childId) }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  // svelte-persisted-store keeps one registry entry per key and, as an external dependency, can outlive
  // vi.resetModules: put the household and the active profile back by key before every test.
  persisted<ProfileState>('izumi-profiles-v1', { profiles: [] }).set({ profiles: [], enabled: false })
  persisted<string>('izumi-active-profile-v1', DEFAULT_PROFILE_ID).set(DEFAULT_PROFILE_ID)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('profile storage and parental policy', () => {
  it('leaves untouched installs opted out but preserves configured households', () => {
    expect(normalizeProfileState({}).enabled).toBe(false)
    expect(normalizeProfileState({ profiles: [child] }).enabled).toBe(true)
    expect(normalizeProfileState({ profiles: [child], enabled: false }).enabled).toBe(false)
  })
  it('keeps the original profile on legacy keys and partitions additional profiles', () => {
    expect(profileStorageKey('local-history', DEFAULT_PROFILE_ID)).toBe('local-history')
    expect(profileStorageKey('local-history', 'child')).toBe('izumi-profile:child:local-history')
  })

  it('normalizes common cinema, television and anime content ratings', () => {
    expect(contentRatingAge('PG-13')).toBe(12)
    expect(contentRatingAge('TV-MA')).toBe(18)
    expect(contentRatingAge('R - 17+ (violence & profanity)')).toBe(16)
    expect(contentRatingAge('TV-Y7')).toBe(7)
  })

  it('blocks adult and over-limit media without hiding unrated family content', () => {
    expect(profileAllowsMedia({ isAdult: true }, child)).toBe(false)
    expect(profileAllowsMedia({ contentRating: 'TV-MA' }, child)).toBe(false)
    expect(profileAllowsMedia({ contentRating: 'PG' }, child)).toBe(true)
    expect(profileAllowsMedia({}, child)).toBe(true)
  })
})

describe('restricted household detection', () => {
  const pinnedMain: IzumiProfile = {
    id: DEFAULT_PROFILE_ID, name: 'Main profile', color: '#ef476f', createdAt: 0, ratingLimit: 18, allowAdult: true,
    pin: { salt: 'a'.repeat(32), hash: 'b'.repeat(64) },
  }
  const openMain: IzumiProfile = { ...pinnedMain, pin: undefined }

  it('applies only to a non-main profile while profiles are on and the main profile has a PIN', async () => {
    const store = await freshStore()
    expect(store.householdLockApplies({ profiles: [pinnedMain, child], enabled: true }, 'child')).toBe(true)
    expect(store.householdLockApplies({ profiles: [pinnedMain, child], enabled: true }, DEFAULT_PROFILE_ID)).toBe(false)
    // A child's own PIN does not make the household restricted: only the main profile's PIN does.
    expect(store.householdLockApplies({ profiles: [openMain, { ...child, pin: pinnedMain.pin }], enabled: true }, 'child')).toBe(false)
    expect(store.householdLockApplies({ profiles: [pinnedMain, child], enabled: false }, 'child')).toBe(false)
    expect(store.householdLockApplies({ profiles: [pinnedMain, child] }, 'child')).toBe(false)
  })

  it('follows the household and the active profile', async () => {
    const store = await freshStore()
    expect(get(store.householdLocked)).toBe(false)
    const { childId } = await household(store, { main: '2468' })
    expect(get(store.householdLocked)).toBe(false)
    store.activeProfileId.set(childId)
    expect(get(store.householdLocked)).toBe(true)
    await store.setProfilePin(store.DEFAULT_PROFILE_ID, null)
    expect(get(store.householdLocked)).toBe(false)
  })
})

describe('shared PIN throttle', () => {
  const T = Date.UTC(2026, 8, 30, 12)

  it('grants five free misses, then locks for 30 s doubling to 5 min', async () => {
    const store = await freshStore()
    expect([0, 1, 5].map(store.pinLockoutMs)).toEqual([0, 0, 0])
    expect([6, 7, 8, 9, 10, 50].map(store.pinLockoutMs)).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000])
    expect(store.pinLockoutMs(Number.NaN)).toBe(0)
    expect([store.PIN_FREE_MISSES, store.PIN_LOCKOUT_BASE_MS, store.PIN_LOCKOUT_MAX_MS]).toEqual([5, 30_000, 300_000])
  })

  it('refuses every PIN while locked and counts only real misses', async () => {
    const store = await freshStore()
    const { main } = await household(store, { main: '2468' })
    for (let miss = 1; miss <= 5; miss++) {
      expect(await store.verifyPinThrottled(main(), '1111', T)).toEqual({ ok: false, reason: 'mismatch' })
    }
    expect(store.readPinThrottle()).toEqual({ misses: 5, lockedUntil: 0 })
    expect(await store.verifyPinThrottled(main(), '1111', T)).toEqual({ ok: false, reason: 'mismatch' })
    expect(store.readPinThrottle()).toEqual({ misses: 6, lockedUntil: T + 30_000 })
    expect(get(store.pinThrottle)).toEqual({ misses: 6, lockedUntil: T + 30_000 })
    expect(store.pinLockedUntil(T + 29_999)).toBe(T + 30_000)
    expect(store.pinLockedUntil(T + 30_000)).toBe(0)
    expect(await store.verifyPinThrottled(main(), '2468', T + 29_999)).toEqual({ ok: false, reason: 'throttled', retryAt: T + 30_000 })
    expect(store.readPinThrottle().misses).toBe(6)
    expect(await store.verifyPinThrottled(main(), '1111', T + 30_000)).toEqual({ ok: false, reason: 'mismatch' })
    expect(store.readPinThrottle()).toEqual({ misses: 7, lockedUntil: T + 90_000 })
  })

  it('clears a profile’s misses when its PIN is entered correctly', async () => {
    const store = await freshStore()
    const { main } = await household(store, { main: '2468' })
    for (let miss = 1; miss <= 3; miss++) await store.verifyPinThrottled(main(), '1111', T)
    expect(store.readPinThrottle().misses).toBe(3)
    expect(await store.verifyPinThrottled(main(), '2468', T)).toEqual({ ok: true })
    expect(store.readPinThrottle()).toEqual({ misses: 0, lockedUntil: 0 })
    expect(localStorage.getItem(store.PIN_THROTTLE_KEY)).toBeNull()
  })

  it('never lets a correct PIN for one profile clear the misses made against another', async () => {
    const store = await freshStore()
    const { main, child } = await household(store, { main: '2468', child: '1357' })
    for (let miss = 1; miss <= 5; miss++) await store.verifyPinThrottled(main(), '0000', T)
    expect(await store.verifyPinThrottled(child(), '1357', T)).toEqual({ ok: true })
    expect(store.readPinThrottle().misses).toBe(5)
    expect(await store.verifyPinThrottled(main(), '0000', T + 1)).toEqual({ ok: false, reason: 'mismatch' })
    expect(store.readPinThrottle().lockedUntil).toBe(T + 30_001)
    // The lock is shared: while it lasts the child's own PIN waits too.
    expect(await store.verifyPinThrottled(child(), '1357', T + 2)).toEqual({ ok: false, reason: 'throttled', retryAt: T + 30_001 })
  })

  it('lets a profile without a PIN through, even while locked', async () => {
    const store = await freshStore()
    const { main, child } = await household(store, { main: '2468' })
    expect(await store.verifyPinThrottled(child(), '', T)).toEqual({ ok: true })
    expect(localStorage.getItem(store.PIN_THROTTLE_KEY)).toBeNull()
    for (let miss = 1; miss <= 6; miss++) await store.verifyPinThrottled(main(), '0000', T)
    expect(await store.verifyPinThrottled(child(), '', T + 1)).toEqual({ ok: true })
    expect(store.readPinThrottle()).toEqual({ misses: 6, lockedUntil: T + 30_000 })
  })

  it('does not charge a try for an entry that cannot be a PIN', async () => {
    const store = await freshStore()
    const { main } = await household(store, { main: '2468' })
    for (const entry of ['', '12', 'abcd', '1234567']) {
      expect(await store.verifyPinThrottled(main(), entry, T)).toEqual({ ok: false, reason: 'mismatch' })
    }
    expect(store.readPinThrottle()).toEqual({ misses: 0, lockedUntil: 0 })
  })

  it('never makes anyone wait more than 5 min, even for a lock stored further ahead', async () => {
    const store = await freshStore()
    const { main } = await household(store, { main: '2468' })
    // A lock set before the clock moved back, or a damaged record, can end a day or more ahead.
    localStorage.setItem(store.PIN_THROTTLE_KEY, JSON.stringify({ lockedUntil: T + 86_400_000, targets: { default: 6 } }))
    expect(await store.verifyPinThrottled(main(), '2468', T)).toEqual({ ok: false, reason: 'throttled', retryAt: T + 300_000 })
    // The cap is stored the first time the lock is seen, so it does not move with the clock.
    expect(store.readPinThrottle()).toEqual({ misses: 6, lockedUntil: T + 300_000 })
    expect(await store.verifyPinThrottled(main(), '2468', T + 299_999)).toEqual({ ok: false, reason: 'throttled', retryAt: T + 300_000 })
    expect(await store.verifyPinThrottled(main(), '2468', T + 300_000)).toEqual({ ok: true })
    expect(store.readPinThrottle()).toEqual({ misses: 0, lockedUntil: 0 })
    expect(store.pinLockedUntil(T + 300_000)).toBe(0)
  })

  it('keeps the lock across a restart', async () => {
    const store = await freshStore()
    const { main } = await household(store, { main: '2468' })
    for (let miss = 1; miss <= 6; miss++) await store.verifyPinThrottled(main(), '0000', T)
    const restarted = await freshStore()
    expect(restarted.readPinThrottle()).toEqual({ misses: 6, lockedUntil: T + 30_000 })
    expect(get(restarted.pinThrottle)).toEqual({ misses: 6, lockedUntil: T + 30_000 })
    await restarted.setProfilePin(restarted.DEFAULT_PROFILE_ID, '2468')
    const again = get(restarted.profiles).find((profile) => profile.id === restarted.DEFAULT_PROFILE_ID)!
    expect(await restarted.verifyPinThrottled(again, '2468', T + 10)).toEqual({ ok: false, reason: 'throttled', retryAt: T + 30_000 })
  })

  it('treats a damaged record as clean', async () => {
    localStorage.setItem('izumi-pin-throttle-v1', '{not json')
    const store = await freshStore()
    expect(store.readPinThrottle()).toEqual({ misses: 0, lockedUntil: 0 })
    localStorage.setItem(store.PIN_THROTTLE_KEY, JSON.stringify({ lockedUntil: 'soon', targets: { default: -3, '../main': 9, child: 2.5 } }))
    expect(store.readPinThrottle()).toEqual({ misses: 0, lockedUntil: 0 })
  })

  it('still throttles for the session when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', undefined)
    const store = await freshStore()
    const { main } = await household(store, { main: '2468' })
    for (let miss = 1; miss <= 6; miss++) await store.verifyPinThrottled(main(), '0000', T)
    expect(await store.verifyPinThrottled(main(), '2468', T + 1)).toEqual({ ok: false, reason: 'throttled', retryAt: T + 30_000 })
  })

  it('stores the throttle under a device key, so backups never carry or clear it', async () => {
    const store = await freshStore()
    const { classifyStorageKey } = await import('$lib/storage/key-policy')
    expect(store.PIN_THROTTLE_KEY).toBe('izumi-pin-throttle-v1')
    expect(classifyStorageKey(store.PIN_THROTTLE_KEY)).toBe('device')
  })
})

describe('PIN misses follow the PIN', () => {
  const T = Date.UTC(2026, 8, 30, 12)

  it('forgets a profile’s misses once its PIN is replaced or removed, or the profile is deleted', async () => {
    const store = await freshStore()
    const { childId, main, child } = await household(store, { main: '2468', child: '1357' })
    const targets = () => JSON.parse(localStorage.getItem(store.PIN_THROTTLE_KEY) ?? '{"targets":{}}').targets
    await store.verifyPinThrottled(main(), '0000', T)
    for (let miss = 1; miss <= 3; miss++) await store.verifyPinThrottled(child(), '0000', T)
    expect(targets()).toEqual({ default: 1, [childId]: 3 })
    await store.setProfilePin(childId, '9999')
    expect(targets()).toEqual({ default: 1 })
    expect(store.readPinThrottle()).toEqual({ misses: 1, lockedUntil: 0 })
    await store.verifyPinThrottled(child(), '0000', T)
    await store.setProfilePin(childId, null)
    expect(targets()).toEqual({ default: 1 })
    // A count left for a profile without a PIN (written by an older build, say) goes with the profile.
    localStorage.setItem(store.PIN_THROTTLE_KEY, JSON.stringify({ lockedUntil: 0, targets: { default: 1, [childId]: 2 } }))
    expect(await store.deleteProfile(childId)).toBe(true)
    expect(targets()).toEqual({ default: 1 })
  })
})

describe('PIN lock countdown', () => {
  const T = Date.UTC(2026, 8, 30, 12)

  it('words the wait in seconds and minutes', async () => {
    const store = await freshStore()
    expect(store.pinThrottleMessage(0)).toBe('')
    expect(store.pinThrottleMessage(-4)).toBe('')
    expect(store.pinThrottleMessage(30)).toBe('Too many wrong PINs. Try again in 30 s.')
    expect(store.pinThrottleMessage(60)).toBe('Too many wrong PINs. Try again in 1 min.')
    expect(store.pinThrottleMessage(90)).toBe('Too many wrong PINs. Try again in 1 min 30 s.')
    expect(store.pinThrottleMessage(300)).toBe('Too many wrong PINs. Try again in 5 min.')
  })

  it('ticks down once a second and stops at zero', async () => {
    const store = await freshStore()
    const { main } = await household(store, { main: '2468' })
    for (let miss = 1; miss <= 6; miss++) await store.verifyPinThrottled(main(), '0000', T)
    vi.useFakeTimers()
    vi.setSystemTime(T)
    const seen: number[] = []
    const stop = store.pinLockSeconds.subscribe((seconds) => { seen.push(seconds) })
    expect(seen.at(-1)).toBe(30)
    vi.advanceTimersByTime(1_000)
    expect(seen.at(-1)).toBe(29)
    vi.advanceTimersByTime(29_000)
    expect(seen.at(-1)).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })

  it('counts down from at most 5 min when the stored lock ends further ahead', async () => {
    const store = await freshStore()
    localStorage.setItem(store.PIN_THROTTLE_KEY, JSON.stringify({ lockedUntil: T + 86_400_000, targets: { default: 6 } }))
    vi.useFakeTimers()
    vi.setSystemTime(T)
    const seen: number[] = []
    const stop = store.pinLockSeconds.subscribe((seconds) => { seen.push(seconds) })
    expect(seen.at(-1)).toBe(300)
    // The cap is stored as soon as the countdown sees the lock, so PIN entry opens when it reaches 0.
    expect(store.readPinThrottle()).toEqual({ misses: 6, lockedUntil: T + 300_000 })
    vi.advanceTimersByTime(300_000)
    expect(seen.at(-1)).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(store.pinLockedUntil()).toBe(0)
    stop()
  })

  it('stays at zero without a timer when nothing is locked', async () => {
    const store = await freshStore()
    vi.useFakeTimers()
    vi.setSystemTime(T)
    const seen: number[] = []
    const stop = store.pinLockSeconds.subscribe((seconds) => { seen.push(seconds) })
    expect(seen).toEqual([0])
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })
})

describe('PIN entry points share the throttle', () => {
  const T = Date.UTC(2026, 8, 30, 12)

  it('activate, unlock, delete and disable count misses and refuse even the right PIN while locked', async () => {
    const store = await freshStore()
    const { childId } = await household(store, { main: '2468', child: '1357' })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T)
    expect(await store.disableProfiles('0000')).toBe(false)
    for (let miss = 2; miss <= 5; miss++) expect(await store.activateProfile(store.DEFAULT_PROFILE_ID, '0000')).toBe(false)
    expect(await store.deleteProfile(childId, '0000')).toBe(false)
    expect(store.readPinThrottle()).toEqual({ misses: 5, lockedUntil: 0 })
    expect(await store.unlockActiveProfile('0000')).toBe(false)
    expect(store.readPinThrottle()).toEqual({ misses: 6, lockedUntil: T + 30_000 })

    expect(await store.unlockActiveProfile('2468')).toBe(false)
    expect(await store.disableProfiles('2468')).toBe(false)
    expect(await store.activateProfile(childId, '1357')).toBe(false)
    expect(await store.deleteProfile(childId, '1357')).toBe(false)
    expect(get(store.profiles).some((profile) => profile.id === childId)).toBe(true)
    expect(get(store.activeProfileId)).toBe(store.DEFAULT_PROFILE_ID)
    expect(store.readPinThrottle()).toEqual({ misses: 6, lockedUntil: T + 30_000 })

    clock.mockReturnValue(T + 30_000)
    expect(await store.activateProfile(childId, '1357')).toBe(true)
    expect(get(store.activeProfileId)).toBe(childId)
    // The child's own PIN cleared only the child's miss; the misses against the main PIN remain.
    expect(store.readPinThrottle().misses).toBe(6)
  })

  it('never throttles switching to a profile without a PIN', async () => {
    const store = await freshStore()
    const { childId } = await household(store, { main: '2468' })
    vi.spyOn(Date, 'now').mockReturnValue(T)
    for (let miss = 1; miss <= 6; miss++) expect(await store.disableProfiles('0000')).toBe(false)
    expect(store.readPinThrottle()).toEqual({ misses: 6, lockedUntil: T + 30_000 })
    expect(await store.activateProfile(childId)).toBe(true)
    expect(get(store.activeProfileId)).toBe(childId)
  })
})
