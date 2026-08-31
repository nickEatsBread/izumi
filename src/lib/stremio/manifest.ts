import { phttp } from '$lib/net/http'
import { acceptsStreamId, type AddonManifest } from './manifest-capability'

export { acceptsStreamId } from './manifest-capability'
export type { AddonCatalog, AddonCatalogExtra, AddonManifest, AddonResource } from './manifest-capability'

// Fetches a Stremio addon's manifest.json (name/description/logo/version) so the
// Sources settings list and the source picker can show a real addon identity
// instead of a raw URL. Uses the Tauri HTTP plugin (bypasses CORS, follows
// http→https). Per-session cached by normalized base.

const cache = new Map<string, Promise<AddonManifest | null>>()
const resolved = new Map<string, AddonManifest>()

function manifestBase(base: string): string {
  let b = base.trim().replace(/^http:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b
  return b.replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '')
}

/** Synchronous view of a successfully fetched manifest. Stream dispatch must not await an unknown
 * manifest, but when boot/settings already warmed it this lets the declared id prefixes gate the
 * request fan-out before the cached Promise's callback gets its next microtask. */
export function peekManifest(base: string): AddonManifest | undefined {
  return resolved.get(manifestBase(base))
}

export function fetchManifest(base: string): Promise<AddonManifest | null> {
  const b = manifestBase(base)
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
      if (manifest) resolved.set(b, manifest)
      else if (cache.get(b) === request) {
        cache.delete(b)
        resolved.delete(b)
      }
    })
  }
  return cache.get(b)!
}
