import { jfetch, form, magnetOf, hashOf, VIDEO, JUNK, poll, authError, isArchiveName } from '../http'
import { pickEpisodeVideo } from '../episode-file'
import type { DebridProvider, DebridInfo, DebridItem, DebridFile, ResolveOpts } from '../types'

// Real-Debrid. Flow: addMagnet → selectFiles(video ids, never `all`) [RD is the only one that
// requires this] → poll info until 'downloaded' → pick the wanted episode (or largest video) →
// unrestrict/link, retrying with a single-file selection if RD packed the result into an
// archive. RD deprecated /instantAvailability, so cache = reaches 'downloaded' fast.

const BASE = 'https://api.real-debrid.com/rest/1.0'
interface RdFile { id: number; path: string; bytes: number; selected: number }
interface RdInfo { id: string; status: string; progress: number; seeders?: number; speed?: number; bytes?: number; files?: RdFile[]; links?: string[] }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rd(method: string, path: string, key: string, body?: string): Promise<any> {
  const { ok, status, json } = await jfetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body,
  })
  // 451 = Real-Debrid has this exact torrent/infohash blocked for legal reasons
  // (DMCA). It is per-file, not your account/IP — a different release usually works.
  if (status === 451) throw new Error('Real-Debrid blocked this release (DMCA/legal) — pick a different source.')
  // error_code 35 = `infringing_file`: RD's content filter (May 2026) rejected this file by
  // name/pattern. Same user-facing meaning as 451 — a different release usually works.
  if (!ok) {
    const code = json && typeof json === 'object' ? (json as { error_code?: number }).error_code : undefined
    if (code === 35) throw new Error('Real-Debrid blocked this release (infringing file) — pick a different source.')
    const auth = authError('Real-Debrid', { status, code: code != null ? String(code) : undefined, message: (json as { error?: string })?.error })
    throw new Error(auth ?? `Real-Debrid request failed (${status}).`)
  }
  return json
}

/** Pure map of RD's /torrents/info payload to a DebridInfo (testable, no HTTP). */
export function rdStatus(info: { status: string; progress?: number; seeders?: number; speed?: number; bytes?: number }): DebridInfo {
  if (info.status === 'downloaded') return { stage: 'ready', progress: 100, raw: info.status }
  if (/error|virus|dead/i.test(info.status)) return { stage: 'error', raw: info.status }
  return {
    stage: /queued|waiting/i.test(info.status) ? 'queued' : 'downloading',
    progress: info.progress,
    seeders: info.seeders,
    speed: info.speed,
    total: info.bytes,
    raw: info.status,
  }
}

interface RdListEntry { id: string; filename: string; hash: string; bytes: number; progress?: number; status: string; added?: string }

/** Pure map of an RD /torrents list entry to a DebridItem. */
export function rdListItem(e: RdListEntry): DebridItem {
  return {
    id: e.id, name: e.filename, size: e.bytes, hash: e.hash?.toLowerCase(),
    status: rdStatus({ status: e.status, progress: e.progress }).stage,
    progress: e.progress,
    addedAt: e.added ? (Date.parse(e.added) || undefined) : undefined,
  }
}

/** Pure map of an RD info file to a DebridFile. */
export function rdFile(f: { id: number; path: string; bytes: number }): DebridFile {
  const name = f.path.split('/').pop() || f.path
  return { id: String(f.id), name, size: f.bytes, playable: VIDEO.test(name) && !JUNK.test(name) }
}

/** Minimum size for a file to count as a real video. Mirrors the floor production debrid
 *  addons use — it keeps 2 MB "trailerclip.mkv" junk out of the selection. */
const MIN_VIDEO_BYTES = 5 * 1024 * 1024

/** Which file ids to hand RD's selectFiles. Avoid RD's `all` keyword whenever files can be
 *  named individually: asking RD for every file is what makes it repackage the torrent into
 *  one archive instead of per-file links. Falls back tier by tier — real (non-junk, over-floor)
 *  videos, then any non-junk video-extension file regardless of size, then every file — so a
 *  torrent whose only video is junk-named or undersized still doesn't drag sidecar files (subs,
 *  etc.) into a multi-file selection. Returns the literal 'all' keyword only when there is
 *  nothing left to name. */
export function rdSelectFileIds(files: Array<{ id: number; path: string; bytes: number }>): string {
  const videos = files.filter(
    (f) => VIDEO.test(f.path) && !JUNK.test(f.path) && f.bytes >= MIN_VIDEO_BYTES,
  )
  const anyVideoExt = files.filter((f) => VIDEO.test(f.path) && !JUNK.test(f.path))
  const pool = videos.length ? videos : anyVideoExt.length ? anyVideoExt : files
  const ids = pool.map((f) => f.id)
  return ids.length ? ids.join(',') : 'all'
}

/** Map a chosen file to its RD link. RD documents `links` only as "Host URL" — the positional
 *  coupling to the SELECTED files is a convention, not a contract, and it breaks outright when
 *  RD packs a torrent (one archive link for many selected files). The old
 *  `links[idx] ?? links[0]` fallback served that archive as if it were the episode. Returning
 *  undefined lets the caller retry with a single-file selection instead of guessing.
 *  Matching by filename is impossible here: RD's links are opaque /d/<id> URLs. */
export function rdLinkFor(selectedCount: number, index: number, links: string[]): string | undefined {
  if (index < 0 || selectedCount <= 0) return undefined
  if (links.length !== selectedCount) return undefined
  return links[index]
}

// Find an already-DOWNLOADED torrent id for `hash` in the account's list. RD has no
// get-by-hash endpoint, so we scan the newest-first list. A single `limit=100` page missed the
// hash for accounts with >100 torrents — the entry had scrolled past the newest 100 — so the
// resolve fell through to addMagnet and RD re-cached a torrent that was already downloaded. Page
// through until found or the list is exhausted, bounded to keep the common (small-account) case
// at exactly one request: page 1 returning <100 entries stops immediately.
//
// Prefers the FULLEST matching entry (greatest `bytes` — RD reports the selected-files size, not
// the whole torrent), not just the first/newest hit. rdResolveSingleFile's retry creates its own
// 'downloaded' entry with only ONE file selected; landing on that instead of the entry with every
// video selected starves pickEpisodeVideo of every other episode in the release and silently
// serves the wrong one (see the poisoning bug this guards against).
async function findDownloadedId(key: string, hash: string): Promise<string | undefined> {
  const LIMIT = 100
  const MAX_PAGES = 5 // ≤500 torrents scanned; beyond that, fall through to addMagnet
  let best: { id: string; bytes: number } | undefined
  for (let page = 1; page <= MAX_PAGES; page++) {
    const list = await rd('GET', `/torrents?limit=${LIMIT}&page=${page}`, key) as Array<{ id: string; hash?: string; status: string; bytes?: number }>
    if (!Array.isArray(list) || list.length === 0) break
    for (const t of list) {
      if (t.hash?.toLowerCase() !== hash || t.status !== 'downloaded') continue
      if (!best || (t.bytes ?? 0) > best.bytes) best = { id: t.id, bytes: t.bytes ?? 0 }
    }
    if (list.length < LIMIT) break // last page reached
  }
  return best?.id
}

interface RdUnrestricted { download: string; filename?: string; filesize?: number }

/** RD's unrestrict response can carry `filename: ''` — `||`, not `??`, so an empty string still
 *  falls back to the (always-present) download URL for archive detection. */
const servedName = (u: RdUnrestricted) => u.filename || u.download

/** Should the caller retry with a fresh single-file selection? Unconditionally yes when there is
 *  no usable link at all (`un` undefined — covers both an unusable positional link mapping and
 *  `chosen` not being part of the current selection at all). Yes when RD served an archive, but
 *  ONLY if more than one file was selected: packing correlates with selecting more than one
 *  file, so a selection that was already exactly one file and still came back as an archive
 *  would just reproduce the identical archive on retry — that must throw instead of adding
 *  another torrent for nothing. Always no for `noAdd` callers (background prefetch): they may
 *  only serve what's already resolvable, never create a new entry on the user's account. */
export function rdShouldRetrySingleFile(un: RdUnrestricted | undefined, selectedCount: number, noAdd: boolean): boolean {
  if (noAdd) return false
  if (!un) return true
  return isArchiveName(servedName(un)) && selectedCount > 1
}

/** Re-add the magnet selecting exactly ONE file, then unrestrict it. Selecting a single file
 *  is the reliable way to make RD serve a real file rather than a packed archive, and
 *  selectFiles cannot change an existing downloaded torrent's selection (the API answers
 *  "202 Action already done"), so a fresh add is required. The previous entry is deliberately
 *  left alone — izumi never deletes torrents from the user's account. */
async function rdResolveSingleFile(
  key: string, hashOrMagnet: string, fileId: number, opts?: ResolveOpts,
): Promise<RdUnrestricted> {
  const id = (await rd('POST', '/torrents/addMagnet', key, form({ magnet: magnetOf(hashOrMagnet) })) as { id: string }).id
  await rd('POST', `/torrents/selectFiles/${id}`, key, form({ files: String(fileId) }))
  let info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
  if (rdStatus(info).stage !== 'ready') {
    await poll(async () => {
      info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
      return rdStatus(info)
    }, opts)
  }
  const link = info.links?.[0]
  if (!link) throw new Error('Real-Debrid returned no link for that file.')
  return await rd('POST', '/unrestrict/link', key, form({ link })) as RdUnrestricted
}

export const realdebrid: DebridProvider = {
  id: 'realdebrid',
  name: 'Real-Debrid',
  keyHint: 'real-debrid.com/apitoken',
  credential: 'apikey',
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No Real-Debrid API key set — add it in Settings → Extensions.')
    // Reuse an already-DOWNLOADED torrent for this hash instead of re-adding. A fresh addMagnet
    // makes RD re-cache from scratch, which is why replaying a finished episode showed
    // "downloading" again even though it completed before. If a completed entry exists, skip
    // straight to picking the file + unrestricting.
    const hash = hashOf(hashOrMagnet)
    let id: string | undefined
    try {
      id = await findDownloadedId(key, hash)
    } catch { /* list unavailable — fall through to addMagnet */ }
    if (!id) {
      id = (await rd('POST', '/torrents/addMagnet', key, form({ magnet: magnetOf(hashOrMagnet) })) as { id: string }).id
    }
    let info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
    if (info.status === 'waiting_files_selection' || !(info.files ?? []).some((f) => f.selected)) {
      await rd('POST', `/torrents/selectFiles/${id}`, key, form({ files: rdSelectFileIds(info.files ?? []) }))
      info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
    }
    // `poll` probes once before its first sleep, so entering it with an already-`downloaded` info
    // spent a whole extra round-trip (fresh TLS handshake — the plugin pools nothing) re-fetching
    // the file list we are holding, then parsing it again. That is pure latency on the CACHED path,
    // which is the common one. Every other provider polls straight after add; RD was the only one
    // paying for it. Routed through `rdStatus` so error-status mapping stays in one place.
    if (rdStatus(info).stage !== 'ready') {
      await poll(async () => {
        info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
        return rdStatus(info)
      }, opts)
    }
    const files = info.files ?? []
    const selected = files.filter((f) => f.selected)
    const videos = files.filter((f) => VIDEO.test(f.path) && !JUNK.test(f.path))
    // Episode-aware pick first (batch/season packs: play the file the user asked for, not the
    // biggest); legacy largest-video fallback otherwise. Picked from the FULL file list, not
    // `selected` — a reused entry (findDownloadedId) can have only a DIFFERENT episode
    // selected, so `selected` alone can't tell us which episodes this torrent even has. `chosen`
    // may therefore not be in `selected` at all; `idx` below handles that.
    const chosen =
      pickEpisodeVideo(files.map((f) => ({ name: f.path, bytes: f.bytes, f })), opts?.want)?.f
      ?? [...(videos.length ? videos : files)].sort((a, b) => b.bytes - a.bytes)[0]
    if (!chosen) throw new Error('No playable file in that torrent.')
    const idx = selected.indexOf(chosen)
    const link = idx >= 0 ? rdLinkFor(selected.length, idx, info.links ?? []) : undefined
    let un = link
      ? await rd('POST', '/unrestrict/link', key, form({ link })) as RdUnrestricted
      : undefined
    // Retry with a fresh single-file selection when needed (no usable link — including `chosen`
    // not being selected at all — or RD packed the selection into an archive); see
    // rdShouldRetrySingleFile for exactly when. Skipped for noAdd callers (background prefetch),
    // which may only serve what's already resolvable.
    if (rdShouldRetrySingleFile(un, selected.length, !!opts?.noAdd)) {
      un = await rdResolveSingleFile(key, hashOrMagnet, chosen.id, opts)
    }
    if (!un || isArchiveName(servedName(un))) {
      throw new Error(opts?.noAdd
        ? "Real-Debrid needs to re-select this release, which background prefetch isn't allowed to do."
        : 'Real-Debrid only offers this release as an archive, so the episode cannot be streamed. Play it with Direct P2P (Settings → Extensions → Torrent playback).')
    }
    // Copyright decoy guard: when a release is taken down, RD serves a tiny placeholder clip
    // ("removed by copyright holder") in place of the real file — which otherwise just PLAYS.
    // The torrent still advertises the real size, so a served file far smaller than that (here
    // <50% of the torrent's bytes) is the decoy. Reject it so the user can pick another source.
    if (chosen.bytes > 0 && un.filesize && un.filesize < chosen.bytes * 0.5)
      throw new Error('Real-Debrid served a copyright-removed placeholder for this release — pick a different source.')
    return un.download
  },
  async listItems(key) {
    if (!key) throw new Error('No Real-Debrid API key set — add it in Settings → Extensions.')
    const list = await rd('GET', '/torrents?limit=100', key) as RdListEntry[]
    return (Array.isArray(list) ? list : []).map(rdListItem)
  },
  async listFiles(key, item) {
    const info = await rd('GET', `/torrents/info/${item.id}`, key) as RdInfo
    return (info.files ?? []).map(rdFile)
  },
  async resolveFile(key, item, file, opts) {
    let info = await rd('GET', `/torrents/info/${item.id}`, key) as RdInfo
    if (!(info.files ?? []).some((f) => f.selected)) {
      await rd('POST', `/torrents/selectFiles/${item.id}`, key, form({ files: rdSelectFileIds(info.files ?? []) }))
      info = await rd('GET', `/torrents/info/${item.id}`, key) as RdInfo
    }
    const selected = (info.files ?? []).filter((f) => f.selected)
    const idx = selected.findIndex((f) => String(f.id) === file.id)
    const chosen = selected[idx]
    if (!chosen) throw new Error("That file isn't available in this torrent.")
    const link = rdLinkFor(selected.length, idx, info.links ?? [])
    let un = link
      ? await rd('POST', '/unrestrict/link', key, form({ link })) as RdUnrestricted
      : undefined
    if (rdShouldRetrySingleFile(un, selected.length, !!opts?.noAdd)) {
      if (!item.hash) throw new Error("Real-Debrid can't re-add this torrent — it has no infohash.")
      un = await rdResolveSingleFile(key, item.hash, chosen.id, opts)
    }
    if (!un || isArchiveName(servedName(un))) {
      throw new Error(opts?.noAdd
        ? "Real-Debrid needs to re-select this file, which background prefetch isn't allowed to do."
        : 'Real-Debrid only offers this file inside an archive.')
    }
    // Same copyright-decoy guard as resolveHash: a served file far smaller than the torrent's is a placeholder.
    if (chosen.bytes > 0 && un.filesize && un.filesize < chosen.bytes * 0.5)
      throw new Error('Real-Debrid served a copyright-removed placeholder for this file — pick another source.')
    return un.download
  },
  async deleteItem(key, item) {
    await rd('DELETE', `/torrents/delete/${item.id}`, key)
  },
}
