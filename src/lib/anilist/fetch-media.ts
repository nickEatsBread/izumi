import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import type { Media } from './types'

// Source-complete fetch-by-id for cases where the caller may only have a trimmed/stale history
// snapshot — notably Continue Watching and persisted downloads. Keep this aligned with the fields
// source extensions receive on the detail-page path (synonyms/season/start date are significant for
// new seasons and ambiguous light-novel titles). Session-cached.

const Q = `query($id:Int!){Media(id:$id,type:ANIME){id idMal title{romaji english userPreferred native} description(asHtml:false) season seasonYear format status episodes duration averageScore genres synonyms startDate{year month day} studios(isMain:true){nodes{id name}} coverImage{extraLarge medium color} bannerImage trailer{id site} nextAiringEpisode{episode timeUntilAiring}}}`

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
