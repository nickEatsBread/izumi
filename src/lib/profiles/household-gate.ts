import { derived, get, writable, type Readable } from 'svelte/store'
import {
  DEFAULT_PROFILE_ID,
  householdLocked,
  pinLockedUntil,
  profiles,
  verifyPinThrottled,
  type PinVerdict,
} from '$lib/profiles/store'

// Household actions on restricted profiles (spec §6.5-6.6, owner decisions 13, 16, 17). Restricted
// means profiles are on, a profile other than the main one is active, and the main profile has a
// PIN (householdLockApplies in profiles/store). Such a profile needs the main profile's PIN to reset
// izumi, save or restore a household backup, send this device's setup, or show and newly install
// 18+ sources. Everyone else is never asked. Pages call authorizeHousehold() before acting; the
// gated functions call assertHouseholdAction(), which uses up the one-shot grant, so a path that
// skips the page still cannot act.
//
// Not covered (spec §6.6, owner decision 17): unflagged add-ons, manual source URLs, collection
// installs, Nuvio transfer, DevTools, device joins, and Sync's "Share this device's setup" / "Use
// setup" between devices already in the room. createBackup() only builds an object in memory; its
// one caller outside tests is stringifyBackup(), which is gated and is the only path that produces
// a backup file.

export type HouseholdAction = 'factory-reset' | 'backup-export' | 'backup-restore' | 'send-setup' | 'adult-sources'

/** A grant must be used within this long, and the first check uses it up. */
export const HOUSEHOLD_GRANT_MS = 60_000

/** The refusal the package, add-on and source installers throw for a new 18+ entry. */
export const ADULT_SOURCES_LOCKED_MESSAGE = 'Unlock 18+ sources with the main profile PIN first.'

/** The PIN prompt's title for each action. */
export const HOUSEHOLD_ACTION_TITLES: Readonly<Record<HouseholdAction, string>> = {
  'factory-reset': 'Reset izumi',
  'backup-export': 'Save a backup',
  'backup-restore': 'Restore a backup',
  'send-setup': "Send this device's setup",
  'adult-sources': 'Show 18+ sources',
}

/** The keypad, row by row: nine digits, delete, zero, OK. The dialog has no text field. */
export const HOUSEHOLD_KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'ok'] as const
export type HouseholdKey = (typeof HOUSEHOLD_KEYPAD)[number]
/** Profile PINs are 4 to 6 digits (validPinFormat in profiles/store). */
export const HOUSEHOLD_PIN_MIN = 4
export const HOUSEHOLD_PIN_MAX = 6

/** Pure: the entered PIN after one key. A seventh digit is ignored, 'clear' deletes the last digit
 *  and 'ok' leaves the PIN as it is (the dialog submits it). */
export function pinAfterKey(pin: string, key: HouseholdKey): string {
  if (key === 'clear') return pin.slice(0, -1)
  if (key === 'ok') return pin
  return pin.length >= HOUSEHOLD_PIN_MAX ? pin : `${pin}${key}`
}

/** A gated function ran on a restricted profile without an unused, unexpired grant. */
export class HouseholdLockedError extends Error {
  constructor(readonly action: HouseholdAction) {
    super('Enter the main profile PIN first.')
    this.name = 'HouseholdLockedError'
  }
}

export interface HouseholdPromptState {
  action: HouseholdAction
  /** A PIN check is running. */
  busy: boolean
  /** The last failed check's message, or ''. */
  error: string
  /** When the shared PIN throttle lets the next check through (epoch ms, at most 5 min away), or 0.
   *  The dialog times and words the wait with pinLockSeconds / pinThrottleMessage, which read the
   *  same capped end. */
  retryAt: number
}

interface PendingPrompt {
  action: HouseholdAction
  promise: Promise<boolean>
  resolve: (granted: boolean) => void
}

const promptState = writable<HouseholdPromptState | null>(null)
/** The open PIN prompt, or null. The app layout mounts HouseholdPinDialog while it is set. */
export const householdPrompt: Readable<HouseholdPromptState | null> = { subscribe: promptState.subscribe }

let pending: PendingPrompt | null = null
const grants = new Map<HouseholdAction, number>()

const adultUnlocked = writable(false)
/** The main PIN was entered for 18+ sources in this session. In memory only, never persisted. */
export const adultSourcesUnlocked: Readable<boolean> = { subscribe: adultUnlocked.subscribe }
/** 18+ add-ons, sources and packages may be listed and newly installed. */
export const adultSourcesAllowed: Readable<boolean> = derived(
  [householdLocked, adultUnlocked],
  ([$locked, $unlocked]) => !$locked || $unlocked,
)

/** The live end of the shared PIN lock, or 0. pinLockedUntil caps a stored end that lies more than
 *  5 min ahead (the clock moved back, or a damaged record), so the keypad never shows hours. */
function throttledUntil(): number {
  return pinLockedUntil()
}

function grant(action: HouseholdAction): void {
  if (action === 'adult-sources') adultUnlocked.set(true)
  else grants.set(action, Date.now() + HOUSEHOLD_GRANT_MS)
}

function settle(granted: boolean): void {
  const current = pending
  pending = null
  promptState.set(null)
  current?.resolve(granted)
}

/** Resolves true when the action may go ahead. Not restricted: at once, with no prompt. Restricted:
 *  opens the main-PIN prompt and resolves when it closes (false on cancel). A second call for the
 *  action already being asked about shares its answer; any other action meanwhile gets false. */
export function authorizeHousehold(action: HouseholdAction): Promise<boolean> {
  if (!get(householdLocked)) {
    grant(action)
    return Promise.resolve(true)
  }
  if (pending) return pending.action === action ? pending.promise : Promise.resolve(false)
  let resolve!: (granted: boolean) => void
  const promise = new Promise<boolean>((done) => { resolve = done })
  pending = { action, promise, resolve }
  promptState.set({ action, busy: false, error: '', retryAt: throttledUntil() })
  return promise
}

/** First statement of every gated function. Uses up the action's grant; on a restricted profile
 *  without an unexpired grant it throws HouseholdLockedError before anything happens. */
export function assertHouseholdAction(action: Exclude<HouseholdAction, 'adult-sources'>): void {
  const expiresAt = grants.get(action)
  grants.delete(action)
  if (!get(householdLocked)) return
  if (expiresAt === undefined || Date.now() > expiresAt) throw new HouseholdLockedError(action)
}

/** Check a PIN against the main profile through the shared throttle. Right: grants the prompt's
 *  action, closes the prompt and resolves it true. Wrong or throttled: the prompt stays open with a
 *  message or a countdown. */
export async function submitHouseholdPin(pin: string): Promise<boolean> {
  const current = pending
  const state = get(promptState)
  if (!current || !state || state.busy) return false
  const main = get(profiles).find((profile) => profile.id === DEFAULT_PROFILE_ID)
  if (!main) return false
  promptState.set({ ...state, busy: true, error: '' })
  let verdict: PinVerdict
  try {
    verdict = await verifyPinThrottled(main, pin)
  } catch {
    if (pending === current) promptState.set({ ...state, busy: false, error: 'Could not check the PIN. Try again.' })
    return false
  }
  // Cancelled (Back, Escape, navigation, the asking page closing) while the check ran: nothing is
  // granted.
  if (pending !== current) return false
  if (verdict.ok) {
    grant(current.action)
    settle(true)
    return true
  }
  promptState.set({
    action: current.action,
    busy: false,
    error: verdict.reason === 'throttled' ? '' : 'Wrong PIN. Try again.',
    retryAt: verdict.reason === 'throttled' ? verdict.retryAt : throttledUntil(),
  })
  return false
}

/** Close the prompt without granting anything; its caller gets false. Pages that ask also call this
 *  from onDestroy, so a prompt still loading or open when they close never resumes them. */
export function cancelHouseholdPrompt(): void {
  if (pending) settle(false)
}

/** Synchronous check for the installers. */
export function adultSourcesPermitted(): boolean {
  return get(adultSourcesAllowed)
}

/** Ask for the main PIN to show 18+ sources for this session (no prompt when already allowed). */
export function requestAdultSources(): Promise<boolean> {
  return adultSourcesPermitted() ? Promise.resolve(true) : authorizeHousehold('adult-sources')
}

/** Hide 18+ sources again (the switch turned off, or the page closed). */
export function lockAdultSources(): void {
  adultUnlocked.set(false)
}

/** Tests and hot reload: close any prompt (its caller gets false), drop grants and the 18+ unlock. */
export function resetHouseholdGateForTests(): void {
  const current = pending
  pending = null
  promptState.set(null)
  grants.clear()
  adultUnlocked.set(false)
  current?.resolve(false)
}

import.meta.hot?.dispose(() => resetHouseholdGateForTests())
