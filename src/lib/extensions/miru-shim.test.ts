import { describe, it, expect, vi } from 'vitest'
import { parseMiruHeader, isMiruExtension, createExtensionBase, adaptMiru, MiruElement, episodeNumber } from './miru-shim'

// The banner and method shapes below are copied from real published extensions.

const BANNER = `// ==MiruExtension==
// @name         Animepahe
// @version      v0.0.3
// @author       someone
// @lang         en
// @license      MIT
// @icon         https://site.test/icon.png
// @package      site.test
// @type         bangumi
// @webSite      https://site.test
// @nsfw         false
// ==/MiruExtension==
`

describe('banner', () => {
  it('detects the format and reads its metadata', () => {
    expect(isMiruExtension(BANNER)).toBe(true)
    expect(parseMiruHeader(BANNER)).toMatchObject({
      name: 'Animepahe', package: 'site.test', type: 'bangumi',
      lang: 'en', webSite: 'https://site.test', version: 'v0.0.3', nsfw: false,
    })
  })

  it('ignores payloads of other formats', () => {
    expect(isMiruExtension('class Provider { async search() {} }')).toBe(false)
    expect(parseMiruHeader('class Provider {}')).toBeNull()
  })

  it('strips a trailing slash from the site so concatenation cannot double it', () => {
    expect(parseMiruHeader(BANNER.replace('https://site.test', 'https://site.test/'))?.webSite)
      .toBe('https://site.test')
  })
})

/** A fetch stub in the bridged shape, recording what was requested. */
function stubFetch(body: string) {
  const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = []
  const fetch = vi.fn(async (url: string, init?: never) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => body }
  })
  return { fetch: fetch as never, calls }
}

describe('request', () => {
  const meta = parseMiruHeader(BANNER)!

  it('concatenates onto the site base and parses JSON when it parses', async () => {
    const { fetch, calls } = stubFetch('{"data":[{"title":"A"}]}')
    const Base = createExtensionBase(meta, fetch)
    const res = await new Base().request('/api?m=search&q=x')
    expect(calls[0].url).toBe('https://site.test/api?m=search&q=x')
    expect(res).toEqual({ data: [{ title: 'A' }] })
  })

  it('returns the raw body when it is not JSON', async () => {
    const { fetch } = stubFetch('<html>hello</html>')
    const res = await new (createExtensionBase(meta, fetch))().request('/page')
    expect(res).toBe('<html>hello</html>')
  })

  it('lets the Miru-Url header override the base, and never forwards that header', async () => {
    // Extensions pass an absolute URL in the header with an EMPTY path argument.
    const { fetch, calls } = stubFetch('ok')
    await new (createExtensionBase(meta, fetch))().request('', { headers: { 'Miru-Url': 'https://other.test/x', Referer: 'https://site.test' } })
    expect(calls[0].url).toBe('https://other.test/x')
    expect(calls[0].init?.headers).toEqual({ Referer: 'https://site.test' })
  })

  it('appends queryParameters and carries method + body', async () => {
    const { fetch, calls } = stubFetch('ok')
    await new (createExtensionBase(meta, fetch))().request('/p', { method: 'post', queryParameters: { a: '1 2' }, data: { k: 'v' } })
    expect(calls[0].url).toBe('https://site.test/p?a=1%202')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.body).toBe('{"k":"v"}')
  })
})

describe('element accessors', () => {
  const html = '<div class="a"><span>Hello</span></div><div class="a">Second</div>'

  it('exposes text/innerHTML/outerHTML as awaitable getters', async () => {
    // Upstream these were host round-trips, so extensions await them even though cheerio is sync.
    const el = new MiruElement(html, '.a')
    expect(await el.text).toBe('Hello')
    expect(await el.innerHTML).toBe('<span>Hello</span>')
    expect(await el.outerHTML).toContain('<div class="a">')
  })

  it('reads attributes and drills into a nested selector', async () => {
    const el = new MiruElement('<a href="/x" title="T">go</a>', 'a')
    expect(await el.getAttributeText('href')).toBe('/x')
    expect(await (await new MiruElement(html, '.a').querySelector('span')).text).toBe('Hello')
  })

  it('removeSelector mutates the content', async () => {
    const el = new MiruElement('<p>keep</p><p class="x">drop</p>', 'body')
    expect(await (await el.removeSelector('.x')).text).toBe('keep')
  })
})

describe('base-class behaviour izumi cannot back', () => {
  const meta = parseMiruHeader(BANNER)!

  it('returns a registered default from getSetting', async () => {
    // Upstream resolves `storedValue ?? defaultValue`. There is never a stored value here, so the
    // default must come back — an extension reading its own registered preference and getting
    // undefined takes a broken branch (a quality preference matching no source, for example).
    const ext = new (createExtensionBase(meta, stubFetch('').fetch))()
    await ext.registerSetting({ key: 'prefQuality', defaultValue: '1080p' })
    expect(await ext.getSetting('prefQuality')).toBe('1080p')
    expect(ext.settingKeys).toEqual(['prefQuality'])
  })

  it('prefers an explicit value over the default, and is undefined for unknown keys', async () => {
    const ext = new (createExtensionBase(meta, stubFetch('').fetch))()
    await ext.registerSetting({ key: 'server', value: 'b', defaultValue: 'a' })
    expect(await ext.getSetting('server')).toBe('b')
    expect(await ext.getSetting('never-registered')).toBeUndefined()
  })

  it('throws clearly for XPath rather than returning silent nonsense', () => {
    expect(() => new (createExtensionBase(meta, stubFetch('').fetch))().queryXPath()).toThrow(/XPath/)
  })

  it('unimplemented methods throw, as upstream does', () => {
    const ext = new (createExtensionBase(meta, stubFetch('').fetch))()
    expect(() => ext.detail('x')).toThrow(/not implement/)
  })
})

describe('episodeNumber', () => {
  it('reads the number from a label, else falls back to position', () => {
    expect(episodeNumber('Episode 12', 0)).toBe(12)
    expect(episodeNumber('EP 3', 0)).toBe(3)
    expect(episodeNumber('7', 0)).toBe(7)
    expect(episodeNumber('Special', 4)).toBe(5)
    expect(episodeNumber(undefined, 0)).toBe(1)
  })
})

describe('adapter to the onlinestream contract', () => {
  const fake = {
    search: async (kw: string) => [{ title: `Result ${kw}`, url: 'show-1', cover: 'c.jpg' }],
    detail: async () => ({
      title: 'Show', cover: 'c.jpg', desc: 'd',
      episodes: [
        // A smaller mirror group and a fuller one — the fuller must win.
        { title: 'Mirror', urls: [{ name: 'Episode 1', url: 'e1-mirror' }] },
        { title: '1080p', urls: [{ name: 'Episode 1', url: 'e1' }, { name: 'Episode 2', url: 'e2' }] },
      ],
    }),
    watch: async (url: string) => ({ type: 'hls', url: `https://cdn.test/${url}.m3u8` }),
  }

  it('maps search results to id/title', async () => {
    expect(await adaptMiru(fake).search({ query: 'frieren' }))
      .toEqual([{ id: 'show-1', title: 'Result frieren', url: 'show-1' }])
  })

  it('passes a filter map to search, which filtering extensions mutate immediately', async () => {
    // A real extension does `delete filter[...]` then `Object.entries(filter)` as its first two
    // statements — omitting the argument throws before it issues a single request.
    let received: unknown = 'never called'
    const filtering = {
      ...fake,
      search: async (_kw: string, _page: number, filter: Record<string, string[]>) => {
        received = filter
        delete filter.filter_main_bar
        Object.entries(filter)
        return []
      },
    }
    await adaptMiru(filtering).search({ query: 'x' })
    expect(received).toEqual({})
  })

  it('drops entries with no url or title rather than emitting blank rows', async () => {
    const messy = { ...fake, search: async () => [{ title: 'ok', url: 'u1' }, { title: '', url: 'u2' }, { title: 'x' }] }
    expect(await adaptMiru(messy).search({ query: 'x' })).toEqual([{ id: 'u1', title: 'ok', url: 'u1' }])
  })

  it('returns [] when an extension yields a non-array', async () => {
    const odd = { ...fake, search: async () => null }
    expect(await adaptMiru(odd).search({ query: 'x' })).toEqual([])
  })

  it('picks the most complete episode group', async () => {
    // izumi's episode model is one id per episode, so interleaving groups would produce duplicate
    // rows that all play the same episode.
    const eps = await adaptMiru(fake).findEpisodes('show-1')
    expect(eps).toEqual([
      { id: 'e1', url: 'e1', number: 1, title: 'Episode 1' },
      { id: 'e2', url: 'e2', number: 2, title: 'Episode 2' },
    ])
  })

  it('maps watch() to a video source, translating hls', async () => {
    const server = await adaptMiru(fake).findEpisodeServer({ id: 'e2' }, 'default')
    expect(server.videoSources).toEqual([
      { url: 'https://cdn.test/e2.m3u8', type: 'm3u8', quality: 'auto', subtitles: [] },
    ])
  })

  it('treats a non-hls type as a progressive file', async () => {
    const mp4 = { ...fake, watch: async () => ({ type: 'mp4', url: 'https://cdn.test/v.mp4' }) }
    expect((await adaptMiru(mp4).findEpisodeServer({ id: 'e1' })).videoSources[0].type).toBe('mp4')
  })

  it('returns no sources rather than throwing when watch() yields nothing', async () => {
    const dead = { ...fake, watch: async () => ({}) }
    expect(await adaptMiru(dead).findEpisodeServer({ id: 'e1' }))
      .toEqual({ server: 'default', headers: {}, videoSources: [] })
  })

  it('reports a single server, no dub', async () => {
    expect(await adaptMiru(fake).getSettings()).toEqual({ episodeServers: ['default'], supportsDub: false })
  })
})
