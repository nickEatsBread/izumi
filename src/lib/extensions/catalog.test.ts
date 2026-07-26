import { describe, it, expect } from 'vitest'
import { pointerUrl, normalizeManifest, isRunnableType, resolveManifestUrl, manifestProblem, sourceLabel, catalogPackages } from './catalog'

// Shapes below are the real ones served by the catalogs we support, trimmed to the fields we read.

// A marketplace index entry: rich metadata, but the payload lives one hop away behind manifestURI.
const marketplaceEntry = {
  id: 'animepahe',
  name: 'Animepahe',
  description: 'Animepahe streaming provider',
  manifestURI: 'https://example.test/src/anime/animepahe/manifest.json',
  author: 'someone',
  type: 'onlinestream-provider',
  language: 'javascript',
  lang: 'en',
  icon: 'https://example.test/animepahe.png',
}

// A per-provider manifest: carries a SELF-referential manifestURI alongside the real payloadURI.
const providerManifest = {
  id: 'animepahe',
  name: 'Animepahe',
  version: '1.2.3',
  manifestURI: 'https://example.test/src/anime/animepahe/manifest.json',
  language: 'typescript',
  type: 'onlinestream-provider',
  payloadURI: 'https://example.test/src/anime/animepahe/provider.ts',
}

describe('pointerUrl', () => {
  it('follows a marketplace entry to its manifest', () => {
    expect(pointerUrl(marketplaceEntry)).toBe('https://example.test/src/anime/animepahe/manifest.json')
  })

  it('treats a manifest that has a payload as a config, despite its self-referential manifestURI', () => {
    // The regression this guards: following the self-reference loops the provider back to itself
    // and it never resolves to code.
    expect(pointerUrl(providerManifest)).toBeNull()
  })

  it('still follows a bare repo-index pointer', () => {
    expect(pointerUrl({ main: 'sub/index.json' })).toBe('sub/index.json')
    expect(pointerUrl({ url: 'https://example.test/other.json' })).toBe('https://example.test/other.json')
  })

  it('does not mistake a flat config for a pointer', () => {
    expect(pointerUrl({ id: 'x', name: 'X', main: 'index.js', update: 'gh:o/r' })).toBeNull()
    expect(pointerUrl({ code: 'https://example.test/x.js' })).toBeNull()
  })

  it('ignores non-objects', () => {
    expect(pointerUrl(null)).toBeNull()
    expect(pointerUrl('https://example.test/x.json')).toBeNull()
  })
})

describe('isRunnableType', () => {
  it('accepts the three runnable types and untyped entries', () => {
    for (const type of ['torrent', 'onlinestream-provider', 'anime-torrent-provider']) {
      expect(isRunnableType({ type })).toBe(true)
    }
    expect(isRunnableType({})).toBe(true)
  })

  it('rejects catalog entries we have no runtime for', () => {
    // A mixed marketplace also lists manga providers and UI plugins.
    expect(isRunnableType({ type: 'manga-provider' })).toBe(false)
    expect(isRunnableType({ type: 'plugin' })).toBe(false)
  })
})

describe('normalizeManifest', () => {
  const base = 'https://example.test/src/anime/animepahe/manifest.json'

  it('takes payloadURI verbatim as the module URL', () => {
    const [cfg] = normalizeManifest(providerManifest, base)
    expect(cfg).toMatchObject({
      id: 'animepahe',
      name: 'Animepahe',
      type: 'onlinestream-provider',
      code: 'https://example.test/src/anime/animepahe/provider.ts',
    })
  })

  it('carries the content language through, lowercased', () => {
    const [cfg] = normalizeManifest({ ...providerManifest, lang: 'FR' }, base)
    expect(cfg.lang).toBe('fr')
  })

  it('does not mistake the source-code language for the content language', () => {
    // `language: 'typescript'` is how the payload is written; `lang` is what the site serves.
    const [cfg] = normalizeManifest({ ...providerManifest, lang: undefined }, base)
    expect(cfg.lang).toBeUndefined()
  })

  it('drops entries whose type we cannot run', () => {
    expect(normalizeManifest({ ...providerManifest, type: 'manga-provider' }, base)).toEqual([])
  })

  it('drops entries with no module reference at all', () => {
    expect(normalizeManifest(marketplaceEntry, base)).toEqual([])
  })

  it('resolves a relative main against the manifest URL and appends .js', () => {
    const [cfg] = normalizeManifest({ id: 'a', name: 'A', main: 'index' }, 'https://example.test/repo/index.json')
    expect(cfg.code).toBe('https://example.test/repo/index.js')
  })

  it('accepts an array and keeps only the runnable entries', () => {
    const out = normalizeManifest([providerManifest, { ...providerManifest, id: 'm', type: 'manga-provider' }], base)
    expect(out.map((c) => c.id)).toEqual(['animepahe'])
  })
})

// A catalog whose entries name a package and a payload file relative to the index.
describe('package-style catalog', () => {
  const base = 'https://repo.test/index.json'
  // A real entry, trimmed to the fields that are read.
  const video = {
    name: 'Animepahe', package: 'animepahe.ru', type: 'bangumi', lang: 'en',
    url: 'animepahe.ru.js', version: 'v0.0.3', icon: 'https://site.test/i.png',
    author: 'someone', webSite: 'https://animepahe.ru',
  }

  it('resolves the payload against the repo/ folder beside the index', () => {
    const [cfg] = normalizeManifest([video], base)
    expect(cfg).toMatchObject({
      id: 'animepahe.ru',
      name: 'Animepahe',
      type: 'onlinestream-provider',
      code: 'https://repo.test/repo/animepahe.ru.js',
      lang: 'en',
      version: 'v0.0.3',
    })
  })

  it('skips content kinds with no runtime here', () => {
    expect(normalizeManifest([{ ...video, type: 'manga' }], base)).toEqual([])
    expect(normalizeManifest([{ ...video, type: 'fikushon' }], base)).toEqual([])
  })

  it('treats the catch-all language as "unknown" rather than a real one', () => {
    // 'all' would otherwise be badged as a language and rank against the user's preference.
    expect(normalizeManifest([{ ...video, lang: 'all' }], base)[0].lang).toBeUndefined()
  })

  it('narrows a regional tag to its base language', () => {
    expect(normalizeManifest([{ ...video, lang: 'zh-cn' }], base)[0].lang).toBe('zh')
  })

  it('passes an absolute payload URL through untouched', () => {
    expect(normalizeManifest([{ ...video, url: 'https://cdn.test/x.js' }], base)[0].code)
      .toBe('https://cdn.test/x.js')
  })

  it('does not hijack entries that already carry their own code reference', () => {
    // A manifest with both `package` and a payload pointer is not this format.
    const [cfg] = normalizeManifest([{ ...video, payloadURI: 'https://x/p.ts', type: 'onlinestream-provider' }], base)
    expect(cfg.code).toBe('https://x/p.ts')
  })
})

// A source that can NEVER work must say so. Silently expanding to an empty list is the behaviour
// that made a compiled-plugin repo look like an izumi bug.
describe('manifestProblem', () => {
  // The real payload served by a compiled-plugin repository index.
  const compiledRepo = {
    name: 'Providers repository',
    description: 'Extension Repository',
    manifestVersion: 1,
    pluginLists: ['https://example.test/builds/plugins.json'],
  }
  // The real shape of one entry in the plugin list it points at.
  const compiledPlugin = {
    name: 'DailymotionProvider',
    internalName: 'DailymotionProvider',
    apiVersion: 1,
    version: 4,
    status: 1,
    tvTypes: ['Others'],
    url: 'https://example.test/builds/DailymotionProvider.cs3',
    jarUrl: 'https://example.test/builds/DailymotionProvider.jar',
  }

  it('names the compiled-plugin repo index for what it is', () => {
    expect(manifestProblem(compiledRepo)).toMatch(/\.cs3/)
  })

  it('names a compiled plugin LIST too, not just the index', () => {
    expect(manifestProblem([compiledPlugin])).toMatch(/\.cs3/)
  })

  it('catches a compiled entry even without the .cs3 extension in the url', () => {
    expect(manifestProblem([{ name: 'X', internalName: 'X', apiVersion: 1, url: 'https://example.test/X' }])).toMatch(/\.cs3/)
  })

  it('explains an unsupported-but-valid manifest', () => {
    expect(manifestProblem([{ id: 'm', name: 'M', type: 'manga-provider', payloadURI: 'https://x/m.js' }]))
      .toMatch(/can't run/i)
  })

  it('explains a response that is not a manifest at all', () => {
    expect(manifestProblem('not json')).toBe('That URL did not return a valid manifest.')
    expect(manifestProblem(null)).toBe('That URL did not return a valid manifest.')
  })

  it('falls back to a generic message for an empty but well-formed list', () => {
    expect(manifestProblem([{ something: true }])).toBe('No runnable extensions were found in this source.')
  })
})

describe('resolveManifestUrl', () => {
  it('passes a full URL through untouched', () => {
    const u = 'https://example.test/marketplace/main.json'
    expect(resolveManifestUrl(u)).toBe(u)
  })

  it('appends index.json to a bare GitHub shorthand', () => {
    expect(resolveManifestUrl('owner/repo')).toBe('https://esm.sh/gh/owner/repo/index.json')
  })
})

describe('sourceLabel', () => {
  // The regression: both of these are bare arrays with no document-level name, so the settings row
  // showed the raw URL — truncated mid-path, which reads as no title at all.
  it('names a raw GitHub manifest after its repo', () => {
    expect(sourceLabel('https://raw.githubusercontent.com/Seanime-contributions/Seanime-Providers/main/marketplace/main.json'))
      .toBe('Seanime-contributions/Seanime-Providers')
    expect(sourceLabel('https://raw.githubusercontent.com/ReWelp/legacyxclient-Extensions/main/legacy/index.json'))
      .toBe('ReWelp/legacyxclient-Extensions')
  })

  it('names esm.sh and jsDelivr gh paths after the repo too, version suffix dropped', () => {
    expect(sourceLabel('https://esm.sh/gh/owner/repo/index.json')).toBe('owner/repo')
    expect(sourceLabel('https://cdn.jsdelivr.net/gh/owner/repo@1.2.3/index.json')).toBe('owner/repo')
  })

  it('falls back to the hostname for any other URL', () => {
    expect(sourceLabel('https://example.test/some/deep/path/manifest.json')).toBe('example.test')
    expect(sourceLabel('https://www.example.test/manifest.json')).toBe('example.test')
  })

  it('keeps a gh: / shorthand spec as its repo path', () => {
    expect(sourceLabel('gh:owner/repo')).toBe('owner/repo')
    expect(sourceLabel('owner/repo/folder/')).toBe('owner/repo/folder')
  })
})

describe('catalogPackages', () => {
  const catalog = {
    formatVersion: 1,
    generatedAt: '2026-07-26T20:14:38.418Z',
    scope: { content: 'anime', transport: 'http', manga: false },
    packages: [
      { id: 'a', name: 'A', version: '1', nsfw: false, sources: [], backend: 'izumi-js', package: 'https://x/a.izumi-ext', packageSha256: 'aa', packageBytes: 1 },
    ],
  }

  it('recognizes a package catalog and returns its entries', () => {
    expect(catalogPackages(catalog)?.map((p) => p.id)).toEqual(['a'])
  })

  it('distinguishes an EMPTY catalog from a document that is not one', () => {
    // [] and null are different answers: an empty catalog must still render as a catalog row
    // rather than falling through to manifest expansion and being called broken.
    expect(catalogPackages({ ...catalog, packages: [] })).toEqual([])
    expect(catalogPackages([{ id: 'x', name: 'X', payloadURI: 'https://x/x.js' }])).toBeNull()
    expect(catalogPackages(null)).toBeNull()
  })

  it('refuses a newer format version or a scope izumi has no runtime for', () => {
    expect(catalogPackages({ ...catalog, formatVersion: 2 })).toBeNull()
    expect(catalogPackages({ ...catalog, scope: { content: 'manga', transport: 'http', manga: true } })).toBeNull()
  })

  it('drops entries with no id or no payload rather than rendering an uninstallable row', () => {
    expect(catalogPackages({ ...catalog, packages: [...catalog.packages, { name: 'no id' }, { id: 'b' }] })?.map((p) => p.id))
      .toEqual(['a'])
  })

  it('explains a catalog it refused instead of calling the URL unreachable', () => {
    expect(manifestProblem({ ...catalog, formatVersion: 2 })).toMatch(/catalog/i)
  })
})
