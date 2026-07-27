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

export type StreamOriginKind = 'addon' | 'torrent-extension' | 'online-extension'
export interface StreamOrigin {
  kind: StreamOriginKind
  /** Opaque addon-config fingerprint or stable extension id. Never a credential-bearing URL. */
  id: string
  name?: string
}

export interface Stream {
  url?: string
  name?: string
  title?: string
  description?: string // Comet/MediaFusion carry metadata here (Torrentio uses `title`)
  infoHash?: string
  // Full magnet URI (with trackers) when the source provided one — preferred over a bare-hash
  // magnet for resolving UNCACHED torrents on debrid (the trackers help it find peers).
  __magnet?: string
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
  // Stable origin used by Continue Watching to query only the source that last succeeded.
  // Deliberately contains no resolved URL, auth header, magnet, or debrid credential.
  __origin?: StreamOrigin
  // Source-declared match confidence (extension SDK `accuracy`). 'high' = the source verified
  // this result against the episode's PRODUCTION id (e.g. TVDB episode id), so title heuristics
  // must not second-guess it — foreign-language release names carry no romaji/english tokens
  // and would otherwise be dropped as irrelevant.
  __accuracy?: 'high' | 'medium' | 'low'
  // Direct streaming source (Seanime onlinestream-provider): plays its `url` straight in libmpv
  // with no debrid. __headers → mpv http-header-fields; __subtitles → external sub tracks.
  __stream?: boolean
  __headers?: Record<string, string>
  // `lang` is a normalized ISO code (mpv matches `slang` on codes); `title` is the provider's own
  // label for the track menu; `headers` covers Referer-gated sidecar URLs.
  __subtitles?: { url: string; lang?: string; title?: string; isDefault?: boolean; headers?: Record<string, string> }[]
  /** Separate audio fragments/tracks supplied with a direct video source (for
   * example AllAnime's split DASH output). Loaded with mpv's `audio-add`. */
  __audioTracks?: { url: string; lang?: string; title?: string; headers?: Record<string, string> }[]
  // Resolved audio track for a direct stream: 'dub' or 'sub' (from the provider search pass).
  __audio?: 'sub' | 'dub'
  // Individual extractor/server identity. Some JVM providers return every server in one response,
  // making the enclosing provider name useless for distinguishing rows in the chooser.
  __server?: string
  // "hard" means subtitles are burned into the video; "soft" means selectable sidecar tracks.
  __subtitleMode?: 'soft' | 'hard'
  // Content language of the provider that produced this row (ISO 639-1, e.g. 'it'), and whether it
  // differs from the user's preferred subtitle language. "SUB" alone says nothing about WHICH
  // language, so an Italian provider's row was indistinguishable from an English one until playback.
  // Resolved where the preference store is available (onlinestream), not here, so `describe` and
  // the ranking stay pure.
  __lang?: string
  __langMismatch?: boolean
  // Canonical media title actually matched by an online provider. Kept separately from the modal's
  // requested AniList title so diagnostics and UI can never conceal a mismatched provider result.
  __sourceTitle?: string
  // Raw source-reported seeder count for extension torrents, kept STRUCTURALLY (not parsed back
  // out of the title) so dedupeStreams can keep the best-seeded copy when several indexers return
  // the same infoHash with disagreeing counts (one live, one 0/unknown). Display still flows
  // through the 👤 title round-trip; this is ranking-only.
  __seeders?: number
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
  server?: string // individual direct-stream server/extractor (e.g. HD-1)
  logo?: string // addon manifest logo (URL) or extension icon (base64/url/data:)
  subtitleLabel?: string // explicit soft/hard subtitle availability for the chooser tooltip
  cached: CacheState
  badges: string[] // ordered, deduped pill labels (badges[0] is the quality)
  // True when this source serves a language the user did not ask for. Ranking de-prioritizes it so
  // a foreign source can never be auto-selected as "best" — which is exactly what happened when an
  // Italian provider won the pick and the episode played with Italian subtitles.
  langMismatch?: boolean
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
// Uncached (download-to-debrid): "[RD download]" / a bare "TB download" / the word
// "uncached", or a download glyph — ⬇ (match the BASE codepoint U+2B07 so the trailing
// VS16 U+FE0F is irrelevant), the plain arrow U+2193, and the hourglass/tray/cloud
// variants other addons use.
//
// Two things this deliberately does NOT do, both of which were bugs:
//   * `/\bdownloading?\b/` — the optional `g` makes "downloadin"/"downloading" match but
//     NOT the bare word "download", so the word form was dead and only the bracketed
//     `[RD download]` spelling ever fired. Everything else fell through to `instant` and
//     became eligible for the auto-pick.
//   * testing only `s.name` — modern addons put the whole marker line in `description`
//     (Comet emits no `name` marker at all), so a description-carried ⬇ read as cached.
// Both predicates therefore run over the SAME haystack the rest of the parser uses.
//
// The `u` flag is load-bearing, not decoration: 🔽 (U+1F53D) and 📥 (U+1F4E5) are astral, so
// WITHOUT it a character class holds their surrogate halves instead of the code points, and the
// high surrogate \uD83D then matches 👤 (U+1F464) — i.e. every seeder-bearing row would read as
// uncached, and any with 👤 0 as dead.
const UNCACHED_MARKER = /\b(?:download|uncached)\b|[⬇↓⏳⌛⏬🔽📥]/iu
// Cached / instantly playable: "[RD+]", ⚡ (U+26A1), or a ✅ tick.
const CACHED_MARKER = /\[[A-Za-z]{2,4}\+\]|[⚡✅]/u
export const isUncached = (s: Stream) => {
  // A direct streaming source has no debrid step to be uncached FOR — its provider text may
  // legitimately name a "download server", which must never be read as a cache marker.
  if (s.__stream) return false
  return UNCACHED_MARKER.test(hayOf(s))
}
export const isCached = (s: Stream) => !isUncached(s) && CACHED_MARKER.test(hayOf(s))

// Addon notice/error sentinels carry no real media (expired key, no results,
// rate-limit) — never show these.
export const isNotice = (s: Stream) =>
  /^\s*\[(?:❌|⚠️|🔄)\]/.test(s.name ?? '')
  || /\berror\b/i.test(s.name ?? '')
  || s.url === 'https://comet.feels.legal'

// --- the parser ------------------------------------------------------------
// Parse each stream once per identity. The picker re-derives the whole list on every source
// arrival (a ~20-source resolve = ~20 full passes) and the store write then re-derives it again
// to compute the best pick, so an unmemoised describe() ran the full regex battery roughly 2N
// times per frame while results were still streaming in. Keyed on object identity, which is
// sound because nothing mutates a Stream after the layer that built it hands it over — the
// dedupe step swaps array slots, it never edits a row in place. A WeakMap so a superseded
// picker's rows are collectable.
const parsed = new WeakMap<Stream, StreamInfo>()

export function describe(s: Stream): StreamInfo {
  const hit = parsed.get(s)
  if (hit) return hit
  const info = parseStream(s)
  parsed.set(s, info)
  return info
}

function parseStream(s: Stream): StreamInfo {
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
  // Dub-only: an English/multi dub track with no separate sub audio (Dual Audio is badged on its own).
  const dubOnly = !dualAudio && /\b(?:eng(?:lish)?[\s._-]*dub(?:bed)?|dubbed|multi[\s._-]*audio)\b/i.test(low)
  const audio = dualAudio ? undefined
    : hay.match(/\b(e-?ac-?3|ddp?\+?|atmos|truehd|dts(?:-hd)?|flac|aac|opus|ac-?3)\b/i)?.[1]?.toUpperCase()
  const batch = /\b(?:batch|complete|season\s?pack)\b/i.test(low)
    && !/\bS\d{1,2}E\d{1,3}\b/i.test(low) // a single SxxExx is not a batch
  // Release group / fansub author. Leading "[Group]" is the anime norm ("[SakuraCircle] Show - 01");
  // fall back to a scene trailing "-GROUP" (must START with a letter, so a "01-02" batch suffix is
  // NOT read as the group "02", and no space before the dash so "Title - Final" isn't a group);
  // then Comet's 🏷️ tag. NOISE rejects quality/codec/source/audio tags ("[1080p]", "[Dual Audio]",
  // "-DL" from WEB-DL) so they never masquerade as the group. This feeds the picker heading AND the
  // cross-episode same-release continuity in play.ts, so a false group would mis-continue.
  const fn = s.behaviorHints?.filename
  const NOISE = /^(?:\d{3,4}p?|x?\.?26[45]|h\.?26[45]|hevc|avc|av1|hi10p?|\d{1,2}\s?-?bit|[0-9a-f]{8}|web|web-?dl|dl|blu-?ray|ray|bd(?:rip|mux)?|hdtv|dvd(?:rip)?|remux|rip|dual\s?audio|multi(?:-?sub|-?audio)?|batch|complete|uncensored|uhd|hd|4k|sd|hdr(?:10\+?)?|dv|flac|aac|opus|ac-?3|e?-?ac-?3|ddp?\+?|atmos|truehd|dts(?:-hd)?)$/i
  const lead = fn?.match(/^\s*\[([^\]]+)\]/)?.[1]?.trim()
  const tail = fn?.match(/-([A-Za-z][A-Za-z0-9]*)$/)?.[1]
  const group = (lead && !NOISE.test(lead) ? lead : undefined)
    || (tail && !NOISE.test(tail) ? tail : undefined)
    || s.description?.match(/🏷️\s*([^\n|]+)/)?.[1]?.trim()

  // 'down' only when an UNCACHED torrent has an explicit 0 seeders (nothing to
  // fetch to debrid → effectively dead). Missing seeders stays 'uncached'.
  //
  // With NO marker either way, the deciding fact is whether the addon handed us something
  // playable: a resolved url is instant, but a bare infoHash still has to go through debrid
  // and is therefore uncached — it was previously called 'instant', which let a torrent that
  // nothing had ever cached win the auto-pick and then stall on resolve. This branch must NOT
  // route through the 0-seeder test above: extension indexers hardcode 0, and calling those
  // rows 'down' would strike out the entire extension torrent path.
  const cached: CacheState = isCached(s) ? 'instant'
    : isUncached(s) ? (seeders === 0 ? 'down' : 'uncached')
    : (s.infoHash && !s.url) ? 'uncached'
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
  // Audio type. Direct-stream rows carry the resolved track explicitly (SUB or DUB); torrent rows
  // only flag DUB (sub is the unmarked default) so the list stays quiet. Dual Audio is separate.
  if (s.__audio) push(s.__audio === 'dub' ? 'DUB' : 'SUB')
  else if (dubOnly) push('DUB')
  // Which language that SUB/DUB actually is. Without it the row said "SUB" and nothing else, so an
  // Italian or French source read identically to an English one right up until playback started.
  if (s.__lang) push(s.__lang.toUpperCase())
  const subtitleCount = s.__subtitles?.length ?? 0
  const subtitleNames = [...new Set((s.__subtitles ?? [])
    .map((track) => track.title ?? track.lang?.toUpperCase())
    .filter((value): value is string => !!value))]
  const subtitleLabel = s.__subtitleMode === 'hard'
    ? 'Hard subtitles (burned into video)'
    : subtitleCount
      ? `${subtitleCount} selectable subtitle${subtitleCount === 1 ? '' : 's'}${subtitleNames.length ? `: ${subtitleNames.join(', ')}` : ''}`
      : undefined
  if (s.__subtitleMode === 'hard') push('HARDSUB')
  else if (subtitleCount) push(`CC ${subtitleCount}`)
  // Direct streaming sources carry no release metadata (codec/size/group) — an adaptive HLS ladder
  // often reports quality "auto", leaving the row barren. Always give it a delivery-type badge so
  // it reads as a real, deliberate source.
  if (s.__stream) push(/\.m3u8(?:[?#]|$)/i.test(s.url ?? '') ? 'HLS' : 'MP4')

  return {
    stream: s, quality, label, filename, group, codec, bitDepth, hdr,
    dualAudio, audio, source, batch, seeders, sizeBytes, sizeLabel,
    provider, addon, server: s.__server, logo: s.__logo, subtitleLabel,
    cached, badges, langMismatch: s.__langMismatch,
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
  // Ordinal season: "2nd Season", "3rd Season" → the ORDINAL is the season. Must come before the
  // "Season NN" branch below, which would otherwise misread "2nd Season 01" as season 1 (the "01"
  // is the episode of the 2nd season, not the season). Lets the verifier reject a sequel-season
  // pack when the requested title is a DIFFERENT part of the franchise.
  const ord = f.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)\s+Season\b/i)
  if (ord) return { season: Number(ord[1]) }
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
