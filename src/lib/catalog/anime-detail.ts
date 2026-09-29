import { readable, type Readable } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import type { EpMeta } from '$lib/anizip/types'
import { airedCount, resumeEp, totalEpisodes } from '$lib/anilist/media'
import { anilistIdOf, type MediaRef } from './identity'
import { loadCatalogProvider } from './registry'

export interface AnimeDetailState {
  fetching: boolean
  data?: { Media: Media | null }
  error?: { message: string }
}

export const usesAnimeDetail = (ref: MediaRef): boolean => ref.type === 'anime'

/** Provider data feeds the same anime presentation; it keeps its native playback identity. */
export function animeDetailSource(
  ref: MediaRef,
  offline = false,
  loadProvider = loadCatalogProvider,
): Readable<AnimeDetailState> {
  return readable<AnimeDetailState>({ fetching: !offline }, (set) => {
    if (offline) return
    const abort = new AbortController()
    void (async () => {
      try {
        if (!usesAnimeDetail(ref) || ref.provider === 'anilist') throw new Error('Unsupported anime provider')
        const provider = await loadProvider(ref.provider)
        if (abort.signal.aborted) return
        const media = await provider.detail(ref, abort.signal)
        if (!abort.signal.aborted) set({ fetching: false, data: { Media: media ? normalizeAnimeDetail(media) : null } })
      } catch (error) {
        if (!abort.signal.aborted) set({ fetching: false, error: { message: error instanceof Error ? error.message : String(error) } })
      }
    })()
    return () => abort.abort()
  })
}

/** Release dates and source-published episodes supply evidence without treating a planned total
 * as released. Kitsu's padded, undated episode placeholders are deliberately not evidence. */
export function normalizeAnimeDetail(media: Media, now = Date.now()): Media {
  const nodes = [...(media.airingSchedule?.nodes ?? [])]
  for (const video of media.videos ?? []) {
    const at = video.released ? Date.parse(video.released) : NaN
    if (Number.isFinite(at)) nodes.push({ episode: video.number, airingAt: at / 1000 })
    else if (media.catalog?.provider === 'jvm' && video.id) nodes.push({ episode: video.number, airingAt: (now - 1) / 1000 })
  }
  return { ...media, type: 'ANIME', airingSchedule: { ...media.airingSchedule, nodes } }
}

/** Source episode numbers can start above one or include specials. Do not replace them with 1..N. */
export function animeEpisodeNumbers(media: Media): number[] {
  if (media.catalog && media.catalog.provider !== 'anilist' && media.videos?.length) {
    return [...new Set(media.videos.map((video) => video.number).filter((number) => Number.isFinite(number) && number >= 0))]
      .sort((left, right) => left - right)
  }
  return Array.from({ length: totalEpisodes(media) }, (_, index) => index + 1)
}

export function animeEpisodeMetadata(media: Media): Record<number, EpMeta> {
  return Object.fromEntries((media.videos ?? []).map((video) => [video.number, {
    title: video.title, image: video.thumbnail, overview: video.overview,
    airDate: video.released, season: video.season,
  }]))
}

/** Everything an episode list's metadata is loaded from: the title's id, the AniList id AniZip is read
 * by, and the episode data its provider supplied. It stays the same across repeated deliveries of one
 * series, which hand the list a new `media` object each time (see EpisodeList.svelte). */
export const animeEpisodeMetadataKey = (media: Media): string =>
  JSON.stringify([media.id, anilistIdOf(media) ?? null, animeEpisodeMetadata(media)])

export function animeResumeEpisode(media: Media, watched: number): number {
  if (!media.catalog || media.catalog.provider === 'anilist' || !media.videos?.length) return resumeEp(media, watched)
  const numbers = animeEpisodeNumbers(media)
  const aired = airedCount(media)
  const available = numbers.filter((episode) => Number.isFinite(aired) && episode <= aired)
  return available.find((episode) => episode > watched) ?? available.at(-1) ?? numbers[0] ?? 1
}

const progressIds = (media: Media): number[] => {
  const canonical = anilistIdOf(media)
  return canonical == null ? [media.id] : [...new Set([media.id, canonical])]
}

/** Episodes this device has recorded as watched: this session's plays and local history
 * (incognito plays included), across a provider card and its mapped AniList id. */
export function recordedWatched(
  media: Media,
  history: Record<number, { progress: number }>,
  session: Record<number, number>,
): number {
  return Math.max(0, ...progressIds(media).flatMap((id) => [history[id]?.progress ?? 0, session[id] ?? 0]))
}

/** Read progress across a provider card and its mapped AniList history, without changing the ids
 * passed to playback or moving existing saved records. Explicit manual progress still wins. */
export function animeWatchedProgress(
  media: Media,
  history: Record<number, { progress: number }>,
  session: Record<number, number>,
  overrides: Record<number, number>,
): number {
  for (const id of progressIds(media)) if (overrides[id] != null) return overrides[id]
  return Math.max(media.mediaListEntry?.progress ?? 0, recordedWatched(media, history, session))
}
