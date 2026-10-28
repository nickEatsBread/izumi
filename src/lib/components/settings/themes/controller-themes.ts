import type { InstalledTheme } from '$lib/themes/installed'

// The controller theme list (ControllerThemeList.svelte): one large card per theme, izumi's default
// first. Pure, so the ordering and the sheet's choices are unit-tested without a DOM.

/** The default appearance's card; installed themes use their package id. */
export const DEFAULT_THEME_CARD = 'izumi-default'

/** A card's stable identity: applying a theme restyles the page, and focus finds the card again by it. */
export const themeCardNavId = (id: string) => `theme-card:${id}`

/** The card that shows Applied: the default under izumi's own preset, an install whose design is the
 *  active one under `custom`, else none (a shipped palette from Appearance is in use). */
export function appliedThemeCard(preset: string, activeDesignId: string, items: readonly InstalledTheme[]): string | null {
  if (preset === 'izumi') return DEFAULT_THEME_CARD
  if (preset !== 'custom') return null
  return items.find((item) => item.designId === activeDesignId)?.id ?? null
}

export type ThemeOptionId = 'update' | 'restore' | 'store' | 'remove'

export const THEME_OPTION_LABELS: Record<ThemeOptionId, string> = {
  update: 'Check for update',
  restore: 'Restore previous version',
  store: 'View in store',
  remove: 'Remove',
}

/** A theme's secondary actions in sheet order. `update`: it came from a store or an update link;
 *  `store`: its store still lists it. */
export function themeOptionIds(item: Pick<InstalledTheme, 'previous'>, can: { update: boolean; store: boolean }): ThemeOptionId[] {
  const ids: ThemeOptionId[] = []
  if (can.update) ids.push('update')
  if (item.previous) ids.push('restore')
  if (can.store) ids.push('store')
  ids.push('remove')
  return ids
}

/** Where focus goes when the card `removed` leaves: the card after it, else the one before. */
export function cardAfterRemove(ids: readonly string[], removed: string): string | null {
  const at = ids.indexOf(removed)
  if (at < 0) return null
  return ids[at + 1] ?? ids[at - 1] ?? null
}
