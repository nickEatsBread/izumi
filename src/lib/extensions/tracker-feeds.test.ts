import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const phttp = vi.hoisted(() => vi.fn())
vi.mock('$lib/net/http', () => ({ phttp }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

const {
  checkTrackerFeed, feedTakesQuery, isSearchFeedUrl, parseSize, parseTrackerFeed, queryTrackerFeeds, trackerFeedOriginId,
  trackerFeedRequestUrl, trackerFeedUrls, trackerSearchTerms,
} = await import('./tracker-feeds')
const { disabledSources } = await import('$lib/stremio/sources')

const TORZNAB = 'http://indexer.test:9117/api/v2.0/indexers/all/results/torznab/api?apikey=SECRET'
const RSS_SEARCH = 'https://tracker.test/?page=rss&q=&c=1_2'
const HEX = 'ad2464124afbac78eb47d872c9090759c5d2123e'
const BASE32 = 'VUSGIESK7OWHR22H3BZMSCIHLHC5EER6' // the same hash, base32-encoded
const HEX2 = '0123456789abcdef0123456789abcdef01234567'
const reply = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) })
const rss = (items: string, ns = '') => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" ${ns}><channel><title>Example Tracker</title>${items}</channel></rss>`

describe('where the search words go', () => {
  it('fills a {query} slot, a browser-style %s, or the search parameter a copied URL already has', () => {
    expect(trackerFeedRequestUrl('https://tracker.test/rss/{query}/1080', 'Example Show')).toBe('https://tracker.test/rss/Example%20Show/1080')
    expect(trackerFeedRequestUrl('https://tracker.test/search?term=%s&rss=1', 'Example')).toBe('https://tracker.test/search?term=Example&rss=1')
    expect(trackerFeedRequestUrl(RSS_SEARCH, 'Example Show')).toBe('https://tracker.test/?page=rss&q=Example+Show&c=1_2')
    expect(trackerFeedRequestUrl('https://tracker.test/rss.php?terms=old', 'Example')).toBe('https://tracker.test/rss.php?terms=Example')
  })
  it('speaks Torznab to an indexer manager, adding the api path once and keeping the key', () => {
    expect(trackerFeedRequestUrl('http://indexer.test:9696/1/?apikey=K', '')).toBe('http://indexer.test:9696/1/api?apikey=K&t=caps')
    expect(trackerFeedRequestUrl(TORZNAB, 'Example Show')).toBe(`${TORZNAB}&t=search&q=Example+Show&limit=100`)
  })
  it('reads a fixed "latest uploads" feed as it is', () => {
    expect(feedTakesQuery('https://group.test/rss/?t&r=1080')).toBe(false)
    expect(feedTakesQuery(RSS_SEARCH)).toBe(true)
  })
  it('tells a search URL, checked as a feed before anything else, from an add-on or a shorthand', () => {
    expect(['https://search.test/search?q={query}', 'https://api.test/q.php?q=', TORZNAB].map(isSearchFeedUrl)).toEqual([true, true, true])
    expect(['https://addon.test/config/manifest.json', 'gh:owner/repo', 'owner/repo', ''].map(isSearchFeedUrl)).toEqual([false, false, false, false])
  })
  it('names one origin per feed and never puts its key in it', () => {
    expect(trackerFeedOriginId(TORZNAB)).toBe('tracker:indexer.test:9117/api/v2.0/indexers/all/results/torznab')
    expect(trackerFeedOriginId('http://indexer.test:9696/1/api?apikey=K')).toBe(trackerFeedOriginId('http://indexer.test:9696/1/'))
    expect(trackerFeedOriginId('https://tracker.test/rss/{query}?passkey=abc')).toBe('tracker:tracker.test/rss')
  })
})

describe('parseTrackerFeed reads every shape of torrent feed', () => {
  it('namespaced tracker fields: hash, peers and a human size', async () => {
    const [row] = await parseTrackerFeed(rss(`<item><title>[Group] Example Show - 02 (1080p).mkv</title>
      <link>https://tracker.test/download/1.torrent</link><pubDate>Sun, 18 Oct 2026 15:00:00 -0000</pubDate>
      <x:seeders>77</x:seeders><x:leechers>22</x:leechers><x:infoHash>${HEX}</x:infoHash><x:size>1.7 GiB</x:size></item>`,
    'xmlns:x="https://tracker.test/xmlns"'), RSS_SEARCH)
    expect(row).toMatchObject({ title: '[Group] Example Show - 02 (1080p).mkv', hash: HEX, seeders: 77, leechers: 22,
      size: Math.round(1.7 * 1024 ** 3), provider: 'Example Tracker', providerId: 'tracker:tracker.test' })
  })
  it('a magnet inside the description HTML, with the size only in its text', async () => {
    const [row] = await parseTrackerFeed(rss(`<item><title>Example.Show.S01E02.1080p.WEB-DL.mkv</title>
      <link><![CDATA[https://tracker.test/download/2.torrent]]></link>
      <description><![CDATA[<a href="magnet:?xt=urn:btih:${BASE32}&amp;tr=udp://tracker.test:80">Magnet Link</a><br />Size: 1.37GB<br />]]></description></item>`), RSS_SEARCH)
    expect(row).toMatchObject({ hash: HEX, size: Math.round(1.37 * 1024 ** 3), link: `magnet:?xt=urn:btih:${BASE32}&tr=udp://tracker.test:80` })
  })
  it('a fixed feed whose link is the magnet and whose guid is the hash', async () => {
    const [row] = await parseTrackerFeed(rss(`<item><title>[Group] Example Show - 03 (1080p) [ABCD1234].mkv</title>
      <link>magnet:?xt=urn:btih:${BASE32}&amp;dn=Example</link><guid isPermaLink="false">${BASE32}</guid>
      <y:size>469.44 MiB</y:size></item>`, 'xmlns:y="https://group.test/xmlns"'), 'https://group.test/rss/?t&r=1080')
    expect(row).toMatchObject({ hash: HEX, size: Math.round(469.44 * 1024 ** 2) })
  })
  it('an indexer manager\'s Torznab attributes, naming the tracker each row came from', async () => {
    const [row] = await parseTrackerFeed(rss(`<item><title>Example Show - 02</title><jackettindexer id="t1">Tracker One</jackettindexer>
      <torznab:attr name="seeders" value="120"/><torznab:attr name="peers" value="150"/><torznab:attr name="size" value="1400000000"/>
      <torznab:attr name="infohash" value="${HEX.toUpperCase()}"/></item>`, 'xmlns:torznab="http://torznab.com/schemas/2015/feed"'), TORZNAB)
    expect(row).toMatchObject({ hash: HEX, seeders: 120, leechers: 30, size: 1400000000, provider: 'Tracker One' })
  })
  it('the older torrent namespace and an Atom feed with a magnet link', async () => {
    const [ez] = await parseTrackerFeed(rss(`<item><title>Example Show S01E02</title><enclosure url="https://tracker.test/3.torrent" length="733" type="application/x-bittorrent"/>
      <torrent xmlns="http://xmlns.ezrss.it/0.1/"><contentLength>1048576</contentLength><infoHash>${HEX}</infoHash><seeds>9</seeds><peers>12</peers></torrent></item>`), RSS_SEARCH)
    expect(ez).toMatchObject({ hash: HEX, seeders: 9, size: 1048576 })
    const [atom] = await parseTrackerFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Tracker</title>
      <entry><title type="text">Example Show 02</title><id>urn:uuid:1</id><link rel="alternate" href="magnet:?xt=urn:btih:${HEX}"/></entry></feed>`, RSS_SEARCH)
    expect(atom).toMatchObject({ title: 'Example Show 02', hash: HEX, provider: 'Atom Tracker' })
  })
  it('reads the hash out of a linked .torrent file when the feed declares none, and skips rows with no way to a hash', async () => {
    const info = 'd6:lengthi1e4:name8:test.mkv12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae'
    const file = new TextEncoder().encode(`d4:info${info}e`)
    const fetchFile = vi.fn(async () => file)
    const rows = await parseTrackerFeed(rss(`<item><title>File only</title><enclosure url="https://tracker.test/4.torrent" type="application/x-bittorrent"/></item>
      <item><title>Nothing to go on</title><link>https://tracker.test/view/5</link></item>`), RSS_SEARCH, fetchFile)
    expect(rows.map((r) => [r.title, r.hash])).toEqual([['File only', createHash('sha1').update(info).digest('hex')]])
    expect(fetchFile).toHaveBeenCalledWith('https://tracker.test/4.torrent')
  })
  it('surfaces an indexer error instead of an empty list', async () => {
    await expect(parseTrackerFeed('<error code="100" description="Invalid API Key"/>', TORZNAB)).rejects.toThrow('Invalid API Key')
  })
  it('a JSON search API: the list of releases wherever it sits, read by field name, next to a list that is not releases', async () => {
    const api = 'https://search.test/search?q={query}&category=5000'
    const rows = await parseTrackerFeed(JSON.stringify({
      query: 'example show',
      results: [
        { title: '[Group] Example Show - 02 (1080p).mkv', tracker: 'Tracker One', size: 1400000000, seeders: 120, peers: 150,
          published: '2026-10-18T15:00:00Z', infohash: HEX.toUpperCase(), magnet: null, details: 'https://tracker.test/view/1' },
        { title: 'Example Show S01E02 1080p WEB-DL', tracker: 'udp://tracker.test:80/announce', seeders: '7', magnet: `magnet:?xt=urn:btih:${HEX2}&dn=Example` },
        { title: 'Example Show 02 (resolve link only)', download: 'https://search.test/download/abc' },
      ],
      indexers: [{ id: 'one', name: 'Tracker One', results: 1, error: null }, { id: 'two', name: 'Tracker Two', results: 0, error: 'timed out' }],
    }), api)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ title: '[Group] Example Show - 02 (1080p).mkv', hash: HEX, seeders: 120, leechers: 30, size: 1400000000,
      provider: 'Tracker One', providerId: 'tracker:search.test/search', evidence: { publishedAt: '2026-10-18T15:00:00Z', upstreamRank: 0 } })
    expect(rows[1]).toMatchObject({ hash: HEX2, seeders: 7, provider: 'search.test', link: `magnet:?xt=urn:btih:${HEX2}&dn=Example` })
  })
  it('a bare JSON list with name and info_hash fields, leaving out an all-zero "no results" row', async () => {
    const api = 'https://api.test/q.php?q='
    const [row] = await parseTrackerFeed(JSON.stringify([
      { id: '1', name: 'Example Show - 02 [1080p]', info_hash: HEX, seeders: '42', leechers: '3', size: '734003200' },
    ]), api)
    expect(row).toMatchObject({ title: 'Example Show - 02 [1080p]', hash: HEX, seeders: 42, leechers: 3, size: 734003200, provider: 'api.test' })
    expect(await parseTrackerFeed(JSON.stringify([{ id: '0', name: 'No results returned', info_hash: '0'.repeat(40), seeders: '0' }]), api)).toEqual([])
  })
  it('reads sizes in bytes or human units', () => {
    expect([parseSize('1468006400'), parseSize('700 MB'), parseSize('Size: 1,5 GiB'), parseSize('n/a')])
      .toEqual([1468006400, 700 * 1024 ** 2, Math.round(1.5 * 1024 ** 3), undefined])
  })
})

describe('trackerSearchTerms', () => {
  it('searches the short titles without season wording, then the first one with the episode', () => {
    expect(trackerSearchTerms({
      titles: ['Example Saga Season 2', 'Example Saga: The Long Subtitle', 'Rei no Hanashi 2nd Season', 'Example (2024)'],
      episode: 3,
    })).toEqual(['Example Saga', 'Rei no Hanashi', 'Example', 'Example Saga 03'])
  })
})

describe('checkTrackerFeed', () => {
  beforeEach(() => { phttp.mockReset() })
  it('names a working feed, reports a refusal, and passes over anything that is not a feed', async () => {
    phttp.mockResolvedValueOnce(reply('<caps><server title="Tracker One"/></caps>'))
    expect(await checkTrackerFeed(TORZNAB)).toEqual({ name: 'Tracker One' })
    phttp.mockResolvedValueOnce(reply(rss('')))
    expect(await checkTrackerFeed(RSS_SEARCH)).toEqual({ name: 'Example Tracker' })
    phttp.mockResolvedValueOnce(reply('<error code="100" description="Invalid API Key"/>'))
    expect(await checkTrackerFeed(TORZNAB)).toEqual({ error: 'Invalid API Key' })
    phttp.mockResolvedValueOnce(reply('{"id":"addon","name":"Addon"}'))
    expect(await checkTrackerFeed('https://addon.test/manifest.json')).toBeNull()
    phttp.mockResolvedValueOnce(reply('<!DOCTYPE html><html><body>search page</body></html>'))
    expect(await checkTrackerFeed(RSS_SEARCH)).toBeNull()
  })
  it('names a JSON search API that refuses an empty search once a sample search finds releases', async () => {
    const api = 'https://search.test/search?q='
    phttp.mockResolvedValueOnce({ ...reply('{"detail":"q is required"}'), ok: false, status: 422 })
    phttp.mockResolvedValueOnce(reply(JSON.stringify({ results: [{ title: 'Example 1080p', infohash: HEX }] })))
    expect(await checkTrackerFeed(api)).toEqual({ name: 'search.test' })
    expect(phttp.mock.calls.map(([url]) => String(url))).toEqual([api, `${api}1080p`])
    phttp.mockResolvedValueOnce({ ...reply('{"detail":"q is required"}'), ok: false, status: 422 })
    phttp.mockResolvedValueOnce(reply('{"results":[]}'))
    expect(await checkTrackerFeed(api)).toBeNull()
  })
})

describe('queryTrackerFeeds', () => {
  const hit = rss(`<item><title>[Group] Example Show - 02 (1080p).mkv</title><link>magnet:?xt=urn:btih:${HEX}</link></item>`)
  beforeEach(() => {
    phttp.mockReset()
    trackerFeedUrls.set([RSS_SEARCH, 'https://group.test/rss/?t&r=1080', TORZNAB])
    disabledSources.set([TORZNAB])
  })
  it('searches every enabled feed, reads a fixed feed once, and folds each release in once per feed', async () => {
    phttp.mockResolvedValue(reply(hit))
    const batches: string[][] = []
    const results = await queryTrackerFeeds({ titles: ['Example Show'], episode: 2 }, (rows) => batches.push(rows.map((r) => r.providerId!)))
    expect(results.map((r) => r.providerId)).toEqual(['tracker:tracker.test', 'tracker:group.test/rss'])
    expect(batches).toHaveLength(2)
    const urls = phttp.mock.calls.map(([url]) => String(url))
    expect(urls).toEqual(expect.arrayContaining(['https://tracker.test/?page=rss&q=Example+Show&c=1_2', 'https://tracker.test/?page=rss&q=Example+Show+02&c=1_2', 'https://group.test/rss/?t&r=1080']))
    expect(urls).toHaveLength(3)
  })
  it('asks only the origin a continuation names', async () => {
    phttp.mockResolvedValue(reply(hit))
    await queryTrackerFeeds({ titles: ['Example Show'], episode: 2 }, undefined, 'tracker:elsewhere.test/1')
    expect(phttp).not.toHaveBeenCalled()
  })
})
