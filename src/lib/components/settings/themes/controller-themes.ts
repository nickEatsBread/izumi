import type { InstalledTheme } from '$lib/themes/installed'
import { DEFAULT_THEME_KEY } from '$lib/themes/store-shelves'

// The Themes page's installed-theme state: which one is applied and what its options sheet offers.
// Pure, so the ordering and the sheet's choices are unit-tested without a DOM.

/** The default appearance's card; installed themes use their package id. */
export const DEFAULT_THEME_CARD = DEFAULT_THEME_KEY

/** The card that shows Applied: the default under izumi's own preset, an install whose design is the
 *  active one under `custom`, else none (a shipped palette from Appearance is in use). */
export function appliedThemeCard(preset: string, activeDesignId: string, items: readonly InstalledTheme[]): string | null {
  if (preset === 'izumi') return DEFAULT_THEME_CARD
  if (preset !== 'custom') return null
  return items.find((item) => item.designId === activeDesignId)?.id ?? null
}

export type ThemeOptionId = 'update' | 'restore' | 'remove'

export const THEME_OPTION_LABELS: Record<ThemeOptionId, string> = {
  update: 'Check for update',
  restore: 'Restore previous version',
  remove: 'Remove',
}

/** A theme's secondary actions in sheet order. `update`: it came from a store or an update link. */
export function themeOptionIds(item: Pick<InstalledTheme, 'previous'>, can: { update: boolean }): ThemeOptionId[] {
  const ids: ThemeOptionId[] = []
  if (can.update) ids.push('update')
  if (item.previous) ids.push('restore')
  ids.push('remove')
  return ids
}

/** Where focus goes when the card `removed` leaves: the card after it, else the one before. */
export function cardAfterRemove(ids: readonly string[], removed: string): string | null {
  const at = ids.indexOf(removed)
  if (at < 0) return null
  return ids[at + 1] ?? ids[at - 1] ?? null
}
