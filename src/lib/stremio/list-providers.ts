export type ListProviderId = 'trakt' | 'mdblist'

export interface ListProvider {
  id: ListProviderId
  name: string
  description: string
  addonId: string
  base: string
  configureUrl: string
  accent: string
  initials: string
}

/** First-class account entry points backed by each service's Stremio list add-on. The configured
 * manifest stays private on this device and its catalogs are adapted into optional Home rows. */
export const LIST_PROVIDERS: readonly ListProvider[] = [
  {
    id: 'trakt',
    name: 'Trakt',
    description: 'Watchlist, recommendations, history, and personal or public lists.',
    addonId: 'community.trakt-tv',
    base: 'https://2ecbbd610840-trakt.baby-beamup.club',
    configureUrl: 'https://2ecbbd610840-trakt.baby-beamup.club/configure/',
    accent: 'bg-[#ed1c24]/15 text-[#ff4f56]',
    initials: 'T',
  },
  {
    id: 'mdblist',
    name: 'MDBList',
    description: 'Your dynamic, ranked, and curated movie and series lists.',
    addonId: 'com.mdblist.lists',
    base: 'https://1fe84bc728af-stremio-mdblist.baby-beamup.club',
    configureUrl: 'https://1fe84bc728af-stremio-mdblist.baby-beamup.club/configure',
    accent: 'bg-[#f5c518]/15 text-[#f5c518]',
    initials: 'MDB',
  },
] as const

export function listProviderByAddonId(addonId: string): ListProvider | undefined {
  return LIST_PROVIDERS.find((provider) => provider.addonId === addonId)
}

/** Recognize an existing configured URL even before its manifest has loaded. Configured variants
 * keep the public add-on's origin and put the private configuration in the path/query. */
export function listProviderOwnsUrl(provider: ListProvider, value: string): boolean {
  try {
    return new URL(value).origin === new URL(provider.base).origin
  } catch {
    return false
  }
}
