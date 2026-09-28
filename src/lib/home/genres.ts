import { anilist } from '$lib/anilist/client'
import { GENRE_COLLECTION } from '$lib/anilist/detail-queries'
import type { CatalogHomeTarget } from '$lib/catalog/home-layout'
import { loadCatalogProvider } from '$lib/catalog/registry'
import { TOP_GENRES } from './blocks'

/** Genres the current Home's catalog knows. AniList for AniList and Merged Homes. */
export async function loadGenres(target: CatalogHomeTarget, signal?: AbortSignal): Promise<string[]> {
  if (target === 'merged' || target === 'auto' || target === 'anilist') {
    const result = await anilist.query(GENRE_COLLECTION, {}).toPromise()
    return (result.data?.GenreCollection as string[] | undefined) ?? []
  }
  const provider = await loadCatalogProvider(target)
  return (await provider.genres?.(signal)) ?? []
}

/** The chips to show. `available` is null until the catalog's genres have loaded. */
export function genreChipList(config: 'top' | string[], available: string[] | null): string[] {
  const wanted = config === 'top' ? TOP_GENRES : config
  if (!available?.length) return [...wanted]
  const known = new Map(available.map((genre) => [genre.toLowerCase(), genre]))
  return wanted.flatMap((genre) => {
    const match = known.get(genre.toLowerCase())
    return match ? [match] : []
  })
}
