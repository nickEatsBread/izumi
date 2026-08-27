import { describe, expect, it } from 'vitest'
import {
  classifySourceDocument,
  classifySourceSpec,
  classifySourceSpecShape,
  sourceSpecFetchUrl,
} from './classify-source-spec'

const catalog = {
  formatVersion: 1,
  generatedAt: '2026-07-26T20:14:38.418Z',
  scope: { content: 'anime', transport: 'http', manga: false },
  packages: [
    { id: 'a', name: 'A', version: '1', nsfw: false, sources: [], backend: 'izumi-js', package: 'https://x/a.izumi-ext', packageSha256: 'aa', packageBytes: 1 },
  ],
}

const stremio = {
  id: 'com.stremio.torrentio.addon',
  name: 'Torrentio',
  version: '0.0.15',
  description: 'Provides torrent streams',
  resources: ['stream'],
  types: ['movie', 'series'],
}

const extensionConfig = {
  id: 'animepahe',
  name: 'Animepahe',
  version: '1.2.3',
  type: 'onlinestream-provider',
  payloadURI: 'https://example.test/src/anime/animepahe/provider.ts',
}

describe('classifySourceSpecShape', () => {
  it('rejects empty and quotes-only input', () => {
    expect(classifySourceSpecShape('')).toEqual({ error: 'Enter a URL, GitHub repo, or catalog.' })
    expect(classifySourceSpecShape('   ')).toEqual({ error: 'Enter a URL, GitHub repo, or catalog.' })
    expect(classifySourceSpecShape('""')).toEqual({ error: 'Enter a URL, GitHub repo, or catalog.' })
  })

  it('treats gh:, npm:, and owner/repo as community sources without fetching', () => {
    expect(classifySourceSpecShape('gh:owner/anime-extensions')).toEqual({
      kind: 'extension', spec: 'gh:owner/anime-extensions',
    })
    expect(classifySourceSpecShape('npm:some-pkg')).toEqual({ kind: 'extension', spec: 'npm:some-pkg' })
    expect(classifySourceSpecShape('owner/repo')).toEqual({ kind: 'extension', spec: 'owner/repo' })
  })

  it('normalizes stremio:// install links as add-ons', () => {
    expect(classifySourceSpecShape('stremio://torrent.example/secret/manifest.json')).toEqual({
      kind: 'addon', spec: 'https://torrent.example/secret',
    })
  })

  it('does not guess a kind for http(s) URLs', () => {
    expect(classifySourceSpecShape('https://torrentio.strem.fun/manifest.json')).toBe('url')
    expect(classifySourceSpecShape('https://raw.githubusercontent.com/org/repo/index.json')).toBe('url')
  })
})

describe('sourceSpecFetchUrl', () => {
  it('fetches a .json URL as given', () => {
    expect(sourceSpecFetchUrl('https://raw.githubusercontent.com/org/repo/index.json'))
      .toBe('https://raw.githubusercontent.com/org/repo/index.json')
  })

  it('fetches an add-on base at /manifest.json', () => {
    expect(sourceSpecFetchUrl('https://torrentio.strem.fun'))
      .toBe('https://torrentio.strem.fun/manifest.json')
    expect(sourceSpecFetchUrl('https://torrentio.strem.fun/manifest.json'))
      .toBe('https://torrentio.strem.fun/manifest.json')
  })
})

describe('classifySourceDocument', () => {
  it('classifies a package catalog as a community source', () => {
    expect(classifySourceDocument(catalog, 'https://example.test/index.json')).toEqual({
      kind: 'extension', spec: 'https://example.test/index.json',
    })
    expect(classifySourceDocument({ ...catalog, packages: [] }, 'https://example.test/index.json')).toEqual({
      kind: 'extension', spec: 'https://example.test/index.json',
    })
  })

  it('classifies extension configs as a community source', () => {
    expect(classifySourceDocument([extensionConfig], 'https://example.test/index.json')).toEqual({
      kind: 'extension', spec: 'https://example.test/index.json',
    })
    expect(classifySourceDocument(extensionConfig, 'https://example.test/manifest.json')).toEqual({
      kind: 'extension', spec: 'https://example.test/manifest.json',
    })
  })

  it('classifies a Stremio manifest as an add-on', () => {
    expect(classifySourceDocument(stremio, 'https://torrentio.strem.fun/manifest.json')).toEqual({
      kind: 'addon', spec: 'https://torrentio.strem.fun',
    })
  })

  it('classifies compiled Android plugin lists as community sources', () => {
    expect(classifySourceDocument({ name: 'repo', pluginLists: ['https://x/list.json'] }, 'https://x/index.json')).toEqual({
      kind: 'extension', spec: 'https://x/index.json',
    })
  })

  it('rejects JSON that is neither kind', () => {
    expect(classifySourceDocument({ hello: 'world' }, 'https://example.test/x.json')).toEqual({
      error: "Couldn't tell if that's a Stremio add-on or a community source.",
    })
  })
})

describe('classifySourceSpec', () => {
  it('returns shape results without calling fetch', async () => {
    let called = 0
    const result = await classifySourceSpec('gh:owner/repo', async () => { called += 1; return {} })
    expect(result).toEqual({ kind: 'extension', spec: 'gh:owner/repo' })
    expect(called).toBe(0)
  })

  it('uses the fetched document to pick a kind, and stores the original spec for community sources', async () => {
    const pasted = 'https://raw.githubusercontent.com/org/repo/index.json'
    const result = await classifySourceSpec(pasted, async () => catalog)
    expect(result).toEqual({ kind: 'extension', spec: pasted })
  })

  it('stores the normalized add-on base, not the /manifest.json fetch URL', async () => {
    const result = await classifySourceSpec('https://torrentio.strem.fun', async () => stremio)
    expect(result).toEqual({ kind: 'addon', spec: 'https://torrentio.strem.fun' })
  })

  it('does not guess an add-on when fetch fails', async () => {
    const result = await classifySourceSpec('https://torrentio.strem.fun', async () => {
      throw new Error('network')
    })
    expect(result).toEqual({ error: 'That URL could not be fetched.' })
  })
})
