import { persisted } from 'svelte-persisted-store'
import { derived, get, writable, type Readable, type Writable } from 'svelte/store'
import { validAvatar, type ProfileAvatarId } from './avatars'
import { deleteLibraryProfile, flushLibraryStorage } from '$lib/storage/library-db'

export const DEFAULT_PROFILE_ID = 'default'
const PROFILES_KEY = 'izumi-profiles-v1'
const ACTIVE_PROFILE_KEY = 'izumi-active-profile-v1'
const PROFILE_KEY_PREFIX = 'izumi-profile'
const SESSION_UNLOCK_KEY = 'izumi-unlocked-profile-v1'

export type ProfileRatingLimit = 7 | 12 | 16 | 18

export interface IzumiProfile {
  id: string
  name: string
  color: string
  avatar?: ProfileAvatarId
  createdAt: number
  updatedAt?: number
  ratingLimit: ProfileRatingLimit
  allowAdult: boolean
  pin?: { salt: string; hash: string }
}

export interface ProfileState {
  profiles: IzumiProfile[]
  enabled?: boolean
  modeUpdatedAt?: number
  deleted?: Record<string, number>
}

export const PROFILE_COLORS = ['#ef476f', '#2a9d8f', '#457b9d', '#e9a23b', '#8b5cf6', '#d97757'] as const

const defaultProfile = (): IzumiProfile => ({
  id: DEFAULT_PROFILE_ID,
  name: 'Main profile',
  color: PROFILE_COLORS[0],
  createdAt: 0,
  ratingLimit: 18,
  allowAdult: true,
})

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage }
  catch { return undefined }
}

function storedActiveProfileId(storage = safeStorage()): string {
  const raw = storage?.getItem(ACTIVE_PROFILE_KEY)
  if (!raw) return DEFAULT_PROFILE_ID
  try {
    const value = JSON.parse(raw)
    return typeof value === 'string' && value ? value : DEFAULT_PROFILE_ID
  } catch {
    return raw || DEFAULT_PROFILE_ID
  }
}

function cleanProfile(value: unknown): IzumiProfile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<IzumiProfile>
  if (typeof raw.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.id) || typeof raw.name !== 'string' || !raw.name.trim()) return null
  const ratingLimit: ProfileRatingLimit = raw.ratingLimit === 7 || raw.ratingLimit === 12 || raw.ratingLimit === 16
    ? raw.ratingLimit
    : 18
  const pin = raw.pin && typeof raw.pin.salt === 'string' && typeof raw.pin.hash === 'string'
    ? { salt: raw.pin.salt, hash: raw.pin.hash }
    : undefined
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, 32),
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : PROFILE_COLORS[0],
    avatar: validAvatar(raw.avatar),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : raw.createdAt ?? 0,
    ratingLimit,
    allowAdult: ratingLimit === 18 && raw.allowAdult === true,
    pin,
  }
}

export function normalizeProfileState(value: unknown): ProfileState {
  const raw = value && typeof value === 'object' ? value as Partial<ProfileState> : {}
  let profiles = Array.isArray(raw.profiles)
    ? raw.profiles.map(cleanProfile).filter((profile): profile is IzumiProfile => !!profile)
    : []
  if (!profiles.some((profile) => profile.id === DEFAULT_PROFILE_ID)) profiles.unshift(defaultProfile())
  const deleted = Object.fromEntries(Object.entries(raw.deleted ?? {}).filter(([id, at]) => id !== DEFAULT_PROFILE_ID && /^[a-zA-Z0-9_-]{1,100}$/.test(id) && Number.isFinite(at) && at > 0))
  profiles = [...new Map(profiles.map((profile) => [profile.id, profile])).values()].filter((profile) => !deleted[profile.id])
  // Preserve households that were already deliberately configured; untouched installs stay simple.
  const customized = profiles.length > 1 || profiles.some((profile) => profile.name !== 'Main profile' || profile.pin || profile.ratingLimit !== 18 || !profile.allowAdult)
  return { profiles: profiles.slice(0, 8), enabled: typeof raw.enabled === 'boolean' ? raw.enabled : customized, modeUpdatedAt: Number.isFinite(raw.modeUpdatedAt) ? raw.modeUpdatedAt : 0, deleted }
}

const normalizeState = normalizeProfileState

const storedProfiles = persisted<ProfileState>(PROFILES_KEY, { profiles: [defaultProfile()], enabled: false })
const normalizedInitial = normalizeState(get(storedProfiles))
if (JSON.stringify(normalizedInitial) !== JSON.stringify(get(storedProfiles))) storedProfiles.set(normalizedInitial)

export const profiles: Readable<IzumiProfile[]> = derived(storedProfiles, ($state) => normalizeState($state).profiles)
export const profilesEnabled = derived(storedProfiles, ($state) => normalizeState($state).enabled === true)
export const profileHousehold = derived(storedProfiles, normalizeState)
export const activeProfileId = persisted<string>(ACTIVE_PROFILE_KEY, storedActiveProfileId())
if (!normalizedInitial.enabled || !normalizedInitial.profiles.some((profile) => profile.id === get(activeProfileId))) activeProfileId.set(DEFAULT_PROFILE_ID)
export const activeProfile: Readable<IzumiProfile> = derived(
  [profiles, activeProfileId],
  ([$profiles, $active]) => $profiles.find((profile) => profile.id === $active) ?? $profiles[0] ?? defaultProfile(),
)
const initialUnlocked = (() => {
  try { return typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem(SESSION_UNLOCK_KEY) ?? '' }
  catch { return '' }
})()
const unlockedProfileId = writable(initialUnlocked)
export const profileSwitcherOpen = writable(get(profilesEnabled) && !initialUnlocked)
const unlockIdentity = (profile: IzumiProfile) => `${profile.id}:${profile.pin?.hash ?? 'open'}`
export const activeProfileLocked: Readable<boolean> = derived(
  [activeProfile, unlockedProfileId],
  ([$profile, $unlocked]) => Boolean($profile.pin) && $unlocked !== unlockIdentity($profile),
)

/** A restricted session (owner decision 13): profiles are on, the active profile is not the main
 * one, and the main profile has a PIN. The same condition the Profiles page gate reads (`main.pin`).
 * The household gate (factory reset, backups, "Send this device's setup", adult sources) keys on it. */
export function householdLockApplies(state: ProfileState, activeId: string): boolean {
  if (state.enabled !== true || activeId === DEFAULT_PROFILE_ID) return false
  return Boolean(state.profiles.find((profile) => profile.id === DEFAULT_PROFILE_ID)?.pin)
}

export const householdLocked: Readable<boolean> = derived(
  [profileHousehold, activeProfileId],
  ([$state, $active]) => householdLockApplies($state, $active),
)

/** Create a persisted value in the active profile's storage partition. The original profile keeps
 * legacy keys so existing installs migrate without copying or losing data. Switching profiles
 * reloads the shell, allowing every module to bind to its new partition atomically. */
export function profileStorageKey(key: string, profileId = storedActiveProfileId()): string {
  return profileId === DEFAULT_PROFILE_ID ? key : `${PROFILE_KEY_PREFIX}:${profileId}:${key}`
}

export function profiledPersisted<T>(key: string, initial: T): Writable<T> {
  return persisted<T>(profileStorageKey(key), initial)
}

export function createProfile(input: Pick<IzumiProfile, 'name' | 'color' | 'ratingLimit' | 'allowAdult' | 'avatar'>): string {
  if (get(profiles).length >= 8) throw new Error('This household already has eight profiles.')
  const id = `profile-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`
  storedProfiles.update((state) => {
    const current = normalizeState(state)
    if (current.profiles.length >= 8) return current
    return { ...current, enabled: true, modeUpdatedAt: Date.now(), profiles: [...current.profiles, {
      id,
      name: input.name.trim().slice(0, 32) || 'Profile',
      color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : PROFILE_COLORS[current.profiles.length % PROFILE_COLORS.length],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      avatar: validAvatar(input.avatar),
      ratingLimit: input.ratingLimit,
      allowAdult: input.ratingLimit === 18 && input.allowAdult,
    }] }
  })
  return id
}

export function updateProfile(id: string, patch: Partial<Pick<IzumiProfile, 'name' | 'color' | 'ratingLimit' | 'allowAdult' | 'avatar'>>): void {
  storedProfiles.update((state) => ({
    ...state, enabled: true, modeUpdatedAt: Date.now(),
    profiles: normalizeState(state).profiles.map((profile) => {
      if (profile.id !== id) return profile
      const ratingLimit = patch.ratingLimit ?? profile.ratingLimit
      return {
        ...profile,
        updatedAt: Date.now(),
        avatar: validAvatar(patch.avatar ?? profile.avatar),
        name: patch.name == null ? profile.name : patch.name.trim().slice(0, 32) || profile.name,
        color: patch.color && /^#[0-9a-f]{6}$/i.test(patch.color) ? patch.color : profile.color,
        ratingLimit,
        allowAdult: ratingLimit === 18 && (patch.allowAdult ?? profile.allowAdult),
      }
    }),
  }))
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function randomSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const body = new TextEncoder().encode(`${salt}:${pin}`)
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', body)))
}

export function validPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin)
}

export async function setProfilePin(id: string, pin: string | null): Promise<void> {
  let record: IzumiProfile['pin']
  if (pin != null) {
    if (!validPinFormat(pin)) throw new Error('Use a 4 to 6 digit PIN.')
    const salt = randomSalt()
    record = { salt, hash: await hashPin(pin, salt) }
  }
  storedProfiles.update((state) => ({
    ...state,
    profiles: normalizeState(state).profiles.map((profile) => profile.id === id ? { ...profile, pin: record, updatedAt: Date.now() } : profile),
  }))
  if (id === get(activeProfileId)) rememberUnlocked(id)
  forgetPinMisses(id)
}

/** Unthrottled comparison, for internal checks only. Every PIN a person types goes through
 * verifyPinThrottled, so guesses are limited on every entry point. */
export async function verifyProfilePin(profile: IzumiProfile, pin: string): Promise<boolean> {
  if (!profile.pin) return true
  if (!validPinFormat(pin)) return false
  return (await hashPin(pin, profile.pin.salt)) === profile.pin.hash
}

/** Device-only record of wrong PINs: a device key in storage/key-policy, so it is never synced,
 * exported or restored. */
export const PIN_THROTTLE_KEY = 'izumi-pin-throttle-v1'
export const PIN_FREE_MISSES = 5
export const PIN_LOCKOUT_BASE_MS = 30_000
export const PIN_LOCKOUT_MAX_MS = 300_000

/** The household-wide view: the most misses made against any one profile's PIN, and the one lock
 * that pauses every PIN entry on this device, as stored (pinLockedUntil gives the live, capped end). */
export interface PinThrottleState { misses: number; lockedUntil: number }
export type PinVerdict = { ok: true } | { ok: false; reason: 'mismatch' } | { ok: false; reason: 'throttled'; retryAt: number }

/** Stored shape. Misses are counted per profile, so typing your own PIN correctly never clears the
 * misses made against another profile's PIN (the main one, say); the lock they trigger is shared. */
interface StoredPinThrottle { lockedUntil: number; targets: Record<string, number> }

function emptyPinThrottle(): StoredPinThrottle {
  return { lockedUntil: 0, targets: {} }
}

// Mirrors the last write, so the throttle still holds for this session when storage is unavailable
// or a write fails.
let memoryPinThrottle: StoredPinThrottle = emptyPinThrottle()

function parsePinThrottle(raw: string | null | undefined): StoredPinThrottle {
  if (!raw) return emptyPinThrottle()
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return emptyPinThrottle()
    const record = value as { lockedUntil?: unknown; targets?: unknown }
    const lockedUntil = typeof record.lockedUntil === 'number' && Number.isFinite(record.lockedUntil) && record.lockedUntil > 0 ? record.lockedUntil : 0
    const targets: Record<string, number> = {}
    if (record.targets && typeof record.targets === 'object') {
      for (const [id, misses] of Object.entries(record.targets as Record<string, unknown>)) {
        if (/^[a-zA-Z0-9_-]{1,100}$/.test(id) && typeof misses === 'number' && Number.isInteger(misses) && misses > 0) targets[id] = Math.min(misses, 1000)
      }
    }
    return { lockedUntil, targets }
  } catch {
    return emptyPinThrottle()
  }
}

function loadPinThrottle(): StoredPinThrottle {
  let stored = emptyPinThrottle()
  try { stored = parsePinThrottle(safeStorage()?.getItem(PIN_THROTTLE_KEY)) } catch { /* unreadable storage: the session copy still counts */ }
  const targets = { ...stored.targets }
  for (const [id, misses] of Object.entries(memoryPinThrottle.targets)) targets[id] = Math.max(targets[id] ?? 0, misses)
  return { lockedUntil: Math.max(stored.lockedUntil, memoryPinThrottle.lockedUntil), targets }
}

function summarizePinThrottle(state: StoredPinThrottle): PinThrottleState {
  return { misses: Math.max(0, ...Object.values(state.targets)), lockedUntil: state.lockedUntil }
}

/** Reads storage on every call, so a lock outlives a reload or an app restart. The lock end is as
 * stored, never capped: use pinLockedUntil for when PIN entry really opens. */
export function readPinThrottle(): PinThrottleState {
  return summarizePinThrottle(loadPinThrottle())
}

const pinThrottleState = writable<PinThrottleState>(readPinThrottle())
/** Updated on every recorded miss, cleared count or forgotten PIN; drives the countdown under PIN fields. */
export const pinThrottle: Readable<PinThrottleState> = { subscribe: pinThrottleState.subscribe }

/** Stores the record and the session copy, without notifying pinThrottle. */
function writePinThrottle(state: StoredPinThrottle): void {
  memoryPinThrottle = { lockedUntil: state.lockedUntil, targets: { ...state.targets } }
  try {
    const storage = safeStorage()
    if (!state.lockedUntil && !Object.keys(state.targets).length) storage?.removeItem(PIN_THROTTLE_KEY)
    else storage?.setItem(PIN_THROTTLE_KEY, JSON.stringify(state))
  } catch { /* quota or private mode: the session copy above still throttles */ }
}

function savePinThrottle(state: StoredPinThrottle): void {
  writePinThrottle(state)
  pinThrottleState.set(summarizePinThrottle(state))
}

/** Drops a profile's miss count once its PIN is replaced or removed, or the profile is deleted: those
 * misses were made against a PIN that no longer exists. The shared lock stays. */
function forgetPinMisses(id: string): void {
  const state = loadPinThrottle()
  if (!state.targets[id]) return
  const targets = { ...state.targets }
  delete targets[id]
  savePinThrottle({ lockedUntil: state.lockedUntil, targets })
}

/** The record at `now`, with its lock capped. No lock this code sets ends more than
 * PIN_LOCKOUT_MAX_MS after the clock that set it, so a later end means the clock has since moved back
 * or the record is damaged. The cap is written back, so it holds from the first time the lock is seen
 * and does not move with the clock: nobody waits more than PIN_LOCKOUT_MAX_MS. pinThrottle is not
 * notified, because this also runs inside pinLockSeconds, which reads the capped end directly. */
function loadPinThrottleAt(now: number): StoredPinThrottle {
  const state = loadPinThrottle()
  const cap = now + PIN_LOCKOUT_MAX_MS
  if (state.lockedUntil <= cap) return state
  const capped: StoredPinThrottle = { lockedUntil: cap, targets: state.targets }
  writePinThrottle(capped)
  return capped
}

/** When PIN entry opens again (epoch ms), or 0 while it is open. Never more than PIN_LOCKOUT_MAX_MS
 * after `now`. */
export function pinLockedUntil(now = Date.now()): number {
  const { lockedUntil } = loadPinThrottleAt(now)
  return lockedUntil > now ? lockedUntil : 0
}

/** 0 for the first PIN_FREE_MISSES misses, then 30 s doubling per miss, capped at 5 min. */
export function pinLockoutMs(misses: number): number {
  if (!(misses > PIN_FREE_MISSES)) return 0
  return Math.min(PIN_LOCKOUT_BASE_MS * 2 ** (misses - PIN_FREE_MISSES - 1), PIN_LOCKOUT_MAX_MS)
}

/** The one PIN check for everything a person types. A profile without a PIN passes and leaves the
 * throttle alone. While locked, every PIN is refused without being checked. An entry that is not 4-6
 * digits is refused without costing a try. A wrong PIN adds a miss for that profile and, past
 * PIN_FREE_MISSES, locks all PIN entry for pinLockoutMs; a right one clears that profile's misses and
 * leaves any running lock in place. */
export async function verifyPinThrottled(profile: IzumiProfile, pin: string, now = Date.now()): Promise<PinVerdict> {
  if (!profile.pin) return { ok: true }
  const lockedUntil = pinLockedUntil(now)
  if (lockedUntil) return { ok: false, reason: 'throttled', retryAt: lockedUntil }
  if (!validPinFormat(pin)) return { ok: false, reason: 'mismatch' }
  const matched = (await hashPin(pin, profile.pin.salt)) === profile.pin.hash
  // Re-read after hashing: another entry point may have recorded a miss meanwhile.
  const state = loadPinThrottleAt(now)
  const liveLock = state.lockedUntil > now ? state.lockedUntil : 0
  const targets = { ...state.targets }
  if (matched) {
    if (targets[profile.id]) {
      delete targets[profile.id]
      savePinThrottle({ lockedUntil: liveLock, targets })
    }
    return { ok: true }
  }
  const misses = (targets[profile.id] ?? 0) + 1
  targets[profile.id] = misses
  const lockout = pinLockoutMs(misses)
  savePinThrottle({ lockedUntil: lockout ? now + lockout : liveLock, targets })
  return { ok: false, reason: 'mismatch' }
}

/** Whole seconds until PIN entry opens again (0 while it is open). Recomputed whenever pinThrottle
 * changes, from pinLockedUntil, so it never starts above PIN_LOCKOUT_MAX_MS; ticks once a second only
 * while a lock lasts and something is subscribed (the countdown under a PIN field). */
export const pinLockSeconds: Readable<number> = derived(pinThrottle, (_throttle, set) => {
  const until = pinLockedUntil()
  const remaining = () => Math.max(0, Math.ceil((until - Date.now()) / 1000))
  const first = remaining()
  set(first)
  if (!first) return
  const timer = setInterval(() => {
    const seconds = remaining()
    set(seconds)
    if (!seconds) clearInterval(timer)
  }, 1000)
  return () => clearInterval(timer)
}, 0)

/** The one line shown under a PIN entry while it is locked ('' when it is not). */
export function pinThrottleMessage(seconds: number): string {
  if (!(seconds > 0)) return ''
  const whole = Math.ceil(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  const wait = minutes ? (rest ? `${minutes} min ${rest} s` : `${minutes} min`) : `${rest} s`
  return `Too many wrong PINs. Try again in ${wait}.`
}

export async function activateProfile(id: string, pin = ''): Promise<boolean> {
  const profile = get(profiles).find((candidate) => candidate.id === id)
  if (!profile || !(await verifyPinThrottled(profile, pin)).ok) return false
  await flushLibraryStorage()
  safeStorage()?.setItem(ACTIVE_PROFILE_KEY, JSON.stringify(id))
  rememberUnlocked(id)
  activeProfileId.set(id)
  profileSwitcherOpen.set(false)
  if (typeof location !== 'undefined') location.reload()
  return true
}

function rememberUnlocked(id: string): void {
  const profile = get(profiles).find((profile) => profile.id === id)
  if (!profile) return
  const identity = unlockIdentity(profile)
  try { sessionStorage.setItem(SESSION_UNLOCK_KEY, identity) } catch { /* unavailable in SSR/private mode */ }
  unlockedProfileId.set(identity)
}

export async function unlockActiveProfile(pin: string): Promise<boolean> {
  const profile = get(activeProfile)
  if (!(await verifyPinThrottled(profile, pin)).ok) return false
  rememberUnlocked(profile.id)
  return true
}

export async function deleteProfile(id: string, pin = ''): Promise<boolean> {
  if (id === DEFAULT_PROFILE_ID || id === get(activeProfileId)) return false
  const profile = get(profiles).find((candidate) => candidate.id === id)
  if (!profile || !(await verifyPinThrottled(profile, pin)).ok) return false
  await deleteLibraryProfile(id)
  storedProfiles.update((state) => ({ ...state, deleted: { ...state.deleted, [id]: Date.now() }, profiles: normalizeState(state).profiles.filter((candidate) => candidate.id !== id) }))
  const storage = safeStorage()
  if (storage) {
    const prefix = `${PROFILE_KEY_PREFIX}:${id}:`
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index)
      if (key?.startsWith(prefix)) storage.removeItem(key)
    }
  }
  forgetPinMisses(id)
  return true
}

/** Disabling never deletes a household or its data, and requires the main profile's PIN. */
export async function disableProfiles(pin = ''): Promise<boolean> {
  const main = get(profiles).find((profile) => profile.id === DEFAULT_PROFILE_ID)!
  if (!(await verifyPinThrottled(main, pin)).ok) return false
  storedProfiles.update((state) => ({ ...state, enabled: false, modeUpdatedAt: Date.now() }))
  return activateProfile(DEFAULT_PROFILE_ID, pin)
}

/** Merge independent profile edits, with permanent deletion tombstones. Device selection and
 * session unlock state are intentionally not synchronized. */
export function mergeProfileStates(local: unknown, remote: unknown): ProfileState {
  const left = normalizeState(local), right = normalizeState(remote)
  const deleted = { ...left.deleted }
  for (const [id, at] of Object.entries(right.deleted ?? {})) deleted[id] = Math.max(deleted[id] ?? 0, at)
  const byId = new Map(left.profiles.map((profile) => [profile.id, profile]))
  for (const profile of right.profiles) {
    const previous = byId.get(profile.id)
    const delta = (profile.updatedAt ?? 0) - (previous?.updatedAt ?? 0)
    if (!previous || delta > 0 || (delta === 0 && JSON.stringify(profile) > JSON.stringify(previous))) byId.set(profile.id, profile)
  }
  const mode = (right.modeUpdatedAt ?? 0) > (left.modeUpdatedAt ?? 0) ? right : left
  return normalizeState({ profiles: [...byId.values()].sort((a, b) => a.id === DEFAULT_PROFILE_ID ? -1 : b.id === DEFAULT_PROFILE_ID ? 1 : a.createdAt - b.createdAt || a.id.localeCompare(b.id)), enabled: mode.enabled, modeUpdatedAt: mode.modeUpdatedAt, deleted })
}

export function mergeRemoteProfiles(remote: unknown): void {
  storedProfiles.update((current) => {
    const merged = mergeProfileStates(current, remote)
    return JSON.stringify(current) === JSON.stringify(merged) ? current : merged
  })
  const id = get(activeProfileId)
  if (!get(profiles).some((profile) => profile.id === id) || (!get(profilesEnabled) && id !== DEFAULT_PROFILE_ID)) {
    activeProfileId.set(DEFAULT_PROFILE_ID)
    // Stores are bound to their partition at module initialization. Never show a different
    // person's identity on top of the old partition while a remote deletion is applied.
    if (typeof location !== 'undefined') location.reload()
  }
}
