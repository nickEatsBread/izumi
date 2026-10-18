import { derived, get } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { phttp } from '$lib/net/http'
import { disabledSources } from '$lib/stremio/sources'
import { normalizeTorrentCount, type TorrentQuery, type TorrentResult } from './types'

// Torznab is the search API that indexer managers (Jackett, Prowlarr) put in front of torrent
// trackers. Searching trackers directly finds an episode as soon as it is uploaded, where Stremio
// add-ons index it an hour or two later, and finds titles those add-ons have no id for at all.
// Nothing is configured by default: the user pastes their own indexer's feed URL.
export const torznabUrls = persisted<string[]>('torznab-urls', [])
export const enabledTorznabUrls = derived([torznabUrls, disabledSources], ([$urls, $off]) => $urls.filter((u) => !$off.includes(u)))

const SEARCH_TIMEOUT_MS = 20_000
const MAX_TITLE_TERMS = 3

/** The endpoint for one request. Feed URLs are copied with or without the `/api` suffix, so add it
 *  when missing; the API key and any other parameter the user pasted are kept. */
export function torznabRequestUrl(spec: string, params: Record<string, string>): string {
  const url = new URL(spec.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Enter an http(s) indexer URL.')
  if (!/\/api\/?$/.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, '')}/api`
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

/** Stable picker origin for one feed. Never contains the API key: origins are persisted and synced. */
export function torznabOriginId(spec: string): string {
  const url = new URL(spec.trim())
  return `torznab:${url.host}${url.pathname.replace(/\/(api)?\/?$/, '')}`
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32ToHex(value: string): string {
  let bits = ''
  for (const char of value.toUpperCase()) bits += BASE32.indexOf(char).toString(2).padStart(5, '0')
  return bits.match(/.{4}/g)!.map((nibble) => parseInt(nibble, 2).toString(16)).join('')
}

/** 40-hex infohash from a magnet's btih (hex or the 32-character base32 form). */
export function magnetInfoHash(magnet: string | undefined): string | undefined {
  const btih = magnet?.match(/urn:btih:([a-z0-9]+)/i)?.[1]
  if (!btih) return undefined
  if (/^[a-f0-9]{40}$/i.test(btih)) return btih.toLowerCase()
  return /^[a-z2-7]{32}$/i.test(btih) ? base32ToHex(btih) : undefined
}

const NOT_TORZNAB = 'The indexer did not answer with Torznab XML.'
function parseXml(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error(NOT_TORZNAB)
  // Torznab reports failures (bad API key, unsupported function) as <error code description>.
  const error = document.documentElement.tagName === 'error' ? document.documentElement : null
  if (error) throw new Error(error.getAttribute('description') || `The indexer returned error ${error.getAttribute('code') ?? ''}.`.trim())
  return document
}

const childText = (parent: Element, name: string) => parent.getElementsByTagName(name)[0]?.textContent?.trim() || undefined

function attrs(item: Element): Map<string, string> {
  const out = new Map<string, string>()
  for (const tag of ['newznab:attr', 'torznab:attr']) {
    for (const attr of item.getElementsByTagName(tag)) {
      const name = attr.getAttribute('name')
      const value = attr.getAttribute('value')
      if (name && value != null) out.set(name.toLowerCase(), value)
    }
  }
  return out
}

/** One feed's search results, keyed to their source. Items without a resolvable infohash (a
 *  .torrent-only private tracker row) are skipped: the hash is what playback resolves. */
export function parseTorznabResults(xml: string, spec: string): TorrentResult[] {
  const document = parseXml(xml)
  const channel = document.getElementsByTagName('channel')[0]
  const feedName = (channel && childText(channel, 'title')) || new URL(spec.trim()).hostname
  const results: TorrentResult[] = []
  for (const [rank, item] of [...document.getElementsByTagName('item')].entries()) {
    const title = childText(item, 'title')
    if (!title) continue
    const values = attrs(item)
    const links = [values.get('magneturl'), childText(item, 'link'),
      ...[...item.getElementsByTagName('enclosure')].map((e) => e.getAttribute('url') ?? undefined)]
    const magnet = links.find((link) => link?.startsWith('magnet:'))
    const declared = values.get('infohash')?.toLowerCase()
    const hash = declared && /^[a-f0-9]{40}$/.test(declared) ? declared : magnetInfoHash(magnet)
    if (!hash) continue
    const seeders = normalizeTorrentCount(values.get('seeders'))
    const peers = normalizeTorrentCount(values.get('peers'))
    const size = Number(values.get('size') ?? childText(item, 'size'))
    // Aggregate feeds name the tracker each row came from.
    const indexer = childText(item, 'jackettindexer') ?? childText(item, 'prowlarrindexer')
    results.push({
      title,
      hash,
      link: magnet,
      seeders,
      leechers: peers != null && seeders != null ? Math.max(0, peers - seeders) : normalizeTorrentCount(values.get('leechers')),
      size: size > 0 ? size : undefined,
      provider: indexer ?? feedName,
      providerId: torznabOriginId(spec),
      evidence: { publishedAt: childText(item, 'pubDate'), upstreamRank: rank },
    })
  }
  return results
}

/** Ask a URL for its Torznab capabilities, which proves the feed and its API key work and names the
 *  indexer. null when the URL is not a Torznab feed at all; `error` when it is one that refused. */
export async function checkTorznab(spec: string): Promise<{ name: string } | { error: string } | null> {
  let xml: string
  try {
    xml = await (await phttp(torznabRequestUrl(spec, { t: 'caps' }), { timeoutMs: SEARCH_TIMEOUT_MS })).text()
  } catch { return null }
  try {
    const document = parseXml(xml)
    if (document.documentElement.tagName !== 'caps') return null
    return { name: document.getElementsByTagName('server')[0]?.getAttribute('title') || new URL(spec.trim()).hostname }
  } catch (error) {
    return (error as Error).message === NOT_TORZNAB ? null : { error: (error as Error).message }
  }
}

/** What to type into a tracker's search box. Release names carry the show's title but rarely its
 *  subtitle tail, season wording or year, and trackers match every word, so those are dropped. The
 *  title-only searches return the newest uploads first, which is where a freshly aired episode is;
 *  the numbered search reaches an older episode of a long show. */
export function torznabSearchTerms(query: Pick<TorrentQuery, 'titles' | 'episode'>): string[] {
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

/** Search every enabled feed for an episode. Best-effort: a feed that fails contributes nothing.
 *  Each search's new rows reach `onBatch` as it lands. `onlyId` limits the search to one origin. */
export async function queryTorznab(
  query: TorrentQuery,
  onBatch?: (results: TorrentResult[]) => void,
  onlyId?: string,
  signal?: AbortSignal,
): Promise<TorrentResult[]> {
  const feeds = get(enabledTorznabUrls).filter((spec) => {
    try { return !onlyId || torznabOriginId(spec) === onlyId } catch { return false }
  })
  const terms = torznabSearchTerms(query)
  if (!feeds.length || !terms.length) return []
  const all: TorrentResult[] = []
  await Promise.all(feeds.map(async (spec) => {
    const seen = new Set<string>()
    await Promise.all(terms.map(async (q) => {
      try {
        const response = await phttp(torznabRequestUrl(spec, { t: 'search', q, limit: '100' }), { signal, timeoutMs: SEARCH_TIMEOUT_MS })
        if (!response.ok || signal?.aborted) return
        const fresh = parseTorznabResults(await response.text(), spec).filter((result) => !seen.has(result.hash))
        for (const result of fresh) seen.add(result.hash)
        if (!fresh.length) return
        all.push(...fresh)
        onBatch?.(fresh)
      } catch { /* this search contributed nothing */ }
    }))
  }))
  return all
}
