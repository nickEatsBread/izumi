// GENERATED from src/lib/stremio/debrid/providers/debridlink.ts by scripts/generate-cloudflare-resolver-core.mjs.
// Edit the canonical source, then regenerate; do not edit this vendored copy.
import { jfetch, form, magnetOf, hashOf, poll, VIDEO, JUNK, authError, debridHttpError } from '../http'
import { pickVideoFile } from '../episode-file'
import type { DebridProvider, DebridInfo, DebridItem, DebridFile } from '../types'

// Debrid-Link. Simplest torrent flow: add magnet → poll /seedbox/list until 100% →
// files[].downloadUrl is DIRECT (no select, no unlock). Envelope: { success, value }.

const BASE = 'https://debrid-link.fr/api/v2'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dl(method: string, path: string, key: string, body?: string, priority?: boolean): Promise<any> {
  const { ok, status, json } = await jfetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body } : {}),
    priority,
  })
  if (json?.success === false) {
    const auth = authError('Debrid-Link', { status, code: json?.error })
    throw new Error(auth ?? json?.error ?? 'Debrid-Link request failed.')
  }
  // A non-2xx with no envelope (5xx, an HTML gateway page) leaves jfetch's `{}` fallback behind,
  // and dlStatus maps a missing entry to 'queued' — so an unchecked status let the poll burn its
  // whole deadline waiting on a service that is simply down. debridHttpError separates the blip
  // poll should ride out from the failure that ends the resolve. Checked AFTER the envelope so a
  // 401 keeps Debrid-Link's badToken wording.
  if (!ok) throw debridHttpError(status, authError('Debrid-Link', { status }) ?? `Debrid-Link request failed (${status}).`)
  return json
}

/** Pure map of a Debrid-Link seedbox entry to a DebridInfo. `peersConnected` is the
 *  closest DL exposes to a seeder count; fields absent on some accounts stay undefined. */
export function dlStatus(t: { downloadPercent?: number; totalSize?: number; downloaded?: number; peersConnected?: number } | undefined): DebridInfo {
  const pct = t?.downloadPercent ?? 0
  if (pct >= 100) return { stage: 'ready', progress: 100 }
  return {
    stage: pct > 0 ? 'downloading' : 'queued',
    progress: t?.downloadPercent,
    total: t?.totalSize,
    downloaded: t?.downloaded,
    seeders: t?.peersConnected,
  }
}

interface DlTorrent { id: string; name?: string; totalSize?: number; downloadPercent?: number; downloaded?: number; peersConnected?: number; hashString?: string; files?: Array<{ name?: string; size?: number; downloadUrl?: string }>; created?: number }

/** Pure map of a Debrid-Link seedbox item to a DebridItem. created is epoch SECONDS. */
export function dlListItem(t: DlTorrent): DebridItem {
  const info = dlStatus(t)
  return {
    id: t.id, name: t.name ?? '', size: t.totalSize ?? 0, hash: t.hashString?.toLowerCase(),
    status: info.stage, progress: info.progress,
    addedAt: t.created ? t.created * 1000 : undefined, fileCount: t.files?.length,
  }
}

/** Pure map of a Debrid-Link file to a DebridFile. downloadUrl is DIRECT → the file id. */
export function dlFile(f: { name?: string; size?: number; downloadUrl?: string }): DebridFile {
  const name = f.name ?? ''
  return { id: f.downloadUrl ?? '', name, size: f.size ?? 0, playable: VIDEO.test(name) && !JUNK.test(name) }
}

/** Pure: an already-complete seedbox entry for `hash`, or undefined. Completion is read off
 *  `downloadPercent` exactly like dlStatus does — a partial entry is not something a background
 *  prefetch can serve without waiting out the whole download. */
export function dlFindReady(list: unknown, hash: string): DlTorrent | undefined {
  const arr = Array.isArray(list) ? list as DlTorrent[] : []
  return arr.find((t) => (t?.hashString ?? '').toLowerCase() === hash && (t?.downloadPercent ?? 0) >= 100)
}

export const debridlink: DebridProvider = {
  id: 'debridlink',
  name: 'Debrid-Link',
  keyHint: 'debrid-link.com/webapp/apikey',
  credential: 'apikey',
  // Debrid-Link's /api/v2/seedbox/cached is undocumented and sources conflict: StremThru has
  // carried "Deprecated: Debrid-Link removed the endpoint" since 2024-11-25 and routes around
  // it, while another client uses it as its only Debrid-Link cache check. The
  // route answers 401 badToken unauthenticated while a fake sibling route answers 404, so it is
  // registered and auth-gated rather than removed — but nobody has verified it with a real key.
  // Shipping an unverified endpoint would fabricate badges. Promote to 'native' once confirmed.
  cacheCheck: 'none',
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No Debrid-Link API key set — add it in Settings → Sources → Playback.')
    const want = hashOf(hashOrMagnet)
    let addedId: string | undefined
    if (opts?.noAdd) {
      // /seedbox/add puts a permanent torrent on the account, so a background prefetch may only
      // reuse an entry already in the seedbox. The poll below re-finds it by hash anyway; this
      // lookup exists purely to decide whether there is anything to reuse at all.
      const list = await dl('GET', '/seedbox/list', key, undefined, opts?.priority).catch(() => undefined)
      const hit = dlFindReady(list?.value, want)
      if (!hit) throw new Error("Debrid-Link needs to add this release, which background prefetch isn't allowed to do.")
      addedId = hit.id
    }
    else {
      const add = await dl('POST', '/seedbox/add', key, form({ url: magnetOf(hashOrMagnet) }), opts?.priority)
      addedId = add.value?.id
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let files: any[] = []
    await poll(async () => {
      const list = (await dl('GET', '/seedbox/list', key, undefined, opts?.priority)).value ?? []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = list.find((x: any) => (x.hashString ?? '').toLowerCase() === want) ?? list.find((x: any) => x.id === addedId)
      files = t?.files ?? []
      return dlStatus(t)
    }, opts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = files.map((f: any) => ({ name: f.name ?? '', bytes: f.size ?? 0, downloadUrl: f.downloadUrl }))
    const best = pickVideoFile(mapped, opts?.want)
    if (!best?.downloadUrl) throw new Error('No playable file in that torrent.')
    return best.downloadUrl
  },
  async listItems(key) {
    if (!key) throw new Error('No Debrid-Link API key set — add it in Settings → Sources → Playback.')
    const r = await dl('GET', '/seedbox/list', key)
    return (r.value ?? []).map(dlListItem)
  },
  async listFiles(key, item) {
    const r = await dl('GET', '/seedbox/list', key)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (r.value ?? []).find((x: any) => x.id === item.id)
    return (t?.files ?? []).map(dlFile)
  },
  async resolveFile(_key, _item, file) {
    if (!file.id) throw new Error('No playable link for that file.')
    return file.id // downloadUrl is already direct.
  },
  async deleteItem(key, item) {
    await dl('DELETE', `/seedbox/${item.id}`, key)
  },
}
