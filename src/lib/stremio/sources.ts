import { persisted } from 'svelte-persisted-store'
import { derived } from 'svelte/store'

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

// Normalize a pasted addon URL to an absolute https base (strip trailing
// /manifest.json). Stremio configuration pages normally expose a `stremio://`
// install link, so accept that protocol too instead of turning it into the
// invalid `https://stremio://...` form.
export const normalizeBase = (u: string) => {
  let s = u.trim().replace(/^(['"])(.*)\1$/, '$2')
  if (!s) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^(?:https?|stremio):\/\//i.test(s)) return ''
  s = s.replace(/^stremio:\/\//i, 'https://')
  s = s.replace(/\/manifest\.json\/?(?=([?#]|$))/i, '')
    .replace(/\/(?=([?#]|$))/, '')
    .replace(/^http:\/\//i, 'https://')
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try {
    const parsed = new URL(s)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
    parsed.protocol = 'https:'
    parsed.hash = ''
    return parsed.toString().replace(/\/(?=([?#]|$))/, '')
  } catch {
    return ''
  }
}

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
