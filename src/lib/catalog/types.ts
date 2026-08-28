import type { Media } from '$lib/anilist/types'
import type { JvmSourceFilter } from '$lib/extensions/manager'
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

export interface CatalogAdvancedSearchFilters {
  /** Inclusive minimum score on Izumi's shared 0–100 scale. */
  minScore?: number
  minVotes?: number
  /** ISO 639-1 original-language code. */
  language?: string
  /** ISO 3166-1 country-of-origin code. */
  country?: string
}

export interface CatalogSearchRequest extends CatalogAdvancedSearchFilters {
  query?: string
  page?: number
  type?: CatalogContentType | 'all'
  genre?: string
  year?: number
  sort?: 'popular' | 'rating' | 'recent' | 'oldest' | 'title' | 'trending'
  /** JVM-only: selecting one source unlocks that extension's native Aniyomi filters. */
  sourceId?: string
  jvmFilters?: JvmSourceFilter[]
  signal?: AbortSignal
}

export interface CatalogFilterOption {
  value: string
  label: string
}

export interface CatalogSearchOptions {
  languages?: CatalogFilterOption[]
  countries?: CatalogFilterOption[]
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
  /** Optional row ids let the independently configured Merged Home request exactly its rows. */
  home(signal?: AbortSignal, rowIds?: string[]): Promise<CatalogHome>
  search(request: CatalogSearchRequest): Promise<CatalogPage>
  detail(ref: MediaRef, signal?: AbortSignal): Promise<Media | null>
  genres?(signal?: AbortSignal): Promise<string[]>
  /** Provider-owned values for richer search controls, loaded only when its search page is open. */
  searchOptions?(signal?: AbortSignal): Promise<CatalogSearchOptions>
}

export class CatalogConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogConfigurationError'
  }
}
