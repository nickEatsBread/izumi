// Single source of truth for parsing Stremio stream objects. Torrentio keeps the
// (now-deprecated) `title` field carrying the release filename + 👤 seeders /
// 💾 size; modern addons (Comet, MediaFusion) put all of that in `description`
// instead — Comet emits NO `title` at all. Parsing a combined haystack of
// name+title+description+behaviorHints.filename means both shapes work.
//
// This module also owns cache-state detection (⚡ instant vs ⬇ download-to-debrid
// vs dead) and per-stream season/episode detection — shared by the picker, the
// auto-play path, and the season verifier so the Torrentio-vs-Comet knowledge
// never drifts apart again.

export interface Stream {
  url?: string
  name?: string
  title?: string
  description?: string // Comet/MediaFusion carry metadata here (Torrentio uses `title`)
  infoHash?: string
  behaviorHints?: {
    filename?: string // clean release name — present on BOTH addons
    videoSize?: number // bytes
    bingeGroup?: string
    [k: string]: unknown
  }
  // Stamped by getStreams from the addon's manifest (logo URL + display name),
  // or by the extensions layer (base64 icon + extension name), for the picker.
  __logo?: string
  __addonName?: string
  // Direct streaming source (Seanime onlinestream-provider): plays its `url` straight in libmpv
  // with no debrid. __headers → mpv http-header-fields; __subtitles → external sub tracks.
  __stream?: boolean
  __headers?: Record<string, string>
  __subtitles?: { url: string; lang?: string }[]
}

export type CacheState = 'instant' | 'uncached' | 'down'
export type StreamSort = 'quality' | 'seeders' | 'size'

export interface StreamInfo {
  stream: Stream
  quality: number // 2160 | 1440 | 1080 | 720 | 480 | 360 | 240 | 0
  label: string // best human label (release filename)
  filename?: string
  group?: string
  codec?: string // HEVC | H264 | AV1 | XviD
  bitDepth?: string // 10bit | 8bit
  hdr?: string // DV | HDR10+ | HDR
  dualAudio?: boolean
  audio?: string // primary audio codec token
  source?: string // BluRay | WEB-DL | WEBRip | WEB | HDTV | DVD
  batch?: boolean // season pack / multi-episode
  seeders?: number
  sizeBytes?: number
  sizeLabel?: string // "1.4 GB"
  provider?: string // RD | AD | PM | TB | OC | DL ...
  addon?: string // "Torrentio" | "Comet"
  logo?: string // addon manifest logo (URL) or extension icon (base64/url/data:)
  cached: CacheState
  badges: string[] // ordered, deduped pill labels (badges[0] is the quality)
}

const hayOf = (s: Stream) =>
  `${s.name ?? ''}\n${s.title ?? ''}\n${s.description ?? ''}\n${s.behaviorHints?.filename ?? ''}`

const fmtBytes = (n?: number) => {
  if (!n || n <= 0) return undefined
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${u[i]}`
}

export function resolutionOf(s: Stream): number {
  const t = hayOf(s).toLowerCase()
  if (/\b(?:2160p?|4k|uhd)\b/.test(t)) return 2160
  if (/\b(?:1440p?|2k|qhd)\b/.test(t)) return 1440
  if (/\b1080p?\b|\bfhd\b/.test(t)) return 1080
  if (/\b720p?\b|\bhd\b/.test(t)) return 720
  if (/\b480p?\b/.test(t)) return 480
  if (/\b360p?\b/.test(t)) return 360
  if (/\b240p?\b/.test(t)) return 240
  return 0
}

export const qualityLabel = (q: number) =>
  q >= 2160 ? '4K' : q >= 1440 ? '1440p' : q ? `${q}p` : 'SD'

// --- cache state -----------------------------------------------------------
// Uncached (download-to-debrid): Torrentio "[RD download]" (word) OR Comet "⬇️"
// (match the BASE codepoint U+2B07 so the trailing VS16 U+FE0F is irrelevant;
// also accept the plain arrow U+2193 just in case).
export const isUncached = (s: Stream) => {
  const n = s.name ?? ''
  return /\bdownloading?\b/i.test(`${n} ${s.title ?? ''} ${s.description ?? ''}`)
    || /\[[A-Za-z]{2,4}\s+download\]/i.test(n)
    || /[⬇↓]/.test(n)
}
// Cached / instantly playable: Torrentio "[RD+]" OR Comet "⚡" (U+26A1), and not
// flagged uncached.
export const isCached = (s: Stream) =>
  !isUncached(s) && (/\[[A-Za-z]{2,4}\+\]/.test(s.name ?? '') || /⚡/.test(s.name ?? ''))

// Addon notice/error sentinels carry no real media (expired key, no results,
// rate-limit) — never show these.
export const isNotice = (s: Stream) =>
  /^\s*\[(?:❌|⚠️|🔄)\]/.test(s.name ?? '')
  || /\berror\b/i.test(s.name ?? '')
  || s.url === 'https://comet.feels.legal'

// --- the parser ------------------------------------------------------------
export function describe(s: Stream): StreamInfo {
  const name = s.name ?? ''
  const hay = hayOf(s)
  const low = hay.toLowerCase()
  const quality = resolutionOf(s)

  const seedersTxt = hay.match(/👤\s*(\d+)/)?.[1] // 👤 = seeders (⚙️/🔎 = tracker; ignore)
  const seeders = seedersTxt != null ? Number(seedersTxt) : undefined
  const sizeTxt = hay.match(/💾\s*([\d.]+\s*[KMGT]i?B)/i)?.[1]?.replace(/\s+/g, ' ').trim()
  const sizeBytes = s.behaviorHints?.videoSize
  const sizeLabel = sizeTxt ?? fmtBytes(sizeBytes)

  // provider: [RD+] [RD download] [RD⚡] [RD⬇️] [Torrent🧲] [AD+] ...
  const provider = name.match(/\[([A-Za-z]{2,4})(?:\+|\s*download|⚡|[⬇↓]️?|🧲)?\]/i)?.[1]?.toUpperCase()
  // Prefer the manifest's display name; else sniff Torrentio/Comet from the name.
  const addon = s.__addonName ?? (/comet/i.test(name) ? 'Comet' : /torrentio/i.test(name) ? 'Torrentio' : undefined)

  // primary release name: bh.filename (both addons) -> Comet 📄 token -> Torrentio title line 1
  const filename = (
    s.behaviorHints?.filename
    || s.description?.match(/📄\s*([^\n]+)/)?.[1]
    || s.title?.split('\n')[0]
  )?.trim()

  const label = (filename || s.description?.split('\n')[0] || name.split('\n')[0] || 'Stream').trim()

  const codec = /\b(?:hevc|x\.?265|h\.?265)\b/i.test(low) ? 'HEVC'
    : /\bav1\b/i.test(low) ? 'AV1'
    : /\b(?:avc|x\.?264|h\.?264)\b/i.test(low) ? 'H264'
    : /\bxvid\b/i.test(low) ? 'XviD' : undefined
  const bitDepth = /\b10\s?-?bit\b/i.test(low) ? '10bit' : /\b8\s?-?bit\b/i.test(low) ? '8bit' : undefined
  const hdr = /\b(?:dolby\s?vision|dovi|\bdv\b)\b/i.test(low) ? 'DV'
    : /\bhdr10\+|\bhdr10plus\b/i.test(low) ? 'HDR10+'
    : /\bhdr\b/i.test(low) ? 'HDR' : undefined
  const source = /\bblu-?ray\b|\bbd(?:rip|mux)?\b|\bremux\b/i.test(low) ? 'BluRay'
    : /\bweb-?dl\b/i.test(low) ? 'WEB-DL'
    : /\bweb-?rip\b/i.test(low) ? 'WEBRip'
    : /\bweb\b/i.test(low) ? 'WEB'
    : /\bhdtv\b/i.test(low) ? 'HDTV'
    : /\bdvd(?:rip)?\b/i.test(low) ? 'DVD' : undefined
  const dualAudio = /\bdual[-\s]?audio\b/i.test(low)
  const audio = dualAudio ? undefined
    : hay.match(/\b(e-?ac-?3|ddp?\+?|atmos|truehd|dts(?:-hd)?|flac|aac|opus|ac-?3)\b/i)?.[1]?.toUpperCase()
  const batch = /\b(?:batch|complete|season\s?pack)\b/i.test(low)
    && !/\bS\d{1,2}E\d{1,3}\b/i.test(low) // a single SxxExx is not a batch
  const group = s.behaviorHints?.filename?.match(/-([A-Za-z0-9]+)$/)?.[1]
    || s.description?.match(/🏷️\s*([^\n|]+)/)?.[1]?.trim()

  // 'down' only when an UNCACHED torrent has an explicit 0 seeders (nothing to
  // fetch to debrid → effectively dead). Missing seeders stays 'uncached'. A
  // stream with a url and no cache glyph (non-Torrentio/Comet addon) is instant.
  const cached: CacheState = isCached(s) ? 'instant'
    : isUncached(s) ? (seeders === 0 ? 'down' : 'uncached')
    : 'instant'

  const badges: string[] = []
  const push = (b?: string | false) => { if (b && !badges.includes(b)) badges.push(b) }
  push(quality ? qualityLabel(quality) : undefined)
  push(codec)
  push(bitDepth)
  push(hdr)
  push(dualAudio ? 'Dual Audio' : audio)
  push(source)
  push(batch ? 'Batch' : undefined)

  return {
    stream: s, quality, label, filename, group, codec, bitDepth, hdr,
    dualAudio, audio, source, batch, seeders, sizeBytes, sizeLabel,
    provider, addon, logo: s.__logo, cached, badges,
  }
}

// Detect {season, episode} — or a bare absolute number — from a stream's
// filename, to catch Torrentio's silent overflow into the wrong TVDB season.
// Returns {} when undeterminable; callers must only DE-RANK on a known mismatch,
// never drop on an unknown.
export function parseSeasonEp(s: Stream): { season?: number; episode?: number; abs?: number } {
  const f = s.behaviorHints?.filename
    || s.title?.split('\n')[0]
    || s.description?.match(/📄\s*([^\n]+)/)?.[1]
    || s.name || ''
  const se = f.match(/\bS(\d{1,2})\s?E(\d{1,4})\b/i) || f.match(/\bS(\d{1,2})\s*P(\d{1,3})\b/i)
  if (se) return { season: Number(se[1]), episode: Number(se[2]) }
  // Season-only (a season pack / batch like "Title S01 1080p BluRay", "Season 2")
  // — no episode, but the season alone is enough to reject a wrong-season pack.
  const sOnly = f.match(/\bS(?:eason\s*)?(\d{1,2})\b/i)
  if (sOnly) return { season: Number(sOnly[1]) }
  // Absolute episode ("[Group] Title - 67 (1080p)"). Strip resolution/codec/bit
  // tokens first so 1080/720/264/265/10 don't parse as an episode number.
  const cleaned = f
    .replace(/\b(?:2160|1440|1080|720|480|360|240)p?\b/gi, ' ')
    .replace(/\bx?\.?26[45]\b|\bav1\b|\bh\.?26[45]\b/gi, ' ')
    .replace(/\b(?:8|10)\s?-?bit\b/gi, ' ')
  const abs = cleaned.match(/-\s*(\d{1,4})(?:v\d)?\b/)
  if (abs) return { abs: Number(abs[1]) }
  return {}
}

// A file is a CONFIDENT wrong-season match iff its parsed season is present and
// differs from the wanted season, OR its parsed absolute number is present and
// differs from the wanted absolute. Unknown/absent parses are NOT confident (we
// never drop on uncertainty), and with no ground truth (no season AND no abs) this
// is always false — so the season gate is a no-op when AniZip lacks the data.
// `episode` is intentionally ignored: a season pack legitimately spans many eps.
export function isWrongSeason(s: Stream, want: { season?: number; abs?: number }): boolean {
  if (want.season == null && want.abs == null) return false
  const p = parseSeasonEp(s)
  if (want.season != null && p.season != null && p.season !== want.season) return true
  if (want.abs != null && p.abs != null && p.abs !== want.abs) return true
  return false
}
