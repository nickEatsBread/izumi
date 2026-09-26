// Home blocks: special Home sections (latest episodes, tabbed grid, genre chips, ranked list,
// profile header). A block is a Home row whose id is `block:<type>:<n>`; the row's position lives in
// the catalog's Home layout like any other row, and its settings live here. Settings are repaired
// through `parseHomeBlock` on every write, so a stale or hand-edited value can never break Home.
import { persisted } from 'svelte-persisted-store'
import type { NavItemId } from '$lib/settings/nav'

export const HOME_BLOCK_TYPES = ['latest-episodes', 'tabbed-grid', 'genre-chips', 'ranked-list', 'profile-header'] as const
export type HomeBlockType = (typeof HOME_BLOCK_TYPES)[number]
export type BlockPagination = 'numbers' | 'more' | 'none'
export type BlockArea = 'main' | 'aside'
/** One tab of a tabbed grid or ranked list. `role` is a Home row id (`trending`, `tmdb:movies`) or,
 * on Merged Home, a bare role that resolves to the first catalog offering it. */
export interface BlockTab { label: string; role: string }
export type BlockDestination = NavItemId | 'home'
export interface BlockButton { label: string; to: BlockDestination }

interface BlockCommon {
  /** Heading shown above the block; blocks without one fall back to their own default. */
  title?: string
  area: BlockArea
  /** Aside blocks are dropped on phones unless this is set. */
  phone: boolean
}
export interface LatestEpisodesBlock extends BlockCommon { type: 'latest-episodes'; columns: number; pageSize: number; pagination: BlockPagination }
export interface TabbedGridBlock extends BlockCommon { type: 'tabbed-grid'; tabs: BlockTab[]; columns: number; pageSize: number; pagination: BlockPagination }
export interface GenreChipsBlock extends BlockCommon { type: 'genre-chips'; genres: 'top' | string[]; all: boolean }
export interface RankedListBlock extends BlockCommon { type: 'ranked-list'; tabs: BlockTab[]; limit: number }
export interface ProfileHeaderBlock extends BlockCommon { type: 'profile-header'; buttons: BlockButton[] }
export type HomeBlock = LatestEpisodesBlock | TabbedGridBlock | GenreChipsBlock | RankedListBlock | ProfileHeaderBlock

export const BLOCK_META: Record<HomeBlockType, { title: string; description: string }> = {
  'latest-episodes': { title: 'Latest episodes', description: 'Newly aired episodes as a grid of episode stills, newest first.' },
  'tabbed-grid': { title: 'Tabbed grid', description: 'Switch between several catalog rows in one poster grid.' },
  'genre-chips': { title: 'Genre chips', description: 'Genre shortcuts that open search.' },
  'ranked-list': { title: 'Ranked list', description: 'A numbered top list, with optional tabs.' },
  'profile-header': { title: 'Profile header', description: 'Your profile banner with watch stats and shortcuts.' },
}

export const BLOCK_LIMITS = {
  columns: [1, 8], pageSize: [4, 48], limit: [3, 20],
  tabs: 6, rankedTabs: 4, buttons: 4, genres: 30,
  label: 24, title: 40, genre: 40,
} as const

/** "Popular genres" for a genre-chips block; filtered to the genres the catalog actually has. */
export const TOP_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi', 'Slice of Life', 'Mystery', 'Supernatural', 'Sports', 'Horror']

/** Titles of the AniList Home rows, used to label default tabs. */
const ROLE_TITLES: Record<string, string> = {
  season: 'Popular This Season', trending: 'Trending Now', popular: 'All Time Popular',
  romance: 'Romance', action: 'Action', fantasy: 'Fantasy', rated: 'Highest Rated',
}

export const homeBlocks = persisted<Record<string, HomeBlock>>('home-blocks-v1', {})
/** Width of the Home side column on wide screens (240–420 px). */
export const homeAsideWidth = persisted<number>('home-aside-width-v1', 320)

const BLOCK_ID = /^block:([a-z-]+):(\d{1,4})$/
const ROLE = /^[A-Za-z0-9_.:-]{1,80}$/

export function blockType(id: string): HomeBlockType | null {
  const match = BLOCK_ID.exec(id)
  const type = match?.[1] as HomeBlockType | undefined
  return type && HOME_BLOCK_TYPES.includes(type) ? type : null
}

export const isBlockId = (id: string): boolean => blockType(id) !== null

export function nextBlockId(type: HomeBlockType, taken: Iterable<string>): string {
  let highest = 0
  for (const id of taken) {
    const match = BLOCK_ID.exec(id)
    if (match?.[1] === type) highest = Math.max(highest, Number(match[2]))
  }
  return `block:${type}:${highest + 1}`
}

/** Latest episodes come from the AniList airing schedule, so they only make sense on an AniList Home. */
export function blockAvailable(type: HomeBlockType, usesAniList: boolean): boolean {
  return type !== 'latest-episodes' || usesAniList
}

const roleTitle = (role: string) => {
  const bare = role.includes(':') ? role.slice(role.indexOf(':') + 1) : role
  return ROLE_TITLES[bare] ?? bare.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

/** A fresh block. `roles` are the tabbable Home rows of the current catalog, in order. */
export function defaultBlock(type: HomeBlockType, roles: string[] = []): HomeBlock {
  const common = { area: 'main' as const, phone: false }
  const tabs = (count: number) => roles.slice(0, count).map((role) => ({ label: roleTitle(role), role }))
  switch (type) {
    case 'latest-episodes': return { type, ...common, columns: 4, pageSize: 12, pagination: 'numbers' }
    case 'tabbed-grid': return { type, ...common, tabs: tabs(3), columns: 6, pageSize: 18, pagination: 'numbers' }
    case 'genre-chips': return { type, ...common, genres: 'top', all: true }
    case 'ranked-list': return { type, ...common, tabs: tabs(1), limit: 10 }
    case 'profile-header': return { type, ...common, buttons: [{ label: 'Library', to: 'library' }, { label: 'Schedule', to: 'schedule' }] }
  }
}

const clampInt = (value: unknown, [min, max]: readonly [number, number], fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, max)
  return trimmed || undefined
}

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

// Mirrors the keys of `NAV_META` in `$lib/settings/nav`. Kept as a plain id list (not imported)
// so parsing a block never has to load nav.ts's Lucide icon components — those are Svelte files,
// and this module is pulled into unit tests that run without the Svelte plugin. The type check
// below fails if a destination is added to `NavItemId` but not here.
const NAV_ITEM_IDS = ['schedule', 'downloads', 'watch', 'settings', 'search', 'trakt', 'letterboxd', 'library'] as const satisfies readonly NavItemId[]
const everyNavItemListed: [Exclude<NavItemId, (typeof NAV_ITEM_IDS)[number]>] extends [never] ? true : never = true
void everyNavItemListed

function parseButtons(value: unknown): BlockButton[] {
  if (!Array.isArray(value)) return []
  const buttons: BlockButton[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const label = text((item as BlockButton).label, 20)
    const to = (item as BlockButton).to
    if (!label || !(to === 'home' || (NAV_ITEM_IDS as readonly string[]).includes(to))) continue
    buttons.push({ label, to })
    if (buttons.length >= BLOCK_LIMITS.buttons) break
  }
  return buttons
}

const pagination = (value: unknown): BlockPagination => (value === 'more' || value === 'none' ? value : 'numbers')

/** Repair a stored or imported block. Returns null only for values that are not blocks at all. */
export function parseHomeBlock(value: unknown): HomeBlock | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const type = raw.type as HomeBlockType
  if (!HOME_BLOCK_TYPES.includes(type)) return null
  const title = text(raw.title, BLOCK_LIMITS.title)
  const common = { ...(title ? { title } : {}), area: raw.area === 'aside' ? 'aside' as const : 'main' as const, phone: raw.phone === true }
  switch (type) {
    case 'latest-episodes': return { type, ...common, columns: clampInt(raw.columns, BLOCK_LIMITS.columns, 4), pageSize: clampInt(raw.pageSize, BLOCK_LIMITS.pageSize, 12), pagination: pagination(raw.pagination) }
    case 'tabbed-grid': return { type, ...common, tabs: parseTabs(raw.tabs, BLOCK_LIMITS.tabs), columns: clampInt(raw.columns, BLOCK_LIMITS.columns, 6), pageSize: clampInt(raw.pageSize, BLOCK_LIMITS.pageSize, 18), pagination: pagination(raw.pagination) }
    case 'genre-chips': return { type, ...common, genres: raw.genres === 'top' ? 'top' : parseGenres(raw.genres), all: raw.all !== false }
    case 'ranked-list': return { type, ...common, tabs: parseTabs(raw.tabs, BLOCK_LIMITS.rankedTabs), limit: clampInt(raw.limit, BLOCK_LIMITS.limit, 10) }
    case 'profile-header': return { type, ...common, buttons: parseButtons(raw.buttons) }
  }
}
