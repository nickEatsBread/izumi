import {
  relevant,
  likelyOtherProduction,
  isEpisodeExtra,
  isStandaloneMovie,
  selfDeclaredOtherProduction,
  wrongFranchiseSeason,
} from './relevance'
import { describe, type Stream } from './parse'

// Metadata-light refinement for environments that cannot build a full AniList `Media` — the
// self-hosted Cloudflare Worker resolves from a media reference plus whatever titles/year/runtime
// its own catalogue lookups produced. `refineStreams` stays the richer app-side surface; this one
// applies the same relevance primitives with explicit evidence gates so a sparse context can never
// reject more than its evidence supports.

export interface RefineLiteContext {
  /** Known aliases for the requested title (request title, romaji/english/native, synonyms). */
  titles: string[]
  streamType: 'movie' | 'series'
  /** First-release year, when a catalogue lookup produced one. */
  year?: number
  /** Declared per-episode/feature runtime in seconds, when known. */
  expectedSeconds?: number
  /** Total episode count, when known. Series-shaped rules stay off without it. */
  totalEpisodes?: number
  /** Long-running absolute-numbered anime (One Piece-style "- 067" naming). */
  absoluteNumbered?: boolean
  /** Release date (ms epoch), when a catalogue lookup produced one. */
  releasedAt?: number
}

// How long after a theatrical release a claimed WEB/BluRay copy stays implausible. Short enough
// that a genuinely fast digital release only overlaps briefly, long enough to cover the window
// where scam uploads carry clean release names precisely because no real digital copy exists yet.
const PRE_DIGITAL_WINDOW_DAYS = 60

export interface RefinedLite { kept: Stream[]; rejectedCount: number }

/**
 * Partition streams into kept/rejected using only the evidence the context actually carries.
 *
 * Every rule keeps unknowns: a rule whose required context field is absent never fires. A caller
 * with an empty context therefore gets its input back untouched, and a caller whose context
 * over-filters can detect `kept.length === 0` and fall back to the unrefined pool.
 */
export function refineStreamsLite(ctx: RefineLiteContext, streams: Stream[]): RefinedLite {
  const titles = ctx.titles.map((t) => t.trim()).filter(Boolean)
  // One alias identifies a movie well enough, but series titles routinely differ between the
  // romaji release name and the catalogue's display title — demanding a second alias before the
  // fuzzy title test may fire keeps a single-language context from quarantining correct releases.
  const titleEvidence = ctx.streamType === 'movie' ? titles.length >= 1 : titles.length >= 2
  const isSeries = ctx.streamType === 'series' && (ctx.totalEpisodes ?? 0) > 1
  const expectedSeconds = ctx.expectedSeconds ?? 0
  // A film still inside its theatrical window has no legitimate WEB/BluRay copy: rows claiming
  // one beside actual cam rips are scam uploads wearing a clean release name. Both conditions are
  // required — a known-recent release date AND cam evidence in this very pool — so a real early
  // digital release (cams gone from relevance) or an unknown date never triggers it.
  const releaseAgeDays = ctx.releasedAt != null ? (Date.now() - ctx.releasedAt) / 86_400_000 : undefined
  const theatricalWindow = ctx.streamType === 'movie' && releaseAgeDays != null && releaseAgeDays < PRE_DIGITAL_WINDOW_DAYS
  const camEvidence = theatricalWindow && streams.some((s) => describe(s).source === 'CAM')
  const why = (s: Stream): boolean => {
    if (camEvidence && ['WEB-DL', 'WEBRip', 'WEB', 'BluRay', 'DVD'].includes(describe(s).source ?? '')) return true
    // Needs no context at all: the release itself declares it is a different production.
    if (selfDeclaredOtherProduction(s)) return true
    if (isSeries && expectedSeconds >= 10 * 60) {
      const size = describe(s).sizeBytes
      // Same conservative 16 KiB/s floor as refineStreams: a declared size that cannot hold the
      // declared runtime is a short/extra regardless of how well its title matches.
      if (size != null && size < expectedSeconds * 16 * 1024) return true
    }
    // Without the requested title we cannot know whether the REQUEST is itself a sequel season,
    // so the sequel-season marker is only evidence once at least one alias is present.
    if (titles.length && wrongFranchiseSeason(s, titles)) return true
    if (titleEvidence && !relevant(s, titles)) return true
    if (likelyOtherProduction(s, ctx.year, ctx.absoluteNumbered ?? false)) return true
    if (isEpisodeExtra(s)) return true
    if (isSeries && isStandaloneMovie(s)) return true
    return false
  }
  const kept: Stream[] = []
  let rejectedCount = 0
  for (const s of streams) {
    if (why(s)) rejectedCount += 1
    else kept.push(s)
  }
  return { kept, rejectedCount }
}
