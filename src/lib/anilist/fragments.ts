import { gql } from '@urql/core'

export const MEDIA_FIELDS = gql`
  fragment MediaFields on Media {
    id idMal
    title { romaji english native userPreferred }
    description(asHtml: false)
    season seasonYear format status episodes duration averageScore genres
    synonyms
    startDate { year month day }
    studios(isMain: true) { nodes { id name } }
    coverImage { extraLarge medium color }
    bannerImage
    trailer { id site }
    nextAiringEpisode { episode timeUntilAiring }
    airingSchedule(perPage: 100) { nodes { episode airingAt } }
  }`
