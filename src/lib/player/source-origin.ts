import { get } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { incognito } from '$lib/stores/incognito'
import type { StreamOrigin } from '$lib/stremio/parse'

export interface SourceRelease {
  infoHash?: string
  bingeGroup?: string
  group?: string
}

export interface RememberedSource {
  origin: StreamOrigin
  release?: SourceRelease
  updatedAt: number
}

export const MAX_REMEMBERED_SOURCES = 100
export const MAX_REMEMBERED_EPISODE_SOURCES = 500
export const sourceOrigins = persisted<Record<number, RememberedSource>>('player-source-origins', {})
/** Exact per-episode source memory. The title-wide store above remains useful for the optional
 * "always continue this title's last source" mode; the default resume mode reads this store. */
export const episodeSourceOrigins = persisted<Record<string, RememberedSource>>('player-episode-source-origins', {})

const cleanString = (value: unknown, max = 256) =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined

function cleanRelease(value: unknown): SourceRelease | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const infoHash = cleanString(raw.infoHash, 64)
  const bingeGroup = cleanString(raw.bingeGroup)
  const group = cleanString(raw.group)
  return infoHash || bingeGroup || group ? { infoHash, bingeGroup, group } : undefined
}

export function validRememberedSource(value: unknown): RememberedSource | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const origin = raw.origin as Record<string, unknown> | undefined
  const kind = origin?.kind
  const id = cleanString(origin?.id)
  if (!id || (kind !== 'addon' && kind !== 'torrent-extension' && kind !== 'online-extension')) return undefined
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  return {
    origin: { kind, id, name: cleanString(origin?.name, 128) },
    release: cleanRelease(raw.release),
    updatedAt,
  }
}

export function capRememberedSources(entries: Record<number, RememberedSource>): Record<number, RememberedSource> {
  return Object.fromEntries(
    Object.entries(entries)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_REMEMBERED_SOURCES),
  ) as Record<number, RememberedSource>
}

function capRememberedEpisodeSources(entries: Record<string, RememberedSource>): Record<string, RememberedSource> {
  return Object.fromEntries(
    Object.entries(entries)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_REMEMBERED_EPISODE_SOURCES),
  )
}

const episodeSourceKey = (mediaId: number, episode: number) => `${mediaId}:${episode}`
const validEpisodeSourceKey = (key: string) => /^[1-9]\d*:[1-9]\d*$/.test(key)

export function rememberSourceOrigin(
  mediaId: number,
  origin: StreamOrigin | undefined,
  release?: SourceRelease,
  episode?: number,
): void {
  if (get(incognito)) return // never persist which source an incognito play used
  const valid = validRememberedSource({ origin, release, updatedAt: Date.now() })
  if (!Number.isInteger(mediaId) || !valid) return
  sourceOrigins.update((current) => capRememberedSources({ ...current, [mediaId]: valid }))
  if (episode != null && Number.isInteger(episode)) {
    episodeSourceOrigins.update((current) => capRememberedEpisodeSources({
      ...current,
      [episodeSourceKey(mediaId, episode)]: valid,
    }))
  }
}

export function forgetSourceOrigin(mediaId: number): void {
  sourceOrigins.update((current) => {
    if (!current[mediaId]) return current
    const next = { ...current }
    delete next[mediaId]
    return next
  })
  const prefix = `${mediaId}:`
  episodeSourceOrigins.update((current) => Object.fromEntries(
    Object.entries(current).filter(([key]) => !key.startsWith(prefix)),
  ))
}

export function clearSourceOrigins(): void {
  sourceOrigins.set({})
  episodeSourceOrigins.set({})
}

/** Last-write-wins merge used by iroh/import. Returns the number of accepted newer records. */
export function mergeSourceOrigins(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const next = { ...get(sourceOrigins) }
  let imported = 0
  for (const [key, raw] of Object.entries(value)) {
    const mediaId = Number(key)
    const incoming = validRememberedSource(raw)
    if (!Number.isInteger(mediaId) || !incoming) continue
    if (!next[mediaId] || incoming.updatedAt > next[mediaId].updatedAt) {
      next[mediaId] = incoming
      imported++
    }
  }
  if (imported) sourceOrigins.set(capRememberedSources(next))
  return imported
}

export function mergeEpisodeSourceOrigins(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const next = { ...get(episodeSourceOrigins) }
  let imported = 0
  for (const [key, raw] of Object.entries(value)) {
    const incoming = validRememberedSource(raw)
    if (!validEpisodeSourceKey(key) || !incoming) continue
    if (!next[key] || incoming.updatedAt > next[key].updatedAt) {
      next[key] = incoming
      imported++
    }
  }
  if (imported) episodeSourceOrigins.set(capRememberedEpisodeSources(next))
  return imported
}
