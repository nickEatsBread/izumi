// Episode list paging and search, kept pure so the rules are testable without a page.

/** izumi's own page size. */
export const DEFAULT_PAGE_SIZE = 48

/** Episodes per page or range: the theme's size; with `auto` 25, 50 or 100 for lists under 250,
 *  under 500 or longer; izumi's 48 otherwise. */
export function pageSizeFor(total: number, size?: number | 'auto'): number {
  if (size === 'auto') return total < 250 ? 25 : total < 500 ? 50 : 100
  return size ?? DEFAULT_PAGE_SIZE
}

/** The page on screen: the one the viewer picked, else the one holding the next episode, kept inside
 *  the list when the page count changes (an `auto` size grows with the list; a theme sets another). */
export function shownPage(picked: number | null, auto: number, pages: number): number {
  return Math.max(0, Math.min(picked ?? auto, pages - 1))
}

/** One label per page from its printed first and last episode ("1–50", "1051–1072"), or the bare
 *  number for a one-episode page. A picker passes the spaced separator (" – "). */
export function episodeRanges(episodes: number[], per: number, label: (episode: number) => string = String, separator = '–'): string[] {
  const ranges: string[] = []
  for (let start = 0; start < episodes.length; start += per) {
    const first = episodes[start]
    const last = episodes[Math.min(start + per, episodes.length) - 1]
    ranges.push(first === last ? label(first) : `${label(first)}${separator}${label(last)}`)
  }
  return ranges
}

export interface SearchableEpisode { title?: string; abs?: number }

/** The whole list filtered by a query, `null` when there is nothing to filter by. Episodes whose
 *  number (or series-wide number) starts with the query come first, so typing a number jumps to
 *  it; every other match follows (a number or title containing the query). Both keep list order. */
export function searchEpisodes(episodes: number[], query: string, meta: Record<number, SearchableEpisode | undefined>): number[] | null {
  const q = query.trim().toLocaleLowerCase().replace(/^ep(?:isode)?\s*/i, '')
  if (!q) return null
  const numbered: number[] = []
  const rest: number[] = []
  for (const episode of episodes) {
    const number = String(episode)
    const abs = meta[episode]?.abs
    const absolute = abs == null ? '' : String(abs)
    if (number.startsWith(q) || (absolute !== '' && absolute.startsWith(q))) numbered.push(episode)
    else if (number.includes(q) || (absolute !== '' && absolute.includes(q)) || meta[episode]?.title?.toLocaleLowerCase().includes(q)) rest.push(episode)
  }
  return [...numbered, ...rest]
}
