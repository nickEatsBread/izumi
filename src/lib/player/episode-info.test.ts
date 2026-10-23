import { describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { episodeName, loadEpisodeMeta } from './episode-info'

describe('episodeName', () => {
  it('gives the episode its own title unless it is a placeholder or spoilers are hidden', () => {
    expect(episodeName(3, { title: 'The Red Tide' }, false)).toBe('The Red Tide')
    expect(episodeName(3, { title: 'Episode 3' }, false)).toBeUndefined()
    expect(episodeName(3, { title: 'The Red Tide' }, true)).toBeUndefined()
    expect(episodeName(3, undefined, false)).toBeUndefined()
  })
})

describe('loadEpisodeMeta', () => {
  const media = { id: 1, videos: [{ number: 2, title: 'From catalog', overview: 'cat', season: 1 }] } as unknown as Media
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it('answers from the catalog first, then merges the episode lookup, and stops after cancel', async () => {
    const seen: (string | undefined)[] = []
    const fetchMeta = vi.fn(async () => ({ 2: { title: 'From lookup', overview: 'full', season: 1 } }))
    const cancel = loadEpisodeMeta(media, 2, (meta) => seen.push(meta?.title), { fetchMeta, anilistId: () => 1 })
    await tick()
    expect(seen).toEqual(['From catalog', 'From lookup'])
    cancel()
    const late = loadEpisodeMeta(media, 2, (meta) => seen.push(meta?.title), { fetchMeta, anilistId: () => 1 })
    late()
    await tick()
    expect(seen).toEqual(['From catalog', 'From lookup', 'From catalog'])
  })

  it('delivers only the catalog answer when the title has no AniList id', async () => {
    const seen: (string | undefined)[] = []
    const fetchMeta = vi.fn(async () => ({}))
    loadEpisodeMeta(media, 2, (meta) => seen.push(meta?.title), { fetchMeta, anilistId: () => undefined })
    await tick()
    expect(seen).toEqual(['From catalog'])
    expect(fetchMeta).not.toHaveBeenCalled()
  })

  it('keeps the catalog answer when the episode lookup fails', async () => {
    const seen: (string | undefined)[] = []
    const fetchMeta = vi.fn(async () => { throw new Error('offline') })
    loadEpisodeMeta(media, 2, (meta) => seen.push(meta?.title), { fetchMeta, anilistId: () => 1 })
    await tick()
    expect(seen).toEqual(['From catalog'])
  })
})
