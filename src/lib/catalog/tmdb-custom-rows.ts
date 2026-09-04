import { persisted } from 'svelte-persisted-store'
import type { CatalogHomeRowOption, CatalogHomeSection } from './types'

export type TmdbCustomRowMediaType = 'movie' | 'series'
export type TmdbCustomRowSort = 'popular' | 'rating' | 'recent'

export interface TmdbCustomHomeRow {
  id: string
  title: string
  mediaType: TmdbCustomRowMediaType
  sort: TmdbCustomRowSort
  genreId?: number
  genreLabel?: string
  year?: number
  minimumScore?: number
  runtimeMax?: number
  streamingOnly?: boolean
}

export interface TmdbCustomGenre {
  id: number
  label: string
}

export const TMDB_CUSTOM_ROW_LIMIT = 12

export const TMDB_CUSTOM_GENRES: Record<TmdbCustomRowMediaType, TmdbCustomGenre[]> = {
  movie: [
    { id: 28, label: 'Action' }, { id: 12, label: 'Adventure' }, { id: 16, label: 'Animation' },
    { id: 35, label: 'Comedy' }, { id: 80, label: 'Crime' }, { id: 99, label: 'Documentary' },
    { id: 18, label: 'Drama' }, { id: 10751, label: 'Family' }, { id: 14, label: 'Fantasy' },
    { id: 36, label: 'History' }, { id: 27, label: 'Horror' }, { id: 10402, label: 'Music' },
    { id: 9648, label: 'Mystery' }, { id: 10749, label: 'Romance' }, { id: 878, label: 'Science Fiction' },
    { id: 53, label: 'Thriller' }, { id: 10752, label: 'War' }, { id: 37, label: 'Western' },
  ],
  series: [
    { id: 10759, label: 'Action & Adventure' }, { id: 16, label: 'Animation' }, { id: 35, label: 'Comedy' },
    { id: 80, label: 'Crime' }, { id: 99, label: 'Documentary' }, { id: 18, label: 'Drama' },
    { id: 10751, label: 'Family' }, { id: 10762, label: 'Kids' }, { id: 9648, label: 'Mystery' },
    { id: 10763, label: 'News' }, { id: 10764, label: 'Reality' }, { id: 10765, label: 'Sci-Fi & Fantasy' },
    { id: 10766, label: 'Soap' }, { id: 10767, label: 'Talk' }, { id: 10768, label: 'War & Politics' },
    { id: 37, label: 'Western' },
  ],
}

export const tmdbCustomHomeRows = persisted<TmdbCustomHomeRow[]>('tmdb-custom-home-rows-v1', [])

const finiteInteger = (value: unknown, minimum: number, maximum: number): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : undefined
}

export function normalizeTmdbCustomHomeRow(value: unknown): TmdbCustomHomeRow | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<TmdbCustomHomeRow>
  const id = typeof raw.id === 'string' && /^custom-[a-z0-9-]+$/i.test(raw.id) ? raw.id : ''
  const title = typeof raw.title === 'string' ? raw.title.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
  const mediaType = raw.mediaType === 'series' ? 'series' : raw.mediaType === 'movie' ? 'movie' : null
  const sort = raw.sort === 'rating' || raw.sort === 'recent' || raw.sort === 'popular' ? raw.sort : null
  if (!id || !title || !mediaType || !sort) return null
  const genreId = finiteInteger(raw.genreId, 1, 99999)
  const validGenre = genreId == null ? undefined : TMDB_CUSTOM_GENRES[mediaType].find((genre) => genre.id === genreId)
  return {
    id,
    title,
    mediaType,
    sort,
    ...(validGenre ? { genreId: validGenre.id, genreLabel: validGenre.label } : {}),
    ...(finiteInteger(raw.year, 1900, new Date().getFullYear() + 2) ? { year: finiteInteger(raw.year, 1900, new Date().getFullYear() + 2) } : {}),
    ...(typeof raw.minimumScore === 'number' && Number.isFinite(raw.minimumScore) ? { minimumScore: Math.max(0, Math.min(10, raw.minimumScore)) } : {}),
    ...(finiteInteger(raw.runtimeMax, 10, 600) ? { runtimeMax: finiteInteger(raw.runtimeMax, 10, 600) } : {}),
    ...(raw.streamingOnly === true ? { streamingOnly: true } : {}),
  }
}

export function validTmdbCustomHomeRows(values: unknown): TmdbCustomHomeRow[] {
  if (!Array.isArray(values)) return []
  const unique = new Map<string, TmdbCustomHomeRow>()
  for (const value of values) {
    const row = normalizeTmdbCustomHomeRow(value)
    if (row && !unique.has(row.id) && unique.size < TMDB_CUSTOM_ROW_LIMIT) unique.set(row.id, row)
  }
  return [...unique.values()]
}

export function tmdbCustomHomeRowOption(row: TmdbCustomHomeRow): CatalogHomeRowOption {
  const qualifiers = [
    row.genreLabel,
    row.year,
    row.minimumScore != null ? `${row.minimumScore}/10+` : undefined,
    row.runtimeMax ? `under ${row.runtimeMax} min` : undefined,
    row.streamingOnly ? 'streaming in your region' : undefined,
  ].filter(Boolean)
  const ordering = row.sort === 'rating' ? 'highest rated' : row.sort === 'recent' ? 'newest first' : 'most popular'
  return {
    id: row.id,
    title: row.title,
    description: `${row.mediaType === 'movie' ? 'Movies' : 'Series'} · ${ordering}${qualifiers.length ? ` · ${qualifiers.join(' · ')}` : ''}`,
    group: 'Your TMDB rows',
    defaultEnabled: true,
  }
}

export function addTmdbCustomHomeRow(input: Omit<TmdbCustomHomeRow, 'id'>, current: TmdbCustomHomeRow[]): TmdbCustomHomeRow {
  const existing = validTmdbCustomHomeRows(current)
  if (existing.length >= TMDB_CUSTOM_ROW_LIMIT) throw new Error(`You can create up to ${TMDB_CUSTOM_ROW_LIMIT} custom TMDB rows.`)
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const row = normalizeTmdbCustomHomeRow({ ...input, id })
  if (!row) throw new Error('Give this row a title and choose valid filters.')
  tmdbCustomHomeRows.set([...existing, row])
  return row
}

export function removeTmdbCustomHomeRow(id: string, current: TmdbCustomHomeRow[]): void {
  tmdbCustomHomeRows.set(validTmdbCustomHomeRows(current).filter((row) => row.id !== id))
}

export interface TmdbCustomHomeRequest {
  id: string
  path: '/discover/movie' | '/discover/tv'
  kind: 'movie' | 'tv'
  params: Record<string, string | number | boolean | undefined>
  more: CatalogHomeSection['more']
}

export function tmdbCustomHomeRequest(row: TmdbCustomHomeRow, region: string, today = new Date()): TmdbCustomHomeRequest {
  const kind = row.mediaType === 'movie' ? 'movie' : 'tv'
  const releasePrefix = kind === 'movie' ? 'primary_release' : 'first_air_date'
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return {
    id: row.id,
    path: `/discover/${kind}`,
    kind,
    params: {
      sort_by: row.sort === 'rating' ? 'vote_average.desc' : row.sort === 'recent' ? `${releasePrefix}.desc` : 'popularity.desc',
      with_genres: row.genreId,
      [`${releasePrefix}_year`]: row.year,
      ...(row.sort === 'recent' && !row.year ? { [`${releasePrefix}.lte`]: date } : {}),
      'vote_average.gte': row.minimumScore,
      'vote_count.gte': row.sort === 'rating' ? 100 : undefined,
      'with_runtime.lte': row.runtimeMax,
      watch_region: row.streamingOnly ? region : undefined,
      region: row.streamingOnly && kind === 'movie' ? region : undefined,
      with_watch_monetization_types: row.streamingOnly ? 'flatrate|free|ads' : undefined,
    },
    more: {
      type: row.mediaType,
      sort: row.sort,
      genre: row.genreLabel,
      year: row.year,
      minScore: row.minimumScore == null ? undefined : row.minimumScore * 10,
      runtimeMax: row.runtimeMax,
    },
  }
}
