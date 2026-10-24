import { derived } from 'svelte/store'
import { isTv } from '$lib/platform'
import { gameMode } from '$lib/player/session'
import { SETTINGS_SEARCH_INDEX, type SettingSearchItem } from './search'

/** Settings' controller layout (spec §5): Android TV, or Steam Deck Game mode. The same rule as
 *  Theme API 6's `tvSurface`. */
export const settingsControllerMode = derived([isTv, gameMode], ([$tv, $gm]) => $tv || $gm)

export interface ControllerSurfaces { tv: boolean; gamemode: boolean }

/** The controller surfaces a row's `hideOn` tags can name, as SettingsSearch and SettingsRow read them. */
export const controllerSurfaces = derived([isTv, gameMode], ([tv, gamemode]): ControllerSurfaces => ({ tv, gamemode }))

/** True when every index entry for `key` is hidden on a surface that is on (`hideOn` 'tv' or
 *  'gamemode', spec §5.6). Search filters on the same entries, so a row disappears exactly where its
 *  hit does. A key with no entry is never hidden here. */
export function controllerHides(
  key: string | undefined,
  surfaces: ControllerSurfaces,
  index: readonly SettingSearchItem[] = SETTINGS_SEARCH_INDEX,
): boolean {
  if (!key || (!surfaces.tv && !surfaces.gamemode)) return false
  const entries = index.filter((entry) => entry.key === key)
  return entries.length > 0 && entries.every((entry) =>
    (entry.hideOn ?? []).some((tag) => (tag === 'tv' && surfaces.tv) || (tag === 'gamemode' && surfaces.gamemode)))
}
