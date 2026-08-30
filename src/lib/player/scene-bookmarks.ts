import { derived, get } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import type { Media } from '$lib/anilist/types'
import { mediaSnapshot } from './history'

export const MAX_SCENE_BOOKMARKS = 500
const MAX_SCENE_BOOKMARK_RECORDS = 750

export interface SceneBookmark {
  id: string
  media: Media
  episode?: number
  position: number
  duration: number
  quote?: string
  note: string
  createdAt: number
  updatedAt: number
}

export type SceneBookmarkRecord =
  | { bookmark: SceneBookmark; updatedAt: number }
  | { deleted: true; updatedAt: number }

export type SceneBookmarkRecords = Record<string, SceneBookmarkRecord>

export const sceneBookmarkRecords = persisted<SceneBookmarkRecords>('scene-bookmarks-v1', {})

const cleanText = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''

const finite = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

function createId(now: number): string {
  try { return crypto.randomUUID() }
  catch { return `scene-${now}-${Math.random().toString(36).slice(2, 10)}` }
}

function capRecords(records: SceneBookmarkRecords): SceneBookmarkRecords {
  const entries = Object.entries(records)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SCENE_BOOKMARK_RECORDS)
  return Object.fromEntries(entries)
}

function activeBookmarks(records: SceneBookmarkRecords): SceneBookmark[] {
  return Object.values(records)
    .filter((record): record is Extract<SceneBookmarkRecord, { bookmark: SceneBookmark }> => 'bookmark' in record)
    .map((record) => record.bookmark)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_SCENE_BOOKMARKS)
}

export const sceneBookmarks = derived(sceneBookmarkRecords, activeBookmarks)

export function addSceneBookmark(
  input: {
    media: Media
    episode?: number | null
    position: number
    duration?: number
    quote?: string
    note?: string
  },
  now = Date.now(),
): { bookmark: SceneBookmark; created: boolean } {
  const position = Math.max(0, finite(input.position))
  const episode = Number.isFinite(input.episode) && Number(input.episode) > 0
    ? Math.trunc(Number(input.episode))
    : undefined
  const records = get(sceneBookmarkRecords)
  const existing = activeBookmarks(records).find((bookmark) =>
    bookmark.media.id === input.media.id
    && bookmark.episode === episode
    && Math.abs(bookmark.position - position) <= 1.5)
  if (existing) return { bookmark: existing, created: false }

  const id = createId(now)
  const quote = cleanText(input.quote, 1_000)
  const bookmark: SceneBookmark = {
    id,
    media: mediaSnapshot(input.media),
    ...(episode != null ? { episode } : {}),
    position,
    duration: Math.max(0, finite(input.duration)),
    ...(quote ? { quote } : {}),
    note: cleanText(input.note, 2_000),
    createdAt: now,
    updatedAt: now,
  }
  sceneBookmarkRecords.set(capRecords({ ...records, [id]: { bookmark, updatedAt: now } }))
  return { bookmark, created: true }
}

export function updateSceneBookmark(
  id: string,
  patch: { note?: string; quote?: string },
  now = Date.now(),
): boolean {
  const records = get(sceneBookmarkRecords)
  const record = records[id]
  if (!record || !('bookmark' in record)) return false
  const quote = patch.quote === undefined ? record.bookmark.quote : cleanText(patch.quote, 1_000)
  const bookmark: SceneBookmark = {
    ...record.bookmark,
    ...(quote ? { quote } : { quote: undefined }),
    note: patch.note === undefined ? record.bookmark.note : cleanText(patch.note, 2_000),
    updatedAt: now,
  }
  sceneBookmarkRecords.set(capRecords({ ...records, [id]: { bookmark, updatedAt: now } }))
  return true
}

export function removeSceneBookmark(id: string, now = Date.now()): boolean {
  const records = get(sceneBookmarkRecords)
  if (!records[id] || 'deleted' in records[id]) return false
  sceneBookmarkRecords.set(capRecords({ ...records, [id]: { deleted: true, updatedAt: now } }))
  return true
}

export function clearSceneBookmarks(now = Date.now()) {
  const records = get(sceneBookmarkRecords)
  const next = { ...records }
  for (const bookmark of activeBookmarks(records)) next[bookmark.id] = { deleted: true, updatedAt: now }
  sceneBookmarkRecords.set(capRecords(next))
}

function normalizeBookmark(value: unknown): SceneBookmark | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SceneBookmark>
  if (
    typeof raw.id !== 'string' || !raw.id
    || !raw.media || typeof raw.media !== 'object'
    || typeof raw.media.id !== 'number' || !Number.isFinite(raw.media.id)
    || typeof raw.position !== 'number' || !Number.isFinite(raw.position)
    || typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)
  ) return null
  const updatedAt = finite(raw.updatedAt, raw.createdAt)
  const quote = cleanText(raw.quote, 1_000)
  const episode = typeof raw.episode === 'number' && Number.isFinite(raw.episode) && raw.episode > 0
    ? Math.trunc(raw.episode)
    : undefined
  return {
    id: raw.id,
    media: mediaSnapshot(raw.media),
    ...(episode != null ? { episode } : {}),
    position: Math.max(0, raw.position),
    duration: Math.max(0, finite(raw.duration)),
    ...(quote ? { quote } : {}),
    note: cleanText(raw.note, 2_000),
    createdAt: raw.createdAt,
    updatedAt,
  }
}

function normalizeRecord(id: string, value: unknown): SceneBookmarkRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SceneBookmarkRecord>
  const updatedAt = finite(raw.updatedAt)
  if (updatedAt <= 0) return null
  if ('deleted' in raw && raw.deleted === true) return { deleted: true, updatedAt }
  if ('bookmark' in raw) {
    const bookmark = normalizeBookmark(raw.bookmark)
    if (!bookmark || bookmark.id !== id) return null
    return { bookmark, updatedAt: Math.max(updatedAt, bookmark.updatedAt) }
  }
  return null
}

/** Merge peer/export data with per-scene last-write-wins records. Deletions are tombstones so a
 * stale device cannot resurrect a scene the user removed elsewhere. */
export function mergeSceneBookmarkRecords(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  const current = get(sceneBookmarkRecords)
  const next = { ...current }
  let changed = 0
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const incoming = normalizeRecord(id, raw)
    if (!incoming || (current[id]?.updatedAt ?? 0) >= incoming.updatedAt) continue
    next[id] = incoming
    changed++
  }
  if (changed) sceneBookmarkRecords.set(capRecords(next))
  return changed
}
