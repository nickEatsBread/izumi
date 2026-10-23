import { derived, get } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { XMLParser } from 'fast-xml-parser'
import parseTorrent from 'parse-torrent'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { phttp } from '$lib/net/http'
import { disabledSources } from '$lib/stremio/sources'
import { normalizeTorrentCount, type TorrentQuery, type TorrentResult } from './types'

// Torrent trackers searched directly. Searching a tracker finds an episode as soon as it is
// uploaded, where Stremio add-ons index it an hour or two later, and finds titles those add-ons have
// no id for. A feed is any torrent feed the user pastes: an indexer manager's Torznab endpoint, a
// tracker's own RSS search, a fixed "latest uploads" feed, or a search API that answers JSON.
// Nothing is configured by default.
export const trackerFeedUrls = persisted<string[]>('tracker-feed-urls', [])
export const enabledTrackerFeedUrls = derived([trackerFeedUrls, disabledSources], ([$urls, $off]) => $urls.filter((u) => !$off.includes(u)))

const SEARCH_TIMEOUT_MS = 20_000
const MAX_TITLE_TERMS = 3
// A feed that links only .torrent files costs one download per row to learn each hash.
const MAX_TORRENT_FILES = 10

// --- Where the search words go -------------------------------------------------------------------

// "{query}" is the documented slot; "%s" is the browser search-engine convention.
const PLACEHOLDER = /\{query\}|%7Bquery%7D|%s/gi
// Search parameters trackers use, so a search URL copied from the browser works as pasted.
const QUERY_PARAMS = ['q', 'query', 'search', 'term', 'terms', 'keywords', 'search_query', 'searchtext', 's']

const parseUrl = (spec: string) => {
  const url = new URL(spec.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Enter an http(s) feed URL.')
  return url
}
const feedHost = (spec: string) => parseUrl(spec.replace(PLACEHOLDER, '')).hostname

/** An indexer manager's Torznab endpoint (Jackett, Prowlarr), which takes `t=search&q=`. */
export function isTorznabFeed(spec: string): boolean {
  const url = parseUrl(spec)
  return /\/api\/?$/.test(url.pathname) || /torznab/i.test(url.pathname) || url.searchParams.has('apikey')
}

/** False for a fixed feed such as a group's latest uploads: it is read as-is and filtered here. */
export function feedTakesQuery(spec: string): boolean {
  PLACEHOLDER.lastIndex = 0
  return PLACEHOLDER.test(spec) || isTorznabFeed(spec) || QUERY_PARAMS.some((p) => parseUrl(spec).searchParams.has(p))
}

/** A pasted URL that takes search words, so it is checked as a tracker feed before anything else:
 *  asked for an add-on manifest it would search for "/manifest.json", and a JSON search API's
 *  answer can pass for a list of sources. */
export function isSearchFeedUrl(spec: string): boolean {
  try { return feedTakesQuery(spec) } catch { return false }
}

/** The request for one search. A feed that takes no query is requested unchanged. */
export function trackerFeedRequestUrl(spec: string, query: string): string {
  const trimmed = spec.trim()
  PLACEHOLDER.lastIndex = 0
  if (PLACEHOLDER.test(trimmed)) return trimmed.replace(PLACEHOLDER, () => encodeURIComponent(query))
  const url = parseUrl(trimmed)
  if (isTorznabFeed(trimmed)) {
    // Feed URLs are copied with or without the `/api` suffix; the pasted API key is kept.
    if (!/\/api\/?$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, '')}/api`
    url.searchParams.set('t', query === '' ? 'caps' : 'search')
    if (query !== '') { url.searchParams.set('q', query); url.searchParams.set('limit', '100') }
    return url.toString()
  }
  const param = QUERY_PARAMS.find((p) => url.searchParams.has(p))
  if (param) url.searchParams.set(param, query)
  return url.toString()
}

/** Stable picker origin for one feed. Never contains the query string, where API keys live:
 *  origins are persisted and synced. */
export function trackerFeedOriginId(spec: string): string {
  const url = parseUrl(spec.replace(PLACEHOLDER, ''))
  return `tracker:${url.host}${url.pathname.replace(/\/(api)?\/?$/, '')}`
}

/** What to type into a tracker's search box. Release names carry the show's title but rarely its
 *  subtitle tail, season wording or year, and trackers match every word, so those are dropped. The
 *  title-only searches return the newest uploads first, which is where a freshly aired episode is;
 *  the numbered search reaches an older episode of a long show. */
export function trackerSearchTerms(query: Pick<TorrentQuery, 'titles' | 'episode'>): string[] {
  const titles: string[] = []
  const seen = new Set<string>()
  for (const raw of query.titles) {
    const term = raw.split(/[:~]/, 1)[0]
      .replace(/\b(?:season|part|cour)\s*\d+\b|\b\d+(?:st|nd|rd|th)\s+(?:season|part|cour)\b|\(\s*(?:19|20)\d\d\s*\)/gi, ' ')
      .replace(/[^\p{L}\p{N}'’\-\s]+/gu, ' ')
      .replace(/(^|\s)-+/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
    const key = term.toLowerCase()
    if (term.length < 3 || seen.has(key)) continue
    seen.add(key)
    titles.push(term)
    if (titles.length === MAX_TITLE_TERMS) break
  }
  const numbered = titles.length && query.episode != null ? [`${titles[0]} ${String(query.episode).padStart(2, '0')}`] : []
  return [...titles, ...numbered]
}

// --- Reading any torrent feed ----------------------------------------------------------------------

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, parseAttributeValue: false })

type Doc = Record<string, any>
const NOT_A_FEED = 'That URL is not a torrent feed.'

function parseDoc(text: string): Doc {
  let doc: Doc
  try { doc = xml.parse(text) as Doc } catch { throw new Error(NOT_A_FEED) }
  // Torznab reports failures (bad API key, unsupported function) as <error code description>.
  if (doc.error) throw new Error(doc.error['@_description'] || 'The indexer refused the request.')
  if (!doc.rss && !doc.feed && !doc['rdf:RDF'] && !doc.caps) throw new Error(NOT_A_FEED)
  return doc
}

const list = (value: unknown): unknown[] => value == null ? [] : Array.isArray(value) ? value : [value]
const text = (value: unknown): string => typeof value === 'object' && value ? text((value as Doc)['#text']) : value == null ? '' : String(value).trim()
const localName = (key: string) => key.slice(key.lastIndexOf(':') + 1).toLowerCase()

/** Every value in one item, keyed by local element name whatever namespace a tracker invents, so
 *  `<x:infoHash>`, `<torrent><infoHash>` and `<torznab:attr name="infohash">` all read alike. An
 *  attribute is keyed `element.attribute` (`enclosure.url`, `link.href`). */
function itemFacts(item: unknown): { fields: Map<string, string[]>; texts: string[] } {
  const fields = new Map<string, string[]>()
  const texts: string[] = []
  const add = (key: string, value: unknown) => {
    const v = text(value)
    if (!v) return
    fields.set(key, [...(fields.get(key) ?? []), v])
    texts.push(v)
  }
  const walk = (node: unknown, key: string) => {
    if (Array.isArray(node)) { for (const n of node) walk(n, key); return }
    if (node == null || typeof node !== 'object') { add(localName(key), node); return }
    const obj = node as Doc
    if (localName(key) === 'attr' && obj['@_name'] != null) { add(String(obj['@_name']).toLowerCase(), obj['@_value']); return }
    for (const [k, v] of Object.entries(obj)) {
      if (k === '#text') add(localName(key), v)
      else if (k.startsWith('@_')) add(`${localName(key)}.${k.slice(2).toLowerCase()}`, v)
      else walk(v, k)
    }
  }
  walk(item, 'item')
  return { fields, texts }
}

const HASH_FIELDS = ['infohash', 'info_hash', 'btih', 'hash']
const looksJson = (body: string) => /^\s*[[{]/.test(body)

/** A JSON search API's releases: the list, anywhere in the body, holding the most objects with a
 *  title and a hash or magnet, so a list of something else (the API's indexers, say) loses. Their
 *  keys are read like a feed item's elements. */
function jsonItems(body: string): unknown[] {
  let doc: unknown
  try { doc = JSON.parse(body) } catch { throw new Error(NOT_A_FEED) }
  const isRelease = (node: unknown) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    const { fields, texts } = itemFacts(node)
    return (fields.has('title') || fields.has('name'))
      && (HASH_FIELDS.some((f) => fields.has(f)) || texts.some((t) => /^magnet:\?/i.test(t)))
  }
  let best: unknown[] = []
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 4) return
    if (Array.isArray(node)) {
      const releases = node.filter(isRelease)
      if (releases.length > best.length) best = releases
    }
    for (const child of Object.values(node)) walk(child, depth + 1)
  }
  walk(doc, 0)
  return best
}

const UNITS: Record<string, number> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }
/** Bytes from "1468006400", "1.7 GiB" or "Size: 1.37GB". */
export function parseSize(value: string | undefined): number | undefined {
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value) || undefined
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*([KMGT]?)i?B\b/i)
  return match ? Math.round(Number(match[1].replace(',', '.')) * UNITS[match[2].toUpperCase()]) : undefined
}

const HEX_HASH = /^[a-f0-9]{40}$/i
const BASE32_HASH = /^[a-z2-7]{32}$/i

async function hashOf(source: string | Uint8Array): Promise<string | undefined> {
  try { return (await parseTorrent(source)).infoHash?.toLowerCase() } catch { return undefined }
}

/** One feed's rows. Each needs an infohash, the identity playback resolves: declared in a field, read
 *  from a magnet anywhere in the item (its link, an enclosure, the description's HTML), or, for a
 *  feed that only links .torrent files, read from the file itself. */
export async function parseTrackerFeed(
  body: string,
  spec: string,
  fetchTorrentFile: (url: string) => Promise<Uint8Array> = downloadTorrentFile,
): Promise<TorrentResult[]> {
  let feedName = feedHost(spec)
  let items: unknown[]
  if (looksJson(body)) items = jsonItems(body)
  else {
    const doc = parseDoc(body)
    feedName = text((doc.rss?.channel ?? doc['rdf:RDF']?.channel ?? doc.feed)?.title) || feedName
    items = list(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item ?? doc.feed?.entry)
  }
  let filesLeft = MAX_TORRENT_FILES
  const rows = await Promise.all(items.map(async (item, rank): Promise<TorrentResult | null> => {
    const { fields, texts } = itemFacts(item)
    const first = (...names: string[]) => names.flatMap((n) => fields.get(n) ?? [])[0]
    const title = first('title', 'name')
    if (!title) return null
    const magnet = texts.map((t) => t.match(/magnet:\?[^\s"'<>]+/i)?.[0]).find(Boolean)?.replace(/&amp;/g, '&')
    const declared = [first(...HASH_FIELDS), first('guid', 'id')].find((h) => h && (HEX_HASH.test(h) || BASE32_HASH.test(h)))
    const torrentFile = [...fields.get('enclosure.url') ?? [], ...fields.get('link') ?? [], ...fields.get('link.href') ?? []]
      .find((u) => /^https?:\/\//i.test(u) && (/\.torrent(?:[?#]|$)/i.test(u) || /bittorrent/i.test(first('enclosure.type') ?? '')))
    let hash = declared && HEX_HASH.test(declared) ? declared.toLowerCase()
      : declared ? await hashOf(`magnet:?xt=urn:btih:${declared}`)
      : magnet ? await hashOf(magnet) : undefined
    if (!hash && torrentFile && filesLeft > 0) {
      filesLeft -= 1
      hash = await fetchTorrentFile(torrentFile).then(hashOf).catch(() => undefined)
    }
    // An all-zero hash is a search API's "no results" placeholder row.
    if (!hash || /^0+$/.test(hash)) return null
    const seeders = normalizeTorrentCount(first('seeders', 'seeds', 'seed'))
    const peers = normalizeTorrentCount(first('peers'))
    return {
      title,
      hash,
      link: magnet ?? torrentFile,
      seeders,
      leechers: normalizeTorrentCount(first('leechers', 'leeches', 'leechs', 'leech'))
        ?? (peers != null && seeders != null ? Math.max(0, peers - seeders) : undefined),
      size: parseSize(first('size', 'contentlength', 'enclosure.length'))
        ?? texts.map((t) => /\bsize\b/i.test(t) ? parseSize(t.slice(t.search(/\bsize\b/i))) : undefined).find(Boolean),
      // Aggregate feeds name the tracker each row came from; a `tracker` that is an announce URL is no name.
      provider: ['jackettindexer', 'prowlarrindexer', 'indexer', 'tracker'].flatMap((n) => fields.get(n) ?? []).find((v) => !v.includes('://')) ?? feedName,
      providerId: trackerFeedOriginId(spec),
      evidence: { publishedAt: first('pubdate', 'published', 'updated', 'date'), upstreamRank: rank },
    }
  }))
  return rows.filter((row): row is TorrentResult => !!row)
}

// shortcut: only https .torrent links are read (the HTTP plugin's scope); plain-http ones are skipped.
async function downloadTorrentFile(url: string): Promise<Uint8Array> {
  if (!/^https:\/\//i.test(url)) throw new Error('not https')
  const response = await httpFetch(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** Checks a pasted URL is a torrent feed (for a Torznab endpoint, that its API key works) and names
 *  it. null when the URL is not a feed at all; `error` when it is one that refused. */
export async function checkTrackerFeed(spec: string): Promise<{ name: string } | { error: string } | null> {
  const fetchBody = async (query: string) => (await phttp(trackerFeedRequestUrl(spec, query), { timeoutMs: SEARCH_TIMEOUT_MS })).text()
  let body: string
  try { body = await fetchBody('') } catch { return null }
  if (looksJson(body)) {
    // A JSON search API has no feed title and often refuses an empty search, so it counts as a feed
    // once a sample search finds releases ("1080p" is in nearly every video release name).
    try {
      if (jsonItems(body).length || (feedTakesQuery(spec) && jsonItems(await fetchBody('1080p')).length)) return { name: feedHost(spec) }
    } catch { /* not a feed */ }
    return null
  }
  try {
    const doc = parseDoc(body)
    const name = doc.caps ? doc.caps.server?.['@_title'] : text((doc.rss?.channel ?? doc['rdf:RDF']?.channel ?? doc.feed)?.title)
    return { name: name || feedHost(spec) }
  } catch (error) {
    return (error as Error).message === NOT_A_FEED ? null : { error: (error as Error).message }
  }
}

/** Search every enabled feed for an episode. Best-effort: a feed that fails contributes nothing.
 *  Each request's new rows reach `onBatch` as it lands. `onlyId` limits the search to one origin. */
export async function queryTrackerFeeds(
  query: TorrentQuery,
  onBatch?: (results: TorrentResult[]) => void,
  onlyId?: string,
  signal?: AbortSignal,
): Promise<TorrentResult[]> {
  const feeds = get(enabledTrackerFeedUrls).filter((spec) => {
    try { return !onlyId || trackerFeedOriginId(spec) === onlyId } catch { return false }
  })
  const terms = trackerSearchTerms(query)
  if (!feeds.length || !terms.length) return []
  const all: TorrentResult[] = []
  await Promise.all(feeds.map(async (spec) => {
    const seen = new Set<string>()
    let requests: string[]
    try { requests = feedTakesQuery(spec) ? terms.map((q) => trackerFeedRequestUrl(spec, q)) : [spec.trim()] } catch { return }
    await Promise.all(requests.map(async (url) => {
      try {
        const response = await phttp(url, { signal, timeoutMs: SEARCH_TIMEOUT_MS })
        if (!response.ok || signal?.aborted) return
        const fresh = (await parseTrackerFeed(await response.text(), spec)).filter((result) => !seen.has(result.hash))
        for (const result of fresh) seen.add(result.hash)
        if (!fresh.length || signal?.aborted) return
        all.push(...fresh)
        onBatch?.(fresh)
      } catch { /* this request contributed nothing */ }
    }))
  }))
  return all
}
