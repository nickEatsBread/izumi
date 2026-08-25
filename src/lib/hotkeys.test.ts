import { describe, expect, it } from 'vitest'
import { conflictingHotkey, displayBinding, effectiveBinding, eventToBinding, findHotkey } from './hotkeys'

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
})
