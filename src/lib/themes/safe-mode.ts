import { writable } from 'svelte/store'

/** Session-only: safe mode shows izumi's default appearance (colours, fonts, layout and
 *  stylesheet) for the session, until toggled back or the app restarts. It never changes the
 *  saved theme. */
export const themeSafeMode = writable(false)

/** Mounted surfaces a theme stylesheet must not reach (Themes page, dialogs, Game mode's HUD…). While
 *  any is open theme.ts wraps the stylesheet in `@scope`, or removes it on engines without `@scope`.
 *  Counted synchronously on mount, so a surface's first paint is already unthemed. */
export const protectedSurfaceCount = writable(0)

/** `active` false leaves the element uncounted, for markup that is only protected in Game mode. */
export function protectedSurface(_node: HTMLElement, active = true): { update(active?: boolean): void; destroy(): void } {
  let counted = false
  const set = (next: boolean) => {
    if (next === counted) return
    counted = next
    protectedSurfaceCount.update((count) => Math.max(0, count + (next ? 1 : -1)))
  }
  set(active)
  return { update: (next = true) => set(next), destroy: () => set(false) }
}

/** Ctrl/Cmd + Alt + Shift + T. `code` keeps it independent of layout and of macOS Option glyphs. */
export function isSafeModeChord(event: Pick<KeyboardEvent, 'code' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>): boolean {
  return event.code === 'KeyT' && event.altKey && event.shiftKey && (event.ctrlKey || event.metaKey)
}

export function scopeSupported(): boolean {
  return typeof globalThis !== 'undefined' && 'CSSScopeRule' in globalThis
}
