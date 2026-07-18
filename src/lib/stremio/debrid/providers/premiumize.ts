import { jfetch, magnetOf, pickLargestVideo, poll, VIDEO, JUNK, authError } from '../http'
import type { DebridProvider, DebridInfo, DebridItem, DebridFile } from '../types'

// Premiumize. apikey query param on every call. FAST PATH: /transfer/directdl
// returns direct links immediately for cached torrents (no cloud clutter, no
// unlock). Fallback: create transfer + poll + resolve folder. Links are directly
// playable (use `link`, not the deprecated `stream_link`).

const BASE = 'https://www.premiumize.me/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pm(method: string, path: string, key: string, fd?: FormData): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const { status, json } = await jfetch(`${BASE}${path}${sep}apikey=${encodeURIComponent(key)}`, fd ? { method, body: fd } : { method })
  // Only throw on an auth/subscription failure; a plain status:'error' (e.g. directdl
  // "not cached") must still fall through to the caller's slow path.
  const auth = authError('Premiumize', { status, message: json?.message })
  if (auth) throw new Error(auth)
  return json
}

interface PmFile { name: string; bytes: number; link?: string; stream_link?: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenContent(content: any[]): PmFile[] {
  const out: PmFile[] = []
  for (const c of content ?? []) {
    if (c.type === 'folder') out.push(...flattenContent(c.content ?? []))
    else out.push({ name: c.path ?? c.name ?? '', bytes: c.size ?? 0, link: c.link, stream_link: c.stream_link })
  }
  return out
}

/** Pure map of a Premiumize transfer entry to a DebridInfo. Premiumize exposes progress
 *  (0..1) and a free-text `message`, but not structured seeders/speed. */
export function pmStatus(t: { status?: string; progress?: number; message?: string }): DebridInfo {
  if (t.status === 'finished' || t.status === 'seeding') return { stage: 'ready', progress: 100, raw: t.status }
  if (t.status === 'error' || t.status === 'timeout') return { stage: 'error', raw: t.status }
  return {
    stage: t.status === 'queued' ? 'queued' : 'downloading',
    progress: (t.progress ?? 0) * 100,
    raw: t.message ?? t.status,
  }
}

interface PmTransfer { id: string; name?: string; status?: string; progress?: number; message?: string; folder_id?: string; file_id?: string; src?: string }

/** Pure map of a Premiumize transfer to a DebridItem. Transfers carry no size; hash from src. */
export function pmListItem(t: PmTransfer): DebridItem {
  const info = pmStatus(t)
  const hash = t.src?.match(/urn:btih:([a-z0-9]+)/i)?.[1]?.toLowerCase()
  return { id: t.id, name: t.name ?? '', size: 0, hash, status: info.stage, progress: info.progress }
}

/** Pure map of a Premiumize file to a DebridFile. The direct link is the file id. */
export function pmFile(f: PmFile): DebridFile {
  const link = f.link ?? f.stream_link ?? ''
  return { id: link, name: f.name, size: f.bytes, playable: VIDEO.test(f.name) && !JUNK.test(f.name) }
}

export const premiumize: DebridProvider = {
  id: 'premiumize',
  name: 'Premiumize',
  keyHint: 'premiumize.me/account',
  credential: 'apikey',
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No Premiumize API key set — add it in Settings → Extensions.')
    const magnet = magnetOf(hashOrMagnet)
    // Fast path — instant for cached torrents.
    const fd = new FormData(); fd.set('src', magnet)
    const dd = await pm('POST', '/transfer/directdl', key, fd)
    if (dd?.status === 'success' && Array.isArray(dd.content) && dd.content.length) {
      const best = pickLargestVideo(flattenContent(dd.content))
      if (best?.link) return best.link
    }
    // Fallback — uncached: create + poll + resolve folder.
    const fd2 = new FormData(); fd2.set('src', magnet)
    const cr = await pm('POST', '/transfer/create', key, fd2)
    if (cr?.status !== 'success' || !cr.id) throw new Error(cr?.message ?? 'Premiumize rejected the magnet.')
    let folderId: string | undefined
    let fileId: string | undefined
    await poll(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = (await pm('GET', '/transfer/list', key)).transfers?.find((x: any) => x.id === cr.id)
      folderId = t?.folder_id; fileId = t?.file_id
      return pmStatus(t ?? {})
    }, opts)
    let files: PmFile[]
    if (folderId) files = flattenContent((await pm('GET', `/folder/list?id=${folderId}`, key)).content ?? [])
    else if (fileId) { const d = await pm('GET', `/item/details?id=${fileId}`, key); files = [{ name: d.name ?? '', bytes: d.size ?? 0, link: d.link, stream_link: d.stream_link }] }
    else files = []
    const best = pickLargestVideo(files)
    if (!best?.link && !best?.stream_link) throw new Error('No playable file in that torrent.')
    return (best.link ?? best.stream_link)!
  },
  async listItems(key) {
    if (!key) throw new Error('No Premiumize API key set — add it in Settings → Extensions.')
    const r = await pm('GET', '/transfer/list', key)
    return (r?.transfers ?? []).map(pmListItem)
  },
  async listFiles(key, item) {
    // Re-fetch the transfer to get its folder_id / file_id, then resolve the file list.
    const list = await pm('GET', '/transfer/list', key)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = list?.transfers?.find((x: any) => x.id === item.id)
    let files: PmFile[] = []
    if (t?.folder_id) files = flattenContent((await pm('GET', `/folder/list?id=${t.folder_id}`, key)).content ?? [])
    else if (t?.file_id) { const d = await pm('GET', `/item/details?id=${t.file_id}`, key); files = [{ name: d.name ?? '', bytes: d.size ?? 0, link: d.link, stream_link: d.stream_link }] }
    return files.map(pmFile)
  },
  async resolveFile(_key, _item, file) {
    if (!file.id) throw new Error('No playable link for that file.')
    return file.id // Premiumize links are already direct.
  },
  async deleteItem(key, item) {
    const fd = new FormData(); fd.set('id', item.id)
    const r = await pm('POST', '/transfer/delete', key, fd)
    if (r?.status !== 'success') throw new Error(r?.message ?? 'Premiumize delete failed.')
  },
}
