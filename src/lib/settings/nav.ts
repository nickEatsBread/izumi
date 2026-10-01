// Customizable mobile navigation. Home is a FIXED anchor (always the first bottom tab, never
// movable); every other destination can live on the bottom bar, as a top-right icon on the browse
// header, or be hidden — and can be reordered. Persisted so it survives restarts.
import { persisted } from 'svelte-persisted-store'
import { derived } from 'svelte/store'
import { activeThemeLayout } from '$lib/themes/layout-state'
import { isMobile } from '$lib/platform'
import { themeNavConfig } from './theme-nav'
import { pinNavItems } from './nav-rules'
import Home from '@lucide/svelte/icons/house'
import Calendar from '@lucide/svelte/icons/calendar'
import Download from '@lucide/svelte/icons/download'
import Settings from '@lucide/svelte/icons/settings'
import Search from '@lucide/svelte/icons/search'
import Users from '@lucide/svelte/icons/users'
import Activity from '@lucide/svelte/icons/activity'
import Film from '@lucide/svelte/icons/film'
import LibraryBig from '@lucide/svelte/icons/library-big'

// Lucide icons are Svelte 5 function components. Taken off an icon we already import rather than
// from `@lucide/svelte`'s `LucideIcon`, because that root export is a barrel over every icon and
// pulling it in for one type more than triples the files svelte-check has to walk (1436 -> 5110).
type LucideIcon = typeof Home

export type NavPlacement = 'bottom' | 'top' | 'hidden'
export type NavItemId = 'schedule' | 'downloads' | 'watch' | 'settings' | 'search' | 'trakt' | 'letterboxd' | 'library'

export interface NavMeta { label: string; href: string; icon: LucideIcon }

/** Metadata for every movable destination. */
export const NAV_META: Record<NavItemId, NavMeta> = {
  schedule: { label: 'Schedule', href: '/app/schedule', icon: Calendar },
  downloads: { label: 'Downloads', href: '/app/downloads', icon: Download },
  watch: { label: 'Together', href: '/app/watch', icon: Users },
  search: { label: 'Search', href: '/app/search', icon: Search },
  settings: { label: 'Settings', href: '/app/settings', icon: Settings },
  trakt: { label: 'Trakt', href: '/app/trakt', icon: Activity },
  letterboxd: { label: 'Letterboxd', href: '/app/letterboxd', icon: Film },
  library: { label: 'Library', href: '/app/library', icon: LibraryBig },
}

/** Home — the fixed anchor. Always the first bottom tab; not part of the movable set. */
export const HOME_META: NavMeta = { label: 'Home', href: '/app/home', icon: Home }

export interface NavItemConfig { id: NavItemId; placement: NavPlacement }

/** Default mobile layout: the three primary destinations share the bottom bar with fixed Home;
 * Search and Together remain compact Home-header actions. */
export const DEFAULT_NAV: NavItemConfig[] = [
  { id: 'schedule', placement: 'bottom' },
  { id: 'downloads', placement: 'bottom' },
  { id: 'settings', placement: 'bottom' },
  { id: 'search', placement: 'top' },
  { id: 'watch', placement: 'top' },
  { id: 'library', placement: 'top' },
  { id: 'trakt', placement: 'hidden' },
  { id: 'letterboxd', placement: 'hidden' },
]

/** Raw persisted config — the Settings → Navigation page reads and writes this directly. */
export const navConfig = persisted<NavItemConfig[]>('nav-config-v1', DEFAULT_NAV)

/** Effective config: while a theme layout sets `nav.bottom`/`nav.top`, its destinations replace the
 *  user's placement entirely (the user's own config, in `navConfig`, is never written to). Otherwise
 *  guarantees every known item appears exactly once (drops unknown ids, appends any missing at their
 *  default placement) so the UI is robust to items added/removed across versions and to a
 *  partially-written stored value. Either way Settings never ends up hidden: `pinNavItems`
 *  (nav-rules.ts) moves it to the bar or the top, depending on the layout and the phone layout. */
export const effectiveNav = derived([navConfig, activeThemeLayout, isMobile], ([$c, layout, $isMobile]) => {
  const themed = layout?.nav ? themeNavConfig(layout.nav, Object.keys(NAV_META)) : null
  if (themed) return pinNavItems(themed as NavItemConfig[], { themed: true, phone: $isMobile })
  const known = Object.keys(NAV_META) as NavItemId[]
  const seen = new Set<NavItemId>()
  const out: NavItemConfig[] = []
  for (const it of $c) if (known.includes(it.id) && !seen.has(it.id)) { seen.add(it.id); out.push(it) }
  for (const d of DEFAULT_NAV) if (!seen.has(d.id)) out.push(d)
  return pinNavItems(out, { themed: false, phone: $isMobile })
})

/** Home's position on the bottom bar: 0 (first) unless the active theme layout places it elsewhere. */
export const navHomeIndex = derived(activeThemeLayout, (layout) => layout?.nav?.home ?? 0)

/** Restore the default navigation layout. */
export function resetNav() { navConfig.set(DEFAULT_NAV.map((d) => ({ ...d }))) }
