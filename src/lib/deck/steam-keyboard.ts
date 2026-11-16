import { invoke } from '@tauri-apps/api/core'
import type { OskLayout } from '$lib/nav/osk'
import type { TextEntryField } from '$lib/nav/text-field'

/** Steam's floating keyboard over `field` (window pixels), as Steam games show it on a Steam Deck.
 *  Resolves false when Steam cannot show one (not launched from Steam, no Steam client), so the
 *  built-in keyboard serves instead. Steam types into the focused field itself. */
export function showSteamKeyboard(field: TextEntryField, layout: OskLayout): Promise<boolean> {
  const rect = field.getBoundingClientRect()
  const scale = window.devicePixelRatio || 1
  return invoke<boolean>('steam_show_osk', {
    x: Math.round(rect.left * scale),
    y: Math.round(rect.top * scale),
    w: Math.max(1, Math.round(rect.width * scale)),
    h: Math.max(1, Math.round(rect.height * scale)),
    mode: field instanceof HTMLTextAreaElement ? 1 : layout === 'numeric' ? 3 : 0,
  })
}
