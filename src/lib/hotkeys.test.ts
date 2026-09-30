// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { conflictingHotkey, displayBinding, effectiveBinding, eventToBinding, findHotkey, isTypingTarget, playerHotkeyEligible, type PlayerHotkeyContext } from './hotkeys'

describe('hotkeys', () => {
  it('normalizes keyboard events and displays bindings', () => {
    expect(eventToBinding({ key: 'K', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false } as KeyboardEvent)).toBe('ctrl+k')
    expect(displayBinding('ctrl+ArrowLeft')).toBe('Ctrl + ←')
  })

  it('uses overrides and detects conflicts in the same scope', () => {
    expect(effectiveBinding('playerMute', { playerMute: 'q' })).toBe('q')
    expect(conflictingHotkey('playerMute', 'f', {} )?.id).toBe('playerFullscreen')
    expect(conflictingHotkey('playerMute', 'ctrl+k', {})).toBeNull()
  })

  it('uses Command+K for quick search on macOS without replacing user overrides', () => {
    const commandK = { key: 'k', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true } as KeyboardEvent
    const controlK = { key: 'k', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false } as KeyboardEvent

    expect(effectiveBinding('globalSearch', {}, true)).toBe('meta+k')
    expect(findHotkey(commandK, {}, 'Global', true)).toBe('globalSearch')
    expect(findHotkey(controlK, {}, 'Global', true)).toBeNull()
    expect(displayBinding('meta+k', true)).toBe('⌘ + K')
    expect(effectiveBinding('globalSearch', { globalSearch: 'ctrl+k' }, true)).toBe('ctrl+k')
  })

  it('uses Control+Tab in both directions on Home for Windows and macOS', () => {
    const next = { key: 'Tab', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false } as KeyboardEvent
    const previous = { key: 'Tab', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false } as KeyboardEvent
    const commandTab = { key: 'Tab', ctrlKey: false, shiftKey: false, altKey: false, metaKey: true } as KeyboardEvent

    for (const macOS of [false, true]) {
      expect(findHotkey(next, {}, 'Home', macOS)).toBe('homeNextCatalog')
      expect(findHotkey(previous, {}, 'Home', macOS)).toBe('homePreviousCatalog')
    }
    expect(findHotkey(commandTab, {}, 'Home', true)).toBeNull()
  })
})

describe('playerHotkeyEligible', () => {
  const idle: PlayerHotkeyContext = { oskOpen: false, layerOpen: false }
  // jsdom events are never trusted and `isTrusted` cannot be redefined on a real event, so the
  // trusted cases use a plain object carrying just the fields the rule reads.
  const key = (isTrusted: boolean, target: EventTarget | null) =>
    ({ key: 'ArrowLeft', isTrusted, target }) as unknown as KeyboardEvent
  const make = (html: string) => {
    const host = document.createElement('div')
    host.innerHTML = html
    return host.firstElementChild!
  }

  it('accepts a real key aimed at the page', () => {
    expect(playerHotkeyEligible(key(true, document.body), idle)).toBe(true)
    expect(playerHotkeyEligible(key(true, make('<button>Play</button>')), idle)).toBe(true)
  })

  it('rejects synthetic keys: the pad translator, the subtitle editor re-dispatch and the TV Back bridge', () => {
    expect(playerHotkeyEligible(key(false, window), idle)).toBe(false)
    expect(playerHotkeyEligible(key(false, document.body), idle)).toBe(false)
  })

  it('rejects every key while the on-screen keyboard or a nav layer is open', () => {
    expect(playerHotkeyEligible(key(true, document.body), { oskOpen: true, layerOpen: false })).toBe(false)
    expect(playerHotkeyEligible(key(true, document.body), { oskOpen: false, layerOpen: true })).toBe(false)
  })

  it('leaves keys typed into a text field to the field', () => {
    for (const html of ['<input>', '<textarea></textarea>', '<select></select>', '<div role="textbox"></div>', '<div role="searchbox"></div>', '<div role="combobox"></div>']) {
      expect(playerHotkeyEligible(key(true, make(html)), idle), html).toBe(false)
    }
  })

  it('never throws on a window target, trusted or not', () => {
    expect(() => playerHotkeyEligible(key(true, window), idle)).not.toThrow()
    expect(playerHotkeyEligible(key(true, window), idle)).toBe(true)
    let verdict: boolean | null = null
    const listener = (event: KeyboardEvent) => { verdict = playerHotkeyEligible(event, idle) }
    window.addEventListener('keydown', listener)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    window.removeEventListener('keydown', listener)
    expect(verdict).toBe(false)
  })

  it('keeps isTypingTarget throwing on window, which Android TV Back still relies on', () => {
    expect(() => isTypingTarget(window)).toThrow(TypeError)
  })
})
