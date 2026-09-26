import { get } from 'svelte/store'
import { describe, expect, it } from 'vitest'
import { isSafeModeChord, protectedSurface, protectedSurfaceCount, themeSafeMode } from './safe-mode'

const chord = (patch: Partial<KeyboardEvent>) => ({ code: 'KeyT', altKey: true, shiftKey: true, ctrlKey: true, metaKey: false, ...patch })

describe('theme safe mode', () => {
  it('recognises Ctrl/Cmd + Alt + Shift + T only', () => {
    expect(isSafeModeChord(chord({}))).toBe(true)
    expect(isSafeModeChord(chord({ ctrlKey: false, metaKey: true }))).toBe(true)
    expect(isSafeModeChord(chord({ altKey: false }))).toBe(false)
    expect(isSafeModeChord(chord({ code: 'KeyR' }))).toBe(false)
  })
  it('counts mounted protected surfaces and ignores double destroys', () => {
    const a = protectedSurface({} as HTMLElement), b = protectedSurface({} as HTMLElement)
    expect(get(protectedSurfaceCount)).toBe(2)
    a.destroy(); b.destroy(); b.destroy()
    expect(get(protectedSurfaceCount)).toBe(0)
  })
  it('starts off every session', () => {
    expect(get(themeSafeMode)).toBe(false)
  })
})
