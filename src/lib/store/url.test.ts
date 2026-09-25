import { describe, expect, it } from 'vitest'
import { canonicalStoreUrl, resolveStoreUrl, signatureUrl } from './url'

describe('resolveStoreUrl', () => {
  it('keeps public https links and drops fragments', () => {
    expect(resolveStoreUrl(' https://stores.example.test/index.json#top ')).toBe('https://stores.example.test/index.json')
  })

  it('turns GitHub file, folder and repository pages into raw links', () => {
    expect(resolveStoreUrl('https://github.com/someone/stores/blob/main/izumi/index.json'))
      .toBe('https://raw.githubusercontent.com/someone/stores/main/izumi/index.json')
    expect(resolveStoreUrl('https://www.github.com/someone/stores/tree/main/izumi'))
      .toBe('https://raw.githubusercontent.com/someone/stores/main/izumi/index.json')
    expect(resolveStoreUrl('https://github.com/someone/stores'))
      .toBe('https://raw.githubusercontent.com/someone/stores/HEAD/index.json')
  })

  it('expands GitHub shorthand, defaulting to index.json at the repository root', () => {
    expect(resolveStoreUrl('someone/stores')).toBe('https://raw.githubusercontent.com/someone/stores/HEAD/index.json')
    expect(resolveStoreUrl('gh:someone/stores/izumi')).toBe('https://raw.githubusercontent.com/someone/stores/HEAD/izumi/index.json')
    expect(resolveStoreUrl('someone/stores@v2/custom.json')).toBe('https://raw.githubusercontent.com/someone/stores/v2/custom.json')
  })

  it('resolves dot segments and refuses shorthand that climbs out of its repository', () => {
    expect(resolveStoreUrl('someone/stores/./izumi/index.json')).toBe('https://raw.githubusercontent.com/someone/stores/HEAD/izumi/index.json')
    expect(resolveStoreUrl('someone/stores/../../../other/repo/HEAD/index.json')).toBeNull()
    expect(resolveStoreUrl('https://stores.example.test/a/../index.json')).toBe('https://stores.example.test/index.json')
  })

  it('rejects plain http, credentials, bare words and oversized input', () => {
    expect(resolveStoreUrl('http://stores.example.test/index.json')).toBeNull()
    expect(resolveStoreUrl('https://user:pass@stores.example.test/index.json')).toBeNull()
    expect(resolveStoreUrl('not a store')).toBeNull()
    expect(resolveStoreUrl(`https://x.test/${'a'.repeat(2050)}`)).toBeNull()
  })

  it('refuses loopback, private-network, mDNS and IPv6-literal hosts', () => {
    for (const host of ['localhost', 'stores.localhost', 'printer.local', '127.0.0.1', '10.0.0.5', '192.168.1.2', '172.20.0.1', '169.254.1.1', '[::1]']) {
      expect(resolveStoreUrl(`https://${host}/index.json`)).toBeNull()
    }
  })

  it('refuses trailing-dot, single-label, private-use and carrier-grade NAT hosts too', () => {
    for (const host of ['localhost.', 'nas.local.', 'router', 'router.', 'db.internal', 'printer.home.arpa', 'box.lan', 'wiki.intranet', '100.64.0.1', '100.127.255.254', '0.0.0.5']) {
      expect(canonicalStoreUrl(`https://${host}/index.json`)).toBeNull()
    }
    expect(canonicalStoreUrl('https://100.63.0.1/index.json')).toBe('https://100.63.0.1/index.json')
    expect(canonicalStoreUrl('https://stores.example.test./index.json')).toBe('https://stores.example.test/index.json')
  })
})

describe('canonicalStoreUrl', () => {
  it('stores one form per location', () => {
    expect(canonicalStoreUrl('https://x.test/a/../i.json#frag')).toBe('https://x.test/i.json')
    expect(canonicalStoreUrl('http://x.test/i.json')).toBeNull()
    expect(canonicalStoreUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('signatureUrl', () => {
  it('appends .sig to the index path and keeps any query', () => {
    expect(signatureUrl('https://x.test/index.json')).toBe('https://x.test/index.json.sig')
    expect(signatureUrl('https://x.test/index.json?v=2')).toBe('https://x.test/index.json.sig?v=2')
  })
})
