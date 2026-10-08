// Wire-shaped answers to the series-page query (MEDIA_BY_ID) and a catalogue card, for tests that run
// them through a real graphcache. Every field the queries select is present: graphcache treats an
// omitted field as a cache miss.

const HOUR = 3600
const now = () => Math.floor(Date.now() / 1000)
const date = (year: number | null, month: number | null, day: number | null) =>
  ({ __typename: 'FuzzyDate', year, month, day })

type Fields = Record<string, unknown>

/** A catalogue card (CardMediaFields with `withPreview`) as AniList sends it. */
export function aniListCard(id: number, overrides: Fields = {}): Fields {
  return {
    __typename: 'Media', id, idMal: id + 1, type: 'ANIME', isAdult: false,
    title: { __typename: 'MediaTitle', romaji: `Romaji ${id}`, english: `English ${id}`, native: `Native ${id}`, userPreferred: `Title ${id}` },
    description: `AniList synopsis ${id}`,
    season: 'SPRING', seasonYear: 2026, format: 'TV', status: 'RELEASING', episodes: 12, duration: 24,
    averageScore: 81, genres: ['Action', 'Drama'],
    rankings: [{ __typename: 'MediaRank', rank: 3, type: 'RATED', allTime: false, context: 'highest rated', year: 2026, season: 'SPRING', format: 'TV' }],
    startDate: date(2026, 4, 1),
    coverImage: { __typename: 'MediaCoverImage', extraLarge: `https://anilist.test/cover/xl/${id}.jpg`, large: `https://anilist.test/cover/l/${id}.jpg`, medium: `https://anilist.test/cover/m/${id}.jpg`, color: '#e4a15d' },
    bannerImage: `https://anilist.test/banner/${id}.jpg`,
    trailer: { __typename: 'MediaTrailer', id: `trailer-${id}`, site: 'youtube' },
    nextAiringEpisode: { __typename: 'AiringSchedule', episode: 5, airingAt: now() + 48 * HOUR, timeUntilAiring: 48 * HOUR },
    ...overrides,
  }
}

/** The full series-page record AniList sends for `id`. */
export function aniListDetail(id: number, overrides: Fields = {}): Fields {
  const card = aniListCard(id)
  return {
    ...card,
    popularity: 140_000, trending: 50, synonyms: [`Synonym ${id}`],
    studios: { __typename: 'StudioConnection', nodes: [{ __typename: 'Studio', id: 7, name: 'Studio Seven' }] },
    airingSchedule: { __typename: 'AiringScheduleConnection', nodes: [{ __typename: 'AiringSchedule', episode: 4, airingAt: now() - 120 * HOUR }] },
    isFavourite: false, source: 'LIGHT_NOVEL', countryOfOrigin: 'JP',
    tags: [{ __typename: 'MediaTag', name: 'Military', rank: 90, isGeneralSpoiler: false, isMediaSpoiler: false }],
    mediaListEntry: null,
    relations: {
      __typename: 'MediaRelationConnection',
      edges: [{ __typename: 'MediaEdge', relationType: 'PREQUEL', node: aniListCard(id + 100) }],
    },
    characters: { __typename: 'CharacterConnection', edges: [] },
    staff: { __typename: 'StaffConnection', edges: [] },
    recommendations: { __typename: 'RecommendationConnection', nodes: [] },
    ...overrides,
  }
}

/** The same title as the backup provider answers it: its own title, poster, member count and
 *  synopsis, no banner, and none of AniList's rankings, tags or relations. */
export function backupDetail(id: number, overrides: Fields = {}): Fields {
  return aniListDetail(id, {
    idMal: id + 1,
    title: { __typename: 'MediaTitle', romaji: `Backup romaji ${id}`, english: null, native: null, userPreferred: `Backup title ${id}` },
    description: `Backup synopsis ${id}`,
    averageScore: 70, popularity: 3_200, trending: null, genres: [], rankings: [], synonyms: [],
    coverImage: { __typename: 'MediaCoverImage', extraLarge: `https://backup.test/poster/${id}.jpg`, large: `https://backup.test/poster/${id}.jpg`, medium: null, color: null },
    bannerImage: null, trailer: null, studios: { __typename: 'StudioConnection', nodes: [] },
    nextAiringEpisode: { __typename: 'AiringSchedule', episode: 6, airingAt: now() + 24 * HOUR, timeUntilAiring: 24 * HOUR },
    airingSchedule: { __typename: 'AiringScheduleConnection', nodes: [] },
    isFavourite: null, source: null, countryOfOrigin: null, tags: [],
    relations: { __typename: 'MediaRelationConnection', edges: [] },
    ...overrides,
  })
}
