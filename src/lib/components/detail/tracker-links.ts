import type { Media } from '$lib/anilist/types'
import { externalIdsOf } from '$lib/catalog/identity'
import { simklClientId } from '$lib/trackers/config'
import { simklApiUrl } from '$lib/trackers/simkl-auth'

export type DetailTracker = 'anilist' | 'mal' | 'kitsu' | 'simkl'
export type TrackerConnections = Record<DetailTracker, boolean>

export interface DetailTrackerLink {
  id: DetailTracker
  label: string
  title: string
  url: string
  connected: boolean
}

const labels: Record<DetailTracker, string> = {
  anilist: 'AniList',
  mal: 'MAL',
  kitsu: 'Kitsu',
  simkl: 'SIMKL',
}

const defaultOrder: DetailTracker[] = ['anilist', 'mal', 'kitsu', 'simkl']

function preferredTitle(media: Media): string | undefined {
  return media.title.userPreferred ?? media.title.english ?? media.title.romaji ?? media.title.native
}

/** SIMKL documents /redirect as the lightweight way to deep-link when the caller already has
 * external catalogue IDs. Pass every ID we know so SIMKL can choose the most reliable match. */
function simklTitleUrl(media: Media, kitsuId?: number): string | undefined {
  if (!simklClientId) return undefined
  const ids = externalIdsOf(media)
  if (!ids.anilist && !ids.mal && !kitsuId) return undefined
  const url = new URL(simklApiUrl('/redirect'))
  url.searchParams.set('to', 'simkl')
  if (ids.anilist) url.searchParams.set('anilist', String(ids.anilist))
  if (ids.mal) url.searchParams.set('mal', String(ids.mal))
  if (kitsuId) url.searchParams.set('kitsu', String(kitsuId))
  const name = preferredTitle(media)
  if (name) url.searchParams.set('title', name)
  if (media.seasonYear) url.searchParams.set('year', String(media.seasonYear))
  return url.toString()
}

/** Per-title tracker destinations. Connected services are promoted ahead of the ordinary
 * catalogue order, so a SIMKL-only viewer sees SIMKL first instead of unrelated AniList/MAL. */
export function detailTrackerLinks(
  media: Media,
  connected: TrackerConnections,
  resolvedKitsuId?: number,
): DetailTrackerLink[] {
  const ids = externalIdsOf(media)
  const kitsuId = resolvedKitsuId ?? ids.kitsu
  const urls: Partial<Record<DetailTracker, string>> = {
    ...(ids.anilist ? { anilist: `https://anilist.co/anime/${ids.anilist}` } : {}),
    ...(ids.mal ? { mal: `https://myanimelist.net/anime/${ids.mal}` } : {}),
    ...(kitsuId ? { kitsu: `https://kitsu.app/anime/${kitsuId}` } : {}),
  }
  const simkl = simklTitleUrl(media, kitsuId)
  if (simkl) urls.simkl = simkl

  return defaultOrder
    .flatMap((id): DetailTrackerLink[] => urls[id] ? [{
      id,
      label: labels[id],
      title: `Open on ${labels[id]}`,
      url: urls[id],
      connected: connected[id],
    }] : [])
    .sort((left, right) => Number(right.connected) - Number(left.connected))
}
