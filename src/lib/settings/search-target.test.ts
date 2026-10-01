// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inputType } from '$lib/nav/input'
import { isTv } from '$lib/platform'
import { DESTRUCTIVE_SELECTOR, revealSetting, settingFocusTarget } from './search-target'

const scrollIntoView = vi.fn()
const byKey = (key: string) => document.querySelector<HTMLElement>(`[data-setting-key="${key}"]`)!
const live = () => new AbortController().signal

beforeEach(() => {
  inputType.set('mouse')
  isTv.set(false)
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('settingFocusTarget', () => {
  it('prefers the row activation button', () => {
    document.body.innerHTML = '<div data-setting-key="row"><button data-focusable>Other</button><button data-row-activate data-focusable>Row</button></div>'
    expect(settingFocusTarget(byKey('row')).textContent).toBe('Row')
  })

  it('lands on a Toggle row itself: the row is the control', () => {
    document.body.innerHTML = '<button data-focusable data-setting-key="haptics">Haptics</button>'
    expect(settingFocusTarget(byKey('haptics'))).toBe(byKey('haptics'))
  })

  it('never lands on a destructive control or a text field', () => {
    document.body.innerHTML = `<div data-setting-key="anilist-account">
      <button data-focusable class="text-destructive">Disconnect</button>
      <button data-focusable class="bg-destructive">Delete</button>
      <button data-focusable data-destructive>Remove</button>
      <input data-focusable type="text" />
      <button data-focusable>Open profile</button>
    </div>`
    expect(settingFocusTarget(byKey('anilist-account')).textContent).toBe('Open profile')
  })

  it('skips a disabled control', () => {
    document.body.innerHTML = '<div data-setting-key="row"><button data-focusable disabled>Off</button><button data-focusable>On</button></div>'
    expect(settingFocusTarget(byKey('row')).textContent).toBe('On')
  })

  it('falls back to the row itself, focusable by script only, when nothing safe remains', () => {
    document.body.innerHTML = '<div data-setting-key="reset-defaults"><button data-focusable class="text-destructive">Reset</button><input data-focusable type="password" /></div>'
    const row = byKey('reset-defaults')
    expect(settingFocusTarget(row)).toBe(row)
    expect(row.getAttribute('tabindex')).toBe('-1')
  })

  it('keeps a tabindex the row already has', () => {
    document.body.innerHTML = '<div data-setting-key="row" tabindex="0"></div>'
    settingFocusTarget(byKey('row'))
    expect(byKey('row').getAttribute('tabindex')).toBe('0')
  })

  it('treats exactly the spec classes and marker as destructive', () => {
    expect(DESTRUCTIVE_SELECTOR).toBe('.text-destructive, .bg-destructive, [data-destructive]')
  })
})

describe('revealSetting', () => {
  it('scrolls to the row and tints it for 1.8 s, leaving focus alone for mouse and touch', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<button id="before" data-focusable>Before</button><button data-focusable data-setting-key="haptics">Haptics</button>'
    document.getElementById('before')!.focus()
    const row = await revealSetting('haptics', null, live())
    expect(row).toBe(byKey('haptics'))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(row!.classList.contains('settings-search-hit')).toBe(true)
    expect(document.activeElement?.id).toBe('before')
    await vi.advanceTimersByTimeAsync(1799)
    expect(row!.classList.contains('settings-search-hit')).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(row!.classList.contains('settings-search-hit')).toBe(false)
  })

  it('focuses the safe control on a pad, never Disconnect', async () => {
    inputType.set('dpad')
    document.body.innerHTML = '<div data-setting-key="anilist-account"><button data-focusable class="text-destructive">Disconnect</button></div>'
    const row = await revealSetting('anilist-account', null, live())
    expect(document.activeElement).toBe(row)
    expect(row!.getAttribute('tabindex')).toBe('-1')
  })

  it('focuses on Android TV too', async () => {
    isTv.set(true)
    document.body.innerHTML = '<button data-focusable data-setting-key="haptics">Haptics</button>'
    await revealSetting('haptics', null, live())
    expect(document.activeElement).toBe(byKey('haptics'))
  })

  it('waits for a row in a hidden section to be shown', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div hidden id="section"><div data-setting-key="episodes-before-watchlist"><button data-focusable>Edit</button></div></div>'
    const pending = revealSetting('episodes-before-watchlist', null, live())
    await vi.advanceTimersByTimeAsync(100)
    expect(scrollIntoView).not.toHaveBeenCalled()
    document.getElementById('section')!.removeAttribute('hidden')
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBe(byKey('episodes-before-watchlist'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('waits for a page that has not rendered yet', async () => {
    vi.useFakeTimers()
    const pending = revealSetting('offline-mode', null, live())
    await vi.advanceTimersByTimeAsync(150)
    document.body.innerHTML = '<button data-focusable data-setting-key="offline-mode">Offline mode</button>'
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBe(byKey('offline-mode'))
  })

  it('uses the fallback row when the row is not on this page', async () => {
    document.body.innerHTML = '<div data-setting-key="gif-recorder"><button data-focusable>Include subtitles</button></div>'
    await expect(revealSetting('include-subtitles-in-gifs', 'gif-recorder', live())).resolves.toBe(byKey('gif-recorder'))
  })

  it('waits for a hidden row before falling back, and prefers it once shown', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div data-setting-key="fallback"></div><div hidden id="wrap"><div data-setting-key="row"></div></div>'
    const pending = revealSetting('row', 'fallback', live(), { attempts: 4, intervalMs: 50 })
    await vi.advanceTimersByTimeAsync(50)
    document.getElementById('wrap')!.removeAttribute('hidden')
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBe(byKey('row'))
  })

  it('takes the fallback on the last attempt when the row never shows', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<div data-setting-key="fallback"></div><div hidden><div data-setting-key="row"></div></div>'
    const pending = revealSetting('row', 'fallback', live(), { attempts: 3, intervalMs: 50 })
    await vi.advanceTimersByTimeAsync(100)
    await expect(pending).resolves.toBe(byKey('fallback'))
  })

  it('gives up with null after 20 attempts 50 ms apart', async () => {
    vi.useFakeTimers()
    let settled: HTMLElement | null | undefined
    void revealSetting('missing', null, live()).then((value) => { settled = value })
    await vi.advanceTimersByTimeAsync(900)
    expect(settled).toBeUndefined()
    await vi.advanceTimersByTimeAsync(50)
    expect(settled).toBeNull()
  })

  it('stops when aborted, before starting or while waiting', async () => {
    const early = new AbortController()
    early.abort()
    document.body.innerHTML = '<div data-setting-key="row"></div>'
    await expect(revealSetting('row', null, early.signal)).resolves.toBeNull()
    expect(byKey('row').classList.contains('settings-search-hit')).toBe(false)

    vi.useFakeTimers()
    document.body.replaceChildren()
    const late = new AbortController()
    const pending = revealSetting('late', null, late.signal)
    await vi.advanceTimersByTimeAsync(50)
    late.abort()
    document.body.innerHTML = '<div data-setting-key="late"></div>'
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBeNull()
    expect(byKey('late').classList.contains('settings-search-hit')).toBe(false)
  })
})

describe('SettingsRow', () => {
  it("marks its activate button as the row's search focus target", () => {
    // A cwd-relative path: in a jsdom file Vite rewrites `new URL(…, import.meta.url)` to a web URL.
    const row = readFileSync('src/lib/components/settings/SettingsRow.svelte', 'utf8').replace(/\r\n/g, '\n')
    expect(row).toContain('      use:ripple\n      data-row-activate\n      aria-pressed={pressed}')
    expect(row.split('data-row-activate').length - 1).toBe(1)
  })
})
