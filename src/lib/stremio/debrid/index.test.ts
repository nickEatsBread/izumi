import { describe, it, expect } from 'vitest'
import { cacheCheckMode, checkCached, providerList } from './index'

describe('cacheCheckMode', () => {
  it('reports native for the providers with a real endpoint', () => {
    expect(cacheCheckMode('torbox')).toBe('native')
    expect(cacheCheckMode('premiumize')).toBe('native')
  })
  it('reports library for the account-scan providers', () => {
    expect(cacheCheckMode('realdebrid')).toBe('library')
    expect(cacheCheckMode('alldebrid')).toBe('library')
  })
  it('reports none for providers that cannot answer', () => {
    expect(cacheCheckMode('debridlink')).toBe('none')
    expect(cacheCheckMode('megadebrid')).toBe('none')
  })
  it('reports none for an unknown provider id', () => {
    expect(cacheCheckMode('nope')).toBe('none')
  })
})

describe('providerList', () => {
  it('exposes cacheCheck on every entry', () => {
    for (const p of providerList) expect(p.cacheCheck).toBeDefined()
  })
})

describe('checkCached', () => {
  it('returns an empty map for a provider that cannot answer', async () => {
    expect((await checkCached('megadebrid', 'k', ['abc'])).size).toBe(0)
  })
  it('returns an empty map for an empty hash list without calling out', async () => {
    expect((await checkCached('torbox', 'k', [])).size).toBe(0)
  })
})
