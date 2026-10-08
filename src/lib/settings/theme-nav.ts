import type { ThemeNav } from '$lib/themes/presentation'
// Type-only: erased at build time, so this never loads nav.ts's icon components.
import type { NavPlacement } from './nav'

/** A theme's bottom/top lists as a nav config; null when the theme leaves destinations to the user.
 *  One entry per destination: one a theme lists on both (API 4) is a bottom-bar tab here, and its
 *  header shortcut comes from `themeHeaderIds`. */
export function themeNavConfig(nav: ThemeNav, known: string[]): Array<{ id: string; placement: NavPlacement }> | null {
  if (!nav.bottom && !nav.top) return null
  const bottom = nav.bottom ?? []
  const top = (nav.top ?? []).filter((id) => !bottom.includes(id))
  return [
    ...bottom.filter((id) => known.includes(id)).map((id) => ({ id, placement: 'bottom' as const })),
    ...top.filter((id) => known.includes(id)).map((id) => ({ id, placement: 'top' as const })),
    ...known.filter((id) => !bottom.includes(id as never) && !top.includes(id as never)).map((id) => ({ id, placement: 'hidden' as const })),
  ]
}

/** The phone Home header's destinations, in order: the theme's `nav.top` list (shortcuts to a
 *  bottom-bar tab included), then any other destination the effective config put at the top (a
 *  pinned Settings). Without a theme list, the effective config's own top destinations. */
export function themeHeaderIds(nav: ThemeNav | undefined, known: string[], placedTop: string[]): string[] {
  if (!nav?.top) return placedTop
  const listed = nav.top.filter((id) => known.includes(id))
  return [...listed, ...placedTop.filter((id) => !listed.includes(id as never))]
}
