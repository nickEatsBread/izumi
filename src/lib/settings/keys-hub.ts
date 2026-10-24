import { SETTINGS_SEARCH_INDEX, settingHref } from './search'

// Accounts › Keys lists every credential the app stores. A row only shows whether its key is set
// and links to the row that edits it: the stores and their editors stay with their features.

export type KeyHubId = 'tmdb' | 'omdb' | 'opensubtitles' | 'subdl' | 'jimaku' | 'debrid'

export interface KeyHubEntry {
  id: KeyHubId
  title: string
  description: string
  /** Title of the search entry for the row that edits this key. */
  searchTitle: string
}

export const KEY_HUB: readonly KeyHubEntry[] = [
  { id: 'tmdb', title: 'TMDB read access token', description: 'Movie and TV catalogs', searchTitle: 'TMDB read access token' },
  { id: 'omdb', title: 'OMDb API key', description: 'Critic ratings on detail pages', searchTitle: 'OMDb API key' },
  { id: 'opensubtitles', title: 'OpenSubtitles account', description: 'Subtitle search and downloads', searchTitle: 'OpenSubtitles' },
  { id: 'subdl', title: 'SubDL API key', description: 'More subtitle results', searchTitle: 'SubDL' },
  { id: 'jimaku', title: 'Jimaku API key', description: 'Japanese subtitle results', searchTitle: 'Jimaku' },
  { id: 'debrid', title: 'Debrid service key', description: 'Cached torrent streams', searchTitle: 'Debrid token' },
]

/** Where a key is edited: its search entry's row (`?setting=`), or the entry's subcategory anchor
 *  when the entry names no row. */
export function keyHubHref(entry: KeyHubEntry): string {
  const item = SETTINGS_SEARCH_INDEX.find((candidate) => candidate.title === entry.searchTitle)
  if (!item) throw new Error(`No settings search entry titled "${entry.searchTitle}"`)
  return item.key ? settingHref(item) : `${item.href}#${item.subcategory}`
}
