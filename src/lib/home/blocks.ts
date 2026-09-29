// Home blocks: special Home sections (latest episodes, tabbed grid, genre chips, ranked list,
// profile header, airing today). A block is a Home row whose id is `block:<type>:<n>`; the row's position lives in
// the catalog's Home layout like any other row, and its settings live here. Settings are repaired
// through `parseHomeBlock` on every write, so a stale or hand-edited value can never break Home.
import { persisted } from 'svelte-persisted-store'
import type { NavItemId } from '$lib/settings/nav'
import { HOME_BLOCK_TYPES, NAV_DESTINATIONS, type HomeBlock, type HomeBlockType } from '$lib/themes/block-schema'

export {
  BLOCK_LIMITS, HOME_BLOCK_TYPES, NAV_DESTINATIONS, parseHomeBlock, parseThemeBlock,
  type AiringTodayBlock, type BlockArea, type BlockButton, type BlockDestination, type BlockPagination, type BlockTab,
  type GenreChipsBlock, type HomeBlock, type HomeBlockType, type LatestEpisodesBlock, type NavDestination,
  type ProfileHeaderBlock, type RankedListBlock, type TabbedGridBlock,
} from '$lib/themes/block-schema'

export const BLOCK_META: Record<HomeBlockType, { title: string; description: string }> = {
  'latest-episodes': { title: 'Latest episodes', description: 'Newly aired episodes as a grid of episode stills, newest first.' },
  'tabbed-grid': { title: 'Tabbed grid', description: 'Switch between several catalog rows in one poster grid.' },
  'genre-chips': { title: 'Genre chips', description: 'Genre shortcuts that open search.' },
  'ranked-list': { title: 'Ranked list', description: 'A numbered top list, with optional tabs.' },
  'profile-header': { title: 'Profile header', description: 'Your profile banner with watch stats and shortcuts.' },
  'airing-today': { title: 'Airing today', description: "Today's episodes in airing order, ticked once they air." },
}

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

/** Latest episodes and today's airings come from the AniList airing schedule, so they only make sense on an AniList Home. */
export function blockAvailable(type: HomeBlockType, usesAniList: boolean): boolean {
  return (type !== 'latest-episodes' && type !== 'airing-today') || usesAniList
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
    case 'latest-episodes': return { type, ...common, columns: 4, pageSize: 12, pagination: 'numbers', caption: 'below' }
    case 'tabbed-grid': return { type, ...common, tabs: tabs(3), columns: 6, pageSize: 18, pagination: 'numbers' }
    case 'genre-chips': return { type, ...common, genres: 'top', all: true }
    case 'ranked-list': return { type, ...common, tabs: tabs(1), limit: 10 }
    case 'profile-header': return { type, ...common, buttons: [{ label: 'Library', to: 'library' }, { label: 'Schedule', to: 'schedule' }] }
    case 'airing-today': return { type, ...common, area: 'aside', limit: 10, clock: false, more: true }
  }
}

// NAV_DESTINATIONS must list exactly the NavItemId values (the type check fails otherwise).
const destinationsMatchNav: [Exclude<NavItemId, (typeof NAV_DESTINATIONS)[number]> | Exclude<(typeof NAV_DESTINATIONS)[number], NavItemId>] extends [never] ? true : never = true
void destinationsMatchNav
