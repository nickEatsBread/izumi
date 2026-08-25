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

export interface AniSkipResult {
  interval?: { startTime: number; endTime: number }
  skipType?: string
  episodeLength?: number
}
export interface AniSkipResp { found?: boolean; results?: AniSkipResult[] }

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

/** Build an exact-runtime request plus an unfiltered fallback. Some releases have bumpers or
 *  slightly different cuts, so an exact runtime can legitimately have no matching submission.
 *  The fallback still lets us use the closest crowd timing and align it to the playing file. */
export function skipTimeUrls(malId: number, episode: number, duration: number): string[] {
  const base = `https://api.aniskip.com/v2/skip-times/${malId}/${episode}/`
  const types = REQUESTED.map((type) => `&types=${type}`).join('')
  const preciseDuration = Number.isFinite(duration) && duration > 0
    ? Math.round(duration * 1000) / 1000
    : 0
  const lengths = preciseDuration > 0 ? [preciseDuration, 0] : [0]
  return lengths.map((length) => `${base}?episodeLength=${length}${types}`)
}

/** Prefer results selected for the playing runtime, then fill missing annotation types from the
 *  unfiltered response. Each result carries the runtime it was authored against; moving its
 *  interval by that runtime delta keeps outro timings attached to the end of alternate cuts. */
export function segmentsFromResponses(responses: AniSkipResp[], duration: number): Segment[] {
  const playingLength = Number.isFinite(duration) && duration > 0 ? duration : 0
  const byRawType = new Map<string, AniSkipResult>()
  for (const response of responses) {
    if (!response.found) continue
    for (const result of response.results ?? []) {
      const raw = result.skipType
      const interval = result.interval
      if (!raw || byRawType.has(raw) || !TYPES[raw] || !interval) continue
      if (!(interval.endTime > interval.startTime)) continue
      byRawType.set(raw, result)
    }
  }

  const candidates: SkipCandidate[] = []
  for (const [raw, result] of byRawType) {
    const type = TYPES[raw]
    const interval = result.interval!
    const authoredLength = result.episodeLength
    const offset = playingLength > 0 && authoredLength != null && Number.isFinite(authoredLength) && authoredLength > 0
      ? playingLength - authoredLength
      : 0
    const upper = playingLength > 0 ? playingLength : Number.POSITIVE_INFINITY
    const start = Math.max(0, Math.min(upper, interval.startTime + offset))
    const end = Math.max(0, Math.min(upper, interval.endTime + offset))
    if (!(end > start)) continue
    candidates.push({ start, end, type, label: LABELS[type], mixed: raw.startsWith('mixed-') })
  }
  return resolveCandidates(candidates)
}

export async function getSkipSegments(
  malId: number | null | undefined,
  episode: number | null | undefined,
  duration = 0,
): Promise<Segment[]> {
  if (!malId || !episode) return []
  const responses = await Promise.all(skipTimeUrls(malId, episode, duration).map(async (url) => {
    try {
      const response = await httpFetch(url)
      return response.ok ? await response.json() as AniSkipResp : null
    } catch { return null }
  }))
  return segmentsFromResponses(responses.filter((response): response is AniSkipResp => response != null), duration)
}
