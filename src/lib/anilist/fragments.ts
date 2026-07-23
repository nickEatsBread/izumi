import { gql } from '@urql/core'

// Slim projection for schedule cards. The weekly grid renders only a poster, a title, and a
// "my shows" badge (id + idMal) per airing — it never touches description, synonyms, studios,
// banner, trailer, or the 100-node airingSchedule that MediaFields drags in. With up to ~600
// airings a week, fetching the full fragment per airing meant a 100-node schedule + synopsis for
// every one; this cuts the payload (and AniList query-complexity cost) by an order of magnitude.
export const SCHEDULE_MEDIA_FIELDS = gql`
  fragment ScheduleMediaFields on Media {
    id idMal
    title { romaji english userPreferred }
    coverImage { medium extraLarge }
  }`

export const MEDIA_FIELDS = gql`
  fragment MediaFields on Media {
    id idMal
    title { romaji english native userPreferred }
    description(asHtml: false)
    season seasonYear format status episodes duration averageScore popularity trending genres
    synonyms
    startDate { year month day }
    studios(isMain: true) { nodes { id name } }
    coverImage { extraLarge medium color }
    bannerImage
    trailer { id site }
    nextAiringEpisode { episode timeUntilAiring }
    airingSchedule(perPage: 100) { nodes { episode airingAt } }
  }`
