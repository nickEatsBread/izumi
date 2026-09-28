import type { ThemeNav } from '$lib/themes/presentation'
// Type-only: erased at build time, so this never loads nav.ts's icon components.
import type { NavPlacement } from './nav'

/** A theme's bottom/top lists as a nav config; null when the theme leaves destinations to the user. */
export function themeNavConfig(nav: ThemeNav, known: string[]): Array<{ id: string; placement: NavPlacement }> | null {
  if (!nav.bottom && !nav.top) return null
  const bottom = nav.bottom ?? []
  const top = nav.top ?? []
  return [
    ...bottom.filter((id) => known.includes(id)).map((id) => ({ id, placement: 'bottom' as const })),
    ...top.filter((id) => known.includes(id)).map((id) => ({ id, placement: 'top' as const })),
    ...known.filter((id) => !bottom.includes(id as never) && !top.includes(id as never)).map((id) => ({ id, placement: 'hidden' as const })),
  ]
}
