import { describe, expect, it } from 'vitest'
import { normalizeStreamBehavior, safeProxyHeaders } from './stream-behavior'

describe('safeProxyHeaders', () => {
  it('keeps normal request headers and rejects injection', () => {
    expect(safeProxyHeaders({ Referer: ' https://example.com/ ', 'X-Bad\r\nInjected': 'yes', Empty: '' }))
      .toEqual({ Referer: 'https://example.com/' })
  })
})

describe('normalizeStreamBehavior', () => {
  it('maps proxyHeaders.request and preserves internal header overrides', () => {
    const out = normalizeStreamBehavior({
      url: 'https://video',
      behaviorHints: { proxyHeaders: { request: { Referer: 'https://addon', Origin: 'https://addon' } } },
      __headers: { Referer: 'https://internal' },
    })
    expect(out.__headers).toEqual({ Referer: 'https://internal', Origin: 'https://addon' })
  })

  it('injects unique tracker sources into the magnet', () => {
    const out = normalizeStreamBehavior({
      infoHash: 'a'.repeat(40),
      sources: ['tracker:udp://tracker.example:80', 'tracker:udp://tracker.example:80', 'dht:ignored'],
    })
    const magnet = new URL(out.__magnet!)
    expect(magnet.searchParams.get('xt')).toBe(`urn:btih:${'a'.repeat(40)}`)
    expect(magnet.searchParams.getAll('tr')).toEqual(['udp://tracker.example:80'])
  })
})
