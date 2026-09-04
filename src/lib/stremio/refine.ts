import type { Media } from '$lib/anilist/types'
import { totalEpisodes } from '$lib/anilist/media'
import {
  relevant,
  hasExplicitTitleConflict,
  likelyOtherProduction,
  isEpisodeExtra,
  isStandaloneMovie,
  wrongFranchiseSeason,
} from './relevance'
import { dedupeStreams } from './dedupe'
import { candidateIds } from './candidate-model'
import { describe, type Stream } from './parse'
import { sourceTitleAliases } from './title-aliases'

// Season/title refinement shared by addon + extension streams. Pure (no Tauri/stores beyond the
// title-language preference), so it's unit-testable.
//
// This USED to be five anonymous `.filter()` calls whose evidence went straight to the garbage
// collector. Two things were wrong with that. Over-filtering produced an empty picker and the
// error path then blamed dead or notice torrents for the app's own filtering, and there was no
// way to tell the user what had been removed or to let them look at it anyway. Partitioning
// instead of filtering fixes both: every dropped row keeps the name of the rule that dropped it.

export type RejectReason =
  | 'title-mismatch'
  | 'other-production'
  | 'episode-extra'
  | 'implausibly-small'
  | 'standalone-movie'
  | 'wrong-franchise-season'

export interface Rejection { stream: Stream; reason: RejectReason }
export interface Refined { kept: Stream[]; rejected: Rejection[] }

/** Human-facing wording for the picker's "Filtered" list. */
export const rejectLabel: Record<RejectReason, string> = {
  'title-mismatch': 'different title',
  'other-production': 'different production',
  'episode-extra': 'opening/ending or extra',
  'implausibly-small': 'too small for a full episode',
  'standalone-movie': 'movie, not an episode',
  'wrong-franchise-season': 'different season',
}

// Detect a per-file batch expansion without discarding its routes. The former hash-only collapse
// silently selected whichever file/provider arrived first; retaining the rows lets verifySeason
// choose the requested episode and lets recovery try a distinct offer for the same release.
export function collapseBatches(streams: Stream[]): Stream[] {
  const filesPerOffer = new Map<string, Set<string>>()
  for (const stream of streams) {
    if (!stream.infoHash) continue
    const ids = candidateIds(stream)
    const key = `${ids.releaseId}:${ids.offerId}`
    const files = filesPerOffer.get(key) ?? new Set<string>()
    files.add(`${stream.fileIdx ?? ''}:${stream.url ?? ''}:${stream.behaviorHints?.filename ?? ''}`)
    filesPerOffer.set(key, files)
  }
  return streams.map((stream) => {
    if (!stream.infoHash) return stream
    const ids = candidateIds(stream)
    return (filesPerOffer.get(`${ids.releaseId}:${ids.offerId}`)?.size ?? 0) > 1
      ? { ...stream, __batch: true }
      : stream
  })
}

const rowKey = (s: Stream) => candidateIds(s).routeId

export function refineStreams(media: Media, raw: Stream[]): Refined {
  const wantedTitles = sourceTitleAliases(media)
  const animeYear = media.startDate?.year ?? undefined
  // Long-running absolute-numbered anime (One Piece, Naruto, Conan…) ship as
  // "One Piece - 001", never scene "S01E01" — so any SxxExx file is a different
  // production (the live action / a remake). airedTotal covers ongoing shows whose
  // media.episodes is still null.
  const totalEps = totalEpisodes(media)
  // Absolute-only episode naming is an anime convention, not a generic property of every long
  // series. Cinemeta can expose dozens of specials before ordinary seasons (Skinwalker Ranch has
  // 126 video rows), and treating that count as anime evidence quarantines every valid SxxExx row.
  const animeNumbering = media.type === 'ANIME'
    || media.catalog?.type === 'anime'
    || (!media.catalog && media.type == null)
  const absoluteNumbered = animeNumbering && totalEps > 60
  // A MULTI-EPISODE SERIES (not a movie/single-ep OVA): a standalone-movie file (no episode/batch
  // marker) is a different production sharing the id — e.g. the 1995 GitS film / GitS 2: Innocence
  // under the 2026 series. Drop those; keep every S01E01 + season pack. Not applied to movies.
  const isSeries = media.format !== 'MOVIE' && totalEps > 1
  const expectedSeconds = (media.duration ?? 0) * 60
  // Ordered, so a row is attributed to the FIRST rule that objects to it.
  const why = (s: Stream): RejectReason | null => {
    // A source can be title-correct yet point at a mini-episode. Compare its declared bytes with
    // AniList's expected runtime using an extremely conservative 16 KiB/s floor: this rejects a
    // 7 MB, two-minute short masquerading as a 24-minute episode without touching even tiny
    // low-resolution encodes. ID verification cannot make an impossibly small file full-length.
    const size = describe(s).sizeBytes
    if (isSeries && expectedSeconds >= 10 * 60 && size != null && size < expectedSeconds * 16 * 1024) {
      return 'implausibly-small'
    }
    // Trust can cover absent/opaque text, but it cannot turn an explicit different title into the
    // requested one. Online rows have already passed provider search + detail validation and carry
    // that canonical match in __sourceTitle; transport-only fallback labels remain "unknown".
    const trustedOnline = s.__stream || s.__origin?.kind === 'online-extension'
    const idVerified = s.__accuracy === 'high'
    // Prefer the more actionable reason when the explicit contradiction is a sequel season.
    if (!trustedOnline && wrongFranchiseSeason(s, wantedTitles)) return 'wrong-franchise-season'
    if ((trustedOnline || idVerified) && hasExplicitTitleConflict(s, wantedTitles)) return 'title-mismatch'
    if (trustedOnline) return null
    if (!idVerified && !relevant(s, wantedTitles)) return 'title-mismatch'
    // `high` is a source-declared confidence value, not an independently verified guarantee. An
    // explicit year/production/shape contradiction therefore still wins over that claim.
    if (likelyOtherProduction(s, animeYear, absoluteNumbered)) return 'other-production'
    if (isEpisodeExtra(s)) return 'episode-extra'
    if (isSeries && isStandaloneMovie(s)) return 'standalone-movie'
    return null
  }

  const pool = collapseBatches(raw)
  const kept: Stream[] = []
  const rejected: Rejection[] = []
  const seenRejects = new Set<string>()
  for (const s of pool) {
    const reason = why(s)
    if (!reason) { kept.push(s); continue }
    // The kept list is deduped below; rejections have to be deduped too or the "Filtered (N)"
    // count reports the same release once per addon that returned it.
    const k = rowKey(s)
    if (k && seenRejects.has(k)) continue
    if (k) seenRejects.add(k)
    rejected.push({ stream: s, reason })
  }
  // Rejected rows stay quarantined even when every addon returned the wrong thing. The picker can
  // still expose them under "Filtered" for an explicit manual override; restoring them here makes
  // a known title/production mismatch eligible for Auto, binge continuation, recovery and
  // downloads precisely when no correct result happened to arrive beside it.
  return { kept: dedupeStreams(kept), rejected }
}
