// The listings a source puts in the menu (a catalog's `izumi.menu`): its watchlist, its history, its
// seasons. Each opens as a grid of its titles (/app/listing); one that names an extra (a season, say)
// opens on a wall of that extra's options first.
import type { AddonCatalog, AddonManifest } from '$lib/stremio/manifest'

export type SourceMenuIcon = 'bookmark' | 'history' | 'calendar' | 'list'
const ICONS: SourceMenuIcon[] = ['bookmark', 'history', 'calendar', 'list']

export interface SourceMenu {
  /** `type:id`, the listing's address in /app/listing. */
  value: string
  label: string
  icon: SourceMenuIcon
  /** The extra whose options the screen opens on, when it names one. */
  extra?: string
  options: string[]
  entry: AddonCatalog
}

export function sourceMenus(manifest: AddonManifest): SourceMenu[] {
  return (manifest.catalogs ?? []).flatMap((entry): SourceMenu[] => {
    const menu = entry.izumi?.menu
    const label = typeof menu?.label === 'string' ? menu.label.trim().slice(0, 40) : ''
    if (!label) return []
    const extra = typeof menu?.extra === 'string' && menu.extra ? menu.extra : undefined
    const options = extra ? [...new Set((entry.extra?.find((item) => item.name === extra)?.options ?? []).filter((option) => typeof option === 'string' && option))] : []
    // A screen that would open on an empty wall is left out.
    if (extra && !options.length) return []
    const icon = ICONS.includes(menu?.icon as SourceMenuIcon) ? menu?.icon as SourceMenuIcon : 'list'
    return [{ value: `${entry.type}:${entry.id}`, label, icon, ...(extra ? { extra } : {}), options, entry }]
  })
}

/** The listing's screen, narrowed to `option` of its extra when given. */
export function listingHref(menu: Pick<SourceMenu, 'value' | 'extra'>, option?: string): string {
  const params = new URLSearchParams({ catalog: menu.value })
  if (option && menu.extra) params.set(menu.extra, option)
  return `/app/listing?${params}`
}
