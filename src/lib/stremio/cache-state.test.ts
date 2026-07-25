import { describe, it, expect } from 'vitest'
import { annotateCache } from './cache-state'
import type { Stream } from './parse'

const s = (infoHash: string, extra: Partial<Stream> = {}): Stream => ({ name: 'x', infoHash, ...extra })

describe('annotateCache', () => {
  it('stamps a cached result with its source', () => {
    const [out] = annotateCache([s('aaa')], new Map([['aaa', 'cached' as const]]), 'native')
    expect(out.__cache).toBe('cached')
    expect(out.__cacheSource).toBe('native')
  })
  it('stamps an uncached result', () => {
    const [out] = annotateCache([s('aaa')], new Map([['aaa', 'uncached' as const]]), 'native')
    expect(out.__cache).toBe('uncached')
  })
  it('leaves a stream absent from the map untouched — absence is not a negative answer', () => {
    const [out] = annotateCache([s('aaa')], new Map(), 'native')
    expect(out.__cache).toBeUndefined()
  })
  it('matches hashes case-insensitively', () => {
    const [out] = annotateCache([s('AAA')], new Map([['aaa', 'cached' as const]]), 'native')
    expect(out.__cache).toBe('cached')
  })
  it('preserves input order', () => {
    const out = annotateCache([s('aaa'), s('bbb')], new Map([['bbb', 'cached' as const]]), 'native')
    expect(out.map((x) => x.infoHash)).toEqual(['aaa', 'bbb'])
  })
  it('does not mutate the input streams', () => {
    const input = s('aaa')
    annotateCache([input], new Map([['aaa', 'cached' as const]]), 'native')
    expect(input.__cache).toBeUndefined()
  })
  it('returns the original array reference when the map is empty', () => {
    const input = [s('aaa')]
    expect(annotateCache(input, new Map(), 'native')).toBe(input)
  })
})
