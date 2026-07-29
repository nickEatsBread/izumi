// Addon identity: the icon and the name that tell the user WHICH source a row came from.
//
// The old rule was one line — "starts with http or data: use it, otherwise assume base64" — which
// broke every addon that declares a RELATIVE manifest logo (Stremio permits it): the path was
// handed to an <img> as a base64 payload and rendered as a permanently broken icon. There was also
// no error handling anywhere, so a logo whose host went down stayed a broken box for good.

/** Absolute, loadable URL for a manifest logo, or undefined when there is nothing usable.
 *  Resolved at FETCH time, where the addon's base URL is in hand — the base is deliberately not
 *  carried on the stream, since stream origins are persisted and must never hold a URL that could
 *  embed a debrid key. */
export function resolveAddonLogo(logo: string | undefined, base: string): string | undefined {
  const raw = logo?.trim()
  if (!raw) return undefined
  if (/^(?:https?:|data:|blob:)/i.test(raw)) return raw
  // Protocol-relative: the webview is https, so http would be blocked as mixed content anyway.
  if (raw.startsWith('//')) return `https:${raw}`
  try {
    // `base` is the addon directory after `/manifest.json` has been stripped. URL resolution
    // treats a path without a trailing slash as a filename, so add it back before resolving a
    // bare relative logo (`logo.png`) or `/addon/logo.png` would incorrectly become `/logo.png`.
    return new URL(raw, `${base.replace(/\/+$/, '')}/`).toString()
  } catch {
    return undefined // an unusable base is better admitted than turned into a broken <img>
  }
}

/** Deterministic fallback tile for an addon with no usable icon. Colour is seeded by identity so a
 *  given addon always looks the same, which makes rows scannable even with no artwork at all. */
const PALETTE: readonly (readonly [string, string])[] = [
  ['#f97373', '#b53b3b'],
  ['#7eb6ff', '#3a6fb8'],
  ['#9d7af6', '#5d3ec1'],
  ['#5ad6a4', '#2c8c66'],
  ['#f4b85a', '#a76f1f'],
  ['#ec78c9', '#a83a8a'],
  ['#5ad0d6', '#1f7a85'],
  ['#c0c8d4', '#5e6677'],
]

export function logoTile(seed: string, name: string): { initial: string; from: string; to: string } {
  // Normalised so the same addon keeps one colour whether it is identified by its id, its display
  // name, or a variant with different punctuation.
  const key = (seed || name || '?').toLowerCase().replace(/[^a-z0-9]+/g, '')
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  const [from, to] = PALETTE[h % PALETTE.length]
  return { initial: (name || '?').trim().charAt(0).toUpperCase() || '?', from, to }
}

/** Turn a stored icon into something an <img>/<image> can actually load.
 *
 *  `StreamInfo.logo` is deliberately dual-scheme (parse.ts): addon manifest logos arrive as
 *  absolute URLs, extension icons as a BARE base64 payload with no data: prefix. Handing the raw
 *  value to an image source works for the first and renders a broken-image glyph for the second,
 *  so every consumer has to apply this — which is exactly why it lives in one place now. */
export function iconSrc(logo: string | undefined): string | undefined {
  const raw = logo?.trim()
  if (!raw) return undefined
  return /^(?:https?:|data:|blob:)/i.test(raw) ? raw : `data:image/png;base64,${raw}`
}
