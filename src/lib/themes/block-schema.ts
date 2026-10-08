// Home block settings: types, limits and validation. Import-free — theme packages declare blocks
// too, and the theme catalog mirrors this file.
export const HOME_BLOCK_TYPES = ['latest-episodes', 'tabbed-grid', 'genre-chips', 'ranked-list', 'profile-header', 'airing-today'] as const
export type HomeBlockType = (typeof HOME_BLOCK_TYPES)[number]
export type BlockPagination = 'numbers' | 'more' | 'none'
export type BlockArea = 'main' | 'aside'
/** One tab of a tabbed grid or ranked list. `role` is a Home row id (`trending`, `tmdb:movies`) or,
 * on Merged Home, a bare role that resolves to the first catalog offering it. */
export interface BlockTab { label: string; role: string }

/** Every movable navigation destination (mirrors `NAV_META` in `$lib/settings/nav`; the app checks
 * the two stay in step). Kept here, import-free, because theme packages name destinations too. */
export const NAV_DESTINATIONS = ['schedule', 'downloads', 'watch', 'settings', 'search', 'trakt', 'letterboxd', 'library'] as const
export type NavDestination = (typeof NAV_DESTINATIONS)[number]
export type BlockDestination = NavDestination | 'home'
/** A profile-header shortcut. `art` (Theme API 4 in packages) draws artwork under the label: the
 *  banner of one of the viewer's own titles, from Continue Watching then the library. */
export interface BlockButton { label: string; to: BlockDestination; art?: boolean }

interface BlockCommon {
  /** Heading shown above the block; blocks without one fall back to their own default. */
  title?: string
  area: BlockArea
  /** Aside blocks are dropped on phones unless this is set. */
  phone: boolean
}
export type LatestEpisodesCaption = 'below' | 'overlay'
export interface LatestEpisodesBlock extends BlockCommon { type: 'latest-episodes'; columns: number; pageSize: number; pagination: BlockPagination; caption: LatestEpisodesCaption }
/** `default` is the tab open on arrival, as an index into `tabs` (absent opens the first; Theme API 4
 *  in packages). */
export interface TabbedGridBlock extends BlockCommon { type: 'tabbed-grid'; tabs: BlockTab[]; columns: number; pageSize: number; pagination: BlockPagination; default?: number }
export interface GenreChipsBlock extends BlockCommon { type: 'genre-chips'; genres: 'top' | string[]; all: boolean }
export interface RankedListBlock extends BlockCommon { type: 'ranked-list'; tabs: BlockTab[]; limit: number }
export interface ProfileHeaderBlock extends BlockCommon { type: 'profile-header'; buttons: BlockButton[] }
/** Today's airings in time order, released or still to come; `clock` adds the date and a live clock
 *  under the heading, `more` a link to the schedule. */
export interface AiringTodayBlock extends BlockCommon { type: 'airing-today'; limit: number; clock: boolean; more: boolean }
export type HomeBlock = LatestEpisodesBlock | TabbedGridBlock | GenreChipsBlock | RankedListBlock | ProfileHeaderBlock | AiringTodayBlock

export const BLOCK_LIMITS = {
  columns: [1, 8], pageSize: [4, 48], limit: [3, 20],
  tabs: 6, rankedTabs: 4, buttons: 4, genres: 30,
  label: 24, title: 40, genre: 40,
} as const

const clampInt = (value: unknown, [min, max]: readonly [number, number], fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, max)
  return trimmed || undefined
}

// A tab's role is a Home row id, not a restricted identifier: the Stremio catalog's ids embed a
// whole addon origin (`https://host/path:catalog`) and can contain `%` (percent-encoded segments)
// and `/`. Only whitespace and length are actually invalid — real row ids never contain either.
const ROLE = /^\S{1,300}$/

function parseTabs(value: unknown, max: number): BlockTab[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const tabs: BlockTab[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const label = text((item as BlockTab).label, BLOCK_LIMITS.label)
    const role = (item as BlockTab).role
    if (!label || typeof role !== 'string' || !ROLE.test(role) || seen.has(label)) continue
    seen.add(label)
    tabs.push({ label, role })
    if (tabs.length >= max) break
  }
  return tabs
}

function parseGenres(value: unknown): 'top' | string[] {
  if (!Array.isArray(value)) return 'top'
  const seen = new Set<string>()
  const genres: string[] = []
  for (const item of value) {
    const genre = text(item, BLOCK_LIMITS.genre)
    if (!genre || seen.has(genre.toLowerCase())) continue
    seen.add(genre.toLowerCase())
    genres.push(genre)
    if (genres.length >= BLOCK_LIMITS.genres) break
  }
  return genres.length ? genres : 'top'
}

function parseButtons(value: unknown): BlockButton[] {
  if (!Array.isArray(value)) return []
  const buttons: BlockButton[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const label = text((item as BlockButton).label, 20)
    const to = (item as BlockButton).to
    if (!label || !(to === 'home' || (NAV_DESTINATIONS as readonly string[]).includes(to))) continue
    const art = (item as BlockButton).art
    buttons.push({ label, to, ...(typeof art === 'boolean' ? { art } : {}) })
    if (buttons.length >= BLOCK_LIMITS.buttons) break
  }
  return buttons
}

const pagination = (value: unknown): BlockPagination => (value === 'more' || value === 'none' ? value : 'numbers')
const caption = (value: unknown): LatestEpisodesCaption => (value === 'overlay' ? 'overlay' : 'below')

/** Repair a stored or imported block. Returns null only for values that are not blocks at all. */
export function parseHomeBlock(value: unknown): HomeBlock | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const type = raw.type as HomeBlockType
  if (!HOME_BLOCK_TYPES.includes(type)) return null
  const title = text(raw.title, BLOCK_LIMITS.title)
  const common = { ...(title ? { title } : {}), area: raw.area === 'aside' ? 'aside' as const : 'main' as const, phone: raw.phone === true }
  switch (type) {
    case 'latest-episodes': return { type, ...common, columns: clampInt(raw.columns, BLOCK_LIMITS.columns, 4), pageSize: clampInt(raw.pageSize, BLOCK_LIMITS.pageSize, 12), pagination: pagination(raw.pagination), caption: caption(raw.caption) }
    case 'tabbed-grid': {
      const tabs = parseTabs(raw.tabs, BLOCK_LIMITS.tabs)
      // Only kept when given: a block that never named one re-reads exactly as it was, so a package
      // stored by this client still validates against the older theme API it declares.
      const opening = raw.default === undefined ? {} : { default: clampInt(raw.default, [0, Math.max(0, tabs.length - 1)], 0) }
      return { type, ...common, tabs, columns: clampInt(raw.columns, BLOCK_LIMITS.columns, 6), pageSize: clampInt(raw.pageSize, BLOCK_LIMITS.pageSize, 18), pagination: pagination(raw.pagination), ...opening }
    }
    case 'genre-chips': return { type, ...common, genres: raw.genres === 'top' ? 'top' : parseGenres(raw.genres), all: raw.all !== false }
    case 'ranked-list': return { type, ...common, tabs: parseTabs(raw.tabs, BLOCK_LIMITS.rankedTabs), limit: clampInt(raw.limit, BLOCK_LIMITS.limit, 10) }
    case 'profile-header': return { type, ...common, buttons: parseButtons(raw.buttons) }
    case 'airing-today': return { type, ...common, limit: clampInt(raw.limit, BLOCK_LIMITS.limit, 10), clock: raw.clock === true, more: raw.more !== false }
  }
}

const BLOCK_KEYS: Record<HomeBlockType, readonly string[]> = {
  'latest-episodes': ['columns', 'pageSize', 'pagination', 'caption'],
  'tabbed-grid': ['tabs', 'columns', 'pageSize', 'pagination', 'default'],
  'genre-chips': ['genres', 'all'],
  'ranked-list': ['tabs', 'limit'],
  'profile-header': ['buttons'],
  'airing-today': ['limit', 'clock', 'more'],
}
/** Block settings a package may only use from Theme API 4. */
const API4_BLOCK_KEYS: readonly string[] = ['default']
/** Profile-header button settings a package may only use from Theme API 4. */
const API4_BUTTON_KEYS: readonly string[] = ['art']

/** A block declared by a theme package (`{ "block": "genre-chips", … }`). Unlike stored settings,
 * which are repaired, a package is rejected when any value is not already valid. `api` is the
 * package's declared theme API: settings added later are refused on older packages. */
export function parseThemeBlock(value: unknown, api: number): HomeBlock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a theme object.')
  const raw = value as Record<string, unknown>
  const type = raw.block as HomeBlockType
  if (!HOME_BLOCK_TYPES.includes(type)) throw new Error('This theme uses an unsupported home block.')
  const allowed = ['block', 'title', 'area', 'phone', ...BLOCK_KEYS[type].filter((key) => api >= 4 || !API4_BLOCK_KEYS.includes(key))]
  if (Object.keys(raw).some((key) => !allowed.includes(key))) throw new Error('This theme uses an unsupported presentation property.')
  if (api < 4 && Array.isArray(raw.buttons) && raw.buttons.some((button) => button && typeof button === 'object' && Object.keys(button).some((key) => API4_BUTTON_KEYS.includes(key)))) {
    throw new Error('This theme uses an unsupported presentation property.')
  }
  const { block: _block, ...settings } = raw
  const parsed = parseHomeBlock({ ...settings, type }) as HomeBlock & Record<string, unknown>
  for (const [key, given] of Object.entries(settings)) {
    if (JSON.stringify(parsed[key]) !== JSON.stringify(given)) throw new Error('A home block setting is outside the supported range.')
  }
  return parsed
}
