import { jfetch, form, magnetOf, hashOf, poll, VIDEO, JUNK, authError } from '../http'
import { pickVideoFile } from '../episode-file'
import type { DebridProvider, DebridInfo, DebridItem, DebridFile, DebridAccountInfo } from '../types'

// AllDebrid. Auto-selects files; ready = statusCode===4; the file link MUST be
// unlocked. Envelope: { status:'success'|'error', data, error }.

const BASE = 'https://api.alldebrid.com'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ad(path: string, key: string, body: string, priority?: boolean): Promise<any> {
  const { status, json } = await jfetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    priority,
  })
  if (json?.status !== 'success') {
    const auth = authError('AllDebrid', { status, code: json?.error?.code, message: json?.error?.message })
    throw new Error(auth ?? json?.error?.message ?? 'AllDebrid request failed.')
  }
  return json.data
}

/** Pure map of an AllDebrid magnet/status entry to a DebridInfo. */
export function adStatus(s: { statusCode: number; status: string; downloaded?: number; size?: number; seeders?: number; downloadSpeed?: number }): DebridInfo {
  if (s.statusCode === 4) return { stage: 'ready', progress: 100, raw: s.status }
  if (s.statusCode >= 5) return { stage: 'error', raw: s.status }
  const progress = s.size ? Math.min(100, ((s.downloaded ?? 0) / s.size) * 100) : undefined
  return {
    stage: s.statusCode >= 1 ? 'downloading' : 'queued',
    progress,
    seeders: s.seeders,
    speed: s.downloadSpeed,
    downloaded: s.downloaded,
    total: s.size,
    raw: s.status,
  }
}

interface AdMagnet { id: number | string; filename: string; size?: number; status: string; statusCode: number; downloaded?: number; seeders?: number; downloadSpeed?: number; hash?: string; uploadDate?: number }

/** Pure map of an AllDebrid magnet entry to a DebridItem. uploadDate is epoch SECONDS. */
export function adListItem(m: AdMagnet): DebridItem {
  const info = adStatus(m)
  return {
    id: String(m.id), name: m.filename, size: m.size ?? 0, hash: m.hash?.toLowerCase(),
    status: info.stage, progress: info.progress,
    addedAt: m.uploadDate ? m.uploadDate * 1000 : undefined,
  }
}

/** Pure flatten of AllDebrid's nested file tree to DebridFile[]. The direct link is the file id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adFiles(tree: any[]): DebridFile[] {
  const out: DebridFile[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(function walk(ns: any[]) {
    for (const n of ns) {
      if (n.e) walk(n.e)
      else out.push({ id: n.l, name: n.n, size: n.s ?? 0, playable: VIDEO.test(n.n) && !JUNK.test(n.n) })
    }
  })(tree ?? [])
  return out
}

/** Pure: the id of an already-READY magnet for `hash` on the account, or undefined. AllDebrid's
 *  status payload is an array on the list call and a bare object when it holds one magnet, so
 *  accept both (same shape listItems normalizes). Only statusCode 4 counts: an entry still
 *  downloading isn't something a background prefetch can serve, and treating it as reusable
 *  would make the prefetch sit on `poll` for the rest of the episode. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adFindReady(magnets: any, hash: string): string | undefined {
  const arr = Array.isArray(magnets) ? magnets : (magnets ? [magnets] : [])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hit = arr.find((m: any) => (m?.hash ?? '').toLowerCase() === hash && m?.statusCode === 4)
  return hit ? String(hit.id) : undefined
}

/** Pure: AllDebrid magnet/status entries -> POSITIVE-ONLY cache map. statusCode 4 === Ready.
 *  Like the RD equivalent this answers "already on MY account", so it emits 'cached' and never
 *  'uncached'. AllDebrid returns `magnets` as EITHER an array OR an object map keyed by id
 *  depending on the call, so both shapes are normalised here. */
export function adOwnedHashes(
  magnets: Array<{ hash?: string; statusCode?: number }> | Record<string, { hash?: string; statusCode?: number }> | null,
  asked: string[],
): Map<string, 'cached' | 'uncached'> {
  // Full union for the same variance reason as rdOwnedHashes; only 'cached' is ever emitted.
  const out = new Map<string, 'cached' | 'uncached'>()
  if (!magnets || typeof magnets !== 'object') return out
  const list = Array.isArray(magnets) ? magnets : Object.values(magnets)
  const want = new Set(asked.map((h) => h.toLowerCase()))
  for (const m of list) {
    if (m?.statusCode !== 4) continue
    const h = m.hash?.toLowerCase()
    if (h && want.has(h)) out.set(h, 'cached')
  }
  return out
}

// Memoised ready-magnet snapshot for checkCached, same rationale as RD's rdOwnedCache: the scan
// is O(account size), so unmemoised checks would re-fetch the whole account on every hash batch.
let adOwnedCache: { at: number; key: string; magnets: unknown } | undefined
let adOwnedFetch: Promise<void> | null = null
const AD_OWNED_TTL = 5 * 60_000

export function adAccountInfo(user: { username?: string; isPremium?: boolean; isTrial?: boolean; premiumUntil?: number | string; fidelityPoints?: number }): DebridAccountInfo {
  const until = Number(user.premiumUntil)
  return {
    username: user.username,
    plan: user.isPremium ? 'premium' : user.isTrial ? 'trial' : 'free',
    premiumUntil: until > 0 ? until * 1000 : undefined,
    points: user.fidelityPoints,
  }
}

export const alldebrid: DebridProvider = {
  id: 'alldebrid',
  name: 'AllDebrid',
  keyHint: 'alldebrid.com/apikeys',
  credential: 'apikey',
  cacheCheck: 'library',
  async accountInfo(key) {
    if (!key) throw new Error('No AllDebrid API key set.')
    return adAccountInfo((await ad('/v4/user', key, '')).user ?? {})
  },
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No AllDebrid API key set — add it in Settings → Sources → Playback.')
    let id: string
    if (opts?.noAdd) {
      // Background prefetch may only serve what the account already holds: magnet/upload creates
      // a permanent entry, which is exactly the "torrent the user didn't ask for" noAdd forbids.
      // AllDebrid has no get-by-hash endpoint, so scan the account's magnet list instead.
      const list = await ad('/v4.1/magnet/status', key, form({}), opts?.priority).catch(() => undefined)
      const existing = adFindReady(list?.magnets, hashOf(hashOrMagnet))
      if (!existing) throw new Error("AllDebrid needs to add this release, which background prefetch isn't allowed to do.")
      id = existing
    }
    else {
      const up = await ad('/v4/magnet/upload', key, form({ 'magnets[]': magnetOf(hashOrMagnet) }), opts?.priority)
      const m = up.magnets?.[0]
      if (m?.error) throw new Error(m.error.message ?? 'AllDebrid rejected the magnet.')
      id = String(m.id)
    }
    await poll(async () => {
      const st = (await ad('/v4.1/magnet/status', key, form({ id }), opts?.priority)).magnets
      const s = Array.isArray(st) ? st[0] : st
      return adStatus(s)
    }, opts)
    const tree = (await ad('/v4/magnet/files', key, form({ 'id[]': id }), opts?.priority))?.magnets?.[0]?.files ?? []
    const flat: { name: string; bytes: number; link: string }[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(function walk(ns: any[]) { for (const n of ns) { if (n.e) walk(n.e); else flat.push({ name: n.n, bytes: n.s ?? 0, link: n.l }) } })(tree)
    const best = pickVideoFile(flat, opts?.want)
    if (!best?.link) throw new Error('No playable file in that torrent.')
    const unlocked = await ad('/v4/link/unlock', key, form({ link: best.link }), opts?.priority)
    return unlocked.link ?? unlocked.download
  },
  async listItems(key) {
    if (!key) throw new Error('No AllDebrid API key set — add it in Settings → Sources → Playback.')
    const data = await ad('/v4.1/magnet/status', key, form({}))
    const arr = Array.isArray(data?.magnets) ? data.magnets : (data?.magnets ? [data.magnets] : [])
    return arr.map(adListItem)
  },
  async listFiles(key, item) {
    const data = await ad('/v4/magnet/files', key, form({ 'id[]': item.id }))
    return adFiles(data?.magnets?.[0]?.files ?? [])
  },
  async resolveFile(key, _item, file) {
    const unlocked = await ad('/v4/link/unlock', key, form({ link: file.id }))
    const url = unlocked.link ?? unlocked.download
    if (!url) throw new Error('AllDebrid returned no link for that file.')
    return url
  },
  async deleteItem(key, item) {
    await ad('/v4/magnet/delete', key, form({ id: String(item.id) }))
  },
  async checkCached(key, hashes) {
    if (!key || !hashes.length) return new Map()
    try {
      const isFresh = () => !!adOwnedCache && adOwnedCache.key === key
        && Date.now() - adOwnedCache.at < AD_OWNED_TTL
      if (!isFresh()) {
        // Single-flight, same reason as Real-Debrid's: the picker probes on every paint tick and
        // each miss used to launch another full account listing while one was already in flight.
        adOwnedFetch ??= (async () => {
          const data = await ad('/v4.1/magnet/status', key, form({ status: 'ready' }))
          adOwnedCache = { at: Date.now(), key, magnets: data?.magnets ?? null }
        })().finally(() => { adOwnedFetch = null })
        await adOwnedFetch
        if (!isFresh()) return new Map()
      }
      return adOwnedHashes(adOwnedCache!.magnets as never, hashes)
    } catch { return new Map() }
  },
}
