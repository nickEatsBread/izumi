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

const cache = new Map<string, Promise<AddonManifest | null>>()

export function fetchManifest(base: string): Promise<AddonManifest | null> {
  let b = base.trim().replace(/^http:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b
  b = b.replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '')
  if (!cache.has(b)) {
    cache.set(b, (async () => {
      try {
        const r = await phttp(`${b}/manifest.json`)
        if (!r.ok) return null
        return (await r.json()) as AddonManifest
      } catch { return null }
    })())
  }
  return cache.get(b)!
}
