import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LoadDoc, transpileSeanime } from '../../src/lib/extensions/seanime-shim'

// Loads the provider through the SAME path the extension Worker uses — sucrase type-strip, append
// the default export, import the resulting module — so the test covers the real load contract, not
// a TypeScript-only import that would hide a runtime-shape mistake.
// Fixtures are the site's own markup, captured live.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const fixture = (name: string) => readFileSync(here(`./fixtures/${name}`), 'utf8')

const INDEX = fixture('index.html')
const LIVEWIRE_SEARCH = fixture('livewire-search.json')
const ANIME = fixture('anime.html')
const EPISODE = fixture('episode.html')

interface Call { url: string; method: string; body?: string }
let calls: Call[] = []
let routes: { match: RegExp; status?: number; body: string }[] = []

// Mirrors the Worker's bridged fetch: a minimal Response-like object, headers as a Map.
function installFetch() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = async (url: string, init?: any) => {
    const method = init?.method ?? 'GET'
    calls.push({ url: String(url), method, body: init?.body })
    const route = routes.find((r) => r.match.test(String(url)))
    if (!route) throw new Error(`unrouted fetch: ${method} ${url}`)
    const status = route.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      url: String(url),
      headers: new Map<string, string>(),
      setCookie: [],
      text: async () => route.body,
      json: async () => JSON.parse(route.body),
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let provider: any

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).LoadDoc = LoadDoc
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).$sleep = async () => {}
  installFetch()
  const src = transpileSeanime(readFileSync(here('./provider.ts'), 'utf8'))
  const code = `${src}\n;export default new Provider();`
  const mod = await import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`)
  provider = mod.default
})

beforeEach(() => {
  calls = []
  routes = [
    { match: /\/livewire\/update$/, body: LIVEWIRE_SEARCH },
    { match: /\/anime\/qtskwpje\/1$/, body: EPISODE },
    { match: /\/anime\/qtskwpje$/, body: ANIME },
    { match: /\/anime$/, body: INDEX },
  ]
})

describe('getSettings', () => {
  it('advertises a single self-hosted server and no dub', () => {
    expect(provider.getSettings()).toEqual({ episodeServers: ['default'], supportsDub: false })
  })
})

describe('search', () => {
  it('decodes the client-rendered title instead of the empty img[alt]', async () => {
    const results = await provider.search({ query: 'eiji' })
    expect(results.length).toBeGreaterThan(0)
    // Titles live three layers deep (HTML entity → JS literal → JSON → \uXXXX). The site's own
    // markup has alt="" server-side, so a naive img[alt] read yields nothing.
    expect(results[0]).toMatchObject({ id: 'qtskwpje', title: '"Eiji"', url: 'https://anizone.to/anime/qtskwpje' })
  })

  it('sends the scraped CSRF token and component snapshot in the wire payload', async () => {
    await provider.search({ query: 'eiji' })
    const post = calls.find((c) => c.method === 'POST')
    expect(post).toBeDefined()
    const payload = JSON.parse(post!.body!)
    expect(payload._token).toMatch(/^[A-Za-z0-9]{40}$/)
    // The snapshot must be the <main> component's, not the layout nav's — otherwise the server
    // accepts the request and changes nothing.
    expect(JSON.parse(payload.components[0].snapshot).memo.name).toBe('pages.anime-index')
    expect(payload.components[0].updates).toEqual({ search: 'eiji' })
  })

  it('does not hit the network for an empty query', async () => {
    expect(await provider.search({ query: '   ' })).toEqual([])
    expect(calls).toEqual([])
  })

  it('dedupes repeated cards by slug', async () => {
    const results = await provider.search({ query: 'eiji' })
    expect(new Set(results.map((r: { id: string }) => r.id)).size).toBe(results.length)
  })
})

describe('findEpisodes', () => {
  it('reads the episode list with numbers taken from the URL', async () => {
    const eps = await provider.findEpisodes('qtskwpje')
    expect(eps).toEqual([
      { id: 'https://anizone.to/anime/qtskwpje/1', number: 1, url: 'https://anizone.to/anime/qtskwpje/1', title: 'Episode 1' },
    ])
  })

  it('skips the lazy-load round-trip when there is no sentinel', async () => {
    await provider.findEpisodes('qtskwpje')
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
  })
})

describe('findEpisodeServer', () => {
  it('returns the HLS source with its sidecar subtitle track', async () => {
    const server = await provider.findEpisodeServer({ id: 'https://anizone.to/anime/qtskwpje/1' }, 'default')
    expect(server.videoSources).toHaveLength(1)
    expect(server.videoSources[0]).toMatchObject({
      url: 'https://seiryuu.vid-cdn.xyz/4cfb51bf-1136-45ff-bf2d-fd16d78e4534/master.m3u8',
      type: 'm3u8',
      quality: 'auto',
    })
    expect(server.videoSources[0].subtitles).toEqual([
      {
        url: 'https://seiryuu.vid-cdn.xyz/4cfb51bf-1136-45ff-bf2d-fd16d78e4534/subtitles/0_en.ass',
        language: 'wowmdildo {+Eternal Blizzard}',
        isDefault: true,
      },
    ])
  })

  it('carries the Referer the stream host requires', async () => {
    const server = await provider.findEpisodeServer({ id: 'https://anizone.to/anime/qtskwpje/1' }, 'default')
    expect(server.headers).toEqual({ Referer: 'https://anizone.to/' })
    expect(server.server).toBe('wowmdildo')
  })

  it('returns no sources rather than throwing when the episode has no id', async () => {
    expect(await provider.findEpisodeServer({}, 'default')).toEqual({ server: 'default', headers: {}, videoSources: [] })
    expect(calls).toEqual([])
  })
})
