// Nuvio collections as Home rows (`collection:<id>`), placed, hidden and moved like any other row. A
// built-in screen shows a new collection right after the banner, where collections always sat; a custom
// screen starts with it off, like every other section there.
import { isCustomScreen } from '$lib/settings/catalog'
import type { CatalogHomeTarget } from '../home-layout'
import type { CatalogHomeRowOption } from '../types'
import type { HomeCollection } from './model'

const PREFIX = 'collection:'
export const collectionRowId = (id: string): string => `${PREFIX}${id}`
export const collectionIdOf = (rowId: string): string | null => (rowId.startsWith(PREFIX) ? rowId.slice(PREFIX.length) : null)

export function collectionRowOptions(collections: HomeCollection[], target: CatalogHomeTarget): CatalogHomeRowOption[] {
  return [...collections]
    .filter((collection) => collection.folders.length)
    .sort((a, b) => Number(b.pinToTop) - Number(a.pinToTop))
    .map((collection) => ({
      id: collectionRowId(collection.id),
      title: collection.title,
      description: `${collection.folders.length} ${collection.folders.length === 1 ? 'folder' : 'folders'}`,
      group: 'Collections',
      lead: true,
      defaultEnabled: !isCustomScreen(target),
    }))
}
