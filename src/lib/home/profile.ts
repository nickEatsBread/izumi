// Data for the profile-header block: a public AniList profile when the user has named one, else a
// summary of on-device watch history.
import { gql } from '@urql/core'
import { anilist } from '$lib/anilist/client'
import { banner, cover } from '$lib/anilist/media'
import type { HistoryEntry } from '$lib/player/history'

export interface ProfileSummary { name: string; avatar?: string; banner?: string; episodes: number; titles: number; source: 'anilist' | 'local' }

const PROFILE_QUERY = gql`
  query ProfileHeader($name: String!) {
    User(name: $name) {
      name
      avatar { large }
      bannerImage
      statistics { anime { count episodesWatched } }
    }
  }`

export async function loadAniListProfile(name: string): Promise<ProfileSummary | null> {
  const result = await anilist.query(PROFILE_QUERY, { name }).toPromise()
  const user = result.data?.User as { name: string; avatar?: { large?: string }; bannerImage?: string | null; statistics?: { anime?: { count?: number; episodesWatched?: number } } } | undefined
  if (result.error || !user) return null
  return {
    name: user.name,
    ...(user.avatar?.large ? { avatar: user.avatar.large } : {}),
    ...(user.bannerImage ? { banner: user.bannerImage } : {}),
    episodes: user.statistics?.anime?.episodesWatched ?? 0,
    titles: user.statistics?.anime?.count ?? 0,
    source: 'anilist',
  }
}

/** Episodes = the furthest episode reached in each title; the banner comes from the latest title. */
export function localProfile(history: Record<number, HistoryEntry>): ProfileSummary {
  const entries = Object.values(history)
  const latest = entries.reduce<HistoryEntry | undefined>((best, entry) => (!best || entry.updatedAt > best.updatedAt ? entry : best), undefined)
  const art = latest ? banner(latest.media) || cover(latest.media) : ''
  return {
    name: 'You',
    ...(art ? { banner: art } : {}),
    episodes: entries.reduce((sum, entry) => sum + Math.max(0, Math.floor(entry.episode || 0)), 0),
    titles: entries.length,
    source: 'local',
  }
}
