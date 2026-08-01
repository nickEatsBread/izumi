import { phttp } from '$lib/net/http'

export interface ChangelogEntry { sha: string; date: string; message: string }
export interface ChangelogPage { entries: ChangelogEntry[]; hasMore: boolean }
interface RawCommit { sha: string; commit: { message: string; author: { date: string } } }

const COMMITS_URL = 'https://api.github.com/repos/nickEatsBread/izumi/commits'
const PAGE_SIZE = 30

/** Map GitHub commit objects to changelog entries: first line of each message, merge commits dropped. */
export function parseCommits(raw: RawCommit[]): ChangelogEntry[] {
  return raw
    .filter((c) => !/^merge[:\s]/i.test(c.commit.message))
    .map((c) => ({ sha: c.sha, date: c.commit.author.date, message: c.commit.message.split('\n')[0].trim() }))
}

const pageCache = new Map<number, Promise<ChangelogPage>>()

/** Fetch the recent commit history as changelog entries. Memoized for the session so revisiting the
 *  page doesn't re-hit the unauthenticated GitHub rate limit; a failed fetch is not cached, so a
 *  retry can still succeed. */
export function fetchChangelog(): Promise<ChangelogEntry[]> {
  return fetchChangelogPage(1).then((page) => page.entries)
}

/** Fetch one history page. Pages are cached independently so an infinite list only requests each
 * GitHub page once, while failures remain retryable. */
export function fetchChangelogPage(page: number): Promise<ChangelogPage> {
  const safePage = Math.max(1, Math.floor(page))
  let request = pageCache.get(safePage)
  if (!request) {
    request = loadChangelogPage(safePage).catch((error) => {
      pageCache.delete(safePage)
      throw error
    })
    pageCache.set(safePage, request)
  }
  return request
}

// Goes through the native pooled client (phttp) so it isn't blocked by webview CORS. Throws on a
// non-ok response so the page shows its error state.
async function loadChangelogPage(page: number): Promise<ChangelogPage> {
  const url = `${COMMITS_URL}?per_page=${PAGE_SIZE}&page=${page}`
  const r = await phttp(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'izumi' } })
  if (!r.ok) throw new Error(`changelog: ${r.status}`)
  const raw = (await r.json()) as RawCommit[]
  return { entries: parseCommits(raw), hasMore: raw.length === PAGE_SIZE }
}
