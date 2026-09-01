import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import {
  CURRENTLY_AIRING_ID, EPISODE_QUEUE_ID, WATCHLIST_ID, availableLocalLists, browsableLocalLists,
  createLocalList, deleteLocalList, enqueueEpisode, localEntriesForList, localLibrary,
  localTrackingForMedia, mediaIsInLocalList, mergeLocalLibrary, removeLocalTracking,
  removeQueuedEpisode, renameLocalList, reorderLocalList, reorderQueuedEpisode, saveLocalTracking,
  setMediaInLocalList, syncWatchedHistoryToWatchlist,
} from './local-lists'

const media = { id: 42, title: { userPreferred: 'Saved show' } } as Media

describe('device-local media lists', () => {
  beforeEach(() => {
    localLibrary.set({ lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }], entries: {}, queue: [] })
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

  it('keeps AniList-style status, progress, and score locally without list membership', () => {
    saveLocalTracking(media, { status: 'DROPPED', progress: 4, score: 70 })
    expect(localTrackingForMedia(get(localLibrary), media)).toEqual({ status: 'DROPPED', progress: 4, score: 70 })
    expect(localEntriesForList(get(localLibrary), 'status:DROPPED')).toHaveLength(1)

    setMediaInLocalList(media, WATCHLIST_ID, true)
    setMediaInLocalList(media, WATCHLIST_ID, false)
    expect(localTrackingForMedia(get(localLibrary), media)?.status).toBe('DROPPED')
    removeLocalTracking(media)
    expect(get(localLibrary).entries).toEqual({})
  })

  it('backfills the Watchlist at the configured episode threshold', () => {
    syncWatchedHistoryToWatchlist({ 42: { media, progress: 2 } }, 3)
    expect(mediaIsInLocalList(get(localLibrary), media, WATCHLIST_ID)).toBe(false)

    syncWatchedHistoryToWatchlist({ 42: { media, progress: 3 } }, 3)
    expect(mediaIsInLocalList(get(localLibrary), media, WATCHLIST_ID)).toBe(true)
    expect(localTrackingForMedia(get(localLibrary), media)).toMatchObject({ status: 'CURRENT', progress: 3 })
  })

  it('renames, reorders and deletes custom lists without touching the watchlist', () => {
    const first = createLocalList('First')!
    const second = createLocalList('Second')!
    expect(renameLocalList(first, 'Renamed')).toBe(true)
    reorderLocalList(second, -1)
    expect(availableLocalLists(get(localLibrary)).map((list) => list.name)).toEqual(['Watchlist', 'Second', 'Renamed'])
    setMediaInLocalList(media, first, true)
    expect(deleteLocalList(first)).toBe(true)
    expect(get(localLibrary).entries).toEqual({})
    expect(deleteLocalList(WATCHLIST_ID)).toBe(false)
  })

  it('provides smart lists and an ordered episode queue', () => {
    const airing = { ...media, status: 'RELEASING' } as Media
    setMediaInLocalList(airing, WATCHLIST_ID, true)
    expect(browsableLocalLists(get(localLibrary)).some((list) => list.id === EPISODE_QUEUE_ID)).toBe(true)
    expect(localEntriesForList(get(localLibrary), CURRENTLY_AIRING_ID)).toHaveLength(1)
    enqueueEpisode(media, 3)
    enqueueEpisode(media, 4)
    const first = get(localLibrary).queue![0]!
    reorderQueuedEpisode(first.id, 1)
    expect(get(localLibrary).queue!.map((item) => item.episode)).toEqual([4, 3])
    removeQueuedEpisode(first.id)
    expect(get(localLibrary).queue!.map((item) => item.episode)).toEqual([4])
  })

  it('merges the newest paired-device list and queue state', () => {
    const current = {
      lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }, { id: 'picks', name: 'Old', createdAt: 1, updatedAt: 10 }],
      entries: {}, queue: [], queueUpdatedAt: 10,
    }
    const incoming = {
      lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }, { id: 'picks', name: 'New', createdAt: 1, updatedAt: 20 }],
      entries: {}, queue: [{ id: 'x', media, episode: 2, addedAt: 20 }], queueUpdatedAt: 20,
    }
    const merged = mergeLocalLibrary(current, incoming)
    expect(availableLocalLists(merged)[1]?.name).toBe('New')
    expect(merged.queue?.[0]?.episode).toBe(2)
  })
})
