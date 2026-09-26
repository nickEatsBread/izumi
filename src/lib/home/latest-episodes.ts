// Every newly aired episode, newest first — the "latest releases" grid of streaming sites. Unlike the
// Recently Released row this keeps every episode (a double drop shows twice) and pages backwards
// from a fixed moment, so page 3 stays page 3 while the user is paging even as new episodes air.
import { gql } from '@urql/core'
import { get } from 'svelte/store'
import { anilist } from '$lib/anilist/client'
import { CARD_MEDIA_FIELDS } from '$lib/anilist/fragments'
import type { Media } from '$lib/anilist/types'
import { gameMode } from '$lib/player/session'
import { showAdult } from '$lib/settings/ui'

export interface EpisodeRelease { media: Media; episode: number; airingAt: number }
export interface ReleasePage { items: EpisodeRelease[]; hasNextPage: boolean; lastPage?: number }

export const LATEST_EPISODES_QUERY = gql`
  query LatestEpisodes($page: Int = 1, $perPage: Int = 12, $before: Int!, $withPreview: Boolean = false) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage lastPage }
      airingSchedules(airingAt_lesser: $before, sort: TIME_DESC) {
        episode airingAt
        media { ...CardMediaFields }
      }
    }
  }
  ${CARD_MEDIA_FIELDS}`

/** `before` is a Unix time in seconds; keep it fixed for the life of the block. */
export async function loadLatestEpisodes(page: number, perPage: number, before: number): Promise<ReleasePage> {
  const result = await anilist.query(LATEST_EPISODES_QUERY, { page, perPage, before, withPreview: !get(gameMode) }).toPromise()
  if (result.error) throw result.error
  const data = result.data?.Page as { pageInfo?: { hasNextPage?: boolean; lastPage?: number | null }; airingSchedules?: Array<EpisodeRelease | { media: null }> } | undefined
  const adult = get(showAdult)
  const items = (data?.airingSchedules ?? []).filter((item): item is EpisodeRelease => !!item.media && (adult || !item.media.isAdult))
  return { items, hasNextPage: !!data?.pageInfo?.hasNextPage, ...(data?.pageInfo?.lastPage ? { lastPage: data.pageInfo.lastPage } : {}) }
}

/** The episode still when AniZip has one, else the series banner, else its cover. */
export function releaseStill(release: EpisodeRelease, still?: string): string {
  return still || release.media.bannerImage || release.media.coverImage?.extraLarge || release.media.coverImage?.large || release.media.coverImage?.medium || ''
}

export const releaseKey = (release: EpisodeRelease): string => `${release.media.id}-${release.episode}-${release.airingAt}`

/** "Load more" appends pages; keep the first copy of any release seen twice (a keyed list would throw). */
export function appendReleases(current: EpisodeRelease[], next: EpisodeRelease[]): EpisodeRelease[] {
  const seen = new Set(current.map(releaseKey))
  return [...current, ...next.filter((release) => !seen.has(releaseKey(release)) && seen.add(releaseKey(release)))]
}
