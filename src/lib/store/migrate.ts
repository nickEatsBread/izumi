import { persisted } from 'svelte-persisted-store'
import { get } from 'svelte/store'
import { disabledExtensions, extensionUrls } from '$lib/settings/ui'
import { registerCatalogStore } from './feeds'

/** Source-list entries already checked for being a package catalog (each is fetched once). */
export const examinedCatalogSpecs = persisted<string[]>('store-catalog-migration-v1', [])

type FetchInfo = (spec: string) => Promise<{ packages?: unknown[]; problem?: string }>

let running: Promise<number> | null = null

/** Catalogs added before stores existed become stores, so they show up in the Store. A spec whose
 *  fetch failed is retried next time; everything else is examined once. Overlapping calls (the Store
 *  page and the background check) share one run. Returns how many stores it added. */
export function migrateCatalogStores(fetchInfo?: FetchInfo): Promise<number> {
  // Theme listings moved to the Store's IndexedDB cache; the old localStorage copy (up to 1 MB) goes.
  try {
    localStorage.removeItem('theme-catalog-cache-v1')
  } catch {
    // No storage here: nothing to clean.
  }
  running ??= migrate(fetchInfo).finally(() => {
    running = null
  })
  return running
}

async function migrate(fetchInfo?: FetchInfo): Promise<number> {
  const pending = get(extensionUrls).filter((spec) => !get(examinedCatalogSpecs).includes(spec))
  if (!pending.length) return 0
  const info: FetchInfo = fetchInfo ?? (await import('$lib/extensions/manager')).fetchExtensionInfo
  let registered = 0
  for (const spec of pending) {
    let result: Awaited<ReturnType<FetchInfo>>
    try {
      result = await info(spec)
    } catch {
      continue
    }
    // Unreachable (network, server error, rate limit): try again next time. A 4xx answer is final.
    if (!result.packages && /could not be fetched|returned HTTP (?:5\d\d|429)/.test(result.problem ?? '')) continue
    // A catalog switched off on the Sources page stays switched off as a store.
    if (result.packages && registerCatalogStore(spec, !get(disabledExtensions).includes(spec))) registered += 1
    examinedCatalogSpecs.update((specs) => (specs.includes(spec) ? specs : [...specs, spec]))
  }
  return registered
}
