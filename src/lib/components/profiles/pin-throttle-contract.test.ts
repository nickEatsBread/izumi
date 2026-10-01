import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const switcher = read('./ProfileSwitcher.svelte')
const manager = read('../../../routes/app/settings/profiles/+page.svelte')

describe('PIN entry points share the household throttle', () => {
  it('never checks a typed PIN with the unthrottled verifier', () => {
    expect(switcher).not.toContain('verifyProfilePin')
    expect(manager).not.toContain('verifyProfilePin')
    expect(manager).toContain('await verifyPinThrottled(main, mainPin)')
    expect(manager).toContain('await verifyPinThrottled(editing, currentPin)')
    expect(manager).toContain("verdict.reason === 'throttled' ? ''")
  })

  it('the profile switcher waits out a lock behind a live countdown', () => {
    expect(switcher).toMatch(/import \{[^}]*\bpinLockSeconds\b[^}]*\bpinThrottleMessage\b[^}]*\} from '\$lib\/profiles\/store'/)
    expect(switcher).toContain('if (!pending || busy || $pinLockSeconds > 0) return')
    expect(switcher).toContain('disabled={pin.length < 4 || busy || $pinLockSeconds > 0}')
    expect(switcher).toContain('{#if $pinLockSeconds > 0}<p role="timer" data-pin-countdown')
    expect(switcher).toContain('{pinThrottleMessage($pinLockSeconds)}')
  })

  it('the Profiles gate, delete and turn-off screens wait out a lock and hand focus back to the PIN field', () => {
    expect(manager).toMatch(/import \{[^}]*\bpinLockSeconds\b[^}]*\bpinThrottleMessage\b[^}]*\bverifyPinThrottled\b[^}]*\} from '\$lib\/profiles\/store'/)
    expect(manager).toContain('const pinEntry = $derived(')
    expect(manager).toContain("screen === 'gate' || (screen === 'delete' && !!editing?.pin)")
    expect(manager).toContain('{#if pinEntry && $pinLockSeconds > 0}<p role="timer" data-pin-countdown')
    expect(manager).toContain('{pinThrottleMessage($pinLockSeconds)}')
    expect(manager).toContain('disabled={busy || mainPin.length < 4 || $pinLockSeconds > 0}')
    expect(manager).toContain('disabled={busy || (!!editing?.pin && $pinLockSeconds > 0)}')
    expect(manager).toContain('disabled={busy || (!!main.pin && $pinLockSeconds > 0)}')
    expect(manager).toContain("error = verdict.reason === 'throttled' ? '' : 'That PIN didn’t match.'; mainPin = ''; void focusScreen(); return }")
    expect(manager).toContain("error = 'That main profile PIN didn’t match.'; mainPin = ''; void focusScreen() }")
  })
})
