// Embed-host extractor registry — izumi's equivalent of the reference app's `loadExtractor`.
//
// Providers link to a shared pool of embed hosts, so the extraction logic belongs to the HOST app,
// not to each provider. Without this every port has to reimplement the same handful of hosts (in
// a survey of 19 catalog providers, 10 contained no extraction logic at all — they delegate).
//
// Adding a host = one entry here. Matching is by host suffix, longest first, so a family entry
// ('streamwish.to') can be overridden by a more specific one.

import { findSources, findSubtitles, refererHeaders, linkType, qualityOf } from './common'
import { unpack } from './jsunpacker'
import { emptyResult, type EpisodeServerResult, type Extractor, type ExtractorContext, type ExtractorResult } from './types'

/** Fetch a page as text with the headers embed hosts expect. Returns null on any failure. */
async function getPage(url: string, ctx: ExtractorContext): Promise<string | null> {
  try {
    const res = await ctx.fetch(url, {
      headers: {
        ...refererHeaders(url, ctx.referer),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
    })
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}

function mediaHeaders(url: string): Record<string, string> {
  return { ...refererHeaders(url), Referer: url }
}

/** Expand a master HLS playlist. A media playlist is returned as one auto-quality source. */
async function hlsLinks(
  playlistUrl: string,
  source: string,
  ctx: ExtractorContext,
  referer: string,
): Promise<ExtractorResult['links']> {
  const headers = mediaHeaders(referer)
  let body = ''
  try {
    const response = await ctx.fetch(playlistUrl, { headers })
    if (!response.ok) return []
    body = await response.text()
  } catch {
    return []
  }

  const lines = body.split(/\r?\n/)
  const links: ExtractorResult['links'] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith('#EXT-X-STREAM-INF:')) continue
    const target = lines.slice(index + 1).find((line) => line.trim() && !line.startsWith('#'))?.trim()
    if (!target) continue
    const full = new URL(target, playlistUrl).toString()
    const resolution = lines[index].match(/\bRESOLUTION=\d+x(\d+)/i)?.[1]
    links.push({
      url: full,
      type: 'm3u8',
      quality: resolution ? `${resolution}p` : qualityOf(undefined, full),
      headers,
      source,
    })
  }
  return links.length
    ? links
    : [{ url: playlistUrl, type: 'm3u8', quality: qualityOf(undefined, playlistUrl), headers, source }]
}

/** The JWPlayer/Playerjs family: fetch, unpack, read `sources`/`tracks`. Covers most hosts. */
function packedPlayer(name: string, hosts: string[]): Extractor {
  return {
    name,
    hosts,
    async extract(url, ctx) {
      const page = await getPage(url, ctx)
      if (!page) return emptyResult()
      // The embed page is fetched with the provider page as its Referer, but
      // extracted media is gated on the embed URL itself. Reusing the provider
      // Referer here makes MP4Upload's CDN return 403 after a valid extraction.
      const headers = { ...refererHeaders(url), Referer: url }
      return { links: findSources(page, name, headers), subtitles: findSubtitles(page, headers) }
    },
  }
}

/** StreamTape hides the path in two concatenated fragments assigned to a link element, with the
 *  first few characters of the second fragment deliberately discarded by a substring() call. */
const streamTape: Extractor = {
  name: 'StreamTape',
  hosts: ['streamtape.com', 'streamtape.net', 'streamtape.to', 'streamtape.xyz', 'strtape.tech', 'stape.fun'],
  async extract(url, ctx) {
    const page = await getPage(url, ctx)
    if (!page) return emptyResult()
    const m = unpack(page).match(/robotlink'\s*\)\s*\.innerHTML\s*=\s*(['"])(.*?)\1\s*\+\s*(['"])(.*?)\3\.substring\((\d+)\)/)
    if (!m) return emptyResult()
    const path = `${m[2]}${m[4].substring(Number(m[5]))}`
    // The page emits a protocol-relative host path ('//host/get_video?…'); occasionally a bare
    // path. Absolute → as-is, '//' → add the scheme, otherwise resolve against the embed's origin.
    const origin = (() => { try { return new URL(url).origin } catch { return 'https://streamtape.com' } })()
    const full = path.startsWith('http') ? path
      : path.startsWith('//') ? `https:${path}`
        : `${origin}/${path.replace(/^\/+/, '')}`
    return {
      links: [{ url: full, type: linkType(full), quality: 'auto', headers: refererHeaders(url, ctx.referer), source: 'StreamTape' }],
      subtitles: [],
    }
  },
}

/** DoodStream builds its link from a `/pass_md5/…` handshake plus a random token and a timestamp. */
const doodStream: Extractor = {
  name: 'DoodStream',
  hosts: ['dood.watch', 'doodstream.com', 'dood.to', 'dood.so', 'dood.la', 'dood.ws', 'dood.sh', 'dood.re', 'dood.yt', 'dooood.com', 'ds2play.com', 'd0o0d.com', 'do0od.com'],
  async extract(url, ctx) {
    const page = await getPage(url, ctx)
    if (!page) return emptyResult()
    const md5 = page.match(/\/pass_md5\/[^'"]+/)?.[0]
    if (!md5) return emptyResult()
    const origin = (() => { try { return new URL(url).origin } catch { return '' } })()
    if (!origin) return emptyResult()
    const headers = { ...refererHeaders(url, ctx.referer), Referer: url }
    let base: string
    try {
      const res = await ctx.fetch(`${origin}${md5}`, { headers })
      if (!res.ok) return emptyResult()
      base = (await res.text()).trim()
    } catch { return emptyResult() }
    if (!base.startsWith('http')) return emptyResult()
    // The token and expiry are appended client-side; without them the CDN rejects the request.
    const token = md5.split('/').pop() ?? ''
    const random = Array.from({ length: 10 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('')
    const full = `${base}${random}?token=${token}&expiry=${Date.now()}`
    return { links: [{ url: full, type: 'mp4', quality: qualityOf(undefined, full), headers, source: 'DoodStream' }], subtitles: [] }
  },
}

/** StreamLare resolves an embed id through its JSON API, then returns HLS or redirect links. */
const streamLare: Extractor = {
  name: 'StreamLare',
  hosts: ['streamlare.com', 'streamlare.net', 'slwatch.co'],
  async extract(url, ctx) {
    const id = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (!id) return emptyResult()
    let payload: unknown
    try {
      const response = await ctx.fetch('https://slwatch.co/api/video/stream/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...refererHeaders(url, ctx.referer) },
        body: JSON.stringify({ id }),
      })
      if (!response.ok) return emptyResult()
      payload = await response.json()
    } catch {
      return emptyResult()
    }

    const text = JSON.stringify(payload).replace(/\\\//g, '/')
    const type = text.match(/"type"\s*:\s*"([^"]+)"/i)?.[1]?.toLowerCase()
    const firstFile = text.match(/"file"\s*:\s*"([^"]+)"/i)?.[1]
    if (type === 'hls' && firstFile) {
      return { links: await hlsLinks(firstFile, 'StreamLare', ctx, url), subtitles: [] }
    }

    const links: ExtractorResult['links'] = []
    for (const match of text.matchAll(/"label"\s*:\s*"([^"]+)"[\s\S]*?"file"\s*:\s*"([^"]+)"/g)) {
      try {
        const response = await ctx.fetch(match[2], { method: 'POST', headers: mediaHeaders(url) })
        if (!response.ok || !response.url) continue
        links.push({
          url: response.url,
          type: linkType(response.url),
          quality: qualityOf(match[1], response.url),
          headers: mediaHeaders(url),
          source: 'StreamLare',
        })
      } catch {
        // Try the next advertised quality.
      }
    }
    return { links, subtitles: [] }
  },
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
}

/** OK.ru exposes either an HLS/DASH manifest or a quality-labelled video array in data-options. */
const okRu: Extractor = {
  name: 'OK.ru',
  hosts: ['ok.ru', 'odnoklassniki.ru'],
  async extract(url, ctx) {
    const page = await getPage(url, ctx)
    if (!page) return emptyResult()
    const raw = page.match(/\bdata-options\s*=\s*(["'])([\s\S]*?)\1/i)?.[2]
    if (!raw) return emptyResult()
    const options = decodeHtmlAttribute(raw)
    const hls = options.match(/"ondemandHls"\s*:\s*"([^"]+)"/i)?.[1]
    if (hls) return { links: await hlsLinks(hls, 'OK.ru', ctx, url), subtitles: [] }
    const dash = options.match(/"ondemandDash"\s*:\s*"([^"]+)"/i)?.[1]
    if (dash) {
      return {
        links: [{ url: dash, type: 'dash', quality: qualityOf(undefined, dash), headers: mediaHeaders(url), source: 'OK.ru' }],
        subtitles: [],
      }
    }

    const qualityMap: Record<string, string> = {
      ultra: '2160p', quad: '1440p', full: '1080p', hd: '720p',
      sd: '480p', low: '360p', lowest: '240p', mobile: '144p',
    }
    const links: ExtractorResult['links'] = []
    for (const item of options.matchAll(/\{[^{}]*"name"\s*:\s*"([^"]+)"[^{}]*"url"\s*:\s*"([^"]+)"[^{}]*\}/g)) {
      if (!item[2].startsWith('https://')) continue
      links.push({
        url: item[2],
        type: linkType(item[2]),
        quality: qualityMap[item[1]] ?? qualityOf(item[1], item[2]),
        headers: mediaHeaders(url),
        source: 'OK.ru',
      })
    }
    return { links: links.reverse(), subtitles: [] }
  },
}

function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function bytesBase64(value: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function aesCbc(
  value: string,
  key: Uint8Array<ArrayBuffer>,
  iv: Uint8Array<ArrayBuffer>,
  encrypt: boolean,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-CBC' }, false, [encrypt ? 'encrypt' : 'decrypt'])
  if (encrypt) {
    return bytesBase64(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, new TextEncoder().encode(value)))
  }
  const clear = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, base64Bytes(value))
  return new TextDecoder().decode(clear)
}

/** Gogo/Vidstreaming uses page-derived AES keys to decrypt its encrypt-ajax response. */
const gogoStream: Extractor = {
  name: 'GogoStream',
  hosts: [
    'gogoplay4.com', 'gogo-stream.com', 'gogostream.com', 'gogostream.co',
    'gogoanime.cm', 'goload.pro', 'goone.pro', 'playtaku.net', 'embtaku.pro',
  ],
  async extract(url, ctx) {
    const page = await getPage(url, ctx)
    if (!page) return emptyResult()
    const digits = (pattern: RegExp) => page.match(pattern)?.[1]?.replace(/\D/g, '')
    const ivText = digits(/<div\b[^>]*class=["'][^"']*\bwrapper\b[^"']*\bcontainer-(\d+)[^"']*["']/i)
    const keyText = digits(/<body\b[^>]*class=["'][^"']*\bcontainer-(\d+)[^"']*["']/i)
    const decryptText = digits(/<div\b[^>]*class=["'][^"']*\bvideocontent-(\d+)[^"']*["']/i)
    const dataValue = page.match(/<script\b[^>]*\bdata-value=["']([^"']+)["']/i)?.[1]
    if (!ivText || !keyText || !decryptText || !dataValue) return emptyResult()

    try {
      const parsed = new URL(url)
      const id = parsed.searchParams.get('id')
      if (!id) return emptyResult()
      const iv = new TextEncoder().encode(ivText)
      const key = new TextEncoder().encode(keyText)
      const decryptKey = new TextEncoder().encode(decryptText)
      const params = (await aesCbc(dataValue, key, iv, false)).split('&').slice(1).join('&')
      const encryptedId = encodeURIComponent(await aesCbc(id, key, iv, true))
      const response = await ctx.fetch(
        `${parsed.origin}/encrypt-ajax.php?id=${encryptedId}&${params}&alias=${encodeURIComponent(id)}`,
        { headers: { 'X-Requested-With': 'XMLHttpRequest', ...refererHeaders(url, url) } },
      )
      if (!response.ok) return emptyResult()
      const wrapped = await response.json() as { data?: string }
      if (!wrapped?.data) return emptyResult()
      const decoded = JSON.parse(await aesCbc(wrapped.data, decryptKey, iv, false)) as {
        source?: { file: string; label?: string; type?: string }[]
      }
      const sources = decoded.source ?? []
      if (sources.length === 1 && (sources[0].type === 'hls' || linkType(sources[0].file) === 'm3u8')) {
        return { links: await hlsLinks(sources[0].file, 'GogoStream', ctx, url), subtitles: [] }
      }
      return {
        links: sources.map((item) => ({
          url: item.file,
          type: linkType(item.file),
          quality: qualityOf(item.label, item.file),
          headers: mediaHeaders(url),
          source: 'GogoStream',
        })),
        subtitles: [],
      }
    } catch {
      return emptyResult()
    }
  },
}

// Host families that all serve the same packed JWPlayer config. Grouped rather than duplicated
// because these domains rotate constantly and the parsing never changes.
const PACKED_HOSTS: [string, string[]][] = [
  ['StreamWish', ['streamwish.to', 'streamwish.com', 'awish.pro', 'dwish.pro', 'mwish.pro', 'swishsrv.com', 'hlswish.com', 'embedwish.com', 'wishembed.pro', 'streamwish.site']],
  ['FileLions', ['filelions.to', 'filelions.com', 'filelions.online', 'filelions.site', 'fviplions.com', 'alions.pro', 'ajmidyadfihayh.sbs']],
  ['VidHide', ['vidhide.com', 'vidhidepro.com', 'vidhidevip.com', 'vidhideplus.com', 'smoothpre.com', 'dhtpre.com']],
  ['Filemoon', ['filemoon.sx', 'filemoon.to', 'filemoon.in', 'filemoon.link', 'moonplayer.site', 'kerapoxy.cc']],
  ['Vidmoly', ['vidmoly.to', 'vidmoly.me', 'vidmoly.net']],
  ['Mp4Upload', ['mp4upload.com']],
  ['StreamRuby', ['streamruby.com', 'rubystm.com', 'rubyvid.com']],
  ['Voe', ['voe.sx', 'voe-unblock.com', 'voeunblock.com']],
  ['StreamHG', ['streamhg.com', 'hglink.to', 'ultrastream.online']],
  ['Vtube', ['vtube.to', 'vtbe.to', 'vtplay.net']],
  ['Vidoza', ['vidoza.net']],
  ['Uqload', ['uqload.com', 'uqload.io', 'uqload.co', 'uqload.net']],
  ['GenericM3U8', []], // fallback only — never host-matched
]

export const extractors: Extractor[] = [
  ...PACKED_HOSTS.filter(([, hosts]) => hosts.length).map(([name, hosts]) => packedPlayer(name, hosts)),
  streamTape,
  doodStream,
  streamLare,
  okRu,
  gogoStream,
]

/** Host of a URL, lowercased and without a leading `www.`. */
function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

/** The extractor claiming this URL's host, or undefined. Longest suffix wins so a specific entry
 *  beats a family entry. */
export function extractorFor(url: string): Extractor | undefined {
  const host = hostOf(url)
  if (!host) return undefined
  let best: { ext: Extractor; len: number } | undefined
  for (const ext of extractors) {
    for (const h of ext.hosts) {
      if ((host === h || host.endsWith(`.${h}`)) && (!best || h.length > best.len)) best = { ext, len: h.length }
    }
  }
  return best?.ext
}

/**
 * Resolve an embed URL to playable links. Mirrors the reference app's `loadExtractor`: a provider
 * hands over whatever URL it scraped and gets links back, with no per-host knowledge of its own.
 *
 * Falls back to the generic packed-player parser for unknown hosts, since most of them are the same
 * JWPlayer config behind a different domain — a rotated domain then still resolves instead of
 * silently returning nothing. A URL that is already a media file is returned as-is.
 */
export async function loadExtractor(url: string, ctx: ExtractorContext): Promise<ExtractorResult> {
  if (!/^https?:\/\//i.test(url)) return emptyResult()
  // Already a playable file — nothing to extract.
  if (/\.(?:m3u8|mp4|mpd)(?:\?|$)/i.test(url)) {
    return {
      links: [{ url, type: linkType(url), quality: qualityOf(undefined, url), headers: refererHeaders(url, ctx.referer), source: 'Direct' }],
      subtitles: [],
    }
  }
  const ext = extractorFor(url) ?? packedPlayer('Generic', [])
  try { return await ext.extract(url, ctx) } catch { return emptyResult() }
}

/**
 * `loadExtractor` reshaped into what a provider's `findEpisodeServer` must return, so a provider
 * can `return $loadEpisodeServer(embedUrl, pageUrl)` and be done.
 *
 * This is what carries the NAME across: `server` is the resolving extractor's own name (Vidmoly,
 * StreamTape, …), which the picker prints beside the extension name — `⚡ AnimeSama · FR · Vidmoly
 * · 1080p`. Previously every link came back with its `source` set and nothing ever read it, so a
 * resolved embed showed up anonymous.
 *
 * Every link from one embed shares the host's headers, and the sidecar subtitles ride on the first
 * source (they belong to the embed, not to a particular rendition).
 */
export async function loadEpisodeServer(url: string, ctx: ExtractorContext): Promise<EpisodeServerResult> {
  const { links, subtitles } = await loadExtractor(url, ctx)
  const subs = subtitles.map((s) => ({ url: s.url, language: s.label, headers: s.headers }))
  return {
    // Name the resolving extractor; fall back to the calling extension so a row is never unlabelled.
    server: links[0]?.source ?? ctx.extension ?? 'Extractor',
    headers: links[0]?.headers ?? {},
    videoSources: links.map((l, i) => ({
      url: l.url,
      type: l.type,
      quality: l.quality,
      subtitles: i === 0 ? subs : [],
    })),
  }
}
