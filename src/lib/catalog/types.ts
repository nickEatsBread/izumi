import type { Media } from '$lib/anilist/types'
import type { CatalogContentType, CatalogProviderId, MediaRef } from './identity'

export interface CatalogCapabilities {
  anime: boolean
  movies: boolean
  series: boolean
  manga?: boolean
  search: boolean
  genres?: boolean
  schedule?: boolean
  episodes?: boolean
  cast?: boolean
  relations?: boolean
}

export interface CatalogPage {
  media: Media[]
  page: number
  hasNextPage: boolean
  total?: number
}

export interface CatalogSearchRequest {
  query?: string
  page?: number
  type?: CatalogContentType | 'all'
  genre?: string
  year?: number
  sort?: 'popular' | 'rating' | 'recent' | 'trending'
  signal?: AbortSignal
}

export interface CatalogHomeSection {
  id: string
  title: string
  media: Media[]
  /** Search request represented by “View more”, where the provider supports it. */
  more?: Omit<CatalogSearchRequest, 'signal'>
}

export interface CatalogHome {
  hero: Media[]
  sections: CatalogHomeSection[]
}

/** A row offered by a provider's Home customizer. `defaultEnabled: false` keeps broad preset
 * libraries cheap until the user asks for them. */
export interface CatalogHomeRowOption {
  id: string
  title: string
  description?: string
  group?: string
  defaultEnabled?: boolean
}

export interface CatalogProvider {
  id: CatalogProviderId
  label: string
  capabilities: CatalogCapabilities
  homeRows?(signal?: AbortSignal): Promise<CatalogHomeRowOption[]>
  home(signal?: AbortSignal): Promise<CatalogHome>
  search(request: CatalogSearchRequest): Promise<CatalogPage>
  detail(ref: MediaRef, signal?: AbortSignal): Promise<Media | null>
  genres?(signal?: AbortSignal): Promise<string[]>
}

export class CatalogConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogConfigurationError'
  }
}
