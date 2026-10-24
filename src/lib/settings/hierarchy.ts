// The Settings route table (spec §3.2): each page's level, structural parent, desktop rail item and
// title, read off the section registry (sections.ts). One source for the phone header (title, back
// arrow), the layered Back (nav/back.ts through settings/back.ts) and the desktop rail highlight
// (SettingsNav). Pure: no stores, no DOM.
import { LEGACY_SETTINGS_ROUTES, SETTINGS_SECTIONS, SETTINGS_SUB_PAGES, settingsSection } from './sections'

export const SETTINGS_ROOT = '/app/settings'

export interface SettingsNode {
  /** Normalised pathname: no query, no hash, no trailing slash. */
  path: string
  /** 0 = the index, 1 = a section page, 2-3 = a sub-page reached from its section. */
  level: 0 | 1 | 2 | 3
  /** Where Back goes up to; null at the index and outside Settings. */
  parent: string | null
  /** Pathnames whose history entry counts as "the parent", so Back can return through history. */
  accepts: readonly string[]
  /** The desktop rail link that stays lit here; null when the rail has no item for the page. */
  railHref: string | null
  /** The phone header title; null at the index (the caller shows "Settings") and outside Settings. */
  title: string | null
}

type KnownNode = Omit<SettingsNode, 'path'>

const route = (rest: string) => `${SETTINGS_ROOT}/${rest}`

/** Pages Back may also return to through history, besides the structural parent (decision 8). */
const ALSO_ACCEPTS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ['store', [route('library')]],
  ['library/collections', [route('library/home')]],
  ['theme-studio', [route('themes')]],
])

/** Strip the query, the hash and any trailing slash. */
export function normaliseSettingsPath(pathname: string): string {
  return pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
}

export function isSettingsPath(pathname: string): boolean {
  const path = normaliseSettingsPath(pathname)
  return path === SETTINGS_ROOT || path.startsWith(`${SETTINGS_ROOT}/`)
}

/** A route the registry names: a section page (level 1), a sub-page (level 2), or an old route whose
 *  page still renders until its content moves, answering as the route it will redirect to. */
function known(rest: string): KnownNode | null {
  const legacy = LEGACY_SETTINGS_ROUTES.get(rest)
  if (legacy) return known(legacy.split('#')[0])
  const sub = SETTINGS_SUB_PAGES.get(rest)
  if (sub) {
    const parent = settingsSection(sub.section).href
    return { level: 2, parent, accepts: [parent, ...(ALSO_ACCEPTS.get(rest) ?? [])], railHref: parent, title: sub.title }
  }
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === rest)
  return section ? { level: 1, parent: SETTINGS_ROOT, accepts: [SETTINGS_ROOT], railHref: section.href, title: section.title } : null
}

export function settingsNode(pathname: string): SettingsNode {
  const path = normaliseSettingsPath(pathname)
  if (!isSettingsPath(path)) return { path, level: 0, parent: null, accepts: [], railHref: null, title: null }
  // The bare landing renders the Playback section on desktop, so Playback stays lit on the rail.
  if (path === SETTINGS_ROOT) return { path, level: 0, parent: null, accepts: [], railHref: route('playback'), title: null }
  const rest = path.slice(SETTINGS_ROOT.length + 1)
  const node = known(rest)
  if (node) return { path, ...node }
  // A deeper route nobody named goes up one segment and keeps its nearest named ancestor's rail item
  // and title.
  const segments = rest.split('/')
  const parent = segments.length > 1 ? path.slice(0, path.lastIndexOf('/')) : SETTINGS_ROOT
  let ancestor: KnownNode | null = null
  for (let depth = segments.length - 1; depth > 0 && !ancestor; depth--) ancestor = known(segments.slice(0, depth).join('/'))
  return {
    path,
    level: Math.min(segments.length, 3) as 1 | 2 | 3,
    parent,
    accepts: [parent],
    railHref: ancestor?.railHref ?? null,
    title: ancestor?.title ?? null,
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
