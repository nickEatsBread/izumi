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

// A source with no usable icon used to get a deterministic colour-hashed tile stamped with its
// initial, generated here. It has been removed rather than reused: the coloured tiles read as real
// branding next to real logos, and they were only ever half the story — the store and the
// extensions list drew a puzzle mark for the same condition. The single fallback now lives in
// $lib/components/SourcePlaceholder.svelte. Do not reintroduce a generated one.

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
