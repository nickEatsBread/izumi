import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get, writable, type Writable } from 'svelte/store'
import type { IzumiProfile, PinThrottleState, PinVerdict } from '$lib/profiles/store'

// The household gate (spec §6.5): restricted profiles need the main profile's PIN for household
// actions; unrestricted households are never asked. The profile store (commit 15) is mocked, so the
// lock, the PIN check and the throttle are driven directly. The lock end comes only from
// pinLockedUntil (commit 15 caps it at 5 min); readPinThrottle is mocked to prove the gate never
// reads the stored, uncapped end. No test here assumes a right PIN clears the throttle: commit 15
// counts misses per profile and never lifts a running lock.

const mocks = vi.hoisted(() => ({
  main: {
    id: 'default', name: 'Main profile', color: '#ef476f', createdAt: 0, ratingLimit: 18, allowAdult: true,
    pin: { salt: 'salt', hash: 'hash' },
  } as IzumiProfile,
  householdLocked: null as unknown as Writable<boolean>,
  verifyPinThrottled: vi.fn<(profile: IzumiProfile, pin: string) => Promise<PinVerdict>>(),
  pinLockedUntil: vi.fn<(now?: number) => number>(),
  readPinThrottle: vi.fn<() => PinThrottleState>(),
}))
vi.mock('$lib/profiles/store', () => {
  mocks.householdLocked = writable(false)
  return {
    DEFAULT_PROFILE_ID: 'default',
    householdLocked: mocks.householdLocked,
    profiles: writable([mocks.main]),
    verifyPinThrottled: mocks.verifyPinThrottled,
    pinLockedUntil: mocks.pinLockedUntil,
    readPinThrottle: mocks.readPinThrottle,
  }
})

import {
  ADULT_SOURCES_LOCKED_MESSAGE,
  HOUSEHOLD_ACTION_TITLES,
  HOUSEHOLD_GRANT_MS,
  HOUSEHOLD_KEYPAD,
  HouseholdLockedError,
  adultSourcesAllowed,
  adultSourcesPermitted,
  adultSourcesUnlocked,
  assertHouseholdAction,
  authorizeHousehold,
  cancelHouseholdPrompt,
  householdPrompt,
  lockAdultSources,
  pinAfterKey,
  requestAdultSources,
  resetHouseholdGateForTests,
  submitHouseholdPin,
  type HouseholdAction,
} from './household-gate'

const NOW = 1_800_000_000_000

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve()
}

function isSettled(promise: Promise<unknown>): () => boolean {
  let settled = false
  void promise.then(() => { settled = true })
  return () => settled
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  resetHouseholdGateForTests()
  mocks.householdLocked.set(false)
  mocks.verifyPinThrottled.mockReset().mockResolvedValue({ ok: true })
  mocks.pinLockedUntil.mockReset().mockReturnValue(0)
  mocks.readPinThrottle.mockReset().mockReturnValue({ misses: 0, lockedUntil: 0 })
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('household gate, unrestricted households', () => {
  it('grants at once, without a prompt or a PIN check', async () => {
    await expect(authorizeHousehold('backup-export')).resolves.toBe(true)
    expect(get(householdPrompt)).toBeNull()
    expect(mocks.verifyPinThrottled).not.toHaveBeenCalled()
    expect(() => assertHouseholdAction('backup-export')).not.toThrow()
    expect(() => assertHouseholdAction('factory-reset')).not.toThrow()
  })

  it('allows 18+ sources without asking', async () => {
    expect(get(adultSourcesAllowed)).toBe(true)
    expect(adultSourcesPermitted()).toBe(true)
    await expect(requestAdultSources()).resolves.toBe(true)
    expect(get(householdPrompt)).toBeNull()
  })
})

describe('household gate, restricted profiles', () => {
  beforeEach(() => {
    mocks.householdLocked.set(true)
  })

  it('refuses a gated function that was not authorized', () => {
    for (const action of ['factory-reset', 'backup-export', 'backup-restore', 'send-setup'] as const) {
      let error: unknown
      try { assertHouseholdAction(action) } catch (cause) { error = cause }
      expect(error).toBeInstanceOf(HouseholdLockedError)
      expect((error as HouseholdLockedError).action).toBe(action)
      expect((error as HouseholdLockedError).message).toBe('Enter the main profile PIN first.')
    }
  })

  it('opens the prompt and resolves true once the main PIN matches', async () => {
    const granted = authorizeHousehold('factory-reset')
    expect(get(householdPrompt)).toEqual({ action: 'factory-reset', busy: false, error: '', retryAt: 0 })
    await expect(submitHouseholdPin('1234')).resolves.toBe(true)
    expect(mocks.verifyPinThrottled).toHaveBeenCalledWith(mocks.main, '1234')
    await expect(granted).resolves.toBe(true)
    expect(get(householdPrompt)).toBeNull()
  })

  it('grants exactly one call of exactly that action', async () => {
    const granted = authorizeHousehold('backup-export')
    await submitHouseholdPin('1234')
    await granted
    expect(() => assertHouseholdAction('backup-restore')).toThrow(HouseholdLockedError)
    expect(() => assertHouseholdAction('backup-export')).not.toThrow()
    expect(() => assertHouseholdAction('backup-export')).toThrow(HouseholdLockedError)
  })

  it('lets an unused grant lapse after a minute', async () => {
    const first = authorizeHousehold('send-setup')
    await submitHouseholdPin('1234')
    await first
    vi.mocked(Date.now).mockReturnValue(NOW + HOUSEHOLD_GRANT_MS)
    expect(() => assertHouseholdAction('send-setup')).not.toThrow()
    vi.mocked(Date.now).mockReturnValue(NOW)
    const second = authorizeHousehold('send-setup')
    await submitHouseholdPin('1234')
    await second
    vi.mocked(Date.now).mockReturnValue(NOW + HOUSEHOLD_GRANT_MS + 1)
    expect(() => assertHouseholdAction('send-setup')).toThrow(HouseholdLockedError)
  })

  it('shares one prompt per action and turns a different action away', async () => {
    const first = authorizeHousehold('backup-export')
    expect(authorizeHousehold('backup-export')).toBe(first)
    await expect(authorizeHousehold('send-setup')).resolves.toBe(false)
    expect(get(householdPrompt)?.action).toBe('backup-export')
    cancelHouseholdPrompt()
    await expect(first).resolves.toBe(false)
  })

  it('keeps the prompt open after a wrong PIN and says so', async () => {
    mocks.verifyPinThrottled.mockResolvedValue({ ok: false, reason: 'mismatch' })
    const granted = authorizeHousehold('backup-restore')
    const settled = isSettled(granted)
    await expect(submitHouseholdPin('0000')).resolves.toBe(false)
    await flushMicrotasks()
    expect(settled()).toBe(false)
    expect(get(householdPrompt)).toEqual({ action: 'backup-restore', busy: false, error: 'Wrong PIN. Try again.', retryAt: 0 })
    expect(() => assertHouseholdAction('backup-restore')).toThrow(HouseholdLockedError)
  })

  it('shows the lockout a wrong PIN started', async () => {
    void authorizeHousehold('factory-reset')
    mocks.verifyPinThrottled.mockResolvedValue({ ok: false, reason: 'mismatch' })
    mocks.pinLockedUntil.mockReturnValue(NOW + 30_000)
    await submitHouseholdPin('0000')
    expect(get(householdPrompt)).toEqual({ action: 'factory-reset', busy: false, error: 'Wrong PIN. Try again.', retryAt: NOW + 30_000 })
  })

  it('shows a lockout the shared throttle reports', async () => {
    void authorizeHousehold('send-setup')
    mocks.verifyPinThrottled.mockResolvedValue({ ok: false, reason: 'throttled', retryAt: NOW + 60_000 })
    await expect(submitHouseholdPin('1234')).resolves.toBe(false)
    expect(get(householdPrompt)).toEqual({ action: 'send-setup', busy: false, error: '', retryAt: NOW + 60_000 })
  })

  it('shows a running lockout as soon as the prompt opens, and none once it has ended', () => {
    mocks.pinLockedUntil.mockReturnValue(NOW + 45_000)
    void authorizeHousehold('backup-export')
    expect(get(householdPrompt)?.retryAt).toBe(NOW + 45_000)
    cancelHouseholdPrompt()
    mocks.pinLockedUntil.mockReturnValue(0)
    void authorizeHousehold('backup-export')
    expect(get(householdPrompt)?.retryAt).toBe(0)
  })

  it('takes the lock end from pinLockedUntil (at most 5 min away), never from the stored record', async () => {
    // A lock stored a day ahead (the clock moved back, or a damaged record) must not show hours.
    mocks.readPinThrottle.mockReturnValue({ misses: 6, lockedUntil: NOW + 86_400_000 })
    mocks.pinLockedUntil.mockReturnValue(NOW + 300_000)
    void authorizeHousehold('factory-reset')
    expect(get(householdPrompt)?.retryAt).toBe(NOW + 300_000)
    mocks.verifyPinThrottled.mockResolvedValue({ ok: false, reason: 'mismatch' })
    await submitHouseholdPin('0000')
    expect(get(householdPrompt)?.retryAt).toBe(NOW + 300_000)
    expect(mocks.pinLockedUntil).toHaveBeenCalledTimes(2)
    expect(mocks.readPinThrottle).not.toHaveBeenCalled()
  })

  it('cancelling resolves false and grants nothing', async () => {
    const granted = authorizeHousehold('factory-reset')
    cancelHouseholdPrompt()
    await expect(granted).resolves.toBe(false)
    expect(get(householdPrompt)).toBeNull()
    expect(() => assertHouseholdAction('factory-reset')).toThrow(HouseholdLockedError)
  })

  it('grants nothing when the prompt was cancelled during the PIN check', async () => {
    const check = deferred<PinVerdict>()
    mocks.verifyPinThrottled.mockReturnValue(check.promise)
    const granted = authorizeHousehold('backup-export')
    const submitted = submitHouseholdPin('1234')
    expect(get(householdPrompt)?.busy).toBe(true)
    cancelHouseholdPrompt()
    check.resolve({ ok: true })
    await expect(submitted).resolves.toBe(false)
    await expect(granted).resolves.toBe(false)
    expect(() => assertHouseholdAction('backup-export')).toThrow(HouseholdLockedError)
  })

  it('ignores a second submit while a check is running', async () => {
    const check = deferred<PinVerdict>()
    mocks.verifyPinThrottled.mockReturnValue(check.promise)
    void authorizeHousehold('backup-export')
    const first = submitHouseholdPin('1234')
    await expect(submitHouseholdPin('1234')).resolves.toBe(false)
    check.resolve({ ok: true })
    await expect(first).resolves.toBe(true)
    expect(mocks.verifyPinThrottled).toHaveBeenCalledTimes(1)
  })

  it('keeps the prompt open when the PIN cannot be checked', async () => {
    mocks.verifyPinThrottled.mockRejectedValue(new Error('storage unavailable'))
    void authorizeHousehold('factory-reset')
    await expect(submitHouseholdPin('1234')).resolves.toBe(false)
    expect(get(householdPrompt)).toEqual({ action: 'factory-reset', busy: false, error: 'Could not check the PIN. Try again.', retryAt: 0 })
  })

  it('does nothing when no prompt is open', async () => {
    await expect(submitHouseholdPin('1234')).resolves.toBe(false)
    expect(mocks.verifyPinThrottled).not.toHaveBeenCalled()
  })

  it('reset (tests and hot reload) closes the prompt and drops grants', async () => {
    const granted = authorizeHousehold('backup-export')
    resetHouseholdGateForTests()
    await expect(granted).resolves.toBe(false)
    expect(get(householdPrompt)).toBeNull()
    expect(() => assertHouseholdAction('backup-export')).toThrow(HouseholdLockedError)
  })
})

describe('18+ sources on restricted profiles', () => {
  beforeEach(() => {
    mocks.householdLocked.set(true)
  })

  it('stay hidden until the main PIN is entered, for this session only', async () => {
    expect(get(adultSourcesAllowed)).toBe(false)
    expect(adultSourcesPermitted()).toBe(false)
    const granted = requestAdultSources()
    expect(get(householdPrompt)?.action).toBe('adult-sources')
    await submitHouseholdPin('1234')
    await expect(granted).resolves.toBe(true)
    expect(get(adultSourcesUnlocked)).toBe(true)
    expect(adultSourcesPermitted()).toBe(true)
    lockAdultSources()
    expect(get(adultSourcesUnlocked)).toBe(false)
    expect(adultSourcesPermitted()).toBe(false)
  })

  it('an 18+ unlock is not a grant for any other action', async () => {
    const granted = requestAdultSources()
    await submitHouseholdPin('1234')
    await granted
    expect(() => assertHouseholdAction('factory-reset')).toThrow(HouseholdLockedError)
  })

  it('does not ask again while unlocked', async () => {
    const first = requestAdultSources()
    await submitHouseholdPin('1234')
    await first
    await expect(requestAdultSources()).resolves.toBe(true)
    expect(get(householdPrompt)).toBeNull()
    expect(mocks.verifyPinThrottled).toHaveBeenCalledTimes(1)
  })

  it('names the refusal the installers throw', () => {
    expect(ADULT_SOURCES_LOCKED_MESSAGE).toBe('Unlock 18+ sources with the main profile PIN first.')
  })
})

describe('keypad', () => {
  it('has twelve keys: nine digits, delete, zero and OK', () => {
    expect(HOUSEHOLD_KEYPAD).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'ok'])
  })

  it('ignores a seventh digit, deletes one digit at a time, and OK leaves the PIN alone', () => {
    let pin = ''
    for (const key of ['1', '2', '3', '4', '5', '6', '7'] as const) pin = pinAfterKey(pin, key)
    expect(pin).toBe('123456')
    expect(pinAfterKey(pin, 'clear')).toBe('12345')
    expect(pinAfterKey('', 'clear')).toBe('')
    expect(pinAfterKey('1234', 'ok')).toBe('1234')
  })

  it('titles the prompt for every action', () => {
    const actions: HouseholdAction[] = ['factory-reset', 'backup-export', 'backup-restore', 'send-setup', 'adult-sources']
    for (const action of actions) expect(HOUSEHOLD_ACTION_TITLES[action]).toMatch(/\S/)
  })
})
