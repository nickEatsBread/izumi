// GENERATED from src/lib/stremio/resolver-core.ts by scripts/generate-cloudflare-resolver-core.mjs.
// Edit the canonical source, then regenerate; do not edit this vendored copy.
// Pure resolver surface shared by local Izumi playback and the self-hosted Cloudflare Worker.
// Modules exported here must remain independent of Svelte stores, Tauri commands and browser-only
// persistence so the Worker always runs the same normalization/ranking code as the client.

export { buildStreamIds, type StreamIdInput } from './stream-ids'
export {
  acceptsStreamId,
  type AddonCatalog,
  type AddonCatalogExtra,
  type AddonManifest,
  type AddonResource,
} from './manifest-capability'
export { dedupeStreams } from './dedupe'
export { isSupplementalVideo, isTvVideoCompatible } from './playback-suitability'
export { normalizeStreamBehavior, safeProxyHeaders } from './stream-behavior'
export {
  describe,
  isCached,
  isNotice,
  isUncached,
  isWrongSeason,
  parseSeasonEp,
  qualityLabel,
  resolutionOf,
} from './parse'
export type { CacheState, Stream, StreamInfo, StreamSort } from './parse'
export {
  languageMismatch,
  pickBest,
  pickCandidates,
  preferDirectStartupCandidates,
  rankInfos,
  rankStreams,
} from './ranking'
export type { RankOptions } from './ranking'
export { refineStreamsLite } from './refine-lite'
export type { RefinedLite, RefineLiteContext } from './refine-lite'
export { addonOriginId, normalizeBase } from './origin-id'
export { hostedRouteInfoHash, torrentioResolverInfoHash } from './resolver-url'
export { allowedByPriority, applyPriorityFilter, priorityIndexOf, priorityPoints } from './source-priority'
export type { SourcePriorityMode } from './source-priority'
