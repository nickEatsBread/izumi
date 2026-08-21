import { fetch as httpFetch } from '@tauri-apps/plugin-http'

// AniSkip OP/ED/recap "skip times" for an episode, used to draw seekbar segments
// and drive the "Skip Opening/Ending" button.
export type SkipType = 'op' | 'ed' | 'recap'
export interface Segment { start: number; end: number; type: SkipType; label: string }

export const LABELS: Record<SkipType, string> = { op: 'Opening', ed: 'Ending', recap: 'Recap' }
// `mixed-op` / `mixed-ed` are AniSkip's annotation for an opening or ending that runs INTO the
// episode proper (the cold-open cut, extremely common in anime) — which is exactly the case people
// most want skipped. They are separate skip types in the API and are simply absent from the
// response unless asked for, so requesting only op/ed silently drops them. They collapse onto the
// same two labels here; overlapping annotations of the same opening are unioned below.
const TYPES: Record<string, SkipType> = {
  op: 'op', ed: 'ed', recap: 'recap', 'mixed-op': 'op', 'mixed-ed': 'ed',
}
const REQUESTED = ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed']

interface AniSkipResult { interval?: { startTime: number; endTime: number }; skipType?: string }
interface AniSkipResp { found?: boolean; results?: AniSkipResult[] }

/** Sort, then union overlapping (or touching) segments of the SAME type into one range.
 *  Without this an episode annotated as both `op` and `mixed-op` yields two near-identical
 *  segments, so the seekbar draws a doubled band and auto-skip fires twice. */
export function mergeOverlapping(segments: Segment[]): Segment[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Segment[] = []
  for (const seg of sorted) {
    const prev = out.find((s) => s.type === seg.type && seg.start <= s.end)
    if (prev) prev.end = Math.max(prev.end, seg.end)
    else out.push({ ...seg })
  }
  return out.sort((a, b) => a.start - b.start)
}

/** A segment plus whether it came from a `mixed-*` annotation. Provenance has to survive the union
 *  step so conflicts can be resolved afterwards. */
export interface SkipCandidate extends Segment { mixed: boolean }

/** Union same-type annotations, then drop `mixed-*` ones that contradict a plain annotation.
 *
 *  Real payload this exists for — Attack on Titan (MAL 16498) episode 1 returns:
 *      op        47.37–137.37
 *      mixed-op  75.00–135.00     (inside the op — union, same theme annotated twice)
 *      mixed-ed  24.41–114.41     (a mis-submission: that window IS the opening)
 *      ed      1342.80–1430.62
 *  Collapsed by type alone, the bogus ED sorts first, so `currentSeg` matches it during the
 *  opening: the button reads "Skip Ending" and auto-skip seeks to 114.41 — into the middle of the
 *  OP it was supposed to skip past. A crowd-sourced `mixed-*` that overlaps a plain annotation of
 *  a DIFFERENT type loses; same-type overlap is still a union. */
export function resolveCandidates(candidates: SkipCandidate[]): Segment[] {
  const sorted = [...candidates].sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: SkipCandidate[] = []
  for (const cand of sorted) {
    const prev = merged.find((s) => s.type === cand.type && cand.start <= s.end)
    if (prev) {
      prev.end = Math.max(prev.end, cand.end)
      prev.mixed = prev.mixed && cand.mixed // a plain annotation anywhere in the union vouches for it
    }
    else merged.push({ ...cand })
  }
  const contradicted = (s: SkipCandidate) => s.mixed && merged.some(
    (o) => o !== s && !o.mixed && o.type !== s.type && s.start < o.end && o.start < s.end,
  )
  return merged
    .filter((s) => !contradicted(s))
    .map(({ mixed: _mixed, ...seg }) => seg)
    .sort((a, b) => a.start - b.start)
}

// Fetch OP/ED/recap segments for a MAL id + episode. `duration` (seconds, from
// mpv) lets AniSkip correct for release-vs-database length differences; pass 0 if
// unknown. Returns [] for movies, missing ids, or when AniSkip has no data — the
// player then falls back to chapter-derived segments (see player/chapter-skip.ts)
// and otherwise simply shows no skip button / segments. Uses the Tauri HTTP plugin
// so it isn't blocked by the webview CORS/scope.
/** Crowd skip times for a new episode often land hours after broadcast. Retry a
 *  handful of times instead of locking in an empty result for the whole watch. */
export const SKIP_RETRY_MS = [0, 12_000, 45_000] as const

export async function getSkipSegments(
  malId: number | null | undefined,
  episode: number | null | undefined,
  duration = 0,
): Promise<Segment[]> {
  if (!malId || !episode) return []
  const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episode}/`
    + `?episodeLength=${Math.round(duration) || 0}`
    + REQUESTED.map((t) => `&types=${t}`).join('')
  try {
    const r = await httpFetch(url)
    if (!r.ok) return []
    const j = await r.json() as AniSkipResp
    if (!j.found || !j.results) return []
    return resolveCandidates(j.results
      .flatMap((res): SkipCandidate[] => {
        const raw = res.skipType
        const type = raw ? TYPES[raw] : undefined
        const iv = res.interval
        if (!type || !iv || !(iv.endTime > iv.startTime)) return []
        return [{ start: iv.startTime, end: iv.endTime, type, label: LABELS[type], mixed: !!raw?.startsWith('mixed-') }]
      }))
  }
  catch { return [] }
}
