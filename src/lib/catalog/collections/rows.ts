// Nuvio collections as Home rows (`collection:<id>`), placed, hidden and moved like any other row. A
// collection starts off on every screen: Edit Home's Add section puts it where it should show.
import { get } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { catalogHomeLayouts, type CatalogHomeLayoutKey, type CatalogHomeLayouts } from '../home-layout'
import type { CatalogHomeRowOption } from '../types'
import type { HomeCollection } from './model'
import { homeCollections } from './store'

const PREFIX = 'collection:'
export const collectionRowId = (id: string): string => `${PREFIX}${id}`
export const collectionIdOf = (rowId: string): string | null => (rowId.startsWith(PREFIX) ? rowId.slice(PREFIX.length) : null)

export function collectionRowOptions(collections: HomeCollection[]): CatalogHomeRowOption[] {
  return [...collections]
    .filter((collection) => collection.folders.length)
    .sort((a, b) => Number(b.pinToTop) - Number(a.pinToTop))
    .map((collection) => ({
      id: collectionRowId(collection.id),
      title: collection.title,
      description: `${collection.folders.length} ${collection.folders.length === 1 ? 'folder' : 'folders'}`,
      group: 'Collections',
      defaultEnabled: false,
    }))
}

const BUILT_IN_LAYOUTS: CatalogHomeLayoutKey[] = ['anilist', 'kitsu', 'tmdb', 'stremio', 'jvm', 'merged']

/** Collections used to sit at the top of every Home. The ones someone already has keep that place on
 *  every built-in screen, right after the banner, unless a layout already places or hides them. */
export function placeExistingCollections(collections: HomeCollection[], layouts: CatalogHomeLayouts): CatalogHomeLayouts {
  const ids = collectionRowOptions(collections).map((option) => option.id)
  if (!ids.length) return layouts
  const next = { ...layouts }
  for (const key of BUILT_IN_LAYOUTS) {
    const current = layouts[key]
    const order = Array.isArray(current?.order) ? current.order : ['hero']
    const disabled = Array.isArray(current?.disabled) ? current.disabled : []
    const fresh = ids.filter((id) => !order.includes(id) && !disabled.includes(id))
    const afterHero = order.indexOf('hero') + 1
    next[key] = { order: [...order.slice(0, afterHero), ...fresh, ...order.slice(afterHero)], disabled }
  }
  return next
}

// Once per install, before any Home reads its rows: later imports start off everywhere.
const existingCollectionsPlaced = persisted('catalog-collection-rows-placed-v1', false)
if (!get(existingCollectionsPlaced)) {
  catalogHomeLayouts.update((layouts) => placeExistingCollections(get(homeCollections), layouts))
  existingCollectionsPlaced.set(true)
}
