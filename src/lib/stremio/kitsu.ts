import { fetch as httpFetch } from '@tauri-apps/plugin-http'

// Kitsu's own DB maps more titles than the Fribb/AniZip lists, so when those miss,
// resolve a Kitsu anime id straight from the MAL id (AniList gives us media.idMal).
export async function kitsuIdFromMal(malId?: number | null): Promise<number | undefined> {
  if (!malId) return undefined
  try {
    const url = `https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${malId}&include=item`
    const r = await httpFetch(url, { headers: { Accept: 'application/vnd.api+json' } })
    if (!r.ok) return undefined
    const j = (await r.json()) as { included?: Array<{ id?: string }> }
    const id = j.included?.[0]?.id
    return id ? Number(id) : undefined
  } catch {
    return undefined
  }
}
