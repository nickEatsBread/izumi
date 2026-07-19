// Customizable mobile navigation. Home is a FIXED anchor (always the first bottom tab, never
// movable); every other destination can live on the bottom bar, as a top-right icon on the browse
// header, or be hidden — and can be reordered. Persisted so it survives restarts.
import { persisted } from 'svelte-persisted-store'
import { derived } from 'svelte/store'
import type { ComponentType } from 'svelte'
import Home from 'lucide-svelte/icons/house'
import Calendar from 'lucide-svelte/icons/calendar'
import Download from 'lucide-svelte/icons/download'
import Settings from 'lucide-svelte/icons/settings'
import Search from 'lucide-svelte/icons/search'
import Bookmark from 'lucide-svelte/icons/bookmark'

export type NavPlacement = 'bottom' | 'top' | 'hidden'
export type NavItemId = 'schedule' | 'downloads' | 'settings' | 'mylist' | 'search'

export interface NavMeta { label: string; href: string; icon: ComponentType }

/** Metadata for every movable destination. */
export const NAV_META: Record<NavItemId, NavMeta> = {
  schedule: { label: 'Schedule', href: '/app/schedule', icon: Calendar },
  downloads: { label: 'Downloads', href: '/app/downloads', icon: Download },
  mylist: { label: 'My List', href: '/app/mylist', icon: Bookmark },
  search: { label: 'Search', href: '/app/search', icon: Search },
  settings: { label: 'Settings', href: '/app/settings', icon: Settings },
}

/** Home — the fixed anchor. Always the first bottom tab; not part of the movable set. */
export const HOME_META: NavMeta = { label: 'Home', href: '/app/home', icon: Home }

export interface NavItemConfig { id: NavItemId; placement: NavPlacement }

/** Defaults reproduce today's layout: Schedule/Downloads/Settings on the bottom bar, Search as a
 *  top icon, My List hidden (opt-in). Array order = display order within each placement. */
export const DEFAULT_NAV: NavItemConfig[] = [
  { id: 'schedule', placement: 'bottom' },
  { id: 'downloads', placement: 'bottom' },
  { id: 'settings', placement: 'bottom' },
  { id: 'search', placement: 'top' },
  { id: 'mylist', placement: 'hidden' },
]

/** Raw persisted config — the Settings → Navigation page reads and writes this directly. */
export const navConfig = persisted<NavItemConfig[]>('nav-config-v1', DEFAULT_NAV)

/** Effective config: guarantees every known item appears exactly once (drops unknown ids, appends
 *  any missing at their default placement) so the UI is robust to items added/removed across
 *  versions and to a partially-written stored value. */
export const effectiveNav = derived(navConfig, ($c) => {
  const known = Object.keys(NAV_META) as NavItemId[]
  const seen = new Set<NavItemId>()
  const out: NavItemConfig[] = []
  for (const it of $c) if (known.includes(it.id) && !seen.has(it.id)) { seen.add(it.id); out.push(it) }
  for (const d of DEFAULT_NAV) if (!seen.has(d.id)) out.push(d)
  return out
})

/** Restore the default navigation layout. */
export function resetNav() { navConfig.set(DEFAULT_NAV.map((d) => ({ ...d }))) }
