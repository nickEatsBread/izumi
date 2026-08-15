import type { KeyingConfig } from '@urql/exchange-graphcache'

// AniList models these as value objects owned by their parent rather than
// independently addressable entities. Tell Graphcache to embed them instead of
// trying to invent identities from fields that do not exist in AniList's schema.
export const ANILIST_CACHE_KEYS: KeyingConfig = {
  Page: () => null,
  PageInfo: () => null,
  MediaTitle: () => null,
  MediaCoverImage: () => null,
  FuzzyDate: () => null,
  AiringSchedule: () => null,
  AiringScheduleConnection: () => null,
  StudioConnection: () => null,
  MediaTrailer: () => null,
  MediaRelationConnection: () => null,
  CharacterConnection: () => null,
  StaffConnection: () => null,
  RecommendationConnection: () => null,
}
