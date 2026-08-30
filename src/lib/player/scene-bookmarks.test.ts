import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import {
  addSceneBookmark,
  clearSceneBookmarks,
  mergeSceneBookmarkRecords,
  removeSceneBookmark,
  sceneBookmarkRecords,
  sceneBookmarks,
  updateSceneBookmark,
} from './scene-bookmarks'

const media = {
  id: 7,
  idMal: 70,
  type: 'ANIME',
  title: { userPreferred: 'A Place Further Than the Universe' },
  coverImage: { medium: 'cover.jpg' },
} as Media

describe('scene bookmarks', () => {
  beforeEach(() => sceneBookmarkRecords.set({}))

  it('saves a trimmed media snapshot and avoids double-saving the same moment', () => {
    const first = addSceneBookmark({ media, episode: 3, position: 62.25, duration: 1440, quote: '  We   are going.  ' }, 100)
    const duplicate = addSceneBookmark({ media, episode: 3, position: 63, duration: 1440 }, 200)

    expect(first.created).toBe(true)
    expect(duplicate.created).toBe(false)
    expect(get(sceneBookmarks)).toHaveLength(1)
    expect(get(sceneBookmarks)[0]).toMatchObject({ episode: 3, position: 62.25, quote: 'We are going.' })
  })

  it('updates notes and keeps a deletion tombstone', () => {
    const { bookmark } = addSceneBookmark({ media, episode: 1, position: 12 }, 100)
    expect(updateSceneBookmark(bookmark.id, { note: '  Best   line ' }, 200)).toBe(true)
    expect(get(sceneBookmarks)[0]?.note).toBe('Best line')

    expect(removeSceneBookmark(bookmark.id, 300)).toBe(true)
    expect(get(sceneBookmarks)).toEqual([])
    expect(get(sceneBookmarkRecords)[bookmark.id]).toEqual({ deleted: true, updatedAt: 300 })
  })

  it('merges newer peer edits but rejects stale records', () => {
    const { bookmark } = addSceneBookmark({ media, episode: 2, position: 20 }, 100)
    const newer = { ...bookmark, note: 'From the TV', updatedAt: 300 }
    expect(mergeSceneBookmarkRecords({ [bookmark.id]: { bookmark: newer, updatedAt: 300 } })).toBe(1)
    expect(get(sceneBookmarks)[0]?.note).toBe('From the TV')
    expect(mergeSceneBookmarkRecords({ [bookmark.id]: { deleted: true, updatedAt: 200 } })).toBe(0)
    expect(get(sceneBookmarks)).toHaveLength(1)
  })

  it('clears every active scene without dropping sync tombstones', () => {
    addSceneBookmark({ media, episode: 1, position: 10 }, 100)
    addSceneBookmark({ media, episode: 1, position: 40 }, 200)
    clearSceneBookmarks(300)
    expect(get(sceneBookmarks)).toEqual([])
    expect(Object.values(get(sceneBookmarkRecords))).toEqual([
      { deleted: true, updatedAt: 300 },
      { deleted: true, updatedAt: 300 },
    ])
  })
})
