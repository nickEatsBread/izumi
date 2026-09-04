import { get, type Readable } from 'svelte/store'
import { catalogScreen, enabledCatalogScreens, tmdbReadToken } from '$lib/settings/catalog'
import { debridKey, debridProvider, hideSpoilers, preferredAudioLang, preferredQuality, preferredStreamSort, showAdult } from '$lib/settings/ui'
import { enabledAddonUrls } from '$lib/stremio/sources'
import { providerMeta } from '$lib/stremio/debrid'
import type { CloudflareResolverProfile } from '$lib/sync/cloudflare'
import { cloudflareAllowLanSources } from '$lib/sync/cloudflare'

/** Build the Worker's opt-in profile from the same stores used by normal Izumi playback/browsing. */
export function currentCloudflareCompanionProfile(connectedDeviceFallback: boolean): CloudflareResolverProfile {
  const key = get(debridKey).trim()
  const provider = get(debridProvider)
  return {
    enabled: true,
    addons: [...get(enabledAddonUrls)],
    quality: get(preferredQuality),
    sort: get(preferredStreamSort),
    audioLang: get(preferredAudioLang),
    connectedDeviceFallback,
    allowPrivateNetworkSources: get(cloudflareAllowLanSources),
    debrid: key && providerMeta(provider) ? { provider, credential: key } : null,
    catalog: {
      screens: [...get(enabledCatalogScreens)],
      defaultScreen: get(catalogScreen),
      showAdult: get(showAdult),
      hideSpoilers: get(hideSpoilers),
      tmdbToken: get(tmdbReadToken).trim(),
    },
  }
}

/** Debounce all source/catalog settings into one free-tier-friendly profile update. */
export function watchCloudflareCompanionProfile(onChange: () => void): () => void {
  const stores: Readable<unknown>[] = [
    enabledAddonUrls, preferredQuality, preferredStreamSort, preferredAudioLang,
    debridProvider, debridKey, enabledCatalogScreens, catalogScreen, tmdbReadToken,
    showAdult, hideSpoilers,
    cloudflareAllowLanSources,
  ]
  let primed = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const unsubscribers = stores.map((store) => store.subscribe(() => {
    if (primed < stores.length) { primed += 1; return }
    clearTimeout(timer)
    timer = setTimeout(onChange, 1_200)
  }))
  return () => {
    clearTimeout(timer)
    unsubscribers.forEach((unsubscribe) => unsubscribe())
  }
}
