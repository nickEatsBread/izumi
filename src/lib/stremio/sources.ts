import { persisted } from 'svelte-persisted-store'
import { derived } from 'svelte/store'
// No default sources — ever. A fresh install ships with an EMPTY source list; the user
// adds their own stream addon URL(s) in Settings. Nothing is provided out of the box.
export const addonUrls = persisted<string[]>('stremio-addon-urls', [])

// URLs the user has toggled OFF. The addon list itself stays intact so the settings UI can show
// every source with a switch; sourcing reads the ENABLED list below.
export const disabledSources = persisted<string[]>('disabled-sources', [])

/** Addon URLs minus the ones toggled off — the effective list every sourcing path should read. */
export const enabledAddonUrls = derived([addonUrls, disabledSources], ([$urls, $off]) => $urls.filter((u) => !$off.includes(u)))

// Normalize a pasted addon URL to an absolute https base (strip trailing
// /manifest.json). Forcing a scheme matters: a scheme-less base would resolve
// relative to the app page and hit the wrong host.
export const normalizeBase = (u: string) => {
  let s = u.trim().replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '').replace(/^http:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  return s
}

/** Deterministic opaque id for an addon configuration. The full addon URL can contain an API key,
 *  so remembered/synced source preferences store this fingerprint and match it against the local
 *  configured URLs instead of copying the credential-bearing URL into watch sync. */
export function addonOriginId(url: string): string {
  const text = normalizeBase(url)
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x85ebca6b)
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`
}
