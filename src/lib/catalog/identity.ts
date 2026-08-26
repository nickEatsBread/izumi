import type { ExternalMediaIds, Media, MediaCatalogIdentity } from '$lib/anilist/types'

export type CatalogProviderId = MediaCatalogIdentity['provider']
export type CatalogContentType = MediaCatalogIdentity['type']

export interface MediaRef {
  provider: CatalogProviderId
  id: string
  type: CatalogContentType
}

/** FNV-1a folded into the negative 31-bit range. AniList ids are positive, so old persisted maps
 * cannot collide with a provider-native item. The full namespaced identity remains authoritative. */
export function compatibilityMediaId(ref: MediaRef): number {
  const value = `${ref.provider}:${ref.type}:${ref.id}`
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  }
  return -((hash >>> 0) % 0x7ffffffe + 1)
}

export function mediaRef(media: Pick<Media, 'id' | 'type' | 'format' | 'catalog'>): MediaRef {
  if (media.catalog) return media.catalog
  const type: CatalogContentType = media.type === 'MANGA'
    ? 'manga'
    : media.format === 'MOVIE' ? 'anime' : 'anime'
  return { provider: 'anilist', id: String(media.id), type }
}

export const mediaKey = (media: Pick<Media, 'id' | 'type' | 'format' | 'catalog'>): string => {
  const ref = mediaRef(media)
  return `${ref.provider}:${ref.type}:${ref.id}`
}

export function externalIdsOf(media: Pick<Media, 'id' | 'idMal' | 'catalog' | 'externalIds'>): ExternalMediaIds {
  const ids = { ...(media.externalIds ?? {}) }
  if (!media.catalog || media.catalog.provider === 'anilist') ids.anilist ??= media.id > 0 ? media.id : undefined
  ids.mal ??= media.idMal
  if (media.catalog?.provider === 'kitsu') ids.kitsu ??= Number(media.catalog.id) || undefined
  if (media.catalog?.provider === 'tmdb') ids.tmdb ??= Number(media.catalog.id) || undefined
  return ids
}

export const anilistIdOf = (media: Pick<Media, 'id' | 'idMal' | 'catalog' | 'externalIds'>): number | undefined =>
  externalIdsOf(media).anilist
export const kitsuIdOf = (media: Pick<Media, 'id' | 'idMal' | 'catalog' | 'externalIds'>): number | undefined =>
  externalIdsOf(media).kitsu

export function catalogMediaHref(media: Pick<Media, 'id' | 'type' | 'format' | 'catalog'>): string {
  const ref = mediaRef(media)
  if (ref.provider === 'anilist') return ref.type === 'manga'
    ? `/app/manga/${encodeURIComponent(ref.id)}`
    : `/app/anime/${encodeURIComponent(ref.id)}`
  return `/app/media/${ref.provider}/${ref.type}/${encodeURIComponent(ref.id)}`
}

export function providerExternalUrl(media: Pick<Media, 'id' | 'type' | 'format' | 'catalog'>): string | undefined {
  const ref = mediaRef(media)
  if (ref.provider === 'anilist') return `https://anilist.co/${ref.type === 'manga' ? 'manga' : 'anime'}/${ref.id}`
  if (ref.provider === 'kitsu') return `https://kitsu.app/${ref.type === 'manga' ? 'manga' : 'anime'}/${ref.id}`
  if (ref.provider === 'tmdb') return `https://www.themoviedb.org/${ref.type === 'movie' ? 'movie' : 'tv'}/${ref.id}`
  return undefined
}
