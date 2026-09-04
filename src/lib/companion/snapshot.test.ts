import { beforeEach, describe, expect, it, vi } from 'vitest'

const anizip = vi.hoisted(() => ({ getEpisodeMeta: vi.fn() }))
const catalog = vi.hoisted(() => ({ loadCatalogProvider: vi.fn() }))
vi.mock('$lib/anizip', () => anizip)
vi.mock('$lib/catalog/registry', () => catalog)

import {
  COMPANION_SNAPSHOT_TARGET_BYTES,
  compactCompanionSnapshot,
  createCompanionDetails,
  createCompanionPresentation,
} from './snapshot'
import type { CompanionMedia } from './protocol'

const media = (): CompanionMedia => ({
  ref: { provider: 'anilist', type: 'anime', id: '154587' },
  title: 'Frieren',
  episode: 2,
  episodeProgress: 0.4,
  seasonEpisodeCounts: [3],
})

describe('companion episode details', () => {
  beforeEach(() => {
    catalog.loadCatalogProvider.mockReset()
    anizip.getEpisodeMeta.mockReset().mockResolvedValue({
      1: { title: 'The Journey’s End', image: 'https://img.example/1.jpg', runtime: 25 },
      2: { title: 'It Didn’t Have to Be Magic', image: 'https://img.example/2.jpg', runtime: 24 },
      3: { title: 'Killing Magic', image: 'https://img.example/3.jpg', runtime: 26 },
    })
  })

  it('hydrates unique episode artwork and playback progress on demand', async () => {
    const details = await createCompanionDetails(media(), false)
    expect(anizip.getEpisodeMeta).toHaveBeenCalledWith(154587, 1)
    expect(details.episodes).toEqual([
      expect.objectContaining({ episode: 1, title: 'The Journey’s End', image: 'https://img.example/1.jpg', watched: true }),
      expect.objectContaining({ episode: 2, title: 'It Didn’t Have to Be Magic', image: 'https://img.example/2.jpg', progress: 0.4, watched: false }),
      expect.objectContaining({ episode: 3, title: 'Killing Magic', image: 'https://img.example/3.jpg', watched: false }),
    ])
  })

  it('marks every unwatched episode for the TV spoiler treatment', async () => {
    const details = await createCompanionDetails(media(), true)
    expect(details.episodes?.map((episode) => episode.spoiler)).toEqual([false, true, true])
  })

  it('loads provider-owned episode titles, summaries and thumbnails before replying to the TV', async () => {
    catalog.loadCatalogProvider.mockResolvedValue({
      detail: vi.fn().mockResolvedValue({
        id: -7,
        catalog: { provider: 'kitsu', id: '42', type: 'anime' },
        title: { userPreferred: 'Provider Series' },
        episodes: 2,
        duration: 24,
        videos: [
          { number: 1, episode: 1, title: 'Arrival', overview: 'The journey begins.', thumbnail: 'https://img.example/k1.jpg' },
          { number: 2, episode: 2, title: 'Departure', overview: 'The group sets out.', thumbnail: 'https://img.example/k2.jpg' },
        ],
      }),
    })
    const details = await createCompanionDetails({
      ref: { provider: 'kitsu', type: 'anime', id: '42' },
      title: 'Provider Series',
      episode: 2,
      episodeProgress: .25,
    }, false)

    expect(catalog.loadCatalogProvider).toHaveBeenCalledWith('kitsu')
    expect(details.seasonEpisodeCounts).toEqual([2])
    expect(details.episodes).toEqual([
      expect.objectContaining({ episode: 1, title: 'Arrival', description: 'The journey begins.', image: 'https://img.example/k1.jpg', watched: true }),
      expect.objectContaining({ episode: 2, title: 'Departure', description: 'The group sets out.', image: 'https://img.example/k2.jpg', progress: .25 }),
    ])
  })

  it('uses the provider presentation path for TV logo prefetching', async () => {
    const presentation = vi.fn().mockResolvedValue({
      id: -9,
      catalog: { provider: 'tmdb', id: '550', type: 'movie' },
      title: { userPreferred: 'Fight Club' },
      logoImage: 'https://image.tmdb.org/t/p/w500/fight-club-logo.png',
      description: 'An insomniac discovers an underground fight club.',
    })
    const detail = vi.fn()
    catalog.loadCatalogProvider.mockResolvedValue({ presentation, detail })

    const result = await createCompanionPresentation({
      ref: { provider: 'tmdb', type: 'movie', id: '550' },
      title: 'Fight Club',
    })

    expect(presentation).toHaveBeenCalledWith({ provider: 'tmdb', type: 'movie', id: '550' })
    expect(detail).not.toHaveBeenCalled()
    expect(result.logoImage).toBe('https://image.tmdb.org/t/p/w500/fight-club-logo.png')
  })

  it('bounds merged Home snapshots without duplicating derived views or title-detail trees', () => {
    const item = (row: number, index: number): CompanionMedia => ({
      ref: { provider: 'tmdb', type: index % 2 ? 'series' : 'movie', id: `${row}-${index}` },
      title: `Title ${row}-${index}`,
      description: 'A'.repeat(900),
      poster: `https://image.tmdb.org/t/p/w342/${row}-${index}.jpg`,
      backdrop: `https://image.tmdb.org/t/p/original/${row}-${index}.jpg`,
      logoImage: `https://image.tmdb.org/t/p/w500/${row}-${index}-logo.png`,
      relations: Array.from({ length: 12 }, (_, relation) => ({
        relationType: 'SEQUEL',
        media: { ref: { provider: 'tmdb', type: 'series', id: `${row}-${index}-r${relation}` }, title: `Related ${relation}`, description: 'R'.repeat(900) },
      })),
      recommendations: Array.from({ length: 12 }, (_, recommendation) => ({
        ref: { provider: 'tmdb', type: 'movie', id: `${row}-${index}-m${recommendation}` }, title: `Recommended ${recommendation}`, description: 'M'.repeat(900),
      })),
    })
    const rows = Array.from({ length: 14 }, (_, row) => ({
      id: row ? `catalog-${row}` : 'continue',
      title: row ? `Catalogue ${row}` : 'Continue Watching',
      kind: row ? 'catalog' as const : 'continue' as const,
      items: Array.from({ length: 30 }, (_, index) => item(row, index)),
    }))
    const all = rows.flatMap((row) => row.items)
    const compact = compactCompanionSnapshot({
      app: 'izumi', kind: 'companion-home', version: 1, revision: 'oversized', generatedAt: 1,
      catalog: { screen: 'merged', label: 'Merged' }, hero: all[0], rows,
      views: { search: all, trending: all, series: all, movies: all, myList: all },
    })

    expect(new TextEncoder().encode(JSON.stringify(compact)).byteLength).toBeLessThanOrEqual(COMPANION_SNAPSHOT_TARGET_BYTES)
    expect(compact.views).toBeUndefined()
    expect(compact.rows[0].items.length).toBeGreaterThanOrEqual(12)
    expect(compact.rows.length).toBeGreaterThan(3)
    expect(compact.rows.every((row) => row.items.every((entry) => !entry.relations && !entry.recommendations && !entry.episodes))).toBe(true)
    expect(compact.rows[0].items[0].logoImage).toContain('-logo.png')
  })
})
