import { describe, expect, it } from 'vitest'
import { resolveStoreUrl, signatureUrl } from './url'

describe('resolveStoreUrl', () => {
  it('keeps public https links and drops fragments', () => {
    expect(resolveStoreUrl(' https://stores.example.test/index.json#top ')).toBe('https://stores.example.test/index.json')
  })

  it('turns GitHub file pages into raw file links', () => {
    expect(resolveStoreUrl('https://github.com/someone/stores/blob/main/izumi/index.json'))
      .toBe('https://raw.githubusercontent.com/someone/stores/main/izumi/index.json')
  })

  it('expands GitHub shorthand, defaulting to index.json at the repository root', () => {
    expect(resolveStoreUrl('someone/stores')).toBe('https://raw.githubusercontent.com/someone/stores/HEAD/index.json')
    expect(resolveStoreUrl('gh:someone/stores/izumi')).toBe('https://raw.githubusercontent.com/someone/stores/HEAD/izumi/index.json')
    expect(resolveStoreUrl('someone/stores@v2/custom.json')).toBe('https://raw.githubusercontent.com/someone/stores/v2/custom.json')
  })

  it('rejects plain http, credentials, bare words and oversized input', () => {
    expect(resolveStoreUrl('http://stores.example.test/index.json')).toBeNull()
    expect(resolveStoreUrl('https://user:pass@stores.example.test/index.json')).toBeNull()
    expect(resolveStoreUrl('not a store')).toBeNull()
    expect(resolveStoreUrl(`https://x.test/${'a'.repeat(2050)}`)).toBeNull()
  })
})

describe('signatureUrl', () => {
  it('appends .sig to the index path and keeps any query', () => {
    expect(signatureUrl('https://x.test/index.json')).toBe('https://x.test/index.json.sig')
    expect(signatureUrl('https://x.test/index.json?v=2')).toBe('https://x.test/index.json.sig?v=2')
  })
})
