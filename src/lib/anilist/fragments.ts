import { gql } from '@urql/core'

export const MEDIA_FIELDS = gql`
  fragment MediaFields on Media {
    id idMal
    title { romaji english native userPreferred }
    description(asHtml: false)
    season seasonYear format status episodes duration averageScore genres
    coverImage { extraLarge medium color }
    bannerImage
    trailer { id site }
    nextAiringEpisode { episode timeUntilAiring }
  }`
