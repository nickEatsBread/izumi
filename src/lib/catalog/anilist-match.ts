/** Finding a catalog title (a source's own, which has no AniList id) on AniList, so it can be tracked
 *  on the viewer's AniList and MyAnimeList lists like any AniList title. */
import { gql, type Client } from '@urql/core'
import type { Media } from '$lib/anilist/types'
import { searchTitleScore } from '$lib/stremio/onlinestream'

const MATCH_QUERY = gql`
  query CatalogAnilistMatch($search: String) {
    Page(perPage: 8) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        id idMal type format status episodes season seasonYear bannerImage
        title { romaji english native userPreferred }
        startDate { year month day }
        coverImage { extraLarge large medium color }
        nextAiringEpisode { episode airingAt timeUntilAiring }
      }
    }
  }
`

const titlesOf = (media: Pick<Media, 'title'>): string[] =>
  [media.title.english, media.title.romaji, media.title.userPreferred, media.title.native].filter((t): t is string => !!t)

/** The candidate whose title confidently names the catalog title; a closer start year breaks ties. */
export function bestAnilistMatch(media: Pick<Media, 'title' | 'startDate'>, candidates: Media[]): Media | null {
  const wanted = titlesOf(media)
  let best: Media | null = null
  let bestScore = 0
  for (const candidate of candidates) {
    const score = Math.max(0, ...titlesOf(candidate).map((t) => searchTitleScore(t, wanted)))
    if (!score) continue
    const year = media.startDate?.year
    const distance = year && candidate.startDate?.year ? Math.abs(candidate.startDate.year - year) : 0
    const ranked = score * 10 - Math.min(distance, 9)
    if (ranked > bestScore) { bestScore = ranked; best = candidate }
  }
  return best
}

export async function findAnilistMatch(client: Client, media: Pick<Media, 'title' | 'startDate'>): Promise<Media | null> {
  const search = media.title.english ?? media.title.romaji ?? media.title.userPreferred
  if (!search) return null
  const result = await client.query(MATCH_QUERY, { search }).toPromise()
  const candidates = (result.data as { Page?: { media?: Media[] } } | undefined)?.Page?.media ?? []
  return bestAnilistMatch(media, candidates)
}
