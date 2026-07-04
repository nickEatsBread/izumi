import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import type { Media } from './types'

// Light fetch-by-id (the fields resolveStreams + download naming need), for cases
// with no urql client / no in-memory Media — e.g. resuming a persisted download
// after an app restart. Session-cached.

const Q = `query($id:Int!){Media(id:$id,type:ANIME){id idMal title{romaji english userPreferred native} format status episodes duration averageScore genres startDate{year} coverImage{extraLarge medium color} bannerImage nextAiringEpisode{episode timeUntilAiring}}}`

const cache = new Map<number, Media>()

export async function fetchMediaById(id: number): Promise<Media> {
  const hit = cache.get(id)
  if (hit) return hit
  const r = await httpFetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: Q, variables: { id } }),
  })
  const j = await r.json() as { data?: { Media?: Media } }
  const m = j?.data?.Media
  if (!m) throw new Error('Could not fetch anime info.')
  cache.set(id, m)
  return m
}
