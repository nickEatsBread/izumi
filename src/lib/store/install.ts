import { get } from 'svelte/store'
import { addonUrls, disabledSources } from '$lib/stremio/sources'
import { normalizeBase } from '$lib/stremio/origin-id'
import { disabledExtensions, disabledPlugins, extensionUrls } from '$lib/settings/ui'
import type { ExtensionCatalogPackage } from '$lib/extensions/catalog'
import { recordPackageOrigin } from './origins'
import type { StoreAdapterId, StoreEntry } from './types'

// Installing a Store entry reuses the existing flows: addons → addonUrls, remote extensions →
// extensionUrls, packages → the Rust package installer, themes → the Themes page preview.

export type InstallOutcome =
  | { kind: 'installed'; message: string }
  | { kind: 'configure'; name: string; id: string; configureUrl: string }
  | { kind: 'open-theme'; path: string }

export interface InstallContext {
  /** URL of the store the entry came from ('' for the addon directory). */
  storeUrl: string
  adapter?: StoreAdapterId
}

export interface InstalledState {
  addonBases: readonly string[]
  /** Installed addon base by manifest id (a configured copy has a different URL). */
  addonBaseById: Readonly<Record<string, string>>
  extensionSpecs: readonly string[]
  packages: readonly { id: string }[]
  themes: readonly { id: string; origin: string }[]
}

/** Where an installed entry lives (addon base, extension spec, package id, theme id), or null. */
export function installedRef(entry: StoreEntry, state: InstalledState, storeUrl: string): string | null {
  const install = entry.install
  if (install.type === 'addon') {
    const base = normalizeBase(install.manifestUrl)
    return state.addonBaseById[entry.id] ?? (state.addonBases.includes(base) ? base : null)
  }
  if (install.type === 'extension') {
    if (state.extensionSpecs.includes(install.spec)) return install.spec
    // The whole store may have been added as one source (every provider in it runs).
    return storeUrl && state.extensionSpecs.includes(storeUrl) ? storeUrl : null
  }
  if (install.type === 'package') return state.packages.some((item) => item.id === install.pkg.id) ? install.pkg.id : null
  return state.themes.some((theme) => theme.id === install.release.id && theme.origin === storeUrl) ? install.release.id : null
}

const without = (list: string[], item: string) => list.filter((value) => value !== item)
const including = (list: string[], item: string) => (list.includes(item) ? list : [...list, item])

export async function installStoreEntry(
  entry: StoreEntry,
  context: InstallContext,
  installPackage: (pkg: ExtensionCatalogPackage) => Promise<{ id: string; name: string }>,
): Promise<InstallOutcome> {
  const install = entry.install
  if (install.type === 'addon') {
    if (install.configureUrl) return { kind: 'configure', name: entry.name, id: entry.id, configureUrl: install.configureUrl }
    const base = normalizeBase(install.manifestUrl)
    if (!base) throw new Error('This addon has an invalid address.')
    addonUrls.set(including(get(addonUrls), base))
    disabledSources.set(without(get(disabledSources), base))
    return { kind: 'installed', message: `${entry.name} installed and enabled.` }
  }
  if (install.type === 'extension') {
    extensionUrls.set(including(get(extensionUrls), install.spec))
    disabledExtensions.set(without(get(disabledExtensions), install.spec))
    return { kind: 'installed', message: `${entry.name} added to your sources.` }
  }
  if (install.type === 'package') {
    const installed = await installPackage(install.pkg)
    if (context.storeUrl) recordPackageOrigin(installed.id, context.storeUrl)
    // Classic catalogs also join the source list, as Store installs always did, so their packages
    // keep their catalog row on the Sources page. Native stores are not source documents.
    if (context.storeUrl && (context.adapter === 'izumi-ext-catalog' || context.adapter === 'aniyomi-index')) {
      extensionUrls.set(including(get(extensionUrls), context.storeUrl))
      disabledExtensions.set(without(get(disabledExtensions), context.storeUrl))
    }
    disabledPlugins.set(without(get(disabledPlugins), installed.id))
    return { kind: 'installed', message: `${installed.name} installed and enabled.` }
  }
  return {
    kind: 'open-theme',
    path: `/app/settings/themes?store=${encodeURIComponent(entry.storeId)}&theme=${encodeURIComponent(install.release.id)}`,
  }
}
