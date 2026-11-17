import { describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { connecting } from '$lib/player/session'

const detail = vi.fn()
vi.mock('./registry', () => ({ loadCatalogProvider: async () => ({ detail }) }))
const playEpisode = vi.fn(async () => {})
vi.mock('$lib/stremio/play', () => ({ playEpisode }))
const { playSourceTitle } = await import('./source-play')

const media = { id: 1, title: { english: 'A title' }, catalog: { provider: 'stremio', type: 'series', id: 'x' }, coverImage: { extraLarge: 'https://img.example/c.jpg' } } as unknown as Media

describe('playing a source title from a card or the banner', () => {
  it('puts the connecting screen up with the press, before its details arrive', async () => {
    let answer!: (value: unknown) => void
    detail.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
    const played = playSourceTitle(media, 'ep1')
    expect(get(connecting)?.title).toBe('A title')
    answer({ ...media, videos: [{ id: 'ep1', number: 1, episode: 1 }] })
    expect(await played).toBe(true)
    expect(playEpisode).toHaveBeenCalledOnce()
    // playEpisode put up nothing of its own here, so the stand-in comes down.
    expect(get(connecting)).toBeNull()
  })

  it('takes the screen down when there is nothing to play', async () => {
    detail.mockResolvedValueOnce(null)
    expect(await playSourceTitle(media, 'ep1')).toBe(false)
    expect(get(connecting)).toBeNull()
  })

  it('plays nothing once the viewer cancelled while the details loaded', async () => {
    playEpisode.mockClear()
    let answer!: (value: unknown) => void
    detail.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
    const played = playSourceTitle(media, 'ep1')
    get(connecting)?.cancel()
    answer({ ...media, videos: [{ id: 'ep1', number: 1, episode: 1 }] })
    expect(await played).toBe(true)
    expect(playEpisode).not.toHaveBeenCalled()
  })
})

describe('a signed-out source', () => {
  it('turns its 401 into a sign-in for that source, not "not found"', async () => {
    const { readFileSync } = await import('node:fs')
    const provider = readFileSync('src/lib/catalog/providers/stremio.ts', 'utf8')
    expect(provider).toContain("throw new SourceSignInError('Sign in to this source to see its titles.', sourceAddonInfo.packageId)")
    const page = readFileSync('src/lib/components/catalog/CatalogMediaDetail.svelte', 'utf8')
    expect(page).toContain('signInSource = reason instanceof SourceSignInError ? reason.packageId : null')
    expect(page).toContain("{signInSource ? 'Sign in to see this title'")
  })
})
