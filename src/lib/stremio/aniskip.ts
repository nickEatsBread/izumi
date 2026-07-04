import { fetch as httpFetch } from '@tauri-apps/plugin-http'

// AniSkip OP/ED/recap "skip times" for an episode, used to draw seekbar segments
// and drive the "Skip Opening/Ending" button.
export type SkipType = 'op' | 'ed' | 'recap'
export interface Segment { start: number; end: number; type: SkipType; label: string }

const LABELS: Record<SkipType, string> = { op: 'Opening', ed: 'Ending', recap: 'Recap' }
const TYPES: Record<string, SkipType> = { op: 'op', ed: 'ed', recap: 'recap' }

interface AniSkipResult { interval?: { startTime: number; endTime: number }; skipType?: string }
interface AniSkipResp { found?: boolean; results?: AniSkipResult[] }

// Fetch OP/ED/recap segments for a MAL id + episode. `duration` (seconds, from
// mpv) lets AniSkip correct for release-vs-database length differences; pass 0 if
// unknown. Returns [] for movies, missing ids, or when AniSkip has no data — the
// player then simply shows no skip button / segments. Uses the Tauri HTTP plugin
// so it isn't blocked by the webview CORS/scope.
export async function getSkipSegments(
  malId: number | null | undefined,
  episode: number | null | undefined,
  duration = 0,
): Promise<Segment[]> {
  if (!malId || !episode) return []
  const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episode}/`
    + `?episodeLength=${Math.round(duration) || 0}&types=op&types=ed&types=recap`
  try {
    const r = await httpFetch(url)
    if (!r.ok) return []
    const j = await r.json() as AniSkipResp
    if (!j.found || !j.results) return []
    return j.results
      .flatMap((res): Segment[] => {
        const type = res.skipType ? TYPES[res.skipType] : undefined
        const iv = res.interval
        if (!type || !iv || !(iv.endTime > iv.startTime)) return []
        return [{ start: iv.startTime, end: iv.endTime, type, label: LABELS[type] }]
      })
      .sort((a, b) => a.start - b.start)
  }
  catch { return [] }
}
