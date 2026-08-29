import { persisted } from 'svelte-persisted-store'
import type { Media } from '$lib/anilist/types'
import { mediaKey } from '$lib/catalog/identity'

export const WATCHLIST_ID = 'watchlist'

export interface LocalMediaList {
  id: string
  name: string
  createdAt: number
}

export interface LocalMediaEntry {
  media: Media
  listIds: string[]
  addedAt: number
  updatedAt: number
}

export interface LocalLibraryState {
  lists: LocalMediaList[]
  entries: Record<string, LocalMediaEntry>
}

const initialState: LocalLibraryState = {
  lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }],
  entries: {},
}

export const localLibrary = persisted<LocalLibraryState>('local-media-library-v1', initialState)

export function availableLocalLists(state: LocalLibraryState): LocalMediaList[] {
  const custom = (state.lists ?? []).filter((list) => list.id !== WATCHLIST_ID)
  return [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }, ...custom]
}

export function localEntriesForList(state: LocalLibraryState, listId: string): LocalMediaEntry[] {
  return Object.values(state.entries ?? {})
    .filter((entry) => entry.listIds.includes(listId))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function mediaIsInLocalList(state: LocalLibraryState, media: Media, listId: string): boolean {
  return state.entries?.[mediaKey(media)]?.listIds.includes(listId) ?? false
}

export function mediaIsSaved(state: LocalLibraryState, media: Media): boolean {
  return Boolean(state.entries?.[mediaKey(media)]?.listIds.length)
}

const snapshotMedia = (media: Media): Media => JSON.parse(JSON.stringify(media)) as Media

export function setMediaInLocalList(media: Media, listId: string, present: boolean): void {
  localLibrary.update((state) => {
    if (!availableLocalLists(state).some((list) => list.id === listId)) return state
    const key = mediaKey(media)
    const previous = state.entries?.[key]
    const listIds = new Set(previous?.listIds ?? [])
    if (present) listIds.add(listId)
    else listIds.delete(listId)
    const entries = { ...(state.entries ?? {}) }
    if (!listIds.size) delete entries[key]
    else {
      const now = Date.now()
      entries[key] = {
        media: snapshotMedia(media),
        listIds: [...listIds],
        addedAt: previous?.addedAt ?? now,
        updatedAt: now,
      }
    }
    return { ...state, lists: availableLocalLists(state), entries }
  })
}

export function toggleMediaInLocalList(media: Media, listId: string): void {
  localLibrary.update((state) => {
    const present = mediaIsInLocalList(state, media, listId)
    if (!availableLocalLists(state).some((list) => list.id === listId)) return state
    const key = mediaKey(media)
    const previous = state.entries?.[key]
    const listIds = new Set(previous?.listIds ?? [])
    if (present) listIds.delete(listId)
    else listIds.add(listId)
    const entries = { ...(state.entries ?? {}) }
    if (!listIds.size) delete entries[key]
    else {
      const now = Date.now()
      entries[key] = {
        media: snapshotMedia(media),
        listIds: [...listIds],
        addedAt: previous?.addedAt ?? now,
        updatedAt: now,
      }
    }
    return { ...state, lists: availableLocalLists(state), entries }
  })
}

export function createLocalList(name: string): string | null {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!clean || clean.toLowerCase() === 'watchlist') return null
  let createdId: string | null = null
  localLibrary.update((state) => {
    const lists = availableLocalLists(state)
    const existing = lists.find((list) => list.name.toLowerCase() === clean.toLowerCase())
    if (existing) { createdId = existing.id; return { ...state, lists } }
    const base = clean.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list'
    const used = new Set(lists.map((list) => list.id))
    let id = base
    let suffix = 2
    while (used.has(id)) id = `${base}-${suffix++}`
    createdId = id
    return { ...state, lists: [...lists, { id, name: clean, createdAt: Date.now() }] }
  })
  return createdId
}
