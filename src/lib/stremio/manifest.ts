import { phttp } from '$lib/net/http'

// Fetches a Stremio addon's manifest.json (name/description/logo/version) so the
// Sources settings list and the source picker can show a real addon identity
// instead of a raw URL. Uses the Tauri HTTP plugin (bypasses CORS, follows
// http→https). Per-session cached by normalized base.

// A Stremio addon resource: a bare name ('stream' | 'subtitles' | 'meta' | 'catalog') or an object
// carrying its own accepted types/id-prefixes.
export type AddonResource = string | { name: string; types?: string[]; idPrefixes?: string[] }

export interface AddonManifest {
  id: string
  name: string
  version: string
  description?: string
  logo?: string
  background?: string
  // What the addon serves + which id namespaces it accepts (used to route subtitle queries).
  resources?: AddonResource[]
  idPrefixes?: string[]
  types?: string[]
}

/** Would this addon answer a `stream` request for `type` + `id`? Read from the manifest's own
 *  declaration, per-resource first and falling back to the top-level fields.
 *
 *  Nothing gated stream dispatch before, so every configured addon was asked for every id
 *  regardless of what it said it serves — a meta-only or imdb-only addon answered nothing and
 *  still spent the picker's patience waiting for it. Unknowns are always accepted: an addon that
 *  declares no prefixes, or whose manifest we could not fetch, must never be skipped on a guess. */
export function acceptsStreamId(m: AddonManifest | null, type: string, id: string): boolean {
  const resources = m?.resources
  if (!resources?.length) return true // no declaration to gate on
  const matches = (types: string[] | undefined, prefixes: string[] | undefined) =>
    (!types?.length || types.includes(type)) && (!prefixes?.length || prefixes.some((p) => id.startsWith(p)))
  for (const r of resources) {
    if (typeof r === 'string') {
      if (r === 'stream' && matches(m?.types, m?.idPrefixes)) return true
    } else if (r.name === 'stream' && matches(r.types ?? m?.types, r.idPrefixes ?? m?.idPrefixes)) return true
  }
  // The manifest listed what it serves and this was not on it — either no stream resource at all
  // (a meta-only addon) or one that does not cover this type or id namespace.
  return false
}

const cache = new Map<string, Promise<AddonManifest | null>>()

export function fetchManifest(base: string): Promise<AddonManifest | null> {
  let b = base.trim().replace(/^http:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b
  b = b.replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '')
  if (!cache.has(b)) {
    const request = (async () => {
      try {
        const r = await phttp(`${b}/manifest.json`)
        if (!r.ok) return null
        return (await r.json()) as AddonManifest
      } catch { return null }
    })()
    cache.set(b, request)
    // Coalesce concurrent requests, but do not turn a transient network/parse failure into a
    // session-long miss. Successful manifests remain cached for the session as before.
    void request.then((manifest) => {
      if (manifest === null && cache.get(b) === request) cache.delete(b)
    })
  }
  return cache.get(b)!
}
