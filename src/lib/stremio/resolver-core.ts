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
