import { jfetch, magnetOf, VIDEO, authError } from '../http'
import { pickVideoFile } from '../episode-file'
import { selectSidecars, sidecarLanguage, sidecarTitle } from '../sidecar-subs'
import type { DebridProvider, DebridSidecar } from '../types'

// EasyDebrid. Cache-only: the API has no account library, no transfer queue and no status
// endpoint, so a resolve either hands back every file's direct URL at once or fails — nothing
// here polls, and there is no Cloud listing to expose. POST /link/lookup answers the pure cache
// question and creates nothing; POST /link/generate mints the per-file URLs.
//
// `Accept: application/json` is load-bearing, not politeness. Without it an unauthenticated call
// is answered with a 302 to the login page (which lands on a 419 HTML "Page Expired"), so a wrong
// key arrives as unparseable HTML and the auth classifier never sees it. With the header the same
// call answers 401 {"message":"Unauthenticated."}. Probed live on 2026-08-01.

const BASE = 'https://easydebrid.com/api/v1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ed(method: string, path: string, key: string, body?: unknown, priority?: boolean): Promise<any> {
  const { ok, status, json } = await jfetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    priority,
  })
  // Two error shapes to fold together: the framework's auth envelope ({message}, with the status)
  // and the service's own ({error}, e.g. "Account not premium." for a lapsed subscription — which
  // arrives on a 200, so the body has to be inspected even when the request "succeeded").
  const msg = json?.error ?? json?.message
  if (!ok || json?.error) {
    throw new Error(authError('EasyDebrid', { status, message: msg }) ?? msg ?? `EasyDebrid request failed (${status}).`)
  }
  return json
}

export interface EdFile { name: string; bytes: number; url: string }

/** Pure map of a /link/generate payload to the {name,bytes} shape the episode picker wants.
 *  `directory` is the in-torrent folder chain, folded back onto the filename so the name here is
 *  the path the torrent actually has. Entries without a URL are dropped — a file we cannot play
 *  must not be able to win the pick. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function edFiles(generated: any): EdFile[] {
  const raw: unknown[] = Array.isArray(generated?.files) ? generated.files : []
  return raw
    .map((f): EdFile => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const o = f as any
      const dirs: string[] = Array.isArray(o?.directory) ? o.directory.filter(Boolean) : []
      return { name: [...dirs, o?.filename ?? ''].join('/'), bytes: o?.size ?? 0, url: o?.url ?? '' }
    })
    .filter((f) => !!f.url)
}

/** Pure: is the one URL we asked about already in the cache? `cached` is positional against the
 *  request's `urls`, so index 0 is ours. Every other shape (no array, short array, a truthy
 *  non-boolean) reads as NOT cached — this gates the noAdd path, so it has to fail closed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function edCached(lookup: any): boolean {
  return Array.isArray(lookup?.cached) && lookup.cached[0] === true
}

/** Map the positional lookup response back to the requested hashes. A malformed or short response
 * leaves missing positions unknown instead of claiming they are uncached. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function edCacheMap(lookup: any, hashes: string[]): Map<string, 'cached' | 'uncached'> {
  const out = new Map<string, 'cached' | 'uncached'>()
  if (!Array.isArray(lookup?.cached)) return out
  for (let i = 0; i < Math.min(hashes.length, lookup.cached.length); i++) {
    if (typeof lookup.cached[i] === 'boolean') {
      out.set(hashes[i].toLowerCase(), lookup.cached[i] ? 'cached' : 'uncached')
    }
  }
  return out
}

/** Only the video files. pickVideoFile falls back to the largest entry of ANY kind when nothing
 *  matches the video regex, and an EasyDebrid response always carries posters and subtitles
 *  alongside the episode — without this the fallback could hand libmpv a .jpg. */
const videosOf = (files: EdFile[]) => files.filter((f) => VIDEO.test(f.name))

// The sidecar pass runs on the SAME magnet a second or two after the resolve, and one generate
// already answers with every file's URL — so the two were byte-identical requests for one payload.
// Kept here for the sidecar path to pick up, and deliberately for that path ONLY: a stale signed
// URL handed to the player is a playback failure, while a stale subtitle URL is a subtitle that
// doesn't attach, which resolveSidecars already swallows. One entry, because the only reader wants
// the resolve that just happened; the key is in it so a mid-session key change can't be served an
// URL signed for the old account.
const GENERATE_MEMO_MS = 60_000
let lastGenerate: { key: string; magnet: string; at: number; files: EdFile[] } | null = null

/** POST /link/generate, keeping the payload for the sidecar pass that follows. */
async function generateFiles(key: string, magnet: string, priority?: boolean): Promise<EdFile[]> {
  const files = edFiles(await ed('POST', '/link/generate', key, { url: magnet }, priority))
  lastGenerate = { key, magnet, at: Date.now(), files }
  return files
}

const recallGenerate = (key: string, magnet: string): EdFile[] | null =>
  lastGenerate && lastGenerate.key === key && lastGenerate.magnet === magnet
  && Date.now() - lastGenerate.at < GENERATE_MEMO_MS
    ? lastGenerate.files
    : null

export const easydebrid: DebridProvider = {
  id: 'easydebrid',
  name: 'EasyDebrid',
  keyHint: 'easydebrid.com dashboard — the "API Key" card',
  credential: 'apikey',
  cacheCheck: 'native',
  async checkCached(key, hashes) {
    if (!key || !hashes.length) return new Map()
    const urls = hashes.map((hash) => magnetOf(hash))
    return edCacheMap(await ed('POST', '/link/lookup', key, { urls }), hashes)
  },
  async resolveHash(key, hashOrMagnet, opts) {
    if (!key) throw new Error('No EasyDebrid API key set — add it in Settings → Extensions.')
    const magnet = magnetOf(hashOrMagnet)
    // /link/generate is the only route to a playable URL, and on an uncached release it is
    // believed to be what makes the service start caching it — the vendor docs only show the
    // cached case, so that behaviour is assumed rather than documented, which is exactly why the
    // guard below is the conservative one. /link/lookup answers the cache question and creates
    // nothing, so a background prefetch asks that first and declines rather than starting work the
    // user never asked for.
    if (opts?.noAdd && !edCached(await ed('POST', '/link/lookup', key, { urls: [magnet] }, opts?.priority))) {
      throw new Error("EasyDebrid needs to cache this release, which background prefetch isn't allowed to do.")
    }
    // Never from the memo: this URL goes straight to the player.
    const files = await generateFiles(key, magnet, opts?.priority)
    if (!files.length) {
      throw new Error('EasyDebrid has no cached copy of this release yet — pick a different source, or try this one again in a moment.')
    }
    const best = pickVideoFile(videosOf(files), opts?.want)
    if (!best) throw new Error('No playable file in that torrent.')
    return best.url
  },
  /** External `.ass`/`.srt` sidecars belonging to the episode `resolveHash` just picked. One
   *  /link/generate already returns every file's URL, so — unlike services that must create an
   *  account entry per subtitle — there is no per-sidecar cost to cap here, and in the normal case
   *  no request either: the resolve that preceded this left the payload behind. Never throws. */
  async resolveSidecars(key, hashOrMagnet, opts): Promise<DebridSidecar[]> {
    // A prefetch may have been refused the cache it would need, and resolveHash runs first
    // anyway, so there is nothing for a noAdd caller to attach subtitles to.
    if (!key || opts?.noAdd) return []
    const magnet = magnetOf(hashOrMagnet)
    let files = recallGenerate(key, magnet)
    if (!files) {
      try { files = await generateFiles(key, magnet) }
      catch { return [] }
    }
    const chosen = pickVideoFile(videosOf(files), opts?.want)
    if (!chosen) return []
    return selectSidecars(files, chosen).map((sub) => ({
      url: sub.url,
      name: sub.name,
      lang: sidecarLanguage(sub.name),
      title: sidecarTitle(chosen.name, sub.name),
    }))
  },
}
