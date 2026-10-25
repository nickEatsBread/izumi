/** Connects pack sessions to the real app: the Store's loaders and installers, themes, modules and
 *  the startup animation. Every install goes through the same paths a Store install takes. */
import { getVersion } from '@tauri-apps/api/app'
import { get } from 'svelte/store'
import { getLocale } from '$lib/paraglide/runtime.js'
import { phttp } from '$lib/net/http'
import { installCatalogPackage, installedExtensionPackages, removeInstalledExtension } from '$lib/extensions/manager'
import { releaseModule, refreshModules, requestModule } from '$lib/modules/modules'
import { activeStudioThemeId } from '$lib/settings/theme-studio'
import { extensionUrls, themePreset } from '$lib/settings/ui'
import { clearStartupAnimation, setStartupAnimation } from '$lib/startup/animation'
import { addStore, allStores, removeStore, storeIdForUrl, storeName, type StoreFeed } from '$lib/store/feeds'
import { installStoreEntry } from '$lib/store/install'
import { loadStore } from '$lib/store/load'
import { loadStoreAndPin } from '$lib/store/service'
import { normalizeBase } from '$lib/stremio/origin-id'
import { addonUrls } from '$lib/stremio/sources'
import { prepareRelease } from '$lib/themes/catalog'
import { applyInstalledTheme, installTheme, installedThemes, removeInstalledTheme } from '$lib/themes/installed'
import { forgetPackRecord, installedPacks, savePackRecord, type PackRecordItem } from './installed'
import type { Installed, ListingSummary, PackDeps } from './session'

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function loadListing(url: string): Promise<ListingSummary> {
  const known = get(allStores).find((store) => store.url === url)
  const feed: StoreFeed = known ?? { id: storeIdForUrl(url), url, name: url, enabled: true, addedAt: Date.now() }
  // A store already on the device is checked against its pinned key; a new one is only previewed
  // (nothing saved) until the user sets the pack up.
  const result = known ? await loadStoreAndPin(feed, { force: true }) : await loadStore(feed, { force: true, save: false })
  if (result.trust.state === 'locked') throw new Error("its signature doesn't match its key")
  if (!result.listing) throw new Error(result.error ?? 'no listing')
  return {
    name: storeName(result.listing.name, url),
    signed: result.trust.state === 'signed',
    ...(result.trust.state === 'signed' ? { fingerprint: result.trust.fingerprint } : {}),
    adapter: result.listing.adapter,
    entries: result.listing.entries,
  }
}

const without = (list: string[], item: string) => list.filter((value) => value !== item)

async function removeItem(item: PackRecordItem): Promise<void> {
  if (item.install === 'package') await removeInstalledExtension(item.installedId)
  else if (item.install === 'addon') addonUrls.set(without(get(addonUrls), item.installedId))
  else if (item.install === 'extension') extensionUrls.set(without(get(extensionUrls), item.installedId))
  else removeInstalledTheme(item.installedId)
}

export const defaultPackDeps: PackDeps = {
  async fetchText(url, maxBytes) {
    const response = await phttp(url, { maxBytes, timeoutMs: 20_000 })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.text()
  },
  sha256: sha256Hex,
  appVersion: () => getVersion(),
  locale: () => getLocale(),
  knownStores: () => get(allStores).map((store) => store.url),
  loadListing,
  modules: () => refreshModules(),
  addStore(url, name, fingerprint) {
    if (!get(allStores).some((store) => store.url === url)) addStore(url, name, fingerprint)
  },
  removeStore: (url) => removeStore(storeIdForUrl(url)),
  async installSource(entry, storeUrl, adapter): Promise<Installed> {
    const install = entry.install
    let installedId: string
    let existed: boolean
    if (install.type === 'package') {
      installedId = install.pkg.id
      existed = (await installedExtensionPackages()).some((pkg) => pkg.id === installedId)
    } else if (install.type === 'addon') {
      installedId = normalizeBase(install.manifestUrl)
      existed = get(addonUrls).includes(installedId)
    } else if (install.type === 'extension') {
      installedId = install.spec
      existed = get(extensionUrls).includes(installedId)
    } else {
      throw new Error(`${entry.name} is a theme, not a source.`)
    }
    const outcome = await installStoreEntry(entry, { storeUrl, adapter, update: existed }, installCatalogPackage)
    if (outcome.kind === 'configure') throw new Error(`${entry.name} has to be configured first.`)
    const item: PackRecordItem = { ref: '', kind: 'source', install: install.type, installedId, name: entry.name, store: storeUrl, added: !existed }
    return { installedId, name: entry.name, added: !existed, undo: existed ? undefined : () => removeItem(item) }
  },
  async installTheme(entry, storeUrl, apply): Promise<Installed> {
    if (entry.install.type !== 'theme') throw new Error(`${entry.name} is not a theme.`)
    const release = entry.install.release
    const before = { preset: get(themePreset), active: get(activeStudioThemeId) }
    let item = get(installedThemes).find((theme) => theme.id === release.id && theme.origin === storeUrl)
    const added = !item
    if (!item || item.package.version !== release.version) {
      item = installTheme(await prepareRelease(release, storeUrl))
    }
    if (apply) applyInstalledTheme(item)
    const id = item.id
    return {
      installedId: id,
      name: entry.name,
      added,
      undo: async () => {
        if (added) removeInstalledTheme(id)
        activeStudioThemeId.set(before.active)
        themePreset.set(before.preset)
      },
    }
  },
  removeItem,
  requestModule: async (id, by) => { await requestModule(id, by) },
  releaseModule: (id, by) => releaseModule(id, by),
  setStartup: async (video, by) => { await setStartupAnimation(video, by) },
  clearStartup: (by) => clearStartupAnimation(by),
  installedPacks: () => get(installedPacks),
  saveRecord: savePackRecord,
  forgetRecord: forgetPackRecord,
  now: () => Date.now(),
}
