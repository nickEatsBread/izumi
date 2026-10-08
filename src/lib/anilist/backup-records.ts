import type { Data, SerializedEntries } from '@urql/exchange-graphcache'

// AniList stays the source of truth for a title. While it is unavailable the transport answers public
// reads from a backup provider (kitsu-catalog.ts, jikan.ts) whose records only approximate AniList's:
// Kitsu has no banner for about half of the titles AniList has one for, and brings its own titles,
// member counts and no relations. Those answers used to be normalized as `Media:<anilistId>`, so they
// overwrote the AniList record of the same title in memory and on disk for up to a week, and a title
// the viewer had seen with its real art kept the degraded record long after AniList came back.
//
// Every backup answer is therefore stamped on the wire (its `data` and each Media in it), normalized
// beside the AniList record instead of over it, and never written to disk. backup-details.ts decides
// what a series page shows from it.

/** Wire-only marker carrying the backup provider's name. No query selects it, so the app never sees
 *  it; the cache key below and the series-page updater are its only readers. */
export const BACKUP_MARK = '__backup'
const BACKUP_KEY_PREFIX = 'backup-'
/** Entity-key prefix of every backup Media in the normalized cache (`Media:backup-<id>`). */
export const BACKUP_ENTITY_PREFIX = `Media:${BACKUP_KEY_PREFIX}`

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null

/** Stamps a backup provider's GraphQL `data`, and every Media nested in it, with `provider`. */
export function stampBackupData(data: unknown, provider: string): void {
  if (!isObject(data)) return
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!isObject(value)) return
    for (const key in value) visit(value[key])
    if (value.__typename === 'Media') value[BACKUP_MARK] = provider
  }
  visit(data)
  data[BACKUP_MARK] = provider
}

/** The backup provider that answered `value`, or undefined for an AniList answer. */
export function backupProvider(value: unknown): string | undefined {
  const provider = isObject(value) ? value[BACKUP_MARK] : undefined
  return typeof provider === 'string' && provider ? provider : undefined
}

/** Graphcache key for Media: an AniList record by its id, a backup record beside it. */
export function mediaCacheKey(data: Data): string | null {
  const id = data.id ?? data._id
  if (id == null) return null
  return backupProvider(data) ? `${BACKUP_KEY_PREFIX}${String(id)}` : String(id)
}

/** A graphcache storage delta without backup records or links to them, so the disk only ever holds
 *  AniList answers: a cold boot paints the last AniList record (or loads), never an approximation. */
export function withoutBackupEntries(delta: SerializedEntries): SerializedEntries {
  const kept: SerializedEntries = {}
  for (const key in delta) {
    const value = delta[key]
    // Entity fields are keyed `<entity key>.<field>` (embedded entities extend the parent's key);
    // link values are `:` plus the JSON of the linked key or keys.
    if (key.startsWith(BACKUP_ENTITY_PREFIX)) continue
    if (typeof value === 'string' && value.startsWith(':') && value.includes(`"${BACKUP_ENTITY_PREFIX}`)) continue
    kept[key] = value
  }
  return kept
}
