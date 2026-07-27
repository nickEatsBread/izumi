import type { StreamInfo } from './parse'

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

export function scoreInfo(info: StreamInfo, opts: ScoreOptions = {}): { score: number; reasons: ScoreReason[] } {
  const reasons: ScoreReason[] = []
  const add = (signal: string, delta: number) => { if (delta) reasons.push({ signal, delta }) }

  // Seeders, capped. A swarm of 5000 is not fifty times better than one of 100 — past a point the
  // torrent simply saturates the connection, and letting the number run would drown every other
  // signal exactly the way the old ladder did.
  if (info.seeders != null) add('seeders', Math.min(Math.floor(info.seeders / 10), 10))

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
  if (group && opts.previousGroup && group === norm(opts.previousGroup)) add('same group as last episode', 12)

  // Nothing to download from and nothing already resolved: not merely worse, effectively unplayable.
  // A penalty rather than a filter, because seeder counts are often stale or simply absent.
  if (info.stream.infoHash && !info.stream.url && info.seeders === 0) add('no seeders and not cached', -20)

  return { score: reasons.reduce((n, r) => n + r.delta, 0), reasons }
}
