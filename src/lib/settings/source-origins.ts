// Human names for the opaque ORIGIN IDS the source-priority setting stores.
//
// The trust order keeps ids, not URLs — an addon's is a hash of its configured URL, so the API key
// inside it is never copied into the setting. That makes the stored order unreadable on its own,
// and both the summary on the Sources page and the reorder screen need the same name lookup, so it
// lives here rather than in either page.

import { derived, type Readable } from 'svelte/store'
import { addonOriginId, enabledAddonUrls } from '$lib/stremio/sources'
import { disabledPlugins, enabledExtensionUrls } from '$lib/settings/ui'
import { fetchManifest } from '$lib/stremio/manifest'
import {
  fetchExtensionMeta,
  installedExtensionPackages,
  type InstalledExtensionPackage,
} from '$lib/extensions/manager'

export type PriorityCandidate = {
  id: string
  name: string
  kind: 'Addon' | 'Extension'
  /** The package an Aniyomi source came from, so the package's own off-switch also hides it. */
  owner?: string
}

const host = (url: string) => {
  try { return new URL(/^https?:/.test(url) ? url : `https://${url}`).hostname } catch { return url }
}

/**
 * One row per RUNNABLE origin. A JS package runs under its own id, but an Aniyomi package runs one
 * JVM source per id it ships — and the source id, not the package id, is what a stream carries, so
 * that is what an entry has to store or it would never match.
 */
export function packageOrigins(extension: InstalledExtensionPackage): PriorityCandidate[] {
  if (extension.backend !== 'aniyomi-jvm') {
    return [{ id: extension.id, name: extension.name, kind: 'Extension' }]
  }
  const ids = (extension.sourceIds?.length ? extension.sourceIds : [extension.sourceId]).filter(Boolean)
  return ids.map((id, i) => ({
    id,
    name: ids.length > 1 ? `${extension.name} · source ${i + 1}` : extension.name,
    kind: 'Extension',
    owner: extension.id,
  }))
}

const dedupe = (rows: PriorityCandidate[]) => [...new Map(rows.map((c) => [c.id, c])).values()]

/**
 * Every source that can actually answer a request, named. A switched-off addon or plugin is not
 * something to express a preference about, so it is left out.
 *
 * Emits progressively and never blocks: addons appear immediately under their hostname and swap to
 * their manifest name as those settle (fetchManifest is session-cached by base, so subscribing adds
 * no request), and extensions fill in after their local enumeration.
 */
export const priorityCandidates: Readable<PriorityCandidate[]> = derived(
  [enabledAddonUrls, enabledExtensionUrls, disabledPlugins],
  ([urls, specs, off], set) => {
    let stale = false
    const offIds = new Set(off)
    const addons: PriorityCandidate[] = urls.map((url) => ({
      id: addonOriginId(url),
      name: host(url),
      kind: 'Addon',
    }))
    let extensions: PriorityCandidate[] = []
    const emit = () => {
      if (stale) return
      set(dedupe([
        ...addons,
        ...extensions.filter((c) => !offIds.has(c.id) && !offIds.has(c.owner ?? c.id)),
      ]))
    }
    emit()

    urls.forEach((url, i) => {
      void fetchManifest(url).then((manifest) => {
        if (stale || !manifest?.name) return
        addons[i] = { ...addons[i], name: manifest.name }
        emit()
      }).catch(() => { /* the hostname stands in */ })
    })

    void Promise.all([
      installedExtensionPackages(),
      Promise.all(specs.map((spec) => fetchExtensionMeta(spec))),
    ]).then(([installed, manifests]) => {
      extensions = [
        ...manifests.flat().map((config): PriorityCandidate => ({
          id: config.id,
          name: config.name,
          kind: 'Extension',
        })),
        ...installed.flatMap(packageOrigins),
      ]
      emit()
    }).catch(() => { /* an unreachable manifest just contributes no rows */ })

    return () => { stale = true }
  },
  [] as PriorityCandidate[],
)
