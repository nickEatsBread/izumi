import { jfetch, form, magnetOf, hashOf, VIDEO, JUNK, poll, authError } from '../http'
import type { DebridProvider, DebridInfo, DebridItem, DebridFile } from '../types'

// Real-Debrid. Flow: addMagnet → selectFiles(all) [RD is the only one that requires
// this] → poll info until 'downloaded' → pick largest video → unrestrict/link. RD
// deprecated /instantAvailability, so cache = reaches 'downloaded' fast.

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
      const list = await rd('GET', '/torrents?limit=100', key) as Array<{ id: string; hash?: string; status: string }>
      id = list.find((t) => t.hash?.toLowerCase() === hash && t.status === 'downloaded')?.id
    } catch { /* list unavailable — fall through to addMagnet */ }
    if (!id) {
      id = (await rd('POST', '/torrents/addMagnet', key, form({ magnet: magnetOf(hashOrMagnet) })) as { id: string }).id
    }
    let info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
    if (info.status === 'waiting_files_selection' || !(info.files ?? []).some((f) => f.selected)) {
      await rd('POST', `/torrents/selectFiles/${id}`, key, form({ files: 'all' }))
      info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
    }
    await poll(async () => {
      info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
      return rdStatus(info)
    }, opts)
    const selected = (info.files ?? []).filter((f) => f.selected)
    const videos = selected.filter((f) => VIDEO.test(f.path) && !JUNK.test(f.path))
    const chosen = [...(videos.length ? videos : selected)].sort((a, b) => b.bytes - a.bytes)[0]
    if (!chosen) throw new Error('No playable file in that torrent.')
    const idx = selected.indexOf(chosen)
    const link = info.links?.[idx] ?? info.links?.[0]
    if (!link) throw new Error('Debrid returned no link.')
    const un = await rd('POST', '/unrestrict/link', key, form({ link })) as { download: string; filesize?: number }
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
      await rd('POST', `/torrents/selectFiles/${item.id}`, key, form({ files: 'all' }))
      info = await rd('GET', `/torrents/info/${item.id}`, key) as RdInfo
    }
    const selected = (info.files ?? []).filter((f) => f.selected)
    const idx = selected.findIndex((f) => String(f.id) === file.id)
    const chosen = selected[idx]
    if (!chosen) throw new Error("That file isn't available in this torrent.")
    const link = info.links?.[idx] ?? info.links?.[0]
    if (!link) throw new Error('Debrid returned no link.')
    const un = await rd('POST', '/unrestrict/link', key, form({ link })) as { download: string; filesize?: number }
    // Same copyright-decoy guard as resolveHash: a served file far smaller than the torrent's is a placeholder.
    if (chosen.bytes > 0 && un.filesize && un.filesize < chosen.bytes * 0.5)
      throw new Error('Real-Debrid served a copyright-removed placeholder for this file — pick another source.')
    return un.download
  },
  async deleteItem(key, item) {
    await rd('DELETE', `/torrents/delete/${item.id}`, key)
  },
}
