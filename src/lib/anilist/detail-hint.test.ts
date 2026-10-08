import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const goto = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('$app/navigation', () => ({ goto }))

import { detailHints, detailLink, openDetail, rememberDetail } from './detail-hint'
import type { Media } from './types'

describe('detail navigation hints', () => {
  beforeEach(() => {
    detailHints.set({})
    goto.mockClear()
  })

  it('carries the exact title displayed by Continue Watching', () => {
    rememberDetail({ id: 101, title: { romaji: 'Series' } }, 'Displayed series name')
    expect(get(detailHints)[101]?.title).toMatchObject({
      romaji: 'Series',
      userPreferred: 'Displayed series name',
    })
  })

  it('keeps what a richer earlier hint knew when a slimmer card records the same title', () => {
    const full: Media = { id: 7, title: { romaji: 'Series' }, bannerImage: 'banner.jpg', description: 'Synopsis', coverImage: { extraLarge: 'old.jpg' } }
    rememberDetail(full)
    rememberDetail({ id: 7, title: { romaji: 'Series' }, coverImage: { extraLarge: 'cover.jpg' } })
    expect(get(detailHints)[7]).toMatchObject({ bannerImage: 'banner.jpg', description: 'Synopsis', coverImage: { extraLarge: 'cover.jpg' } })
    // A card that knows the title has no banner says so, and that wins.
    rememberDetail({ id: 7, title: { romaji: 'Series' }, bannerImage: null as unknown as string })
    expect(get(detailHints)[7]?.bannerImage).toBeNull()
  })

  it('keeps the cover colour and titles a slimmer slice of the same record leaves out', () => {
    rememberDetail({
      id: 15, title: { romaji: 'Series', native: 'シリーズ' },
      coverImage: { extraLarge: 'xl.jpg', large: 'l.jpg', medium: 'm.jpg', color: '#e4a15d' },
    })
    // A schedule row: two cover sizes, no native title, no colour.
    rememberDetail({ id: 15, title: { romaji: 'Series', english: 'The Series' }, coverImage: { medium: 'm2.jpg', extraLarge: 'xl2.jpg' } })
    expect(get(detailHints)[15]).toMatchObject({
      title: { romaji: 'Series', english: 'The Series', native: 'シリーズ' },
      coverImage: { extraLarge: 'xl2.jpg', large: 'l.jpg', medium: 'm2.jpg', color: '#e4a15d' },
    })
    // A provider card built with undefined fields does not know them, so they erase nothing.
    rememberDetail({ id: 15, title: { romaji: 'Series', native: undefined }, bannerImage: 'banner.jpg' })
    rememberDetail({ id: 15, title: { romaji: 'Series' }, bannerImage: undefined, coverImage: { color: undefined } })
    expect(get(detailHints)[15]).toMatchObject({ bannerImage: 'banner.jpg', title: { native: 'シリーズ' }, coverImage: { color: '#e4a15d' } })
  })

  it('replaces a record from another catalog under the same id instead of mixing the two', () => {
    // The stand-in record the series page shows while AniList is unavailable keeps the AniList id.
    rememberDetail({
      id: 16, title: { romaji: 'Series' }, description: 'Stand-in synopsis', bannerImage: 'banner.jpg',
      catalog: { provider: 'kitsu', type: 'anime', id: '900' },
    })
    const card: Media = { id: 16, title: { romaji: 'Series' }, coverImage: { extraLarge: 'cover.jpg' } }
    rememberDetail(card)
    expect(get(detailHints)[16]).toBe(card)
  })

  it('does not emit again when the same card records the same media twice', () => {
    const media: Media = { id: 8, title: { romaji: 'Series' } }
    const seen = vi.fn()
    const stop = detailHints.subscribe(seen)
    rememberDetail(media)
    rememberDetail(media)
    rememberDetail({ ...media })
    stop()
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('records the hint before opening the series page', async () => {
    await openDetail({ id: 9, title: { romaji: 'Series' } }, 'Shown title')
    expect(get(detailHints)[9]?.title.userPreferred).toBe('Shown title')
    expect(goto).toHaveBeenCalledWith('/app/anime/9')
  })

  it('records the linked media on press, click and Enter, and follows the latest media', () => {
    const node = new EventTarget() as HTMLElement
    const first: Media = { id: 11, title: { romaji: 'First' } }
    const action = detailLink(node, first)
    node.dispatchEvent(new Event('pointerdown'))
    expect(get(detailHints)[11]).toBe(first)

    const second: Media = { id: 12, title: { romaji: 'Second' } }
    action.update(second)
    node.dispatchEvent(new Event('click'))
    expect(get(detailHints)[12]).toBe(second)

    const third: Media = { id: 13, title: { romaji: 'Third' } }
    action.update(third)
    node.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Tab' }))
    expect(get(detailHints)[13]).toBeUndefined()
    node.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }))
    expect(get(detailHints)[13]).toBe(third)

    // No media yet (an entry still loading) records nothing; a destroyed action stops listening.
    action.update(undefined)
    node.dispatchEvent(new Event('click'))
    action.update({ id: 14, title: {} })
    action.destroy()
    node.dispatchEvent(new Event('click'))
    expect(Object.keys(get(detailHints)).sort()).toEqual(['11', '12', '13'])
    expect(goto).not.toHaveBeenCalled()
  })
})
