import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  discussAnimeArchiveEmbedUrl,
  discussAnimeEmbedUrl,
  discussAnimeThreadsUrl,
  mapDiscussAnimeThread,
  matchDiscussAnimeThread,
  type DiscussAnimeThread,
} from './discussanime'

const row = (overrides: Partial<DiscussAnimeThread> = {}): DiscussAnimeThread => ({
  id: 12,
  slug: 'show-episode-3',
  title: 'Show Episode 3 Discussion',
  url: 'https://discussanime.moe/thread/show-episode-3',
  mal_id: 100,
  episode_number: 3,
  episode_number_end: null,
  comment_count: 42,
  created_at: 1_700_000_000,
  ...overrides,
})

describe('Discuss Anime API request', () => {
  it('uses a build-time public key in static Tauri bundles', () => {
    const source = readFileSync(fileURLToPath(new URL('./discussanime.ts', import.meta.url)), 'utf8')
    expect(source).toContain("from '$env/static/public'")
    expect(source).toContain('publicEnv as Record<string, string | undefined>')
    expect(source).not.toContain("from '$env/dynamic/public'")
  })

  it('uses the MAL id and documented episode pagination parameters', () => {
    const url = new URL(discussAnimeThreadsUrl({ id: 1, idMal: 100, format: 'TV' }, 3))
    expect(url.origin + url.pathname).toBe('https://discussanime.moe/api/v1/threads')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      mal_id: '100', episode: '3', episode_window: '30', limit: '100', page: '1',
    })
    expect(url.searchParams.has('anilist_id')).toBe(false)
  })

  it('falls back to AniList and omits episode matching for movies', () => {
    const url = new URL(discussAnimeThreadsUrl({ id: 7, idMal: null, format: 'MOVIE' }, 1))
    expect(url.searchParams.get('anilist_id')).toBe('7')
    expect(url.searchParams.has('episode')).toBe(false)
  })
})

describe('Discuss Anime thread matching', () => {
  it('matches an exact episode or a range that covers it', () => {
    const rows = [row({ id: 1, episode_number: 1 }), row({ id: 2, episode_number: 3, episode_number_end: 4 })]
    expect(matchDiscussAnimeThread(rows, 4, false)?.id).toBe(2)
  })

  it('uses an unnumbered thread for a movie', () => {
    const rows = [row({ id: 1 }), row({ id: 2, episode_number: null })]
    expect(matchDiscussAnimeThread(rows, null, true)?.id).toBe(2)
  })
})

describe('Discuss Anime Disqus mapping', () => {
  it('builds the verified Discuss Anime identifier from the API thread id', () => {
    const embed = new URL(discussAnimeEmbedUrl(row()))
    expect(embed.searchParams.get('f')).toBe('discussanime')
    expect(embed.searchParams.get('t_i')).toBe('thread-12')
    expect(embed.searchParams.get('t_u')).toBe(row().url)
  })

  it('normalizes counts and epoch seconds for the existing comments panel', () => {
    expect(mapDiscussAnimeThread(row())).toMatchObject({
      id: 'disqus-thread-12', source: 'Disqus', replyCount: 42, createdAt: 1_700_000_000_000,
    })
  })

  it('uses DiscussAnime\'s own renderer for migrated archive threads', () => {
    const archived = row({ id: 8305, slug: 'archive-liar-game-episode-1-discussion-11040292375' })
    expect(discussAnimeArchiveEmbedUrl(archived))
      .toBe('https://discussanime.moe/embed/discussion/archive-liar-game-episode-1-discussion-11040292375')
    expect(mapDiscussAnimeThread(archived)).toMatchObject({
      id: 'discussanime-archive-8305',
      embedUrl: 'https://discussanime.moe/embed/discussion/archive-liar-game-episode-1-discussion-11040292375',
    })
  })

  it('keeps live DiscussAnime threads on Disqus', () => {
    expect(mapDiscussAnimeThread(row()).embedUrl).toContain('https://disqus.com/embed/comments/')
  })
})
