import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { subDlApiKey } from '$lib/settings/ui'
import type { SubQuery, SubtitleCandidate, SubtitleProvider } from './types'

// SubDL API v1 — bring-your-own key, passed as a query param. SEARCH only: each result carries a
// relative `url` under dl.subdl.com that returns a ZIP; the download + unzip happens in Rust on
// manual pick. We pass no `unpack` param (v1 unzips in Rust — one code path).

const SUBDL_BASE = 'https://api.subdl.com/api/v1/subtitles'
const SUBDL_DL = 'https://dl.subdl.com'

/** Build the SubDL query string. api_key + uppercase languages + subs_per_page are always sent; ids
 *  use imdb_id (raw tt…) when present, else tmdb_id + type; a series adds season/episode. */
export function subdlParams(q: SubQuery, apiKey: string): string {
  const p = new URLSearchParams()
  p.set('api_key', apiKey)
  if (q.imdbId) p.set('imdb_id', q.imdbId)
  else if (q.tmdbId) { p.set('tmdb_id', q.tmdbId); p.set('type', q.type === 'movie' ? 'movie' : 'tv') }
  if (q.type === 'series') {
    if (q.season != null) p.set('season_number', String(q.season))
    if (q.episode != null) p.set('episode_number', String(q.episode))
  }
  const langs = [...q.languages].map((l) => l.toUpperCase()).sort()
  if (langs.length) p.set('languages', langs.join(','))
  p.set('subs_per_page', '30')
  return p.toString()
}

interface SubDlEntry { release_name?: string; language?: string; lang?: string; url?: string }

export function createSubDL(): SubtitleProvider {
  return {
    id: 'subdl',
    async search(q: SubQuery): Promise<SubtitleCandidate[]> {
      const key = get(subDlApiKey)
      if (!key) return [] // SubDL needs a key even to search
      if (!q.imdbId && !q.tmdbId) return []
      try {
        const r = await phttp(`${SUBDL_BASE}?${subdlParams(q, key)}`)
        if (!r.ok) return []
        const j = (await r.json()) as { status?: boolean; subtitles?: SubDlEntry[] }
        if (j.status === false) return []
        return (j.subtitles ?? [])
          .filter((s) => !!s.url)
          .map((s): SubtitleCandidate => ({
            provider: 'subdl',
            lang: s.language,
            release: s.release_name,
            download: { needsFetch: true, zipUrl: SUBDL_DL + s.url! },
          }))
      } catch {
        return []
      }
    },
  }
}
