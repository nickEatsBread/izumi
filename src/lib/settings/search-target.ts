import { isNavigable } from '$lib/nav/focusable'
import { focusRestoreAllowed } from '$lib/nav/focus-memory'
import { isTextEntryField } from '$lib/nav/text-field'

/** Controls a search hit never focuses: one A press there would disconnect, delete or reset
 *  (Accounts Disconnect, Reset izumi, a trash button). */
export const DESTRUCTIVE_SELECTOR = '.text-destructive, .bg-destructive, [data-destructive]'

const HIT_CLASS = 'settings-search-hit'
const HIT_MS = 1800

/** Reachable, not destructive and not a text field (A on a field would open the keyboard). */
const safe = (el: HTMLElement) => !el.matches(DESTRUCTIVE_SELECTOR) && !isTextEntryField(el) && isNavigable(el)

/**
 * Where focus goes for a revealed row: its SettingsRow activation button (`data-row-activate`); else
 * the row itself when it is a safe control (a Toggle row is its own button); else the row's first safe
 * `[data-focusable]`; else the row, made focusable by script only (tabindex -1), where A does nothing.
 */
export function settingFocusTarget(container: HTMLElement): HTMLElement {
  const activate = container.querySelector<HTMLElement>('[data-row-activate]')
  if (activate && isNavigable(activate)) return activate
  if (container.matches('[data-focusable]') && safe(container)) return container
  for (const el of container.querySelectorAll<HTMLElement>('[data-focusable]')) if (safe(el)) return el
  if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1')
  return container
}

/** A row is rendered when it is connected, not inside a hidden section (Accounts keeps its other
 *  sections in the DOM with `hidden`) or an inert subtree, and visible where the engine can tell. */
function rendered(el: HTMLElement): boolean {
  return el.isConnected && !el.closest('[hidden], [inert]') && (el.checkVisibility?.() ?? true)
}

/** The first `[data-setting-key]` equal to `key` that passes `accept`. Compared as text, so any key
 *  works without CSS escaping. */
function findRow(key: string, accept: (el: HTMLElement) => boolean): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-setting-key]')) {
    if (el.getAttribute('data-setting-key') === key && accept(el)) return el
  }
  return null
}

/** Resolves true after `ms`, or false at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((done) => {
    if (signal.aborted) { done(false); return }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = () => { clearTimeout(timer); done(false) }
    signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); done(true) }, ms)
  })
}

/**
 * Brings a searched row into view. Polls `attempts` × `intervalMs` (default 20 × 50 ms) for a
 * rendered `[data-setting-key=key]`: the page may still be mounting, or the row may sit in a section
 * that opens once the page reads its URL. `fallbackKey` stands in when the row is absent from the page
 * (not rendered on this device or build), or on the last attempt. The row is scrolled to the centre
 * and tinted for 1.8 s; on a pad or TV (focusRestoreAllowed) focus moves to settingFocusTarget(row).
 * Resolves the revealed row, or null when aborted or nothing turned up.
 */
export async function revealSetting(
  key: string,
  fallbackKey: string | null,
  signal: AbortSignal,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<HTMLElement | null> {
  const attempts = Math.max(1, options.attempts ?? 20)
  const intervalMs = options.intervalMs ?? 50
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal.aborted) return null
    const last = attempt === attempts - 1
    const row = findRow(key, rendered)
      ?? (fallbackKey && (last || !findRow(key, () => true)) ? findRow(fallbackKey, rendered) : null)
    if (row) {
      row.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      row.classList.add(HIT_CLASS)
      setTimeout(() => row.classList.remove(HIT_CLASS), HIT_MS)
      if (focusRestoreAllowed()) settingFocusTarget(row).focus({ preventScroll: true })
      return row
    }
    if (last || !(await pause(intervalMs, signal))) return null
  }
  return null
}
