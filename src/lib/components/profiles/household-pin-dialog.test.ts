import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { attr, hasAttr, markupElements } from '../../../test/svelte-markup'

// The household PIN dialog (spec §6.5): no <input> (so no OSK, IME, controller mode or autofill),
// a twelve-key keypad of plain focusable buttons plus Cancel, a nav layer whose close is cancel, a
// capture keydown for keyboards and TV remotes, its own focus save/restore, the shared PIN lock line
// from commit 15, and the one-line forgotten-PIN note (owner decision 16). Svelte components cannot
// be mounted in this suite, so the markup is read with svelte/compiler (src/test/svelte-markup.ts)
// and the script as text.

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
const read = (relative: string) => readFileSync(path(relative), 'utf8').replace(/\r\n/g, '\n')
const DIALOG = './HouseholdPinDialog.svelte'

describe('household PIN dialog', () => {
  const source = read(DIALOG)
  const elements = markupElements(path(DIALOG))

  it('has no text field: the PIN is entered on a keypad of buttons', () => {
    expect(source).not.toContain('<input')
    expect(source).not.toContain('<textarea')
    expect(elements.filter((el) => ['input', 'textarea', 'select'].includes(el.name))).toEqual([])
  })

  it('renders the twelve-key keypad and Cancel as focusable plain buttons of at least 44 px', () => {
    expect(source).toContain('{#each HOUSEHOLD_KEYPAD as key (key)}')
    const buttons = elements.filter((el) => el.name === 'button')
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(attr(button, 'type')?.value).toBe('button')
      expect(hasAttr(button, 'data-focusable')).toBe(true)
      expect(hasAttr(button, 'disabled')).toBe(false)
    }
    expect(buttons.filter((el) => hasAttr(el, 'data-keypad-key'))).toHaveLength(1)
    expect(source).toContain('min-h-14 min-w-14')
    expect(source).toContain('mt-3 min-h-12 w-full')
  })

  it('is a trapped modal nav layer above every settings dialog, cancelled by Back', () => {
    const root = elements.find((el) => attr(el, 'role')?.value === 'dialog')
    expect(root).toBeDefined()
    expect(attr(root!, 'aria-modal')?.value).toBe('true')
    expect(hasAttr(root!, 'data-nav-trap')).toBe(true)
    expect(hasAttr(root!, 'data-nav-escape')).toBe(true)
    expect(String(attr(root!, 'class')?.value)).toContain('z-[155]')
    expect(source).toContain('pushNavLayer({')
    expect(source).toContain("kind: 'household-pin'")
    expect(source).toContain("restore: 'none'")
    expect(source).toContain('close: () => cancelHouseholdPrompt()')
    expect(source).toContain('removeLayer()')
  })

  it('takes digits, Backspace, Enter and Escape from a window capture listener', () => {
    expect(source).toContain("window.addEventListener('keydown', onKeydown, { capture: true })")
    expect(source).toContain("window.removeEventListener('keydown', onKeydown, { capture: true })")
    expect(source).toContain('/^[0-9]$/.test(event.key)')
    expect(source).toContain("event.key === 'Backspace'")
    expect(source).toContain("event.key === 'Enter'")
    expect(source).toContain("event.key === 'Escape'")
  })

  it('keeps OK focusable while it cannot submit (aria-disabled, never disabled)', () => {
    expect(source).toContain("aria-disabled={prompt.busy || (key === 'ok' && !canSubmit) ? 'true' : undefined}")
    expect(source).toContain('$pinLockSeconds === 0 && pin.length >= HOUSEHOLD_PIN_MIN')
  })

  it('words and times a PIN lock exactly like the profile switcher (commit 15)', () => {
    expect(source).toMatch(/import \{[^}]*\bpinLockSeconds\b[^}]*\bpinThrottleMessage\b[^}]*\} from '\$lib\/profiles\/store'/)
    expect(source).toContain('{#if $pinLockSeconds > 0}<p role="timer" data-pin-countdown')
    expect(source).toContain('{pinThrottleMessage($pinLockSeconds)}')
    // No clock, wording or lock end of its own: pinLockSeconds reads the capped end.
    expect(source).not.toContain('setInterval')
    expect(source).not.toContain('Too many wrong PINs')
    expect(source).not.toContain('retryAt')
  })

  it('saves the opener and gives focus back to it', () => {
    expect(source).toContain('const openerDescriptor = describeFocus(opener)')
    expect(source).toContain('opener.focus({ preventScroll: true })')
    expect(source).toContain('restoreFocus(openerDescriptor)')
  })

  it('says in one line how a forgotten main PIN is recovered', () => {
    expect(source).toContain('Forgot the main PIN? The only way back is clearing')
  })

  it('is mounted lazily in the app layout, right after ProfileSwitcher, gated on the prompt', () => {
    const layout = read('../../../routes/app/+layout.svelte')
    expect(layout).toContain("const loadHouseholdPinDialog = () => import('$lib/components/profiles/HouseholdPinDialog.svelte')")
    expect(layout).not.toContain('import HouseholdPinDialog')
    const mount = '{#if $householdPrompt}<Lazy load={loadHouseholdPinDialog} />{/if}'
    expect(layout).toContain(mount)
    expect(layout.indexOf(mount)).toBe(layout.indexOf('<ProfileSwitcher />') + '<ProfileSwitcher />\n'.length)
  })
})
