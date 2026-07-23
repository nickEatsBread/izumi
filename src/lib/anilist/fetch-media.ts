import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { anilist } from './client'
import { MEDIA_BY_IDS_QUERY } from './lists'
import type { Media } from './types'

// Source-complete fetch-by-id for cases where the caller may only have a trimmed/stale history
// snapshot — notably Continue Watching and persisted downloads. Keep this aligned with the fields
// source extensions receive on the detail-page path (synonyms/season/start date are significant for
// new seasons and ambiguous light-novel titles). Session-cached.

const Q = `query($id:Int!){Media(id:$id,type:ANIME){id idMal title{romaji english userPreferred native} description(asHtml:false) season seasonYear format status episodes duration averageScore popularity trending genres synonyms startDate{year month day} studios(isMain:true){nodes{id name}} coverImage{extraLarge medium color} bannerImage trailer{id site} nextAiringEpisode{episode timeUntilAiring} airingSchedule(perPage:100){nodes{episode airingAt}} relations{edges{relationType node{id idMal title{romaji english userPreferred native} season seasonYear format status episodes averageScore popularity trending coverImage{extraLarge medium color}}}}}}`

const cache = new Map<number, Media>()

export async function fetchMediaById(id: number, fresh = false): Promise<Media> {
  const hit = fresh ? undefined : cache.get(id)
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

/** Batch-fetch many media by id in one request per 50 ids (AniList's page cap), through the
 *  POOLED + rate-limited `anilist` client — NOT the N serial, unpooled, un-throttled fetch-by-id
 *  calls that bypassed the Bottleneck limiter and the shared 429 cooldown. `fresh` forces a
 *  network read (schedules change), otherwise the urql cache may answer. Warms the single-id
 *  cache so a later fetchMediaById hits. Missing ids are simply absent from the map. */
export async function fetchMediaByIds(ids: number[], fresh = false): Promise<Map<number, Media>> {
  const out = new Map<number, Media>()
  const unique = [...new Set(ids)]
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    const r = await anilist
      .query(MEDIA_BY_IDS_QUERY, { ids: chunk }, fresh ? { requestPolicy: 'network-only' } : undefined)
      .toPromise()
    if (r.error) continue
    for (const m of ((r.data?.Page?.media ?? []) as Media[])) {
      out.set(m.id, m)
      cache.set(m.id, m)
    }
  }
  return out
}
