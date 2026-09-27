// Where the theme top bar's Categories menu leads, and where its panel sits. Kept pure so it can be
// tested without a DOM.
import { isLegacyAniListCatalog, mergedCatalogProviders, type CatalogScreen, type CatalogSelection } from '$lib/settings/catalog'

/** What the Categories menu browses. */
export interface CategoriesCatalog {
  /** The catalog whose genres the menu lists and whose search its links open. */
  catalog: CatalogSelection
  /** The scope a Merged screen's search must open (`provider=`); a single catalog needs none. */
  provider?: CatalogSelection
}

/** The catalog on screen. Merged search filters only inside one of its catalogs, so a Merged screen
 *  browses the AniList-based catalog it includes, else its first one. */
export function categoriesCatalog(screen: CatalogScreen, providers: unknown): CategoriesCatalog {
  if (screen !== 'merged') return { catalog: screen }
  const scopes = mergedCatalogProviders(providers)
  const scope = scopes.find(isLegacyAniListCatalog) ?? scopes[0]
  return { catalog: scope, provider: scope }
}

function searchHref(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => !!entry[1])).toString()
  return query ? `/app/search?${query}` : '/app/search'
}

/** Search filtered to one genre. */
export const genreHref = ({ provider }: CategoriesCatalog, genre: string): string => searchHref({ provider, genre })

/** "Browse all": AniList search sorted by popularity. The other catalogs' search pages have sorts
 *  of their own and open on their default (popular). */
export const browseAllHref = ({ catalog, provider }: CategoriesCatalog): string =>
  searchHref({ provider, sort: isLegacyAniListCatalog(catalog) ? 'POPULARITY_DESC' : undefined })

/** Breathing room from the window edge, in local px. */
const EDGE = 8

/** Where the fixed, portalled panel goes: under its button, slid left until its real width fits
 *  the window. `trigger`, `panelWidth` and `viewportWidth` are screen px (getBoundingClientRect,
 *  innerWidth); the result is local px for the panel's own left/top under the UI-scale `zoom` (see
 *  cards/preview-pos.ts for the two coordinate spaces). */
export function categoriesPanelPlace(
  trigger: { left: number; bottom: number },
  panelWidth: number,
  viewportWidth: number,
  zoom = 1,
): { left: number; top: number } {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const edge = EDGE * z
  const left = Math.max(edge, Math.min(trigger.left, viewportWidth - panelWidth - edge))
  return { left: left / z, top: trigger.bottom / z }
}
