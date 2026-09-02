// GENERATED from src/lib/stremio/score.ts by scripts/generate-cloudflare-resolver-core.mjs.
// Edit the canonical source, then regenerate; do not edit this vendored copy.
import type { StreamInfo } from './parse'
import { priorityIndexOf, priorityPoints } from './source-priority'

// Within-tier ranking.
//
// The list was ordered by a fixed ladder — cache state, then language, then resolution, then
// seeders, then size — in which every key absolutely vetoed the next. Resolution vetoing everything
// is the problem: anime returns a wall of 1080p releases, so for the rows a user actually chooses
// between, the ladder had exactly one term left (seeders) and the encode, the group, the source and
// dual audio counted for nothing. Whichever 1080p file happened to have the most seeders won.
//
// This is deliberately NOT a score across tiers. Resolution stays a hard outer key, so asking for
// 1080p still gets 1080p — the score only decides which 1080p. It therefore scores no resolution
// term at all; adding one would just re-introduce the cross-tier trade the outer key exists to
// prevent.

export interface ScoreReason { signal: string; delta: number }

export interface ScoreOptions {
  /** Release group the previous episode played from, for cross-episode consistency. */
  previousGroup?: string
  /** Direct P2P has to fetch bytes before the first frame. Within the same quality tier, favour
   * efficient encodes that can build a useful playback buffer sooner. */
  directP2p?: boolean
  /** The user's ordered source trust list. Ranks a stated preference above every heuristic about
   * the file — but still under cache state, which rankInfos sorts on first. */
  sourcePriority?: readonly string[]
  /** Preferred subtitle language. Release-name evidence is deliberately conservative: it can
   * reward a source that explicitly promises the requested subtitles, but silence is not treated
   * as proof that a mux has none. */
  subtitleLang?: string
}

/** Fansub groups with a track record for encode quality and subtitle accuracy. Anime-first by
 *  design: a scene-release trust list would score almost nothing in this catalogue. Being absent
 *  from it is not a penalty — plenty of good releases come from groups nobody has heard of. */
export const TRUSTED_GROUPS = [
  'Erai-raws', 'SubsPlease', 'HorribleSubs', 'Vodes', 'Beatrice-Raws', 'Kaleido', 'Anime Time',
  'Judas', 'Commie', 'Doki', 'Coalgirls', 'ASW', 'Nep_Blanc', 'Tenrai-Sensei', 'sam', 'Arid',
  'Lia', 'Legion', 'ToonsHub', 'Yameii', 'EMBER', 'Cyr',
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const TRUSTED = new Set(TRUSTED_GROUPS.map(norm))

/** Convert a source-reported swarm count into ranking points.
 *
 * Direct playback uses the swarm for bytes; debrid playback still benefits from its community
 * signal. A bounded logarithmic curve keeps 100 and 1,000 meaningfully distinct without allowing
 * very large, noisy tracker estimates to dominate every other signal. The second argument remains
 * for API compatibility now that both paths intentionally use the same curve. */
export function seederPoints(seeders: number, _directP2p = false): number {
  if (!Number.isFinite(seeders) || seeders <= 0) return 0
  if (seeders < 100) return Math.floor(seeders / 10)
  return Math.min(10 + Math.floor(Math.log2(seeders / 100)), 20)
}

export type SubtitleCompatibility = 'match' | 'unknown' | 'mismatch'

const subLang = (lang?: string) => {
  const value = lang?.trim().toLowerCase() ?? ''
  if (value === 'en' || value === 'eng' || value.startsWith('en-') || value.startsWith('en_')) return 'eng'
  if (value === 'ja' || value === 'jpn' || value.startsWith('ja-') || value.startsWith('ja_')) return 'jpn'
  if (value === 'fr' || value === 'fra' || value === 'fre' || value.startsWith('fr-') || value.startsWith('fr_')) return 'fra'
  return value || undefined
}

/** Subtitle evidence available before opening a torrent. Stremio does not expose embedded MKV
 * tracks in its stream response, so UNKNOWN must remain neutral. We only claim a match from
 * explicit sidecars, release markers, Torrentio's language flags, or groups whose releases are
 * specifically English-subtitled. */
export function subtitleCompatibility(info: StreamInfo, wanted?: string): SubtitleCompatibility {
  const target = subLang(wanted)
  if (!target || target === 'none') return 'unknown'

  const declared = [
    ...(info.stream.__subtitles ?? []),
    ...(info.stream.subtitles ?? []),
  ]
  if (declared.length) {
    const languages = declared.map((track) => subLang(track.lang)).filter(Boolean)
    if (languages.includes(target)) return 'match'
    // An unlabelled sidecar may still be the requested language. Do not turn missing metadata into
    // a confident rejection; only a fully-labelled, non-matching list is actionable.
    return languages.length === declared.length ? 'mismatch' : 'unknown'
  }

  if (info.stream.__subtitleMode === 'hard') {
    const hardLang = subLang(info.stream.__lang)
    return !hardLang ? 'unknown' : hardLang === target ? 'match' : 'mismatch'
  }

  const text = [
    info.stream.name,
    info.stream.title,
    info.stream.description,
    info.stream.behaviorHints?.filename,
  ].filter(Boolean).join('\n')
  const group = info.group ? norm(info.group) : ''
  const explicitlyNoSubs = /\b(?:no[ ._-]?subs?|unsubbed)\b/i.test(text)
    || /(?:无字幕|無字幕)/u.test(text)
  if (explicitlyNoSubs) return 'mismatch'

  if (target === 'eng') {
    if (group === norm('SubsPlease') || group === norm('HorribleSubs')) return 'match'
    if (/\bmulti[ ._-]?(?:sub|subs|subtitle|subtitles)\b/i.test(text)) return 'match'
    if (/🇬🇧|🇺🇸/u.test(text)
      || /\b(?:eng(?:lish)?[ ._-]?subs?|subs?[ ._-]?eng(?:lish)?)\b/i.test(text)) return 'match'
    // These labels explicitly describe a non-English subtitle release. A bare group ending in
    // "-Raws" is NOT enough: Erai-raws and several encode groups routinely ship English tracks.
    if (/\b(?:sub[ ._-]?french|french[ ._-]?subs?|vostfr)\b/i.test(text)) return 'mismatch'
    const flags = text.match(/🇫🇷|🇷🇺|🇵🇹|🇪🇸|🇲🇽|🇨🇳|🇹🇼|🇩🇪|🇵🇱|🇯🇵/gu)
    if (flags?.length) return 'mismatch'
  }
  return 'unknown'
}

/** A large live swarm is useful community evidence, but only when the alternative is at least the
 * same resolution. The ratio and absolute gap both have to be large so ordinary tracker jitter
 * cannot break a user's release continuity. */
export function communityDominates(challenger: StreamInfo, incumbent: StreamInfo): boolean {
  const next = challenger.seeders
  const current = incumbent.seeders
  return challenger.quality >= incumbent.quality
    && next != null && current != null
    && next >= 100
    && next - current >= 100
    && next >= Math.max(1, current) * 4
}

/** Keep the user's current release when choices are comparable; allow a clearly safer baseline to
 * break continuity when the incumbent explicitly lacks the requested subtitles or has been
 * overwhelmingly rejected by the live swarm. */
export function continuityChoice(
  incumbent: StreamInfo | undefined,
  baseline: StreamInfo | undefined,
  wantedSubtitles?: string,
): StreamInfo | undefined {
  if (!incumbent || !baseline || incumbent === baseline || incumbent.stream === baseline.stream) return incumbent
  const currentSubs = subtitleCompatibility(incumbent, wantedSubtitles)
  const baselineSubs = subtitleCompatibility(baseline, wantedSubtitles)
  if (currentSubs === 'mismatch' && baselineSubs !== 'mismatch') return baseline
  if (communityDominates(baseline, incumbent)) return baseline
  return incumbent
}

/** Resolution as POINTS, not a veto.
 *
 *  It used to be a hard sort key, which meant any 4K release outranked every 1080p one no matter
 *  how dead it was — so the list led with a 22-seeder 4K file above an 812-seeder 1080p, i.e. with
 *  the thing least likely to actually start playing. As points, the 4K-over-1080p edge is small
 *  enough that health can overturn it and large enough to win when health is comparable. */
export const RESOLUTION_POINTS: [number, number][] = [[2160, 25], [1440, 22], [1080, 20], [720, 8], [480, 2]]

export function scoreInfo(info: StreamInfo, opts: ScoreOptions = {}): { score: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = []
  const add = (signal: string, delta: number) => { if (delta) reasons.push({ signal, delta }) }

  // Stated preference first: the user knows which provider actually works for them, which is not
  // something any signal below can infer from the file.
  if (opts.sourcePriority?.length) {
    const points = priorityPoints(priorityIndexOf(info.stream, opts.sourcePriority))
    if (points) add('preferred source', points)
  }

  const res = RESOLUTION_POINTS.find(([q]) => info.quality >= q)
  if (res) add(`${info.quality}p`, res[1])

  // A swarm of 5000 is not fifty times better than one of 100. Keep a bounded logarithmic
  // distinction above 100 in every mode: even when debrid supplies the bytes, the larger swarm is
  // useful community evidence that this is the normal, well-vetted release rather than an odd mux.
  if (info.seeders != null) add('seeders', seederPoints(info.seeders, !!opts.directP2p))

  const subtitles = subtitleCompatibility(info, opts.subtitleLang)
  if (subtitles === 'match') add('requested subtitles', 6)
  else if (subtitles === 'mismatch') add('wrong or missing subtitles', -24)

  if (opts.directP2p && info.stream.infoHash && !info.stream.url && info.sizeBytes != null) {
    const mib = info.sizeBytes / (1024 ** 2)
    // A multi-gigabyte Blu-ray episode can have a healthy swarm and still take far too long to
    // satisfy MKV startup seeks. Direct mode values time-to-first-frame over archival bitrate.
    const efficiency = mib <= 450 ? 8
      : mib <= 700 ? 6
        : mib <= 1_024 ? 3
          : mib <= 1_536 ? 0
            : mib <= 2_048 ? -4
              : mib <= 3_072 ? -8
                : -12
    add('P2P startup size', efficiency)
  }

  // Anime-specific, and the single most requested distinction after resolution.
  if (info.dualAudio) add('dual audio', 3)

  if (info.bitDepth === '10bit') add('10-bit', 1)
  // HEVC and AV1 both earn the same point: they are the modern efficient encodes, and libmpv
  // decodes both — in hardware where the GPU supports it, through the software fallback where it
  // does not. Browser-based clients penalise AV1 because their renderer struggles with it; that is
  // a property of playing video in a webview, not of the codec, and importing it here would
  // de-rank good releases for a problem this app does not have.
  if (info.codec === 'HEVC' || info.codec === 'AV1') add(info.codec, 1)
  if (info.codec === 'XviD') add('ancient codec', -4)

  if (info.source === 'BluRay') add('BluRay', 2)
  else if (info.source === 'WEB-DL') add('WEB-DL', 1)
  else if (info.source === 'HDTV') add('broadcast rip', -2)

  if (info.hdr) add('HDR', 2)

  const group = info.group ? norm(info.group) : ''
  if (group && TRUSTED.has(group)) add('known group', 2)
  // Staying on one group across a binge keeps subtitle styling, typesetting and naming consistent,
  // but it is a preference rather than a veto. A large swarm gap is meaningful community evidence,
  // and the continuation selectors apply an explicit dominance guard before auto-starting too.
  if (group && opts.previousGroup && group === norm(opts.previousGroup)) {
    // Direct P2P keeps continuity as a very small tie-breaker because swarm health also controls
    // startup. Debrid can afford a little more, but never more than the health signal itself.
    add('same group as last episode', opts.directP2p ? 2 : 4)
  }

  // Curation deliberately scores NOTHING here; addon.ts promotes a curated row within its own
  // resolution instead, which is a thing points cannot express. What matters
  // for a within-tier preference is the ADJACENT gap, not the 25 → 2 spread: 1440p → 1080p is 2
  // points and 1080p → 720p is 12. Curation is a categorical recommendation, so it remains a
  // within-resolution promotion rather than another point term.

  // Nothing to download from and nothing already resolved: not merely worse, effectively unplayable.
  // A penalty rather than a filter, because seeder counts are often stale or simply absent.
  if (info.stream.infoHash && !info.stream.url && info.seeders === 0) add('no seeders and not cached', -20)

  return { score: reasons.reduce((n, r) => n + r.delta, 0), reasons }
}
