import { jfetch, form, magnetOf, VIDEO, JUNK, poll } from '../http'
import type { DebridProvider } from '../types'

// Real-Debrid. Flow: addMagnet → selectFiles(all) [RD is the only one that requires
// this] → poll info until 'downloaded' → pick largest video → unrestrict/link. RD
// deprecated /instantAvailability, so cache = reaches 'downloaded' fast.

const BASE = 'https://api.real-debrid.com/rest/1.0'
interface RdFile { id: number; path: string; bytes: number; selected: number }
interface RdInfo { id: string; status: string; progress: number; files?: RdFile[]; links?: string[] }

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
  if (!ok) throw new Error(`Real-Debrid request failed (${status}).`)
  return json
}

export const realdebrid: DebridProvider = {
  id: 'realdebrid',
  name: 'Real-Debrid',
  keyHint: 'real-debrid.com/apitoken',
  credential: 'apikey',
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No Real-Debrid API key set — add it in Settings → Extensions.')
    const { id } = await rd('POST', '/torrents/addMagnet', key, form({ magnet: magnetOf(hashOrMagnet) })) as { id: string }
    let info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
    if (info.status === 'waiting_files_selection' || !(info.files ?? []).some((f) => f.selected)) {
      await rd('POST', `/torrents/selectFiles/${id}`, key, form({ files: 'all' }))
      info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
    }
    await poll(async () => {
      info = await rd('GET', `/torrents/info/${id}`, key) as RdInfo
      if (info.status === 'downloaded') return { stage: 'ready', progress: 100, raw: info.status }
      if (/error|virus|dead/i.test(info.status)) return { stage: 'error', raw: info.status }
      return { stage: /queued|waiting/i.test(info.status) ? 'queued' : 'downloading', progress: info.progress, raw: info.status }
    }, opts)
    const selected = (info.files ?? []).filter((f) => f.selected)
    const videos = selected.filter((f) => VIDEO.test(f.path) && !JUNK.test(f.path))
    const chosen = [...(videos.length ? videos : selected)].sort((a, b) => b.bytes - a.bytes)[0]
    if (!chosen) throw new Error('No playable file in that torrent.')
    const idx = selected.indexOf(chosen)
    const link = info.links?.[idx] ?? info.links?.[0]
    if (!link) throw new Error('Debrid returned no link.')
    const { download } = await rd('POST', '/unrestrict/link', key, form({ link })) as { download: string }
    return download
  },
}
