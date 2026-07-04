import { fetch as httpFetch } from '@tauri-apps/plugin-http'

// AnimeThemes.moe — the OP/ED theme-song database. We use it to make
// auto-skip smarter: DON'T auto-skip an OP/ED on the episode where that theme first
// debuts, so the user hears each new opening/ending once. `animethemeentries.episodes`
// (e.g. "1-12") gives the range a theme plays over; the first number is its debut.

interface Entry { episodes?: string }
interface Theme { type?: string; animethemeentries?: Entry[] }
interface Anime { animethemes?: Theme[] }
interface Resp { anime?: Anime[] }

/** Whether `episode` is the FIRST appearance of an OP / ED for this AniList title.
 *  Falls back to "episode 1 is the debut" when AnimeThemes has no data. */
export async function firstOccurrences(
  anilistId: number | null | undefined,
  episode: number | null | undefined,
): Promise<{ op: boolean; ed: boolean }> {
  const fallback = { op: episode === 1, ed: episode === 1 }
  if (!anilistId || !episode) return fallback
  const url = `https://api.animethemes.moe/anime/?fields[anime]=id&filter[external_id]=${anilistId}`
    + `&filter[site]=AniList&include=animethemes.animethemeentries`
  try {
    const r = await httpFetch(url)
    if (!r.ok) return fallback
    const j = (await r.json()) as Resp
    if (!j.anime?.[0]?.animethemes) return fallback
    const occ = { op: false, ed: false }
    for (const a of j.anime) {
      for (const theme of a.animethemes ?? []) {
        for (const entry of theme.animethemeentries ?? []) {
          if (!entry.episodes) continue
          if (parseInt(entry.episodes.split('-')[0]) === episode) {
            if (theme.type === 'OP') occ.op = true
            else if (theme.type === 'ED') occ.ed = true
          }
        }
      }
    }
    return occ
  }
  catch { return fallback }
}
