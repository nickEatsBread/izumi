// Data for the profile-header block: a public AniList profile when the user has named one, else a
// summary of on-device watch history.
import { gql } from '@urql/core'
import { anilist } from '$lib/anilist/client'
import { banner, cover } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'
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

/** Artwork for the profile-header buttons that ask for it (`art`): one of the viewer's own titles
 *  per button, in order and never repeated — Continue Watching first (most recent first), then the
 *  library (`library` in the caller's order, newest first). A title's banner, else its cover; a
 *  button past the titles there are gets none. */
export function profileButtonArt(watching: readonly Media[], library: readonly Media[], count: number): string[] {
  const seen = new Set<number>()
  const art: string[] = []
  for (const media of [...watching, ...library]) {
    if (art.length >= count) break
    if (seen.has(media.id)) continue
    seen.add(media.id)
    const src = media.bannerImage || cover(media)
    if (src) art.push(src)
  }
  return art
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
