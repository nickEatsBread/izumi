import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import {
  WATCHLIST_ID, availableLocalLists, createLocalList, localEntriesForList, localLibrary,
  mediaIsInLocalList, setMediaInLocalList,
} from './local-lists'

const media = { id: 42, title: { userPreferred: 'Saved show' } } as Media

describe('device-local media lists', () => {
  beforeEach(() => {
    localLibrary.set({ lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }], entries: {} })
    vi.spyOn(Date, 'now').mockReturnValue(1234)
  })
  afterEach(() => vi.restoreAllMocks())

  it('keeps the built-in watchlist available without account state', () => {
    expect(availableLocalLists(get(localLibrary))[0]).toMatchObject({ id: WATCHLIST_ID, name: 'Watchlist' })
    setMediaInLocalList(media, WATCHLIST_ID, true)
    expect(mediaIsInLocalList(get(localLibrary), media, WATCHLIST_ID)).toBe(true)
    expect(localEntriesForList(get(localLibrary), WATCHLIST_ID)[0].media.title.userPreferred).toBe('Saved show')
  })

  it('creates named lists and can save the same title to several lists', () => {
    const id = createLocalList('Weekend picks')
    expect(id).toBe('weekend-picks')
    setMediaInLocalList(media, WATCHLIST_ID, true)
    setMediaInLocalList(media, id!, true)
    expect(get(localLibrary).entries['anilist:anime:42'].listIds).toEqual([WATCHLIST_ID, id])
  })

  it('removes the media snapshot once it belongs to no lists', () => {
    setMediaInLocalList(media, WATCHLIST_ID, true)
    setMediaInLocalList(media, WATCHLIST_ID, false)
    expect(get(localLibrary).entries).toEqual({})
  })
})
