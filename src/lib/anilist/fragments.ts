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

// Slim projection for the Continue Watching reconcile (MEDIA_BY_IDS_QUERY's local-history refresh +
// MEDIA_BY_MAL_QUERY's MAL id matching). ContinueCard only ever renders a resume thumbnail, a title
// and an episode number, and buildSnapshot only ever reads id/idMal/title/coverImage/bannerImage/
// status/format/episodes/nextAiringEpisode/airingSchedule (see mediaSnapshot in player/history.ts) —
// not the description, synonyms, studios, trailer or 100-node airingSchedule that MediaFields drags
// in. A batch of fifty of those, requested on EVERY mount of the row, was a large parse+normalize
// cost landing on the main thread on a phone. airingSchedule is kept but shrunk (not dropped): AniList
// leaves episodes/nextAiringEpisode both null on many OVAs/ONAs and adult titles, whose only episode-
// count signal is this schedule (see hasAiredEpisodeToWatch/airedCount in anilist/media.ts) — and
// those formats essentially never run past two-dozen episodes, so a much smaller page still covers them.
export const CONTINUE_MEDIA_FIELDS = gql`
  fragment ContinueMediaFields on Media {
    id idMal
    title { romaji english userPreferred }
    coverImage { medium large extraLarge }
    bannerImage
    status format episodes
    nextAiringEpisode { episode airingAt timeUntilAiring }
    airingSchedule(perPage: 26) { nodes { episode airingAt } }
  }`

// Catalogue cards do not need the source-resolution and episode-history payload carried by the
// detail fragment. In particular, nesting a 100-node airing schedule in every home/search card made
// a twenty-card page normalize hundreds or thousands of objects that the card never reads.
// Desktop hover previews opt into their three rich fields; Gamescope/mobile pass `withPreview=false`
// because SmallCard deliberately disables that popup there.
export const CARD_MEDIA_FIELDS = gql`
  fragment CardMediaFields on Media {
    id idMal type isAdult
    title { romaji english native userPreferred }
    description(asHtml: false) @include(if: $withPreview)
    season seasonYear format status episodes averageScore
    startDate { year month day }
    coverImage { extraLarge large medium color }
    bannerImage @include(if: $withPreview)
    trailer @include(if: $withPreview) { id site }
    nextAiringEpisode { episode airingAt timeUntilAiring }
  }`

// Featured banners need richer discovery metadata than a card, but not source-matching aliases,
// popularity counters, start dates, or a hundred episode nodes. Keep the small schedule fallback so
// short OVAs whose scalar episode count is null still show a useful total.
export const HERO_MEDIA_FIELDS = gql`
  fragment HeroMediaFields on Media {
    id idMal type isAdult
    title { romaji english native userPreferred }
    description(asHtml: false)
    season seasonYear format status episodes duration averageScore genres
    studios(isMain: true) { nodes { id name } }
    coverImage { extraLarge large medium color }
    bannerImage
    trailer { id site }
    nextAiringEpisode { episode airingAt timeUntilAiring }
    airingSchedule(perPage: 26) { nodes { episode airingAt } }
  }`

export const MEDIA_FIELDS = gql`
  fragment MediaFields on Media {
    id idMal type isAdult
    title { romaji english native userPreferred }
    description(asHtml: false)
    season seasonYear format status episodes duration averageScore popularity trending genres
    synonyms
    startDate { year month day }
    studios(isMain: true) { nodes { id name } }
    coverImage { extraLarge large medium color }
    bannerImage
    trailer { id site }
    nextAiringEpisode { episode airingAt timeUntilAiring }
    airingSchedule(perPage: 100) { nodes { episode airingAt } }
  }`

// Manga/light-novel cards need publication metadata, but none of the anime-only airing schedule,
// trailer, or studio payload. Keeping this separate prevents reading-list support from making every
// anime browse query heavier.
export const READING_MEDIA_FIELDS = gql`
  fragment ReadingMediaFields on Media {
    id idMal type
    title { romaji english native userPreferred }
    description(asHtml: false)
    format status chapters volumes averageScore popularity genres synonyms
    countryOfOrigin source
    startDate { year month day }
    coverImage { extraLarge large medium color }
    bannerImage
  }`
