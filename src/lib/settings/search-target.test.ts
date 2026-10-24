// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inputType } from '$lib/nav/input'
import { isTv } from '$lib/platform'
import { DESTRUCTIVE_SELECTOR, revealBlock, revealSetting, settingFocusTarget } from './search-target'
import { SUBCATEGORY_OPEN_EVENT } from './sections'

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

  it('unfolds the folded subcategory holding the row, then reveals the row once it shows', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = `<section data-settings-subcategory="advanced" data-collapsed id="sub">
      <div data-settings-subcategory-body hidden><div data-setting-key="player-cache-size"></div></div></section>`
    const sub = document.getElementById('sub')!
    const opened = vi.fn()
    // SettingsSubcategory's side: unfold on the event, applied by Svelte a tick later.
    sub.addEventListener(SUBCATEGORY_OPEN_EVENT, () => {
      opened()
      queueMicrotask(() => { sub.removeAttribute('data-collapsed'); sub.querySelector('[hidden]')!.removeAttribute('hidden') })
    })
    const pending = revealSetting('player-cache-size', null, live())
    expect(opened).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBe(byKey('player-cache-size'))
    expect(opened).toHaveBeenCalledTimes(1)
  })

  it('unfolds the fallback row’s subcategory when the row itself is not on the page', async () => {
    document.body.innerHTML = `<section data-settings-subcategory="advanced" data-collapsed id="sub">
      <div data-settings-subcategory-body hidden><div data-setting-key="gif-recorder"></div></div></section>`
    const sub = document.getElementById('sub')!
    sub.addEventListener(SUBCATEGORY_OPEN_EVENT, () => { sub.removeAttribute('data-collapsed'); sub.querySelector('[hidden]')!.removeAttribute('hidden') })
    await expect(revealSetting('include-subtitles-in-gifs', 'gif-recorder', live())).resolves.toBe(byKey('gif-recorder'))
  })

  it('leaves an open subcategory and a hidden Accounts section alone', async () => {
    document.body.innerHTML = `<section data-settings-subcategory="up-next" id="open"><div data-setting-key="auto-play-next-episode"></div></section>
      <div hidden><section data-settings-subcategory="trackers" id="tab"><div data-setting-key="anilist-account"></div></section></div>`
    const heard = vi.fn()
    document.getElementById('open')!.addEventListener(SUBCATEGORY_OPEN_EVENT, heard)
    document.getElementById('tab')!.addEventListener(SUBCATEGORY_OPEN_EVENT, heard)
    await expect(revealSetting('auto-play-next-episode', null, live())).resolves.toBe(byKey('auto-play-next-episode'))
    await expect(revealSetting('anilist-account', null, live(), { attempts: 1 })).resolves.toBeNull()
    expect(heard).not.toHaveBeenCalled()
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

describe('revealBlock', () => {
  const BLOCK = `<section id="storage">
    <button data-focusable class="text-destructive">Clear all caches</button>
    <input data-focusable type="text" />
    <button data-focusable>Change folder</button>
  </section>`

  it("focuses the block's first safe control on a pad, after SvelteKit's fragment focus reset", async () => {
    inputType.set('dpad')
    document.body.innerHTML = BLOCK
    // reset_focus re-applies the hash in a timeout queued before afterNavigate; the engine drops focus.
    setTimeout(() => (document.activeElement as HTMLElement).blur())
    const target = await revealBlock('storage', live())
    await new Promise((settle) => setTimeout(settle))
    expect(target?.textContent).toBe('Change folder')
    expect(document.activeElement).toBe(target)
  })

  it('leaves focus alone for mouse and touch', async () => {
    document.body.innerHTML = `<button id="before" data-focusable>Before</button>${BLOCK}`
    document.getElementById('before')!.focus()
    await expect(revealBlock('storage', live())).resolves.toBeNull()
    expect(document.activeElement?.id).toBe('before')
  })

  it('does nothing once aborted or when the block is missing', async () => {
    inputType.set('dpad')
    document.body.innerHTML = BLOCK
    const aborted = new AbortController()
    aborted.abort()
    await expect(revealBlock('storage', aborted.signal)).resolves.toBeNull()
    await expect(revealBlock('missing', live())).resolves.toBeNull()
    expect(document.activeElement).toBe(document.body)
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
