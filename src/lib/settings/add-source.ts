import { get } from 'svelte/store'
import { classifySourceSpec } from './classify-source-spec'
import { disabledExtensions, extensionUrls } from './ui'
import { addonUrls, disabledSources, normalizeBase } from '$lib/stremio/sources'
import { registerCatalogStore } from '$lib/store/feeds'
import { currentLegacyStores } from '$lib/store/origins'

/** `duplicate` marks a source that is already added, so a caller with other fallbacks (Settings'
 *  tracker-feed check) can report it as it is instead of trying something else. */
export type AddSourceResult = { kind: 'addon' | 'extension' } | { error: string; duplicate?: true }

/**
 * Adds a pasted add-on URL, GitHub repo or package catalog. Settings → Sources and first-run setup
 * both call this, so the two accept exactly the same input and record it the same way.
 */
export async function addSourceSpec(input: string): Promise<AddSourceResult> {
  const result = await classifySourceSpec(input)
  if ('error' in result) return result
  if (result.kind === 'addon') {
    if (get(extensionUrls).some((url) => url === result.spec || normalizeBase(url) === result.spec)) {
      return { error: "That's already added as a community source.", duplicate: true }
    }
    if (!get(addonUrls).some((url) => normalizeBase(url) === result.spec)) addonUrls.update((urls) => [...urls, result.spec])
    disabledSources.update((urls) => urls.filter((url) => url !== result.spec && normalizeBase(url) !== result.spec))
    return { kind: 'addon' }
  }
  if (get(addonUrls).some((url) => url === result.spec || normalizeBase(url) === normalizeBase(result.spec))) {
    return { error: "That's already added as an add-on.", duplicate: true }
  }
  if (get(extensionUrls).includes(result.spec)) {
    disabledExtensions.update((urls) => urls.filter((url) => url !== result.spec))
  } else {
    // Freeze the legacy stores first: a source added now never claims packages installed before
    // origins were recorded.
    currentLegacyStores()
    extensionUrls.update((urls) => [...urls, result.spec])
  }
  // A package catalog is also a store, so it shows up in the Store with its packages.
  if (result.catalog) registerCatalogStore(result.spec)
  return { kind: 'extension' }
}
