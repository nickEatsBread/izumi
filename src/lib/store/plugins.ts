import { loadListings } from './listings'
import type { InstallRef, StoreEntry } from './types'

export type PluginInstallRef = Extract<InstallRef, { type: 'plugin' }>

/** A plugin as listed by one store. The store URL is the plugin's install origin, so a plugin only
 *  ever updates from the store it came from. */
export interface PluginListing {
  entry: StoreEntry
  install: PluginInstallRef
  origin: string
  storeName: string
}

export function loadPluginListings(options: { force?: boolean } = {}) {
  return loadListings<PluginListing>((entry, store) => entry.install.type === 'plugin'
    ? { entry, install: entry.install, origin: store.url, storeName: store.name }
    : undefined, 'plugins', options)
}
