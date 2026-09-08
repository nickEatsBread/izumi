// Addon URL canonicalization + the deterministic opaque origin id derived from it. Pure and
// store-free so the self-hosted Worker can tag its rows with the SAME origin ids the desktop
// writes into the source-priority order — trust configured once must mean the same source
// everywhere. Moved out of sources.ts (which re-exports both) for the Worker vendoring surface.

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
