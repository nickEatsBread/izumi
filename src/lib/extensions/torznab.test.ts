// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const phttp = vi.hoisted(() => vi.fn())
vi.mock('$lib/net/http', () => ({ phttp }))

const {
  checkTorznab, magnetInfoHash, parseTorznabResults, queryTorznab, torznabOriginId,
  torznabRequestUrl, torznabSearchTerms, torznabUrls,
} = await import('./torznab')
const { disabledSources } = await import('$lib/stremio/sources')

const FEED = 'http://indexer.test:9117/api/v2.0/indexers/all/results/torznab/api?apikey=SECRET'
const HEX = 'ad2464124afbac78eb47d872c9090759c5d2123e'
const reply = (body: string) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) })

const item = (title: string, extra: string) => `<item><title>${title}</title>${extra}</item>`
const rss = (...items: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><title>Aggregate</title>${items.join('')}</channel></rss>`

describe('torznab feed URLs', () => {
  it('adds the api path once and keeps the pasted key', () => {
    expect(torznabRequestUrl('http://indexer.test:9696/1/?apikey=K', { t: 'caps' })).toBe('http://indexer.test:9696/1/api?apikey=K&t=caps')
    expect(torznabRequestUrl(FEED, { t: 'search', q: 'Example Show' })).toBe(`${FEED}&t=search&q=Example+Show`)
  })
  it('names one origin per feed without its API key', () => {
    expect(torznabOriginId(FEED)).toBe('torznab:indexer.test:9117/api/v2.0/indexers/all/results/torznab')
    expect(torznabOriginId('http://indexer.test:9696/1/api?apikey=K')).toBe(torznabOriginId('http://indexer.test:9696/1/'))
  })
})

describe('parseTorznabResults', () => {
  it('maps hash, magnet, peers, size and the tracker each row came from', () => {
    const [row] = parseTorznabResults(rss(item('[Group] Example Show - 02 (1080p).mkv', `
      <link>http://indexer.test/dl/1.torrent</link><pubDate>Sun, 18 Oct 2026 15:00:00 +0000</pubDate>
      <jackettindexer id="t1">Tracker One</jackettindexer>
      <torznab:attr name="size" value="1400000000"/><torznab:attr name="seeders" value="120"/>
      <torznab:attr name="peers" value="150"/><torznab:attr name="infohash" value="${HEX.toUpperCase()}"/>
      <torznab:attr name="magneturl" value="magnet:?xt=urn:btih:${HEX}&amp;tr=udp%3A%2F%2Ftracker.test"/>`)), FEED)
    expect(row).toMatchObject({
      title: '[Group] Example Show - 02 (1080p).mkv', hash: HEX, seeders: 120, leechers: 30, size: 1400000000,
      link: `magnet:?xt=urn:btih:${HEX}&tr=udp%3A%2F%2Ftracker.test`, provider: 'Tracker One',
      providerId: torznabOriginId(FEED),
    })
  })
  it('reads a base32 magnet when no infohash is declared, and skips rows with no hash at all', () => {
    const rows = parseTorznabResults(rss(
      item('Base32 row', '<enclosure url="magnet:?xt=urn:btih:VUSGIESK7OWHR22H3BZMSCIHLHC5EER6" type="application/x-bittorrent"/>'),
      item('Torrent-file-only row', '<enclosure url="http://indexer.test/dl/2.torrent" type="application/x-bittorrent"/>'),
    ), FEED)
    expect(rows.map((row) => [row.title, row.hash, row.provider])).toEqual([['Base32 row', HEX, 'Aggregate']])
    expect(magnetInfoHash('magnet:?xt=urn:btih:VUSGIESK7OWHR22H3BZMSCIHLHC5EER6')).toBe(HEX)
  })
  it('surfaces the indexer error instead of an empty list', () => {
    expect(() => parseTorznabResults('<error code="100" description="Invalid API Key"/>', FEED)).toThrow('Invalid API Key')
  })
})

describe('torznabSearchTerms', () => {
  it('searches the short titles without season wording, then the first one with the episode', () => {
    expect(torznabSearchTerms({
      titles: ['Example Saga Season 2', 'Example Saga: The Long Subtitle', 'Rei no Hanashi 2nd Season', 'Example (2024)'],
      episode: 3,
    })).toEqual(['Example Saga', 'Rei no Hanashi', 'Example', 'Example Saga 03'])
  })
})

describe('checkTorznab', () => {
  beforeEach(() => { phttp.mockReset() })
  it('names a working feed, reports a refusal, and passes over anything that is not Torznab', async () => {
    phttp.mockResolvedValueOnce(reply('<caps><server title="Tracker One"/><searching><search available="yes"/></searching></caps>'))
    expect(await checkTorznab(FEED)).toEqual({ name: 'Tracker One' })
    phttp.mockResolvedValueOnce(reply('<error code="100" description="Invalid API Key"/>'))
    expect(await checkTorznab(FEED)).toEqual({ error: 'Invalid API Key' })
    phttp.mockResolvedValueOnce(reply('{"id":"addon","name":"Addon"}'))
    expect(await checkTorznab(FEED)).toBeNull()
  })
})

describe('queryTorznab', () => {
  beforeEach(() => {
    phttp.mockReset()
    torznabUrls.set([FEED, 'http://indexer.test:9696/2/api?apikey=K'])
    disabledSources.set(['http://indexer.test:9696/2/api?apikey=K'])
  })
  it('searches every enabled feed and folds each new release in once', async () => {
    const hit = item('[Group] Example Show - 02 (1080p).mkv', `<torznab:attr name="infohash" value="${HEX}"/>`)
    phttp.mockResolvedValue(reply(rss(hit)))
    const batches: string[][] = []
    const results = await queryTorznab({ titles: ['Example Show'], episode: 2 }, (rows) => batches.push(rows.map((r) => r.hash)))
    expect(results.map((r) => r.hash)).toEqual([HEX])
    expect(batches).toEqual([[HEX]])
    const urls = phttp.mock.calls.map(([url]) => String(url))
    expect(urls).toHaveLength(2)
    expect(urls.every((url) => url.startsWith('http://indexer.test:9117/'))).toBe(true)
  })
  it('asks only the origin a continuation names', async () => {
    phttp.mockResolvedValue(reply(rss()))
    await queryTorznab({ titles: ['Example Show'], episode: 2 }, undefined, 'torznab:elsewhere.test/1')
    expect(phttp).not.toHaveBeenCalled()
  })
})
