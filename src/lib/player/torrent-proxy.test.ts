import { describe, expect, it } from 'vitest'
import { torrentProxyEndpoint } from './torrent-proxy'

describe('torrentProxyEndpoint', () => {
  it('returns null while proxying is disabled', () =>
    expect(torrentProxyEndpoint(false, 'not a url')).toBeNull())

  it('normalizes a SOCKS5 endpoint', () =>
    expect(torrentProxyEndpoint(true, ' socks5://127.0.0.1:1080 ')).toBe('socks5://127.0.0.1:1080'))

  it('allows authenticated SOCKS5 endpoints', () =>
    expect(torrentProxyEndpoint(true, 'socks5://user:pass@proxy.example:1080'))
      .toBe('socks5://user:pass@proxy.example:1080'))

  it.each([
    ['', 'Enter a SOCKS5 proxy URL'],
    ['http://127.0.0.1:8080', 'SOCKS5 proxies only'],
    ['socks5://127.0.0.1', 'host and port'],
    ['socks5://127.0.0.1:1080/path', 'cannot contain'],
  ])('rejects %s', (value, message) =>
    expect(() => torrentProxyEndpoint(true, value)).toThrow(message))
})
