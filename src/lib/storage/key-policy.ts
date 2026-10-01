/**
 * One storage-key policy for application backups and diagnostics (settings fix pass, spec §6.1).
 *
 * Pure: no imports and no storage access, so backup.ts and diagnostics.ts share it without pulling
 * any store into either. Keys are classified by their base key: the profile partition prefix
 * (`izumi-profile:<id>:`, see profileStorageKey in profiles/store.ts) is stripped first, so every
 * profile's copy of a key gets the same class.
 */

export type StorageKeyClass = 'secret' | 'transient' | 'device' | 'fields' | 'reviewed' | 'unlisted'
export type ExportDecision = 'export' | 'redact' | 'skip'

/** The name test backups used before this policy (moved verbatim from backup.ts). It still decides
 *  every key the lists below do not name, so a new `*-token` key is never exported by accident. */
export const LEGACY_SECRET_KEY = /(token|secret|password|credential|api.?key|jwt|debrid|opensubtitles-creds|addon.*url)/i

/** profiles/store.ts profileStorageKey: `izumi-profile:<id>:<key>`, ids are 1-100 of [A-Za-z0-9_-]. */
const PROFILE_PREFIX = /^izumi-profile:[A-Za-z0-9_-]{1,100}:/

/** Sign-ins, keys and configured add-on URLs: exported only with "Include accounts and secrets". */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  'debrid-key', 'stremio-addon-urls', 'disabled-sources',
  'subdl-api-key', 'jimaku-api-key', 'tmdb-read-token', 'omdb-api-key',
  'anilist-token', 'mal-token', 'mal-refresh', 'kitsu-token', 'kitsu-refresh',
  'nuvio-auth-tokens-v1', 'stremio-account-token', 'stremio-sync-credential-baseline-v1',
  'stremio-account-email', 'stremio-account-id',
])
/** Every key of these services is account data, apart from the reviewed and transient trakt keys
 *  listed below. */
const SECRET_PREFIXES = ['opensubtitles-', 'simkl-', 'trakt-'] as const

/** Sign-in in flight and session state: never exported, never restored. The last three live in
 *  sessionStorage today; they are listed so that moving one to localStorage cannot leak it. */
const TRANSIENT_KEYS: ReadonlySet<string> = new Set([
  'trakt-browser-auth-v1', 'companion-client-restore-v1',
  'companion-client-claim-v1', 'izumi-unlocked-profile-v1', 'izumi-reset-requested',
])

/** This install's identity (owner decision 15): never exported, even with secrets. A restore never
 *  carries another device's sync membership or TV pairing; the user rejoins sync and pairs the TV again. */
const DEVICE_KEYS: ReadonlySet<string> = new Set([
  'izumi-active-profile-v1', 'watch-party-device-id-v1', 'nuvio-client-id-v1',
  'cloudflare-sync-config-v1', 'cloudflare-sync-setup-secret-v1', 'sync-provider-v1', 'sync-device-name',
  'paired-tizen-companions-v1', 'paired-tizen-progress-applied-v1', 'companion-discovery-saves-v1',
  'izumi-pin-throttle-v1',
])

/** Exported with one credential field removed (redactFieldValue) and merged with this device's value
 *  on restore (mergeFieldValue). */
const FIELD_KEYS: ReadonlySet<string> = new Set(['downloads', 'torrent-proxy-url'])

/** Deliberately exported. izumi-profiles-v1 carries the PIN verifiers on purpose (owner decision,
 *  spec §6.3): they are profile data, so profiles restore with their PINs, and no restore can spread
 *  a roster without PINs through sync. key-policy.test.ts pins this. (Diagnostics hide the roster
 *  anyway: a diagnostics report is not a backup.) */
const REVIEWED_KEYS: ReadonlySet<string> = new Set([
  'trakt-client-id', 'store-pins-v1', 'extension-urls', 'doh-url', 'sync-relay-url',
  'comments-backend-url', 'debrid-provider', 'debrid-room-notice-ack', 'izumi-profiles-v1',
])

/** Strips a leading `izumi-profile:<id>:`; any other key is returned unchanged. */
export function baseStorageKey(key: string): string {
  return key.replace(PROFILE_PREFIX, '')
}

export function classifyStorageKey(key: string): StorageKeyClass {
  const base = baseStorageKey(key)
  if (TRANSIENT_KEYS.has(base)) return 'transient'
  if (DEVICE_KEYS.has(base)) return 'device'
  if (FIELD_KEYS.has(base)) return 'fields'
  if (REVIEWED_KEYS.has(base)) return 'reviewed'
  if (SECRET_KEYS.has(base) || SECRET_PREFIXES.some((prefix) => base.startsWith(prefix))) return 'secret'
  return LEGACY_SECRET_KEY.test(base) ? 'secret' : 'unlisted'
}

/** transient/device → 'skip'; secret → 'export' with secrets, else 'redact'; fields, reviewed and
 *  unlisted → 'export'. */
export function exportDecision(key: string, includeSecrets: boolean): ExportDecision {
  const kind = classifyStorageKey(key)
  if (kind === 'transient' || kind === 'device') return 'skip'
  if (kind === 'secret') return includeSecrets ? 'export' : 'redact'
  return 'export'
}

export interface FieldRedaction { value: string | null; note?: string }

const PROXY_NOTE = 'The SOCKS5 proxy username and password were left out. Enter them again in Network settings; until then, torrents that require the proxy will not play.'

/** Stored values are JSON (svelte-persisted-store); a value that is not JSON is read as itself. */
function parseStored(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** A stored URL with a host; `quoted` says whether it was stored as a JSON string. */
function storedUrl(raw: string): { url: URL; quoted: boolean } | null {
  const text = parseStored(raw)
  if (typeof text !== 'string') return null
  try {
    const url = new URL(text)
    return url.host ? { url, quoted: text !== raw } : null
  } catch {
    return null
  }
}

/** `downloads` is keyed by entry id; an entry's `url` can be a signed debrid link. */
function withoutDownloadUrls(raw: string): string | null {
  const downloads = parseStored(raw)
  if (!isRecord(downloads)) return null
  const result: Record<string, unknown> = {}
  for (const [id, entry] of Object.entries(downloads)) {
    if (!isRecord(entry)) {
      result[id] = entry
      continue
    }
    const copy: Record<string, unknown> = { ...entry }
    delete copy.url
    result[id] = copy
  }
  return JSON.stringify(result)
}

/** The proxy stays configured and torrent-proxy-enabled stays on, so without its sign-in the proxy
 *  fails closed instead of torrents connecting directly. A value that cannot be read but has user
 *  info is left out. */
function withoutProxyUserInfo(raw: string): FieldRedaction {
  const stored = storedUrl(raw)
  if (!stored) {
    const text = parseStored(raw)
    return typeof text === 'string' && text.includes('@') ? { value: null, note: PROXY_NOTE } : { value: raw }
  }
  if (!stored.url.username && !stored.url.password) return { value: raw }
  stored.url.username = ''
  stored.url.password = ''
  const text = stored.url.toString()
  return { value: stored.quoted ? JSON.stringify(text) : text, note: PROXY_NOTE }
}

/** Export side of a fields key (backups without secrets, diagnostics): 'downloads' loses each entry's
 *  url; 'torrent-proxy-url' loses its user info and adds a note. value null = leave the key out.
 *  Other keys: unchanged. */
export function redactFieldValue(key: string, value: string): FieldRedaction {
  const base = baseStorageKey(key)
  if (base === 'downloads') return { value: withoutDownloadUrls(value) }
  if (base === 'torrent-proxy-url') return withoutProxyUserInfo(value)
  return { value }
}

function withLocalDownloadUrls(incoming: string, local: string): string {
  const next = parseStored(incoming)
  const current = parseStored(local)
  if (!isRecord(next) || !isRecord(current)) return incoming
  let changed = false
  const result: Record<string, unknown> = {}
  for (const [id, entry] of Object.entries(next)) {
    const mine = current[id]
    if (isRecord(entry) && entry.url === undefined && isRecord(mine) && typeof mine.url === 'string') {
      result[id] = { ...entry, url: mine.url }
      changed = true
    } else {
      result[id] = entry
    }
  }
  return changed ? JSON.stringify(result) : incoming
}

function withLocalProxyUserInfo(incoming: string, local: string): string {
  const next = storedUrl(incoming)
  const current = storedUrl(local)
  if (!next || !current || next.url.username || next.url.password) return incoming
  if (!current.url.username && !current.url.password) return incoming
  const bare = new URL(current.url.toString())
  bare.username = ''
  bare.password = ''
  return bare.toString() === next.url.toString() ? local : incoming
}

/** Restore side of a fields key: a download entry without a url takes this device's url for the same
 *  entry id; a proxy URL without user info keeps this device's sign-in when it names the same proxy.
 *  Anything else takes the incoming value. */
export function mergeFieldValue(key: string, incoming: string, local: string | null): string {
  if (local == null) return incoming
  const base = baseStorageKey(key)
  if (base === 'downloads') return withLocalDownloadUrls(incoming, local)
  if (base === 'torrent-proxy-url') return withLocalProxyUserInfo(incoming, local)
  return incoming
}

/** Harvested strings shorter than this are too likely to appear by chance in unrelated settings. */
const MIN_SECRET_LENGTH = 12
/** Lower-case words joined by - _ or . ('manifest.json', 'anime-catalog'): a public path segment.
 *  Any other 12+ character segment (base64, key=value, percent-encoded JSON, mixed case) is taken to
 *  be an add-on's configuration. */
const PLAIN_SEGMENT = /^[a-z]+(?:[-_.][a-z]+)*$/

/** Credentials sit near the top of a stored value: the value itself, a list's items, an object's
 *  fields, or a list under one field (depth <= 2). Deeper structure is data, such as queued tracker
 *  requests carrying titles and cover URLs; harvesting it would redact unrelated settings for sharing
 *  a cover URL with a queued request. */
function shallowStrings(value: unknown, depth: number): string[] {
  if (typeof value === 'string') return [value]
  if (depth >= 2 || !value || typeof value !== 'object') return []
  const children: unknown[] = Array.isArray(value) ? value : Object.values(value)
  return children.flatMap((child) => shallowStrings(child, depth + 1))
}

function harvestUrl(text: string, add: (part: string) => void): void {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    add(text)
    return
  }
  add(url.username)
  add(url.password)
  for (const segment of url.pathname.split('/')) if (!PLAIN_SEGMENT.test(segment)) add(segment)
  for (const pair of url.search.slice(1).split('&')) add(pair.slice(pair.indexOf('=') + 1))
  add(url.hash.slice(1))
}

/** Strings (12+ characters) that identify a secret-class value, used to leave out or redact any
 *  other setting that embeds one. URL-aware: a public add-on URL contributes nothing; a configured
 *  URL contributes only its config path segment, query values, fragment and user info (as written in
 *  the URL); any other secret string contributes itself. */
export function harvestSecretStrings(entries: Readonly<Record<string, string>>): string[] {
  const found = new Set<string>()
  const add = (part: string) => {
    if (part.length >= MIN_SECRET_LENGTH) found.add(part)
  }
  for (const [key, raw] of Object.entries(entries)) {
    if (classifyStorageKey(key) !== 'secret') continue
    for (const text of shallowStrings(parseStored(raw), 0)) {
      if (/^https?:\/\//i.test(text)) harvestUrl(text, add)
      else add(text)
    }
  }
  return [...found]
}
