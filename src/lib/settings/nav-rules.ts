// Placement rules shared by the effective navigation (nav.ts) and the Navigation settings page.
// Type-only import: nav.ts imports this module at runtime, so importing its values back would be a
// cycle (and would pull nav.ts's icon components into anything that only needs the rules).
import type { NavItemConfig, NavItemId, NavPlacement } from './nav'

/** Destinations that can never be hidden. Settings is where every placement is changed, so hiding
 *  it would leave no way back on a phone. */
export const PINNED_NAV_IDS: readonly NavItemId[] = ['settings']

/** The most movable destinations a phone bottom bar carries next to Home before a pinned one goes to
 *  the top instead. A theme's own `nav.bottom` list is capped at the same 5 (themes/presentation.ts). */
export const PHONE_BOTTOM_LIMIT = 5

const PINNED_PLACEMENTS: readonly NavPlacement[] = ['bottom', 'top']
const ALL_PLACEMENTS: readonly NavPlacement[] = ['bottom', 'top', 'hidden']

/** The placements the Navigation page offers for `id`: a pinned destination cannot be hidden. */
export function allowedPlacements(id: NavItemId): NavPlacement[] {
  return [...(PINNED_NAV_IDS.includes(id) ? PINNED_PLACEMENTS : ALL_PLACEMENTS)]
}

/**
 * Moves a hidden pinned destination somewhere visible and returns every other item untouched:
 * - not the phone layout (a desktop bottom bar): 'bottom';
 * - the phone layout with a theme's destinations: 'top', so a theme's bar (at most 5, sized for its
 *   own list, e.g. a centred pill) never widens;
 * - the phone layout with the user's own config: 'bottom', or 'top' once PHONE_BOTTOM_LIMIT
 *   destinations are already on the bar.
 */
export function pinNavItems(config: readonly NavItemConfig[], options: { themed: boolean; phone: boolean }): NavItemConfig[] {
  let bottom = config.filter((item) => item.placement === 'bottom').length
  return config.map((item) => {
    if (item.placement !== 'hidden' || !PINNED_NAV_IDS.includes(item.id)) return item
    const placement: NavPlacement = !options.phone
      ? 'bottom'
      : options.themed || bottom >= PHONE_BOTTOM_LIMIT ? 'top' : 'bottom'
    if (placement === 'bottom') bottom += 1
    return { ...item, placement }
  })
}
