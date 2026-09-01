import { persisted } from 'svelte-persisted-store'
import type { Media } from '$lib/anilist/types'
import { mediaKey } from '$lib/catalog/identity'

export const WATCHLIST_ID = 'watchlist'
export const RECENTLY_ADDED_ID = 'smart:recent'
export const CURRENTLY_AIRING_ID = 'smart:airing'
export const EPISODE_QUEUE_ID = 'episode-queue'

export type LocalMediaStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'PAUSED' | 'DROPPED' | 'REPEATING'

const STATUS_LISTS: Array<{ id: string; name: string; status: LocalMediaStatus }> = [
  { id: 'status:CURRENT', name: 'Watching', status: 'CURRENT' },
  { id: 'status:PLANNING', name: 'Planning', status: 'PLANNING' },
  { id: 'status:COMPLETED', name: 'Completed', status: 'COMPLETED' },
  { id: 'status:PAUSED', name: 'Paused', status: 'PAUSED' },
  { id: 'status:DROPPED', name: 'Dropped', status: 'DROPPED' },
  { id: 'status:REPEATING', name: 'Rewatching', status: 'REPEATING' },
]

export interface LocalMediaList {
  id: string
  name: string
  createdAt: number
  updatedAt?: number
}

export interface LocalMediaEntry {
  media: Media
  listIds: string[]
  addedAt: number
  updatedAt: number
  /** Account-independent equivalent of AniList's mediaListEntry. All fields are optional so an
   * older saved-list entry can acquire progress, a status, or a score independently. */
  tracking?: {
    status?: LocalMediaStatus
    progress?: number
    score?: number
    repeat?: number
    startedAt?: { year?: number; month?: number; day?: number } | null
    completedAt?: { year?: number; month?: number; day?: number } | null
  }
}

export interface LocalLibraryState {
  lists: LocalMediaList[]
  entries: Record<string, LocalMediaEntry>
  deletedLists?: Record<string, number>
  deletedEntries?: Record<string, number>
  listOrderUpdatedAt?: number
  queue?: LocalEpisodeQueueEntry[]
  queueUpdatedAt?: number
}

export interface LocalEpisodeQueueEntry {
  id: string
  media: Media
  episode: number
  addedAt: number
}

const initialState: LocalLibraryState = {
  lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }],
  entries: {},
  queue: [],
}

export const localLibrary = persisted<LocalLibraryState>('local-media-library-v1', initialState)

export function availableLocalLists(state: LocalLibraryState): LocalMediaList[] {
  const custom = (state.lists ?? []).filter((list) => list.id !== WATCHLIST_ID)
  return [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }, ...custom]
}

/** Lists shown by the library browser. Smart lists and the episode queue are read-only targets and
 * deliberately excluded from LocalListPicker, where they would look writable. */
export function browsableLocalLists(state: LocalLibraryState): LocalMediaList[] {
  return [
    ...availableLocalLists(state),
    ...STATUS_LISTS.map(({ id, name }) => ({ id, name, createdAt: 0 })),
    { id: RECENTLY_ADDED_ID, name: 'Recently added', createdAt: 0 },
    { id: CURRENTLY_AIRING_ID, name: 'Currently airing', createdAt: 0 },
    { id: EPISODE_QUEUE_ID, name: 'Episode queue', createdAt: 0 },
  ]
}

export function localEntriesForList(state: LocalLibraryState, listId: string): LocalMediaEntry[] {
  const entries = Object.values(state.entries ?? {})
  const status = STATUS_LISTS.find((list) => list.id === listId)?.status
  if (status) return entries.filter((entry) => entry.tracking?.status === status)
    .sort((left, right) => right.updatedAt - left.updatedAt)
  if (listId === RECENTLY_ADDED_ID) return entries.sort((left, right) => right.addedAt - left.addedAt)
  if (listId === CURRENTLY_AIRING_ID) {
    return entries.filter((entry) => entry.media.status === 'RELEASING')
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }
  if (listId === EPISODE_QUEUE_ID) return []
  return entries.filter((entry) => entry.listIds.includes(listId))
    .sort((left, right) => right.updatedAt - left.updatedAt)
}

export function mediaIsInLocalList(state: LocalLibraryState, media: Media, listId: string): boolean {
  return state.entries?.[mediaKey(media)]?.listIds.includes(listId) ?? false
}

export function mediaIsSaved(state: LocalLibraryState, media: Media): boolean {
  return Boolean(state.entries?.[mediaKey(media)]?.listIds.length)
}

export function localTrackingForMedia(state: LocalLibraryState, media: Media): LocalMediaEntry['tracking'] | undefined {
  return state.entries?.[mediaKey(media)]?.tracking
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
    const deletedEntries = { ...(state.deletedEntries ?? {}) }
    if (!listIds.size && !previous?.tracking) { delete entries[key]; deletedEntries[key] = Date.now() }
    else {
      const now = Date.now()
      delete deletedEntries[key]
      entries[key] = {
        media: snapshotMedia(media),
        listIds: [...listIds],
        addedAt: previous?.addedAt ?? now,
        updatedAt: now,
        tracking: previous?.tracking,
      }
    }
    return { ...state, lists: availableLocalLists(state), entries, deletedEntries }
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
    const deletedEntries = { ...(state.deletedEntries ?? {}) }
    if (!listIds.size && !previous?.tracking) { delete entries[key]; deletedEntries[key] = Date.now() }
    else {
      const now = Date.now()
      delete deletedEntries[key]
      entries[key] = {
        media: snapshotMedia(media),
        listIds: [...listIds],
        addedAt: previous?.addedAt ?? now,
        updatedAt: now,
        tracking: previous?.tracking,
      }
    }
    return { ...state, lists: availableLocalLists(state), entries, deletedEntries }
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
    const now = Date.now()
    return { ...state, lists: [...lists, { id, name: clean, createdAt: now, updatedAt: now }], listOrderUpdatedAt: now }
  })
  return createdId
}

/** Persist list status/progress/score even when no tracker account is connected. */
export function saveLocalTracking(media: Media, patch: NonNullable<LocalMediaEntry['tracking']>): void {
  localLibrary.update((state) => {
    const key = mediaKey(media)
    const previous = state.entries?.[key]
    const now = Date.now()
    const entries = { ...(state.entries ?? {}) }
    const deletedEntries = { ...(state.deletedEntries ?? {}) }
    delete deletedEntries[key]
    entries[key] = {
      media: snapshotMedia(media),
      listIds: [...(previous?.listIds ?? [])],
      addedAt: previous?.addedAt ?? now,
      updatedAt: now,
      tracking: { ...(previous?.tracking ?? {}), ...patch },
    }
    return { ...state, lists: availableLocalLists(state), entries, deletedEntries }
  })
}

/** Remove only the AniList-style local entry; custom-list membership remains intact. */
export function removeLocalTracking(media: Media): void {
  localLibrary.update((state) => {
    const key = mediaKey(media)
    const previous = state.entries?.[key]
    if (!previous?.tracking) return state
    const entries = { ...(state.entries ?? {}) }
    const deletedEntries = { ...(state.deletedEntries ?? {}) }
    if (previous.listIds.length) entries[key] = { ...previous, tracking: undefined, updatedAt: Date.now() }
    else { delete entries[key]; deletedEntries[key] = Date.now() }
    return { ...state, entries, deletedEntries }
  })
}

/** Backfill the default Watchlist from durable history. This makes the feature useful to existing
 * installs immediately after upgrading or lowering the threshold, without touching incognito data. */
export function syncWatchedHistoryToWatchlist(
  history: Record<number, { media: Media; progress: number }>,
  minimumEpisodes: number,
): void {
  const threshold = Math.max(1, Math.floor(minimumEpisodes || 1))
  localLibrary.update((state) => {
    const entries = { ...(state.entries ?? {}) }
    const deletedEntries = { ...(state.deletedEntries ?? {}) }
    const now = Date.now()
    let changed = false
    for (const watched of Object.values(history)) {
      if (watched.progress < threshold) continue
      const key = mediaKey(watched.media)
      const previous = entries[key]
      const previousStatus = previous?.tracking?.status
      if (previousStatus && !['CURRENT', 'PLANNING', 'REPEATING'].includes(previousStatus)) continue
      const listIds = new Set(previous?.listIds ?? [])
      const progress = Math.max(previous?.tracking?.progress ?? 0, watched.progress)
      const status: LocalMediaStatus = watched.media.episodes != null && progress >= watched.media.episodes
        ? 'COMPLETED'
        : 'CURRENT'
      if (listIds.has(WATCHLIST_ID) && previousStatus === status && previous?.tracking?.progress === progress) continue
      listIds.add(WATCHLIST_ID)
      delete deletedEntries[key]
      entries[key] = {
        media: snapshotMedia(watched.media),
        listIds: [...listIds],
        addedAt: previous?.addedAt ?? now,
        updatedAt: now,
        tracking: { ...(previous?.tracking ?? {}), status, progress },
      }
      changed = true
    }
    return changed ? { ...state, lists: availableLocalLists(state), entries, deletedEntries } : state
  })
}

const cleanListName = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, 60)

export function renameLocalList(id: string, name: string): boolean {
  if (id === WATCHLIST_ID) return false
  const clean = cleanListName(name)
  if (!clean || clean.toLowerCase() === 'watchlist') return false
  let renamed = false
  localLibrary.update((state) => {
    const lists = availableLocalLists(state)
    if (lists.some((list) => list.id !== id && list.name.toLowerCase() === clean.toLowerCase())) return state
    const now = Date.now()
    const next = lists.map((list) => list.id === id ? { ...list, name: clean, updatedAt: now } : list)
    renamed = next.some((list) => list.id === id)
    return renamed ? { ...state, lists: next } : state
  })
  return renamed
}

export function deleteLocalList(id: string): boolean {
  if (id === WATCHLIST_ID) return false
  let deleted = false
  localLibrary.update((state) => {
    if (!availableLocalLists(state).some((list) => list.id === id)) return state
    const now = Date.now()
    const lists = availableLocalLists(state).filter((list) => list.id !== id)
    const deletedEntries = { ...(state.deletedEntries ?? {}) }
    const entries = Object.fromEntries(Object.entries(state.entries ?? {}).flatMap(([key, entry]) => {
      const listIds = entry.listIds.filter((listId) => listId !== id)
      if (listIds.length || entry.tracking) return [[key, { ...entry, listIds, updatedAt: now }]]
      deletedEntries[key] = now
      return []
    }))
    deleted = true
    return {
      ...state,
      lists,
      entries,
      deletedEntries,
      deletedLists: { ...(state.deletedLists ?? {}), [id]: now },
      listOrderUpdatedAt: now,
    }
  })
  return deleted
}

export function reorderLocalList(id: string, direction: -1 | 1): void {
  if (id === WATCHLIST_ID) return
  localLibrary.update((state) => {
    const lists = availableLocalLists(state)
    const index = lists.findIndex((list) => list.id === id)
    const target = index + direction
    if (index <= 0 || target <= 0 || target >= lists.length) return state
    const next = [...lists]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    return { ...state, lists: next, listOrderUpdatedAt: Date.now() }
  })
}

export function enqueueEpisode(media: Media, episode: number): void {
  if (!Number.isInteger(episode) || episode < 1) return
  localLibrary.update((state) => {
    const id = `${mediaKey(media)}:episode:${episode}`
    const queue = [...(state.queue ?? []).filter((item) => item.id !== id), {
      id,
      media: snapshotMedia(media),
      episode,
      addedAt: Date.now(),
    }]
    return { ...state, queue, queueUpdatedAt: Date.now() }
  })
}

export function removeQueuedEpisode(id: string): void {
  localLibrary.update((state) => ({
    ...state,
    queue: (state.queue ?? []).filter((item) => item.id !== id),
    queueUpdatedAt: Date.now(),
  }))
}

export function reorderQueuedEpisode(id: string, direction: -1 | 1): void {
  localLibrary.update((state) => {
    const queue = [...(state.queue ?? [])]
    const index = queue.findIndex((item) => item.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= queue.length) return state
    ;[queue[index], queue[target]] = [queue[target]!, queue[index]!]
    return { ...state, queue, queueUpdatedAt: Date.now() }
  })
}

/** Merge paired-device library snapshots with timestamped deletion tombstones. */
export function mergeLocalLibrary(current: LocalLibraryState, incoming: LocalLibraryState): LocalLibraryState {
  const deletedLists = { ...(current.deletedLists ?? {}) }
  for (const [id, at] of Object.entries(incoming.deletedLists ?? {})) deletedLists[id] = Math.max(deletedLists[id] ?? 0, at)
  const byList = new Map<string, LocalMediaList>()
  for (const list of [...availableLocalLists(current), ...availableLocalLists(incoming)]) {
    if (list.id === WATCHLIST_ID) continue
    if ((deletedLists[list.id] ?? 0) >= (list.updatedAt ?? list.createdAt)) continue
    const previous = byList.get(list.id)
    if (!previous || (list.updatedAt ?? list.createdAt) > (previous.updatedAt ?? previous.createdAt)) byList.set(list.id, list)
  }
  const orderOwner = (incoming.listOrderUpdatedAt ?? 0) > (current.listOrderUpdatedAt ?? 0) ? incoming : current
  const order = availableLocalLists(orderOwner).map((list) => list.id)
  const lists = [...byList.values()].sort((left, right) => {
    const li = order.indexOf(left.id), ri = order.indexOf(right.id)
    return (li < 0 ? Number.MAX_SAFE_INTEGER : li) - (ri < 0 ? Number.MAX_SAFE_INTEGER : ri)
      || left.createdAt - right.createdAt
  })

  const deletedEntries = { ...(current.deletedEntries ?? {}) }
  for (const [id, at] of Object.entries(incoming.deletedEntries ?? {})) deletedEntries[id] = Math.max(deletedEntries[id] ?? 0, at)
  const entries: Record<string, LocalMediaEntry> = {}
  for (const [key, entry] of [...Object.entries(current.entries ?? {}), ...Object.entries(incoming.entries ?? {})]) {
    if ((deletedEntries[key] ?? 0) >= entry.updatedAt) continue
    if (!entries[key] || entry.updatedAt > entries[key]!.updatedAt) entries[key] = {
      ...entry,
      listIds: entry.listIds.filter((id) => id === WATCHLIST_ID || byList.has(id)),
    }
  }
  for (const key of Object.keys(entries)) {
    if (!entries[key]!.listIds.length && !entries[key]!.tracking) delete entries[key]
  }

  const incomingQueueWins = (incoming.queueUpdatedAt ?? 0) > (current.queueUpdatedAt ?? 0)
  return {
    lists: [{ id: WATCHLIST_ID, name: 'Watchlist', createdAt: 0 }, ...lists],
    entries,
    deletedLists,
    deletedEntries,
    listOrderUpdatedAt: Math.max(current.listOrderUpdatedAt ?? 0, incoming.listOrderUpdatedAt ?? 0),
    queue: incomingQueueWins ? [...(incoming.queue ?? [])] : [...(current.queue ?? [])],
    queueUpdatedAt: Math.max(current.queueUpdatedAt ?? 0, incoming.queueUpdatedAt ?? 0),
  }
}
