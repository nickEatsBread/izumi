import { writable } from 'svelte/store'

/** Session-only: safe mode shows izumi's default appearance (colours, fonts, layout and
 *  stylesheet) for the session, until toggled back or the app restarts. It never changes the
 *  saved theme. */
export const themeSafeMode = writable(false)

/** Mounted surfaces a theme stylesheet must not reach (Themes page, pack review…). Only engines
 *  without `@scope` need it: there the stylesheet is removed while any of them is open. */
export const protectedSurfaceCount = writable(0)

export function protectedSurface(_node: HTMLElement): { destroy(): void } {
  let active = true
  protectedSurfaceCount.update((count) => count + 1)
  return {
    destroy() {
      if (!active) return
      active = false
      protectedSurfaceCount.update((count) => Math.max(0, count - 1))
    },
  }
}

/** Ctrl/Cmd + Alt + Shift + T. `code` keeps it independent of layout and of macOS Option glyphs. */
export function isSafeModeChord(event: Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>): boolean {
  return event.code === 'KeyT' && event.altKey && event.shiftKey && (event.ctrlKey || event.metaKey)
}

export function scopeSupported(): boolean {
  return typeof globalThis !== 'undefined' && 'CSSScopeRule' in globalThis
}
