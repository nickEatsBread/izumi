import { get } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
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
export const sourceOrigins = persisted<Record<number, RememberedSource>>('player-source-origins', {})

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

export function rememberSourceOrigin(mediaId: number, origin: StreamOrigin | undefined, release?: SourceRelease): void {
  const valid = validRememberedSource({ origin, release, updatedAt: Date.now() })
  if (!Number.isInteger(mediaId) || !valid) return
  sourceOrigins.update((current) => capRememberedSources({ ...current, [mediaId]: valid }))
}

export function forgetSourceOrigin(mediaId: number): void {
  sourceOrigins.update((current) => {
    if (!current[mediaId]) return current
    const next = { ...current }
    delete next[mediaId]
    return next
  })
}

export function clearSourceOrigins(): void { sourceOrigins.set({}) }

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
