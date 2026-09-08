import { cloudSubtitleServices } from '$lib/stremio/subtitles'
import { get, type Readable } from 'svelte/store'
import { profileHousehold } from '$lib/profiles/store'
import { catalogScreen, enabledCatalogScreens, tmdbReadToken } from '$lib/settings/catalog'
import {
  debridKey, debridProvider, hideSpoilers, preferredAudioLang, preferredQuality, preferredStreamSort, showAdult,
  enabledSubtitleProviders, preferredSubLang, cloudSubtitleSession, subtitleStyleEnabled, subtitleOverrideScope,
  subtitleFont, subtitleBold, subtitleFontSize, subtitleTextColor, subtitleBorderColor, subtitleBorderSize,
  subtitleShadow, subtitlePosition, sourcePriority, sourcePriorityMode,
} from '$lib/settings/ui'
import { enabledAddonUrls } from '$lib/stremio/sources'
import { providerMeta } from '$lib/stremio/debrid'
import type { CloudflareResolverProfile } from '$lib/sync/cloudflare'
import { cloudflareAllowLanSources } from '$lib/sync/cloudflare'
import { homeCollections } from '$lib/catalog/collections/store'

/** Build the Worker's opt-in profile from the same stores used by normal Izumi playback/browsing. */
export function currentCloudflareCompanionProfile(connectedDeviceFallback: boolean): CloudflareResolverProfile {
  const key = get(debridKey).trim()
  const provider = get(debridProvider)
  return {
    enabled: true,
    collections: get(homeCollections),
    household: get(profileHousehold),
    addons: [...get(enabledAddonUrls)],
    subtitleServices: cloudSubtitleServices(),
    subtitleLang: get(preferredSubLang),
    subtitleStyle: {
      enabled: get(subtitleStyleEnabled), scope: get(subtitleOverrideScope), font: get(subtitleFont),
      bold: get(subtitleBold), fontSize: get(subtitleFontSize), textColor: get(subtitleTextColor),
      borderColor: get(subtitleBorderColor), borderSize: get(subtitleBorderSize), shadow: get(subtitleShadow), position: get(subtitlePosition),
    },
    quality: get(preferredQuality),
    sort: get(preferredStreamSort),
    audioLang: get(preferredAudioLang),
    // Origin-id fingerprints, never URLs: the Worker recognises its own configured add-ons by the
    // same ids, so the desktop trust order carries to the TV without copying credentials.
    sourcePriority: [...get(sourcePriority)],
    sourcePriorityMode: get(sourcePriorityMode),
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
    enabledSubtitleProviders, preferredSubLang, cloudSubtitleSession, subtitleStyleEnabled, subtitleOverrideScope, subtitleFont, subtitleBold, subtitleFontSize, subtitleTextColor, subtitleBorderColor, subtitleBorderSize, subtitleShadow, subtitlePosition,
    enabledAddonUrls, preferredQuality, preferredStreamSort, preferredAudioLang, sourcePriority, sourcePriorityMode,
    debridProvider, debridKey, enabledCatalogScreens, catalogScreen, tmdbReadToken,
    showAdult, hideSpoilers,
    cloudflareAllowLanSources,
    profileHousehold,
    homeCollections,
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
