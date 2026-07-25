// Parsers shared by the embed-host extractors. Every host in the JWPlayer family ships the same
// shape once the packed wrapper is removed, so the bulk of extraction is one set of parsers plus a
// thin per-host wrapper.

import { unpack } from './jsunpacker'
import type { ExtractorLink, ExtractorSubtitle } from './types'

/** Sidecar/asset extensions that share the player config's `file` key but are not the video. */
const NON_VIDEO_RE = /\.(?:vtt|srt|ass|ssa|sub|txt|jpg|jpeg|png|webp|gif|json|css|js)$/i

/** Container type from a URL, defaulting to mp4 for anything that isn't obviously a playlist. */
export function linkType(url: string): 'm3u8' | 'mp4' | 'dash' {
  const path = url.split(/[?#]/)[0].toLowerCase()
  if (path.endsWith('.m3u8') || path.includes('.m3u8')) return 'm3u8'
  if (path.endsWith('.mpd')) return 'dash'
  return 'mp4'
}

/** Pull a quality label out of a JWPlayer `label`/`res` field or, failing that, the URL itself. */
export function qualityOf(label: string | undefined, url: string): string {
  const fromLabel = label?.match(/(\d{3,4})\s*[pP]?/)?.[1]
  if (fromLabel) return `${fromLabel}p`
  const fromUrl = url.match(/[/_-](\d{3,4})[pP][/_.-]/)?.[1] ?? url.match(/[/_-](\d{3,4})[pP]?\.(?:mp4|m3u8)/)?.[1]
  return fromUrl ? `${fromUrl}p` : 'auto'
}

/**
 * Find player sources in a page. Handles the shapes hosts actually use:
 *   sources: [{file: "…", label: "1080p"}]      (JWPlayer / Playerjs)
 *   sources: ["…"]                              (bare array)
 *   file: "…" / src: "…"                        (single source)
 *   player.src({src: "…"})                      (Mp4Upload-style)
 * The page is unpacked first — on most hosts the URL only exists after the packed dictionary is
 * substituted back in.
 */
export function findSources(page: string, source: string, headers: Record<string, string>): ExtractorLink[] {
  const html = unpack(page)
  const out: ExtractorLink[] = []
  const seen = new Set<string>()
  const push = (url: string, label?: string) => {
    const clean = url.trim().replace(/\\\//g, '/')
    if (!/^https?:\/\//i.test(clean) || seen.has(clean)) return
    // `tracks:[{file:…}]` uses the SAME `file` key as `sources`, so without this every subtitle and
    // thumbnail sprite was returned as a video source.
    if (NON_VIDEO_RE.test(clean.split(/[?#]/)[0])) return
    seen.add(clean)
    out.push({ url: clean, type: linkType(clean), quality: qualityOf(label, clean), headers, source })
  }
  // Object entries inside a `sources:[…]` array, with the label in either order.
  for (const m of html.matchAll(/["']?(?:file|src)["']?\s*:\s*["']([^"']+)["']([^}]*)/g)) {
    const label = m[2]?.match(/["']?(?:label|res|quality)["']?\s*:\s*["']?([^"',}]+)/)?.[1]
    push(m[1], label)
  }
  // Bare string arrays: sources: ["https://…", "https://…"]
  for (const arr of html.matchAll(/sources\s*:\s*\[([^\]]*)\]/g)) {
    for (const s of arr[1].matchAll(/["'](https?:[^"']+)["']/g)) push(s[1])
  }
  return out
}

/** Sidecar subtitle tracks advertised by the player config (`tracks:[{file,label,kind}]`) or by
 *  plain <track> elements. `kind: captions/subtitles` only — thumbnail VTTs use the same field. */
export function findSubtitles(page: string, headers: Record<string, string>): ExtractorSubtitle[] {
  const html = unpack(page)
  const out: ExtractorSubtitle[] = []
  const seen = new Set<string>()
  const push = (url: string, label?: string) => {
    const clean = url.trim().replace(/\\\//g, '/')
    if (!/^https?:\/\//i.test(clean) || seen.has(clean)) return
    seen.add(clean)
    out.push({ url: clean, label: label?.trim(), headers })
  }
  for (const m of html.matchAll(/\{([^{}]*\b(?:kind|label)\b[^{}]*)\}/g)) {
    const body = m[1]
    const kind = body.match(/["']?kind["']?\s*:\s*["']([^"']+)["']/)?.[1]?.toLowerCase()
    // Skip thumbnail tracks — they are VTT too but are not subtitles.
    if (kind && !/caption|subtitle/.test(kind)) continue
    const file = body.match(/["']?(?:file|src)["']?\s*:\s*["']([^"']+)["']/)?.[1]
    if (!file || /\.(?:mp4|m3u8|mpd)(?:\?|$)/i.test(file)) continue
    push(file, body.match(/["']?label["']?\s*:\s*["']([^"']*)["']/)?.[1])
  }
  for (const m of html.matchAll(/<track\b[^>]*>/gi)) {
    const tag = m[0]
    const kind = tag.match(/\bkind\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase()
    if (kind && !/caption|subtitle/.test(kind)) continue
    const src = tag.match(/\bsrc\s*=\s*["']?([^"'\s>]+)/i)?.[1]
    if (!src) continue
    push(src, tag.match(/\blabel\s*=\s*["']([^"']*)["']/i)?.[1] ?? tag.match(/\bsrclang\s*=\s*["']?([\w-]+)/i)?.[1])
  }
  return out
}

/** Referer/Origin most embed CDNs gate on, derived from the embed URL itself. */
export function refererHeaders(embedUrl: string, referer?: string): Record<string, string> {
  try {
    const u = new URL(embedUrl)
    return { Referer: referer ?? `${u.origin}/`, Origin: u.origin }
  } catch {
    return referer ? { Referer: referer } : {}
  }
}
