import { persisted } from 'svelte-persisted-store'
import { derived } from 'svelte/store'
import { normalizeBase } from './origin-id'

// Canonical URL + origin-id helpers live in origin-id.ts (vendored into the Worker); re-exported
// here so every existing importer keeps its path.
export { addonOriginId, normalizeBase } from './origin-id'

/** Public movie and series metadata catalog maintained for Stremio. It uses IMDb title ids and
 * does not require a personal API credential. */
export const CINEMETA_BASE = 'https://v3-cinemeta.strem.io'

// No default sources — ever. A fresh install ships with an EMPTY source list; the user
// adds their own stream addon URL(s) in Settings. Nothing is provided out of the box.
export const addonUrls = persisted<string[]>('stremio-addon-urls', [])

// URLs the user has toggled OFF. The addon list itself stays intact so the settings UI can show
// every source with a switch; sourcing reads the ENABLED list below.
export const disabledSources = persisted<string[]>('disabled-sources', [])

/** Addon URLs minus the ones toggled off — the effective list every sourcing path should read. */
export const enabledAddonUrls = derived([addonUrls, disabledSources], ([$urls, $off]) => $urls.filter((u) => !$off.includes(u)))

/** Replace an add-on configuration in place while preventing duplicate source rows. */
export function replaceAddonBase(urls: string[], previous: string | undefined, next: string): string[] {
  const normalized = normalizeBase(next)
  if (!normalized) return urls
  const at = previous ? urls.indexOf(previous) : -1
  const withoutOldOrDuplicate = urls.filter((url) => url !== previous && normalizeBase(url) !== normalized)
  if (at < 0) return [...withoutOldOrDuplicate, normalized]
  withoutOldOrDuplicate.splice(Math.min(at, withoutOldOrDuplicate.length), 0, normalized)
  return withoutOldOrDuplicate
}

