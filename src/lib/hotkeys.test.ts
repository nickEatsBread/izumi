import { describe, expect, it } from 'vitest'
import { conflictingHotkey, displayBinding, effectiveBinding, eventToBinding } from './hotkeys'

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
})
