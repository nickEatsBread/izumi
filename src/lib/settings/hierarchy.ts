// The Settings route table (spec §3.8): each page's level, structural parent, desktop rail item and
// title. One source for the phone header (title, back arrow), the layered Back (nav/back.ts through
// settings/back.ts) and the desktop rail highlight (SettingsNav). Pure: no stores, no DOM.

export const SETTINGS_ROOT = '/app/settings'

export interface SettingsNode {
  /** Normalised pathname: no query, no hash, no trailing slash. */
  path: string
  /** 0 = the index, 1 = a category page, 2-3 = a sub-page reached from its category. */
  level: 0 | 1 | 2 | 3
  /** Where Back goes up to (an href that may name a tab); null at the index and outside Settings. */
  parent: string | null
  /** Pathnames whose history entry counts as "the parent", so Back can return through history. */
  accepts: readonly string[]
  /** The desktop rail link that stays lit here; null when the rail has no item for the page. */
  railHref: string | null
  /** The phone header title; null at the index (the caller shows "Settings") and outside Settings. */
  title: string | null
}

const route = (rest: string) => `${SETTINGS_ROOT}/${rest}`

/** Titles by route below /app/settings; the longest matching prefix wins. */
const TITLES = new Map<string, string>([
  ['player', 'Player'],
  ['subtitles', 'Subtitles'],
  ['hotkeys', 'Hotkeys'],
  ['catalog', 'Catalog'],
  ['catalog/home', 'Customize Home'],
  ['catalog/collections', 'Collections & covers'],
  ['sources', 'Sources'],
  ['sources/priority', 'Source priority'],
  ['store', 'Store'],
  // A redirect to Sources' Manage tab (extensions/+page.ts); titled so every route has one.
  ['extensions', 'Sources'],
  ['downloads', 'Downloads'],
  ['storage', 'Storage'],
  ['profiles', 'Profiles'],
  ['interface', 'Interface'],
  ['themes', 'Themes'],
  ['theme-studio', 'Theme Studio'],
  ['navigation', 'Navigation'],
  ['history', 'History'],
  ['scenes', 'Scene bookmarks'],
  ['sync', 'Device sync'],
  ['backup', 'Backup & restore'],
  ['accounts', 'Accounts'],
  ['network', 'Network'],
  ['changelog', 'Changelog'],
  ['about', 'About'],
  ['about/license-information', 'License Information'],
])

/** Sub-pages whose parent is not simply "drop the last segment". Tabs are not levels: the parent
 *  href names the tab the sub-page belongs to. A cross-link still goes up to the structural parent
 *  (decision 8); `accepts` lists the pages Back may return to through history instead. */
const PARENTS = new Map<string, { parent: string; accepts: readonly string[] }>([
  ['sources/priority', { parent: route('sources?tab=ordering'), accepts: [route('sources')] }],
  ['store', { parent: route('sources?tab=manage'), accepts: [route('sources'), route('catalog')] }],
  ['catalog/home', { parent: route('catalog'), accepts: [route('catalog')] }],
  ['catalog/collections', { parent: route('catalog'), accepts: [route('catalog'), route('catalog/home')] }],
  ['about/license-information', { parent: route('about'), accepts: [route('about')] }],
])

/** Rail items for routes that are not their own first segment. null = no rail item: Navigation
 *  configures the phone shell, so the desktop rail leaves it out. */
const RAIL = new Map<string, string | null>([
  ['store', route('sources')],
  ['extensions', route('sources')],
  ['theme-studio', route('themes')],
  ['navigation', null],
])

/** Strip the query, the hash and any trailing slash. */
export function normaliseSettingsPath(pathname: string): string {
  return pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
}

export function isSettingsPath(pathname: string): boolean {
  const path = normaliseSettingsPath(pathname)
  return path === SETTINGS_ROOT || path.startsWith(`${SETTINGS_ROOT}/`)
}

function titleFor(rest: string): string | null {
  let best: string | null = null
  for (const key of TITLES.keys()) {
    if ((rest === key || rest.startsWith(`${key}/`)) && (best === null || key.length > best.length)) best = key
  }
  return best === null ? null : TITLES.get(best) ?? null
}

export function settingsNode(pathname: string): SettingsNode {
  const path = normaliseSettingsPath(pathname)
  if (!isSettingsPath(path)) return { path, level: 0, parent: null, accepts: [], railHref: null, title: null }
  // The bare landing renders the Player pane on desktop, so Player stays lit on the rail.
  if (path === SETTINGS_ROOT) return { path, level: 0, parent: null, accepts: [], railHref: route('player'), title: null }
  const rest = path.slice(SETTINGS_ROOT.length + 1)
  const segments = rest.split('/')
  const named = PARENTS.get(rest)
  const parent = named?.parent ?? (segments.length > 1 ? path.slice(0, path.lastIndexOf('/')) : SETTINGS_ROOT)
  return {
    path,
    level: named ? 2 : (Math.min(segments.length, 3) as 1 | 2 | 3),
    parent,
    accepts: named?.accepts ?? [parent],
    railHref: RAIL.has(rest) ? RAIL.get(rest) ?? null : route(segments[0]),
    title: titleFor(rest),
  }
}

export function settingsParent(pathname: string): { href: string; accepts: readonly string[] } | null {
  const node = settingsNode(pathname)
  return node.parent === null ? null : { href: node.parent, accepts: node.accepts }
}

export function settingsPageTitle(pathname: string): string | null {
  return settingsNode(pathname).title
}

export function settingsRailHref(pathname: string): string | null {
  return settingsNode(pathname).railHref
}
