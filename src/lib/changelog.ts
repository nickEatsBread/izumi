import { phttp } from '$lib/net/http'

export interface ChangelogEntry { sha: string; date: string; message: string }
interface RawCommit { sha: string; commit: { message: string; author: { date: string } } }

const COMMITS_URL = 'https://api.github.com/repos/nickEatsBread/izumi/commits?per_page=50'

/** Map GitHub commit objects to changelog entries: first line of each message, merge commits dropped. */
export function parseCommits(raw: RawCommit[]): ChangelogEntry[] {
  return raw
    .filter((c) => !/^merge[:\s]/i.test(c.commit.message))
    .map((c) => ({ sha: c.sha, date: c.commit.author.date, message: c.commit.message.split('\n')[0].trim() }))
}

let cache: Promise<ChangelogEntry[]> | null = null

/** Fetch the recent commit history as changelog entries. Memoized for the session so revisiting the
 *  page doesn't re-hit the unauthenticated GitHub rate limit; a failed fetch is not cached, so a
 *  retry can still succeed. */
export function fetchChangelog(): Promise<ChangelogEntry[]> {
  if (!cache) cache = loadChangelog().catch((e) => { cache = null; throw e })
  return cache
}

// Goes through the native pooled client (phttp) so it isn't blocked by webview CORS. Throws on a
// non-ok response so the page shows its error state.
async function loadChangelog(): Promise<ChangelogEntry[]> {
  const r = await phttp(COMMITS_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'izumi' } })
  if (!r.ok) throw new Error(`changelog: ${r.status}`)
  return parseCommits((await r.json()) as RawCommit[])
}
