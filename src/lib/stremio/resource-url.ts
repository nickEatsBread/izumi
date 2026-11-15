import { normalizeBase } from './origin-id'

/** An add-on resource URL: `path` (e.g. `/stream/series/<id>.json`) replaces `/manifest.json` in
 *  the configured URL, so a configuration query (`?token=…`) stays at the end, as in Stremio. */
export function addonResourceUrl(base: string, path: string): string {
  const b = normalizeBase(base)
  try {
    const url = new URL(b)
    url.pathname = url.pathname.replace(/\/$/, '') + path
    return url.href
  } catch { return b + path }
}
