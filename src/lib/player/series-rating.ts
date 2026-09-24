import { get, writable } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { anyTrackerConnected, setScore } from '$lib/trackers'
import { connectedTrackerProviders } from '$lib/trackers/config'
import { traktToken } from '$lib/trakt/config'
import { incognito } from '$lib/stores/incognito'
import { seriesRatingPrompt as seriesRatingPromptEnabled } from '$lib/settings/ui'
import { localLibrary, localTrackingForMedia } from '$lib/library/local-lists'

// The end-of-series rating prompt. Both players call `requestSeriesRating` when an episode
// completes; this module decides whether that completion was a finale worth asking about and, if
// so, publishes ONE request per title per session for SeriesRatingPrompt.svelte to present.
//
// It is deliberately separate from the Up Next prompt: Up Next is opt-in and skipped entirely when
// off, whereas a finale has no next episode and the question only makes sense when there is a
// connected tracker to save the answer to.

export interface SeriesRatingRequest {
  media: Media
  /** The episode whose completion raised the prompt (1 for a movie). */
  episode: number
  /** The viewer's existing canonical 0-100 score, when the snapshot carries one. */
  currentScore: number
}

export const seriesRatingPrompt = writable<SeriesRatingRequest | null>(null)

/** A finale is the last episode of a title that has stopped airing. A RELEASING or HIATUS title
 *  reaches "no later episode has aired" every week, and asking then would be asking someone to
 *  rate a show they are in the middle of. `episodes` is the planned total — the same field that
 *  drives the tracker's COMPLETED status in markWatched — so the two never disagree. */
export function isSeriesFinale(
  media: Pick<Media, 'status' | 'episodes'>,
  episode: number | null | undefined,
): boolean {
  if (media.status !== 'FINISHED' && media.status !== 'CANCELLED') return false
  const total = media.episodes ?? 0
  if (total <= 0) return false
  // Movies play without an episode number; their single "episode" is the whole thing.
  const played = episode ?? (total === 1 ? 1 : null)
  return played != null && played >= total
}

export interface SeriesRatingGate {
  finale: boolean
  trackerConnected: boolean
  incognito: boolean
  enabled: boolean
  /** Canonical 0-100; anything above zero means the viewer already rated it. */
  currentScore: number
  alreadyAsked: boolean
}

/** Every reason NOT to ask, in one place: no tracker (nowhere to save), incognito (nothing may
 *  reach a tracker), the setting off, an existing score (they already answered), or this session
 *  already asked about this title. */
export function shouldPromptSeriesRating(gate: SeriesRatingGate): boolean {
  return gate.finale
    && gate.trackerConnected
    && !gate.incognito
    && gate.enabled
    && gate.currentScore <= 0
    && !gate.alreadyAsked
}

/** Titles asked about this session. A dismissed prompt must not come back when the same finale
 *  reaches its finalize hook a moment later, or when the credits are re-watched. */
const asked = new Set<number>()

function knownScore(media: Media): number {
  const local = localTrackingForMedia(get(localLibrary), media)?.score ?? 0
  return Math.max(media.mediaListEntry?.score ?? 0, local)
}

/** Ask for a rating if `episode` completing `media` is a finale worth asking about. Returns whether
 *  a prompt was raised. Safe to call from every completion hook (EOF, close, external return):
 *  the per-session guard makes repeats free. */
export function requestSeriesRating(media: Media, episode: number | null | undefined): boolean {
  const currentScore = knownScore(media)
  const ok = shouldPromptSeriesRating({
    finale: isSeriesFinale(media, episode),
    trackerConnected: anyTrackerConnected(),
    incognito: get(incognito),
    enabled: get(seriesRatingPromptEnabled),
    currentScore,
    alreadyAsked: asked.has(media.id),
  })
  if (!ok) return false
  asked.add(media.id)
  seriesRatingPrompt.set({ media, episode: episode ?? 1, currentScore })
  return true
}

export function dismissSeriesRating(): void {
  seriesRatingPrompt.set(null)
}

/** Persist a 1-10 answer through the ordinary score path (local + every connected tracker). */
export function saveSeriesRating(request: SeriesRatingRequest, score10: number): Promise<string[]> {
  const clamped = Math.max(1, Math.min(10, Math.round(score10)))
  return setScore(request.media, clamped * 10)
}

const TRACKER_LABELS: Record<string, string> = {
  anilist: 'AniList',
  mal: 'MyAnimeList',
  kitsu: 'Kitsu',
  simkl: 'Simkl',
}

/** Display names of the services a saved rating reaches, in the order the accounts were linked. */
export function connectedTrackerLabels(): string[] {
  const labels = connectedTrackerProviders().map((provider) => TRACKER_LABELS[provider] ?? provider)
  if (get(traktToken)) labels.push('Trakt')
  return labels
}

/** Test seam: forget which titles were asked about. */
export function resetSeriesRatingSession(): void {
  asked.clear()
  seriesRatingPrompt.set(null)
}
