import { phttp } from '$lib/net/http'

// Kitsu's own DB maps more titles than the Fribb/AniZip lists, so when those miss,
// resolve a Kitsu anime id straight from Kitsu's mapping table.
// Brackets/slash are percent-encoded — tauri-http (reqwest) rejects the raw form.
async function kitsuIdFromSite(site: 'myanimelist/anime' | 'anilist/anime', externalId?: number | null): Promise<number | undefined> {
  if (!externalId) return undefined
  try {
    const url =
      'https://kitsu.io/api/edge/mappings' +
      `?filter%5BexternalSite%5D=${encodeURIComponent(site)}` +
      `&filter%5BexternalId%5D=${externalId}&include=item`
    const r = await phttp(url, { headers: { Accept: 'application/vnd.api+json' } })
    if (!r.ok) return undefined
    const j = (await r.json()) as { included?: Array<{ id?: string }> }
    const id = j.included?.[0]?.id
    return id ? Number(id) : undefined
  } catch {
    return undefined
  }
}

/** Kitsu id from the MAL id (AniList gives us media.idMal). */
export function kitsuIdFromMal(malId?: number | null): Promise<number | undefined> {
  return kitsuIdFromSite('myanimelist/anime', malId)
}

/** Kitsu id from whichever of Kitsu's AniList and MAL links exists. A new show is often linked to
 *  one site weeks before the other: a fall premiere already carried its AniList link while the MAL
 *  lookup, then the only one asked, came back empty, so no add-on was ever queried for it. Both are
 *  asked at once; the AniList link wins whenever it exists, so two links that disagree always give
 *  the same answer (tracker writes act on it). */
export async function kitsuIdFromLinks(ids: { anilist?: number | null; mal?: number | null }): Promise<number | undefined> {
  const byMal = kitsuIdFromSite('myanimelist/anime', ids.mal)
  return await kitsuIdFromSite('anilist/anime', ids.anilist) ?? await byMal
}
