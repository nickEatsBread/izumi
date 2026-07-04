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
  raw?: string // provider's raw status, for honest display/debugging
}

export interface ResolveOpts {
  onStatus?: (info: DebridInfo) => void
  pollMs?: number // default 3000
  timeoutMs?: number // default 10 min
  signal?: AbortSignal
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
}
