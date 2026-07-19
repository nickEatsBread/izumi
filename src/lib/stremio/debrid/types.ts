// Multi-provider debrid abstraction. A provider turns a torrent hash/magnet (from
// a source extension) into a direct, playable HTTP URL that libmpv opens. Only
// TORRENT-capable services are here — pure hoster-link unrestrictors (Cocoleech,
// DASAN) can't resolve a bare infoHash and are intentionally omitted.

/** Provider-agnostic poll stage. */
export type DebridStage = 'queued' | 'downloading' | 'ready' | 'error'

/** What onStatus receives each poll, so the UI can show a slow (uncached) download. */
export interface DebridInfo {
  stage: DebridStage
  progress?: number // 0–100 when the provider reports it
  seeders?: number // active seeders, when the provider reports them
  speed?: number // download speed in BYTES/sec
  downloaded?: number // bytes fetched so far
  total?: number // total bytes of the file/torrent
  filename?: string // the file being cached, when known
  raw?: string // provider's raw status, for honest display/debugging
}

/** One torrent/magnet on the debrid account. `status` reuses the DebridStage vocabulary. */
export interface DebridItem {
  id: string          // provider-specific torrent id
  name: string        // release/torrent name
  size: number        // total bytes (0 when the provider's list omits it)
  status: DebridStage // 'queued' | 'downloading' | 'ready' | 'error'
  progress?: number   // 0–100 while downloading
  hash?: string       // btih infohash (lower-cased) when exposed
  addedAt?: number    // epoch ms, for newest-first sort
  fileCount?: number  // when the list endpoint carries it (skips listFiles for single-file)
}

/** One file inside a torrent. `id` is the key resolveFile needs (numeric id, or a direct link). */
export interface DebridFile {
  id: string
  name: string
  size: number
  playable: boolean   // is a video file (VIDEO regex, minus JUNK)
}

/** Which episode the caller actually wants out of a (possibly multi-file) torrent.
 *  Providers use it to pick the RIGHT file from a batch/season pack instead of the
 *  legacy largest-file heuristic (see episode-file.ts). All fields optional — an
 *  empty/missing want keeps the legacy behavior. */
export interface EpisodeWant {
  episode?: number  // per-season episode number
  abs?: number      // absolute episode number (long-runners / TVDB absolute)
  season?: number   // wanted season — gates files that parse a contradicting season
  filename?: string // addon behaviorHints.filename: the exact in-pack file, when known
}

export interface ResolveOpts {
  onStatus?: (info: DebridInfo) => void
  pollMs?: number // default 3000
  timeoutMs?: number // default 10 min
  signal?: AbortSignal
  want?: EpisodeWant // episode-aware file selection inside multi-file torrents
}

export interface DebridProviderMeta {
  id: string // stable key (e.g. 'realdebrid')
  name: string // display name
  keyHint: string // where to get the credential
  credential: 'apikey' | 'userpass'
  experimental?: boolean // true → tag "(experimental)" in the UI
}

export interface DebridProvider extends DebridProviderMeta {
  /** Resolve a torrent hash or magnet to a direct playable URL. MUST throw a
   *  user-facing Error on failure and NEVER leak the key in the message. */
  resolveHash(key: string, hashOrMagnet: string, opts?: ResolveOpts): Promise<string>
  /** Account torrents/magnets, newest first. Absent = "listing not supported". */
  listItems?(key: string): Promise<DebridItem[]>
  /** Files inside one torrent. Fetched lazily when a row is opened. */
  listFiles?(key: string, item: DebridItem): Promise<DebridFile[]>
  /** Resolve ONE chosen file to a direct playable URL. Drives debridCaching via opts.onStatus. */
  resolveFile?(key: string, item: DebridItem, file: DebridFile, opts?: ResolveOpts): Promise<string>
  /** Remove a torrent from the account. */
  deleteItem?(key: string, item: DebridItem): Promise<void>
}
