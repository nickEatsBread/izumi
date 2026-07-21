import type { KeyingConfig } from '@urql/exchange-graphcache'

// AniList models these as value objects owned by their parent rather than
// independently addressable entities. Tell Graphcache to embed them instead of
// trying to invent identities from fields that do not exist in AniList's schema.
export const ANILIST_CACHE_KEYS: KeyingConfig = {
  MediaTitle: () => null,
  MediaCoverImage: () => null,
  FuzzyDate: () => null,
  AiringSchedule: () => null,
}
