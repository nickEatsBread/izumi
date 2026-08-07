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

  // Seeders, capped. A swarm of 5000 is not fifty times better than one of 100 — past a point the
  // torrent simply saturates the connection, and letting the number run would drown every other
  // signal exactly the way the old ladder did.
  if (info.seeders != null) add('seeders', Math.min(Math.floor(info.seeders / 10), 10))

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
  // which is worth more than any single quality signal — swapping group mid-season is jarring in a
  // way a slightly worse encode is not. Weighted above the seeder cap on purpose: the popular
  // alternative essentially always has more seeders, so anything lower would mean this never
  // decided the one case it exists for.
  if (group && opts.previousGroup && group === norm(opts.previousGroup)) {
    // Continuity is a preference, not permission to fetch a much larger torrent on every Next.
    // Direct P2P keeps a small tie-breaker; debrid/CDN playback retains the strong preference.
    add('same group as last episode', opts.directP2p ? 2 : 12)
  }

  // Curation deliberately scores NOTHING here; addon.ts promotes a curated row within its own
  // resolution instead, which is a thing points cannot express. What matters
  // for a within-tier preference is the ADJACENT gap, not the 25 → 2 spread: 1440p → 1080p is 2
  // points and 1080p → 720p is 12, so any weight big enough to beat group continuity (12) also
  // buys a whole tier — the exact trade the seeder cap of 10 exists to forbid.

  // Nothing to download from and nothing already resolved: not merely worse, effectively unplayable.
  // A penalty rather than a filter, because seeder counts are often stale or simply absent.
  if (info.stream.infoHash && !info.stream.url && info.seeders === 0) add('no seeders and not cached', -20)

  return { score: reasons.reduce((n, r) => n + r.delta, 0), reasons }
}
