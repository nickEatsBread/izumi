import { phttp } from '$lib/net/http'
import type { SubQuery, SubtitleCandidate, SubtitleProvider } from './types'

// OpenSubtitles.com REST v1 — keyless SEARCH via an izumi-owned embedded Api-Key. Listing candidates
// costs no user quota; DOWNLOADING a picked result (which spends the user's own ~20/day) happens in
// Rust on manual pick. This file only searches. Every call needs the Api-Key + a non-default
// User-Agent (a missing/duplicate UA is an instant 403), so both ride on every request.

/** izumi's registered OpenSubtitles consumer key — makes search keyless for users. A consumer key is
 *  client-embedded by design (it ships in the binary), so it's effectively public; the Vite env
 *  override lets it be rotated without a code change. */
export const OPEN_SUBS_API_KEY = import.meta.env?.VITE_OPENSUBTITLES_API_KEY || 'kpwJltOBFOqFaoRvWSIPph7katlIMxas'

const OPEN_SUBS_BASE = 'https://api.opensubtitles.com/api/v1'
const USER_AGENT = 'izumi v1.0.0'

/** Strip the `tt` prefix and leading zeros → the bare numeric id OpenSubtitles expects
 *  (`tt0211915` → `211915`). Returns undefined for a missing/empty id. */
export function osImdb(id: string | undefined): string | undefined {
  if (!id) return undefined
  const n = id.replace(/^tt/i, '').replace(/^0+/, '')
  return n.length ? n : undefined
}

/** Build the sorted, lowercase `/subtitles` query string. Episode form A (parent_imdb_id + season +
 *  episode) is used for a series with a mapped season/episode; a movie uses imdb_id. We never mix an
 *  episode's own imdb_id with season/episode, and never send form B. Params are sorted + languages
 *  lowercased to avoid the documented 301 redirect (which drops the auth header). */
export function osSearchParams(q: SubQuery): string {
  const p: Record<string, string> = {}
  const langs = [...q.languages].map((l) => l.toLowerCase()).sort()
  if (langs.length) p.languages = langs.join(',')
  const parent = osImdb(q.parentImdbId ?? q.imdbId)
  const own = osImdb(q.imdbId)
  if (q.type === 'series') {
    if (parent && q.season != null && q.episode != null) {
      p.parent_imdb_id = parent
      p.season_number = String(q.season)
      p.episode_number = String(q.episode)
    }
  } else if (own) {
    p.imdb_id = own
  }
  const usp = new URLSearchParams()
  for (const k of Object.keys(p).sort()) usp.set(k, p[k])
  return usp.toString()
}

interface OsFile { file_id?: number; file_name?: string }
interface OsAttrs { language?: string; release?: string; files?: OsFile[] }
interface OsData { id?: string; attributes?: OsAttrs }

/** Map one data[] entry → candidate. The download key is attributes.files[0].file_id; a row with no
 *  file id can't be downloaded, so it's dropped. */
function toCandidate(d: OsData): SubtitleCandidate | null {
  const fileId = d.attributes?.files?.[0]?.file_id
  if (fileId == null) return null
  return {
    provider: 'opensubtitles',
    lang: d.attributes?.language,
    release: d.attributes?.release,
    id: d.id,
    download: { needsFetch: true, fileId },
  }
}

export function createOpenSubtitles(): SubtitleProvider {
  return {
    id: 'opensubtitles',
    async search(q: SubQuery): Promise<SubtitleCandidate[]> {
      const qs = osSearchParams(q)
      if (!qs.includes('imdb_id')) return [] // no usable id → nothing to search
      try {
        const r = await phttp(`${OPEN_SUBS_BASE}/subtitles?${qs}`, {
          headers: { 'Api-Key': OPEN_SUBS_API_KEY, 'User-Agent': USER_AGENT, Accept: 'application/json' },
        })
        if (!r.ok) return []
        const j = (await r.json()) as { data?: OsData[] }
        return (j.data ?? []).map(toCandidate).filter((c): c is SubtitleCandidate => c !== null)
      } catch {
        return []
      }
    },
  }
}
