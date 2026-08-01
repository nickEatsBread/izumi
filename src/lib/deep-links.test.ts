import { describe, expect, it } from 'vitest'
import { parseDeepLink } from './deep-link-target'

describe('deep links', () => {
  it('routes anime and episode links', () => {
    expect(parseDeepLink('izumi://anime/21')?.path).toBe('/app/anime/21')
    expect(parseDeepLink('izumi://watch/21/1070')?.path).toBe('/app/anime/21?episode=1070')
  })
  it('routes magnets through search without autoplay', () => {
    expect(parseDeepLink('magnet:?xt=urn:btih:abc&dn=Frieren%2001')?.path).toBe('/app/search?q=Frieren%2001')
  })
  it('rejects unrelated and malformed input', () => {
    expect(parseDeepLink('https://example.com')).toBeNull()
    expect(parseDeepLink('not a url')).toBeNull()
  })
})
