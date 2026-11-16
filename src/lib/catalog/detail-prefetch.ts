// A title's details fetched while its card has focus, so pressing it opens a page that is already
// filled: a source's details took ~0.5-1.8 s on the Steam Deck after the press. Each prefetch is used
// by one open within FRESH_MS and then dropped, so a later visit (back from the player, say) always
// reads progress afresh.
import type { Media } from '$lib/anilist/types'
import type { MediaRef } from './identity'
import { loadCatalogProvider } from './registry'

const FRESH_MS = 30_000
const prefetched = new Map<string, { at: number; detail: Promise<Media | null> }>()
const keyOf = (ref: MediaRef) => `${ref.provider}:${ref.type}:${ref.id}`

/** The title a catalog title page's address opens (`/app/media/<provider>/<type>/<id>`), or null. */
export function titleRefFromPath(pathname: string): MediaRef | null {
  const match = /^\/app\/media\/([^/]+)\/([^/]+)\/([^/]+)\/?$/.exec(pathname)
  if (!match || match[1] === 'anilist') return null
  try {
    return { provider: decodeURIComponent(match[1]), type: decodeURIComponent(match[2]), id: decodeURIComponent(match[3]) } as MediaRef
  } catch {
    return null
  }
}

export function prefetchDetail(ref: MediaRef, load = loadCatalogProvider, now = performance.now()): void {
  const provider = ref.provider
  if (provider === 'anilist') return
  for (const [key, entry] of prefetched) if (now - entry.at > FRESH_MS) prefetched.delete(key)
  const key = keyOf(ref)
  if (prefetched.has(key)) return
  const detail = load(provider).then((catalog) => catalog.detail(ref))
  detail.catch(() => prefetched.delete(key))
  prefetched.set(key, { at: now, detail })
}

/** The prefetched details for `ref`, at most once; undefined when there are none fresh enough. */
export function takePrefetchedDetail(ref: MediaRef, now = performance.now()): Promise<Media | null> | undefined {
  const key = keyOf(ref)
  const entry = prefetched.get(key)
  prefetched.delete(key)
  return entry && now - entry.at <= FRESH_MS ? entry.detail : undefined
}
