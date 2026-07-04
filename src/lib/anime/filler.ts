import { fetch as httpFetch } from '@tauri-apps/plugin-http'

// Filler-episode numbers per AniList media id, from ThaUnknown's pre-scraped
// AnimeFillerList dump. Loaded once, cached for the
// session. Via the Tauri HTTP plugin so it isn't blocked by the webview.
let fillerMap: Record<number, number[]> | null = null
let loading: Promise<Record<number, number[]>> | null = null

function load(): Promise<Record<number, number[]>> {
  if (fillerMap) return Promise.resolve(fillerMap)
  loading ??= (async () => {
    try {
      const r = await httpFetch('https://raw.githubusercontent.com/ThaUnknown/filler-scrape/master/filler.json')
      fillerMap = r.ok ? ((await r.json()) as Record<number, number[]>) : {}
    }
    catch { fillerMap = {} }
    return fillerMap
  })()
  return loading
}

/** Filler episode numbers for a title (empty if none). */
export async function fillerEpisodes(mediaId: number): Promise<number[]> {
  return (await load())[mediaId] ?? []
}
export async function isFiller(mediaId: number, episode: number): Promise<boolean> {
  return (await fillerEpisodes(mediaId)).includes(episode)
}
