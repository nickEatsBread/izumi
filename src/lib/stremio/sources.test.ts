import { describe, it, expect } from 'vitest'
import { get } from 'svelte/store'
import {
  addonOriginId,
  addonUrls,
  CINEMETA_BASE,
  disabledSources,
  enabledAddonUrls,
  normalizeBase,
  replaceAddonBase,
} from './sources'

describe('enabledAddonUrls', () => {
  it('filters out disabled sources, keeps the rest', () => {
    addonUrls.set(['https://a', 'https://b', 'https://c'])
    disabledSources.set(['https://b'])
    expect(get(enabledAddonUrls)).toEqual(['https://a', 'https://c'])
    disabledSources.set([])
    expect(get(enabledAddonUrls)).toEqual(['https://a', 'https://b', 'https://c'])
    addonUrls.set([]); disabledSources.set([])
  })
})

describe('addonOriginId', () => {
  it('matches normalized forms without exposing a credential-bearing URL', () => {
    const url = 'https://example.com/secret-api-key/manifest.json'
    const id = addonOriginId(url)
    expect(id).toBe(addonOriginId('https://example.com/secret-api-key'))
    expect(id).not.toContain('secret-api-key')
    expect(id).toMatch(/^[a-f0-9]{16}$/)
  })
})

describe('normalizeBase', () => {
  it('accepts the stremio install links emitted by addon configuration pages', () => {
    expect(normalizeBase('stremio://torrent.example/secret/manifest.json'))
      .toBe('https://torrent.example/secret')
    expect(normalizeBase('"https://torrent.example/secret/manifest.json"'))
      .toBe('https://torrent.example/secret')
  })

  it('rejects empty and non-web URLs', () => {
    expect(normalizeBase('')).toBe('')
    expect(normalizeBase('file:///tmp/manifest.json')).toBe('')
  })
})

describe('replaceAddonBase', () => {
  it('reconfigures in place and removes an existing duplicate', () => {
    expect(replaceAddonBase(
      ['https://one.example', 'https://addon.example/old', 'https://addon.example/new'],
      'https://addon.example/old',
      'stremio://addon.example/new/manifest.json',
    )).toEqual(['https://one.example', 'https://addon.example/new'])
  })

  it('installs the public keyless metadata catalog in normalized form', () => {
    expect(replaceAddonBase([], undefined, `${CINEMETA_BASE}/manifest.json`)).toEqual([CINEMETA_BASE])
  })
})
