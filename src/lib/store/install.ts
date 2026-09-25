import { get } from 'svelte/store'
import { addonUrls, disabledSources } from '$lib/stremio/sources'
import { normalizeBase } from '$lib/stremio/origin-id'
import { disabledPlugins, extensionUrls, disabledExtensions } from '$lib/settings/ui'
import type { ExtensionCatalogPackage } from '$lib/extensions/catalog'
import { packageOrigins, recordPackageOrigin } from './origins'
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
  /** The package id is already installed, from somewhere this store can't claim. */
  installedElsewhere?: boolean
}

export interface InstalledState {
  addonBases: readonly string[]
  /** Installed addon base by manifest id (a configured copy has a different URL). */
  addonBaseById: Readonly<Record<string, string>>
  extensionSpecs: readonly string[]
  packages: readonly { id: string }[]
  /** Which store each installed package came from. */
  packageOrigins: Readonly<Record<string, string>>
  /** Stores that may claim packages installed before origins were recorded: the official catalog and
   *  the catalogs in the source list — the only places those installs could have come from. */
  legacyStores: readonly string[]
  themes: readonly { id: string; origin: string }[]
}

/** Own properties only: ids such as `constructor` must never resolve through the prototype. */
function own(record: Readonly<Record<string, string>>, key: string | undefined): string | undefined {
  return key !== undefined && Object.hasOwn(record, key) ? record[key] : undefined
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : ''
  } catch {
    return ''
  }
}

/** Where an installed entry lives (addon base, extension spec, package id, theme id), or null. A
 *  package counts as installed from this store only when this store is where it came from. */
export function installedRef(entry: StoreEntry, state: InstalledState, storeUrl: string): string | null {
  const install = entry.install
  if (install.type === 'addon') {
    const base = normalizeBase(install.manifestUrl)
    // A listing names its own manifest id, so the id alone never proves which installed addon it is:
    // the installed copy must also live on the listing's host (a configured copy keeps its host).
    const byId = own(state.addonBaseById, install.manifestId)
    const host = hostOf(byId)
    if (byId && host && (host === hostOf(install.manifestUrl) || host === hostOf(install.configureUrl))) return byId
    return state.addonBases.includes(base) ? base : null
  }
  if (install.type === 'extension') {
    if (state.extensionSpecs.includes(install.spec)) return install.spec
    // The whole store may have been added as one source (every provider in it runs).
    return storeUrl && state.extensionSpecs.includes(storeUrl) ? storeUrl : null
  }
  if (install.type === 'package') {
    if (!state.packages.some((item) => item.id === install.pkg.id)) return null
    const origin = own(state.packageOrigins, install.pkg.id)
    return (origin ? origin === storeUrl : state.legacyStores.includes(storeUrl)) ? install.pkg.id : null
  }
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
    if (install.configureUrl) {
      return { kind: 'configure', name: entry.name, id: install.manifestId ?? entry.id, configureUrl: install.configureUrl }
    }
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
    const origin = own(get(packageOrigins), install.pkg.id)
    // A package only ever changes through the store it came from; a same-id package elsewhere is a
    // takeover, not an update.
    if ((origin && origin !== context.storeUrl) || (!origin && context.installedElsewhere)) {
      throw new Error('This package is installed from another store. Remove it there first.')
    }
    const installed = await installPackage(install.pkg)
    if (context.storeUrl) recordPackageOrigin(installed.id, context.storeUrl)
    // Classic catalogs also join the source list, as Store installs always did, so their packages keep
    // their catalog row on the Sources page. A catalog the user switched off stays off.
    if (context.storeUrl && (context.adapter === 'izumi-ext-catalog' || context.adapter === 'aniyomi-index')) {
      extensionUrls.set(including(get(extensionUrls), context.storeUrl))
    }
    disabledPlugins.set(without(get(disabledPlugins), installed.id))
    return { kind: 'installed', message: `${installed.name} installed and enabled.` }
  }
  return {
    kind: 'open-theme',
    path: `/app/settings/themes?store=${encodeURIComponent(entry.storeId)}&theme=${encodeURIComponent(install.release.id)}`,
  }
}
