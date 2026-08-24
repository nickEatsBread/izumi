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
  /** Stremio `sources` entries, most commonly `tracker:<announce-url>` hints. */
  sources?: string[]
  // Full magnet URI (with trackers) when the source provided one — preferred over a bare-hash
  // magnet for resolving UNCACHED torrents on debrid (the trackers help it find peers).
  __magnet?: string
  // Direct .torrent payload supplied by an extension. The native engine can fetch this metadata
  // immediately instead of rediscovering it over DHT from the info hash.
  __torrentUrl?: string
  behaviorHints?: {
    filename?: string // clean release name — present on BOTH addons
    videoSize?: number // bytes
    bingeGroup?: string
    videoHash?: string // OpenSubtitles moviehash, when supplied by the addon
    proxyHeaders?: { request?: Record<string, string>; response?: Record<string, string> }
    notWebReady?: boolean
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
  // Structural season-pack signal supplied by an extension's batch() method or provider
  // metadata. Some legitimate packs have no "batch", "complete", range, or S01 in their name.
  __batch?: boolean
  // Direct streaming source (Seanime onlinestream-provider): plays its `url` straight in libmpv
  // with no debrid. __headers → mpv http-header-fields; __subtitles → external sub tracks.
  __stream?: boolean
  /** Adaptive manifest identity supplied by an online extension. This must survive the generic
   * Stream mapping: localhost JVM wrappers and signed endpoints often have no useful suffix. */
  __manifest?: 'hls' | 'dash'
  __headers?: Record<string, string>
  /** Encrypted stream (Widevine/PlayReady). Played in the webview CDM instead of mpv. */
  __drm?: import('$lib/player/drm').StreamDrm
  /** Seek-bar hover sprite / BIF URL. */
  __previewUrl?: string
  /** Provider-supplied network-safe equivalent for Watch Together guests. The local player
   * continues to use the faster loopback source; this is only serialized into the room. */
  __party?: Pick<Stream, 'url' | '__headers' | '__drm' | '__subtitles' | '__audioTracks' | '__previewUrl' | '__audioLang'>
  // `lang` is a normalized ISO code (mpv matches `slang` on codes); `title` is the provider's own
  // label for the track menu; `headers` covers Referer-gated sidecar URLs.
  __subtitles?: {
    url: string
    lang?: string
    title?: string
    isDefault?: boolean
    headers?: Record<string, string>
    kind?: 'subtitles' | 'captions'
    switchUrl?: string
  }[]
  /** BCP-47 / ISO audio language for a muxed direct stream, when known. */
  __audioLang?: string
  /** Separate audio fragments/tracks supplied with a direct video source (for
   * example AllAnime's split DASH output). Loaded with mpv's `audio-add`. */
  __audioTracks?: {
    url?: string
    lang?: string
    title?: string
    headers?: Record<string, string>
    switchUrl?: string
  }[]
  // Resolved audio track for a direct stream: 'dub' or 'sub' (from the provider search pass).
  __audio?: 'sub' | 'dub'
  // Individual extractor/server identity. Some JVM providers return every server in one response,
  // making the enclosing provider name useless for distinguishing rows in the chooser.
  __server?: string
  // The extractor's own quality string ("1080p", "auto"), carried so variant UIs don't re-parse it
  // out of the display name — and so they don't fall back to resolutionOf's regex haystack, which
  // reads the server token itself (e.g. "HD-1") as a quality signal ("\bhd\b").
  __quality?: string
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
  // Debrid cache answer, stamped by the cache-check pass in play.ts. Lives on the Stream rather
  // than on the parsed StreamInfo because StreamPicker.svelte re-derives its rows by calling
  // rankInfos(pick.streams) itself — a patch applied to a StreamInfo[] would be discarded on the
  // next re-derive. An addon's own ⚡/⬇ glyph still wins over this: the glyph is that addon's
  // first-hand statement about the stream it is offering.
  __cache?: 'cached' | 'uncached'
  __cacheSource?: 'native' | 'library'
}

export type CacheState = 'instant' | 'unknown' | 'uncached' | 'down'

/** Where a StreamInfo's `cached` value came from, so the UI can label it honestly.
 *  'glyph'   — parsed from the addon's own ⚡/⬇ marker
 *  'native'  — a provider cache endpoint answered definitively
 *  'library' — found in the user's own debrid account (a positive only; never proves
 *              the provider is holding it for everyone) */
export type CacheSource = 'glyph' | 'native' | 'library'
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
  /** Spoken audio languages named in the release (ISO-ish 3-letter codes, plus 'multi'). Empty
   *  when the name says nothing, which is the common case and must never be read as "wrong
   *  language" — only a POSITIVE mismatch is actionable. */
  audioLanguages: string[]
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
  cacheSource?: CacheSource
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

// Bytes from a human size string. Most addons report size as TEXT only — `behaviorHints.videoSize`
// was the sole source of `sizeBytes`, so "sort by size" silently tied at zero for all of them.
// Both the binary and decimal spellings are read as 1024-based, matching fmtBytes: addons that
// write "GB" overwhelmingly mean GiB, and being consistent matters more here than being pedantic,
// since the number is used to compare releases with each other.
const SIZE_TEXT = /(\d+(?:\.\d+)?)\s*([KMGT])i?B\b/i
export function bytesOfSizeText(text?: string): number | undefined {
  const m = text?.match(SIZE_TEXT)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return undefined
  const pow = { k: 1, m: 2, g: 3, t: 4 }[m[2].toLowerCase()]
  return pow ? Math.round(n * 1024 ** pow) : undefined
}

// A season/complete/range PACK marker (legit, kept): batch, complete, "Season N", a bare "S01"
// pack (S01 not followed by E), volumes, an "NN-NN" episode range, BD Box. Shared with the
// relevance heuristics so the picker's "Batch" pill and the rules that must never drop a pack
// can't drift apart — they were three different regexes with three different ideas of a batch.
export const BATCH_MARKER = /\bbatch\b|\bcomplete\b|\bseason\b|\bS\d{1,2}(?![\dE])\b|\bvol(?:ume)?\.?\s?\d+\b|\b\d{1,3}\s?[-–~]\s?\d{1,3}\b|\bBD\s?box\b/i

// Spoken/tagged audio languages. Deliberately a small exact-token table rather than a fuzzy match:
// release names are full of short uppercase tags, and "DL" (from WEB-DL), "NTb" and similar group
// suffixes are exactly the shapes a looser matcher reads as a language. Anime-relevant entries
// first — the point is telling an Italian or Portuguese release from a Japanese one, not covering
// every ISO code.
const LANG_TOKENS: Record<string, string> = {
  eng: 'eng', english: 'eng',
  jpn: 'jpn', jap: 'jpn', japanese: 'jpn', raw: 'jpn',
  ita: 'ita', italian: 'ita',
  spa: 'spa', esp: 'spa', spanish: 'spa', castellano: 'spa', latino: 'spa',
  fre: 'fre', fra: 'fre', french: 'fre', vostfr: 'fre', truefrench: 'fre',
  ger: 'ger', deu: 'ger', german: 'ger',
  por: 'por', ptbr: 'por', portuguese: 'por', dublado: 'por',
  rus: 'rus', russian: 'rus',
  ara: 'ara', arabic: 'ara',
  chi: 'chi', chinese: 'chi',
  kor: 'kor', korean: 'kor',
  hin: 'hin', hindi: 'hin',
  multi: 'multi', multisub: 'multi', multiaudio: 'multi',
}

export function audioLanguagesOf(name: string): string[] {
  const out = new Set<string>()
  for (const raw of name.toLowerCase().split(/[^a-z]+/)) {
    const hit = LANG_TOKENS[raw]
    if (hit) out.add(hit)
  }
  return [...out]
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
// Account-status cards: some addons return the user's subscription/quota state as a fake stream
// row, which then sits in the picker looking like a source. Gated hard on the row carrying NO
// evidence of being a real file — no infoHash, no declared size or filename, and no video-looking
// URL — so a legitimate release whose name happens to mention "3 days left" is never dropped.
const STATUS_CARD = /\b(?:expires? in|days? left|quota used|subscription|limit reached|no results)\b/i
const VIDEO_URL = /\.(?:mkv|mp4|avi|m4v|webm|mov|ts)(?:[?#]|$)/i

export const isNotice = (s: Stream) =>
  /^\s*\[(?:❌|⚠️|🔄)\]/.test(s.name ?? '')
  || /\berror\b/i.test(s.name ?? '')
  || s.url === 'https://comet.feels.legal'
  || (STATUS_CARD.test(`${s.name ?? ''} ${s.title ?? ''} ${s.description ?? ''}`)
      && !s.infoHash
      && !s.behaviorHints?.videoSize
      && !s.behaviorHints?.filename
      && !VIDEO_URL.test(s.url ?? ''))

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

  // Seeders. The person glyph is the common spelling; some indexers use the two-person glyph or
  // write it out. The `S:` form is anchored to a boundary and requires the colon so it can't
  // swallow the neighbouring `L:` leecher count — reading leechers as seeders would paint a dead
  // torrent as healthy, which is worse than reading nothing.
  const seedersTxt = hay.match(/[👤👥]\s*(\d+)/u)?.[1]
    ?? hay.match(/\bseeders?\s*[:=]\s*(\d+)/i)?.[1]
    ?? hay.match(/(?:^|[\s|([])S\s*[:=]\s*(\d+)/i)?.[1]
  // Prefer a positive structural count supplied by an extension. Zero remains unknown here: some
  // indexers use it as a placeholder when they do not measure tracker health, so treating every
  // structural zero as a dead swarm hides otherwise playable torrents.
  const structuralSeeders = s.__seeders != null && Number.isFinite(s.__seeders) && s.__seeders > 0
    ? Math.floor(s.__seeders)
    : undefined
  const seeders = structuralSeeders ?? (seedersTxt != null ? Number(seedersTxt) : undefined)
  const sizeTxt = hay.match(/💾\s*([\d.]+\s*[KMGT]i?B)/i)?.[1]?.replace(/\s+/g, ' ').trim()
  // Structured first (authoritative), then the text the addon wrote. The LABEL keeps the addon's
  // own wording when it gave one — it is what the user sees on the row, and rounding it through
  // our formatter only makes it disagree with what the addon's own UI shows.
  const sizeBytes = s.behaviorHints?.videoSize ?? bytesOfSizeText(sizeTxt)
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
  // Ordered most specific first. Plain HDR10 used to fall through every branch and badge NOTHING:
  // the HDR10+ test requires the plus, and `\bhdr\b` cannot match inside "HDR10" because there is
  // no word boundary between R and 1.
  const hdr = /\b(?:dolby\s?vision|dovi|\bdv\b)\b/i.test(low) ? 'DV'
    : /\bhdr10\+|\bhdr10plus\b/i.test(low) ? 'HDR10+'
    : /\bhdr10\b/i.test(low) ? 'HDR10'
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
  const batch = BATCH_MARKER.test(low)
    && !/\bS\d{1,2}E\d{1,3}\b/i.test(low) // a single SxxExx is not a batch
  const audioLanguages = audioLanguagesOf(hay)
  // Release group / fansub author. Leading "[Group]" is the anime norm ("[SakuraCircle] Show - 01");
  // fall back to a scene trailing "-GROUP" (must START with a letter, so a "01-02" batch suffix is
  // NOT read as the group "02", and no space before the dash so "Title - Final" isn't a group);
  // then Comet's 🏷️ tag. NOISE rejects quality/codec/source/audio tags ("[1080p]", "[Dual Audio]",
  // "-DL" from WEB-DL) so they never masquerade as the group. This feeds the picker heading AND the
  // cross-episode same-release continuity in play.ts, so a false group would mis-continue.
  const fn = s.behaviorHints?.filename
  const NOISE = /^(?:\d{3,4}p?|x?\.?26[45]|h\.?26[45]|hevc|avc|av1|hi10p?|\d{1,2}\s?-?bit|[0-9a-f]{8}|web|web-?dl|dl|blu-?ray|ray|bd(?:rip|mux)?|hdtv|dvd(?:rip)?|remux|rip|dual\s?audio|multi(?:-?sub|-?audio)?|batch|complete|uncensored|uhd|hd|4k|sd|hdr(?:10\+?)?|dv|flac|aac|opus|ac-?3|e?-?ac-?3|ddp?\+?|atmos|truehd|dts(?:-hd)?)$/i
  const lead = fn?.match(/^\s*\[([^\]]+)\]/)?.[1]?.trim()
  // Scene-style groups appear before the media extension (and often an optional CRC tag), not
  // literally at the end of the full filename. The old end anchor therefore missed e.g.
  // `Show.S01E01.1080p-WAKANIM.mkv`, causing subtitle-style saves to fall back to the anime title.
  const releaseStem = fn
    ?.replace(/\.(?:mkv|mp4|m4v|avi|webm|ts)$/i, '')
    .replace(/\s*\[[0-9A-F]{8}\]\s*$/i, '')
  const tail = releaseStem?.match(/-([A-Za-z][A-Za-z0-9._]{0,31})$/)?.[1]
  const group = (lead && !NOISE.test(lead) ? lead : undefined)
    || (tail && !NOISE.test(tail) ? tail : undefined)
    || s.description?.match(/🏷️\s*([^\n|]+)/)?.[1]?.trim()

  // Cache state, most-authoritative first:
  //   1. an explicit addon glyph — first-hand, always wins
  //   2. a __cache hint from the provider cache-check pass
  //   3. a row with a resolved URL and no infoHash is a direct HTTP stream that genuinely plays
  //      now, so 'instant' is honest
  //   4. an infoHash with no glyph and no hint (every source-extension torrent) is genuinely
  //      UNKNOWN — it is not evidence of caching, and calling it 'instant' is what let pickBest
  //      auto-commit to a stalling debrid download
  const glyphCached = isCached(s)
  const glyphUncached = isUncached(s)
  const cached: CacheState = glyphCached ? 'instant'
    : glyphUncached ? (seeders === 0 ? 'down' : 'uncached')
    : s.__cache === 'cached' ? 'instant'
    : s.__cache === 'uncached' ? (seeders === 0 ? 'down' : 'uncached')
    : s.infoHash ? 'unknown'
    : 'instant'
  const cacheSource: CacheSource | undefined = (glyphCached || glyphUncached) ? 'glyph'
    : s.__cache ? (s.__cacheSource ?? 'native')
    : undefined

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
    dualAudio, audio, audioLanguages, source, batch, seeders, sizeBytes, sizeLabel,
    provider, addon, server: s.__server, logo: s.__logo, subtitleLabel,
    cached, cacheSource, badges, langMismatch: s.__langMismatch,
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
  // Cross-style "1x04". The season group is capped at two digits so a resolution can't parse as
  // one: "1920x1080" offers no two-or-fewer-digit run ending at the x that starts on a boundary.
  const cross = f.match(/\b(\d{1,2})x(\d{1,3})\b/)
  if (cross) return { season: Number(cross[1]), episode: Number(cross[2]) }
  // Written-out episode numbering, which anime releases use as often as the scene forms. Longest
  // spelling first: `\bep` would otherwise match the start of "Episode" and then fail on the
  // letters that follow.
  const written = f.match(/\bepisode\s*(\d{1,4})\b/i) || f.match(/\bep\.?\s*(\d{1,3})\b/i)
  if (written) return { abs: Number(written[1]) }
  // Ordinal season: "2nd Season", "3rd Season" → the ORDINAL is the season. Must come before the
  // "Season NN" branch below, which would otherwise misread "2nd Season 01" as season 1 (the "01"
  // is the episode of the 2nd season, not the season). Lets the verifier reject a sequel-season
  // pack when the requested title is a DIFFERENT part of the franchise.
  const ord = f.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)\s+Season\b/i)
  if (ord) return { season: Number(ord[1]) }
  // Season plus a dash-separated episode: "[ASW] Honzuki no Gekokujou S4 - 17", the dominant anime
  // fansub form. Read BOTH numbers. Season-only used to win here, which left the episode invisible
  // to the verifier — so a title whose season could not be compared (a TVDB absolute mapping, where
  // TVDB's season numbering is not the scene's) had nothing left to check, and a wrong episode from
  // the right cour passed. The episode is capped at three digits and must not be followed by more
  // digits, so a resolution or a CRC in the same position cannot be read as one.
  const seasonDashEp = f.match(/\bS(?:eason\s*)?(\d{1,2})\b[^\dA-Za-z]{0,4}-\s*(\d{1,3})(?!\d)/i)
  if (seasonDashEp) return { season: Number(seasonDashEp[1]), episode: Number(seasonDashEp[2]) }
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
// An explicit episode is checked, while a season pack with no episode token remains eligible.
export function isWrongSeason(s: Stream, want: { season?: number; episode?: number; abs?: number }): boolean {
  if (want.season == null && want.episode == null && want.abs == null) return false
  const p = parseSeasonEp(s)
  // The ground truth and the release name can be in two DIFFERENT coordinate systems. AniZip's
  // season/absolute numbers come from TVDB, which folds some franchises into a single season and
  // counts straight through it, while the scene numbers by cour. Ascendance of a Bookworm S4 is the
  // worst case: TVDB says season 1, episode 43 for what AniList calls episode 17, and the releases
  // are all named `S4 - 17` / `S04E17`. Comparing those coordinates directly declared every correct
  // file "confidently wrong" and left only the one file numbered TVDB's way — a title where the
  // right sources appeared for a moment and then vanished from the picker.
  const absMapped = want.abs != null && want.episode != null && want.abs !== want.episode
  // With an absolute mapping in play, a stated season is not comparable: TVDB's is not the scene's.
  // A TVDB season above 1 means TVDB does split this show by cour after all, so it IS comparable.
  const seasonComparable = !absMapped || (want.season != null && want.season > 1)
  if (seasonComparable && want.season != null && p.season != null && p.season !== want.season) return true
  // Both numberings name the same episode, so accept either — but only reject on an axis whose
  // ground truth we actually hold. Comparing a season-relative `E01` against an absolute target of
  // 73 would discard a correct file, which is the mirror of the bug above.
  const either = [want.episode, want.abs].filter((n): n is number => n != null)
  // A season pack (`Title S01`) has no explicit episode and remains eligible; a file that actually
  // says S01E03 is confidently wrong when the user requested episode 7.
  if (want.episode != null && p.episode != null && !either.includes(p.episode)) return true
  if (want.abs != null && p.abs != null && !either.includes(p.abs)) return true
  // Without an absolute mapping, the common `Title - 07` form is the per-title episode number.
  if (want.abs == null && want.episode != null && p.abs != null && p.abs !== want.episode) return true
  return false
}
