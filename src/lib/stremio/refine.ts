import type { Media } from '$lib/anilist/types'
import { title, totalEpisodes } from '$lib/anilist/media'
import { relevant, likelyOtherProduction, isEpisodeExtra, isStandaloneMovie, wrongFranchiseSeason } from './relevance'
import { dedupeStreams, dedupeBy } from './dedupe'
import type { Stream } from './parse'

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
  | 'standalone-movie'
  | 'wrong-franchise-season'

export interface Rejection { stream: Stream; reason: RejectReason }
export interface Refined { kept: Stream[]; rejected: Rejection[] }

/** Human-facing wording for the picker's "Filtered" list. */
export const rejectLabel: Record<RejectReason, string> = {
  'title-mismatch': 'different title',
  'other-production': 'different production',
  'episode-extra': 'opening/ending or extra',
  'standalone-movie': 'movie, not an episode',
  'wrong-franchise-season': 'different season',
}

// Collapse the per-file batch explosion: any infoHash contributing 2+ file rows is a
// season/complete pack (a single-episode torrent yields exactly one row), so keep one row per
// packed hash. A 458-file dub pack becomes one row. Runs BEFORE dedupeStreams (which keys
// url-first), so this infoHash pass is the first — and for same-hash extension duplicates the
// ONLY — place a live-seeded copy can win over a 0/unknown-seeder copy of the same torrent;
// dedupeBy carries that tiebreak. Batch packs are addon rows (not torrent-ext), so they collapse
// first-wins exactly as before.
export function collapseBatches(streams: Stream[]): Stream[] {
  return dedupeBy(streams, (s) => s.infoHash ?? '')
}

const rowKey = (s: Stream) => s.url ?? s.infoHash ?? s.behaviorHints?.filename ?? s.name ?? ''

export function refineStreams(media: Media, raw: Stream[]): Refined {
  const wantedTitles = [title(media), media.title.romaji, media.title.english].filter((t): t is string => !!t)
  const animeYear = media.startDate?.year ?? undefined
  // Long-running absolute-numbered anime (One Piece, Naruto, Conan…) ship as
  // "One Piece - 001", never scene "S01E01" — so any SxxExx file is a different
  // production (the live action / a remake). airedTotal covers ongoing shows whose
  // media.episodes is still null.
  const totalEps = totalEpisodes(media)
  const absoluteNumbered = totalEps > 60
  // A MULTI-EPISODE SERIES (not a movie/single-ep OVA): a standalone-movie file (no episode/batch
  // marker) is a different production sharing the id — e.g. the 1995 GitS film / GitS 2: Innocence
  // under the 2026 series. Drop those; keep every S01E01 + season pack. Not applied to movies.
  const isSeries = media.format !== 'MOVIE' && totalEps > 1
  // Direct streams and id-VERIFIED extension results skip the release-NAME heuristics: a source
  // that matched this exact episode's production id (accuracy 'high') outranks any title parse —
  // e.g. a CJK-titled release carries zero romaji/english tokens and relevant() would drop it.
  const trusted = (s: Stream) => !!s.__stream || s.__accuracy === 'high'

  // Ordered, so a row is attributed to the FIRST rule that objects to it.
  const why = (s: Stream): RejectReason | null => {
    if (!relevant(s, wantedTitles)) return 'title-mismatch'
    if (likelyOtherProduction(s, animeYear, absoluteNumbered)) return 'other-production'
    if (isEpisodeExtra(s)) return 'episode-extra'
    if (isSeries && isStandaloneMovie(s)) return 'standalone-movie'
    // Same-franchise wrong season: base-entry request pulling in "… The Final Season" / "Season 2"
    // files a number-less season gate can't catch (Attack on Titan S1 → Final Season episodes).
    if (wrongFranchiseSeason(s, wantedTitles)) return 'wrong-franchise-season'
    return null
  }

  const pool = collapseBatches(raw)
  const kept: Stream[] = []
  const rejected: Rejection[] = []
  const seenRejects = new Set<string>()
  for (const s of pool) {
    const reason = trusted(s) ? null : why(s)
    if (!reason) { kept.push(s); continue }
    // The kept list is deduped below; rejections have to be deduped too or the "Filtered (N)"
    // count reports the same release once per addon that returned it.
    const k = rowKey(s)
    if (k && seenRejects.has(k)) continue
    if (k) seenRejects.add(k)
    rejected.push({ stream: s, reason })
  }
  // Safety net, matching the season verifier's: five heuristics firing at once must never be the
  // reason the user sees nothing. Hand back the unfiltered pool and claim no rejections, because
  // showing everything and saying "12 filtered" at the same time would be a lie.
  if (!kept.length) return { kept: dedupeStreams(pool), rejected: [] }
  return { kept: dedupeStreams(kept), rejected }
}
