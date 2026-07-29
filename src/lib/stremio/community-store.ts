import { phttp } from '$lib/net/http'
import type { AddonManifest } from './manifest'

const API = 'https://stremio-addons.net/api/v0'

export interface CommunityAddon {
  uuid: string
  slug: string
  manifestUrl: string
  configureUrl: string | null
  stars: number
  categories: { name: string; slug: string }[]
  createdAt: string
  manifest: AddonManifest & { behaviorHints?: { adult?: boolean } }
}

export interface CommunityAddonPage {
  addons: CommunityAddon[]
  pagination: { page: number; total: number; totalPages: number; hasNextPage: boolean }
}

export interface CommunityQuery {
  search?: string
  page?: number
  limit?: number
  category?: string
  sort?: 'stars' | 'new'
}

export function communityStoreUrl(query: CommunityQuery = {}): string {
  const params = new URLSearchParams()
  params.set('page', String(Math.max(1, query.page ?? 1)))
  params.set('limit', String(Math.max(1, Math.min(50, query.limit ?? 30))))
  params.set('nsfw', 'exclude')
  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.category) params.append('category', query.category)
  params.set('sort_by', query.sort === 'new' ? 'createdAt' : 'stars')
  params.set('order', 'desc')
  return `${API}/addons?${params}`
}

const cache = new Map<string, Promise<CommunityAddonPage>>()

/** Read-only community directory. Installation remains a local Izumi choice; no credentials or
 * installed-source list are ever sent to the directory. */
export function listCommunityAddons(query: CommunityQuery = {}): Promise<CommunityAddonPage> {
  const url = communityStoreUrl(query)
  const hit = cache.get(url)
  if (hit) return hit
  const request = (async () => {
    const response = await phttp(url)
    if (!response.ok) throw new Error(`The community source directory returned HTTP ${response.status}.`)
    const page = await response.json() as CommunityAddonPage
    return {
      ...page,
      addons: (page.addons ?? []).filter((addon) =>
        !!addon?.manifestUrl
        && !!addon.manifest?.id
        && !addon.manifest.behaviorHints?.adult),
    }
  })()
  cache.set(url, request)
  void request.catch(() => cache.delete(url))
  return request
}
