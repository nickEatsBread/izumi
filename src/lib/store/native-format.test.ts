import { describe, expect, it } from 'vitest'
import { isNativeStore, parseNativeStore } from './native-format'

const STORE_URL = 'https://stores.example.test/izumi/index.json'
const HASH = 'a'.repeat(64)
const KEY = `ed25519:${'A'.repeat(43)}=`
const store = (entries: unknown[], extra: Record<string, unknown> = {}) => ({
  app: 'izumi', kind: 'store', schemaVersion: 1, id: 'com.example.store', name: 'Example Store', entries, ...extra,
})

describe('native store index', () => {
  it('recognises only izumi store documents', () => {
    expect(isNativeStore(store([]))).toBe(true)
    expect(isNativeStore({ app: 'izumi', kind: 'theme-catalog' })).toBe(false)
    expect(isNativeStore([])).toBe(false)
  })

  it('refuses newer formats, missing identity and malformed keys', () => {
    expect(() => parseNativeStore(store([], { schemaVersion: 2 }), STORE_URL, 's')).toThrow('newer format')
    expect(() => parseNativeStore(store([], { id: 'Bad Id' }), STORE_URL, 's')).toThrow('id or name')
    expect(() => parseNativeStore(store([], { publicKey: 'rsa:abc' }), STORE_URL, 's')).toThrow('signing key')
    expect(() => parseNativeStore(store(Array.from({ length: 2001 }, () => ({}))), STORE_URL, 's')).toThrow('more than 2000')
  })

  it('normalises addons, streaming sources, packages and themes', () => {
    const { meta, entries, skipped } = parseNativeStore(store([
      { kind: 'source', sourceType: 'stremio-addon', id: 'example-addon', name: 'Example Addon',
        manifestUrl: 'https://addon.example.test/manifest.json', configureUrl: 'https://addon.example.test/configure', manifestId: 'org.example.addon',
        content: ['anime', 'cartoons'], languages: ['EN'], requiresDebrid: true },
      { kind: 'source', sourceType: 'stream-provider', id: 'example-stream', name: 'Example Stream', manifestUrl: 'providers/stream.json' },
      { kind: 'source', sourceType: 'package', id: 'example-package', name: 'Example Package', version: '1.2.0',
        url: 'packages/example.izumi-ext', sha256: HASH, bytes: 123, backend: 'aniyomi-jvm' },
      { kind: 'theme', id: 'example-theme', name: 'Example Theme', version: '1.0.0', themeApi: 2,
        url: 'themes/example.json', sha256: HASH.toUpperCase(), bytes: 2048, author: 'Someone', description: 'An example look.' },
    ], { publicKey: KEY }), STORE_URL, 's1')

    expect(meta).toMatchObject({ id: 'com.example.store', name: 'Example Store', publicKey: KEY })
    expect(skipped).toBe(0)
    expect(entries.map((entry) => entry.key)).toEqual([
      's1:source:example-addon', 's1:source:example-stream', 's1:source:example-package', 's1:theme:example-theme',
    ])
    expect(entries[0]).toMatchObject({
      sourceType: 'stremio-addon', content: ['anime'], languages: ['en'], requiresDebrid: true,
      install: { type: 'addon', manifestUrl: 'https://addon.example.test/manifest.json', configureUrl: 'https://addon.example.test/configure', manifestId: 'org.example.addon' },
    })
    expect(entries[1].install).toEqual({ type: 'extension', spec: 'https://stores.example.test/izumi/providers/stream.json' })
    expect(entries[2].install).toMatchObject({
      type: 'package',
      pkg: { packageFormat: 'izumi-ext', backend: 'aniyomi-jvm', package: 'https://stores.example.test/izumi/packages/example.izumi-ext', packageSha256: HASH, packageBytes: 123 },
    })
    expect(entries[3].install).toMatchObject({
      type: 'theme',
      release: { id: 'example-theme', themeApi: 2, download: 'https://stores.example.test/izumi/themes/example.json', sha256: HASH, author: 'Someone' },
    })
  })

  it('skips malformed entries, ignores kinds this build cannot install, and drops duplicates', () => {
    const { entries, skipped } = parseNativeStore(store([
      { kind: 'source', sourceType: 'stremio-addon', id: 'no-manifest', name: 'No manifest' },
      { kind: 'source', sourceType: 'package', id: 'no-hash', name: 'No hash', version: '1.0.0', url: 'https://x.test/p.izumi-ext', bytes: 1 },
      { kind: 'theme', id: 'http-theme', name: 'Insecure', version: '1.0.0', themeApi: 1, url: 'http://x.test/t.json', sha256: HASH, bytes: 1 },
      { kind: 'plugin', id: 'later', name: 'Later' },
      { kind: 'pack', id: 'later-pack', name: 'Later' },
      { kind: 'source', sourceType: 'future-type', id: 'future', name: 'Future' },
      { kind: 'widget', id: 'widget', name: 'Widget' },
      { kind: 'source', sourceType: 'stream-provider', id: 'dup', name: 'Dup', manifestUrl: 'https://x.test/a.json' },
      { kind: 'source', sourceType: 'stream-provider', id: 'dup', name: 'Dup again', manifestUrl: 'https://x.test/b.json' },
      'not an object',
    ]), STORE_URL, 's')
    expect(entries.map((entry) => entry.name)).toEqual(['Dup'])
    expect(skipped).toBe(5)
  })

  it('holds native themes to the theme catalog rules', () => {
    const theme = { kind: 'theme', name: 'T', version: '1.0.0', themeApi: 2, url: 'https://x.test/t.json', sha256: HASH, bytes: 10, author: 'A', description: 'D.' }
    const { entries, skipped } = parseNativeStore(store([
      { ...theme, id: 'phone-look', platforms: ['phone'] },
      { ...theme, id: 'shared.copy' },
      { ...theme, id: 'too-big', bytes: 1_000_000_000 },
      { ...theme, id: 'no-description', description: undefined },
    ]), STORE_URL, 's')
    expect(entries.map((entry) => entry.id)).toEqual(['phone-look'])
    expect(entries[0].install).toMatchObject({ type: 'theme', release: { platforms: ['phone'] } })
    expect(skipped).toBe(3)
  })

  it('explains a missing schemaVersion', () => {
    expect(() => parseNativeStore(store([], { schemaVersion: undefined }), STORE_URL, 's')).toThrow('no valid schemaVersion')
  })

  it('refuses reserved ids and configurable addons that do not name their manifest id', () => {
    const { entries, skipped } = parseNativeStore(store([
      { kind: 'source', sourceType: 'stream-provider', id: 'constructor', name: 'Reserved', manifestUrl: 'https://x.test/a.json' },
      { kind: 'source', sourceType: 'stremio-addon', id: 'configurable', name: 'Configurable', manifestUrl: 'https://x.test/m.json', configureUrl: 'https://x.test/c' },
      { kind: 'source', sourceType: 'stremio-addon', id: 'plain-addon', name: 'Plain', manifestUrl: 'https://x.test/p.json' },
    ]), STORE_URL, 's')
    expect(entries.map((entry) => entry.id)).toEqual(['plain-addon'])
    expect(skipped).toBe(2)
    expect(() => parseNativeStore(store([], { id: 'prototype' }), STORE_URL, 's')).toThrow('id or name')
  })
})
