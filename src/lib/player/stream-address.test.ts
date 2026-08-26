import { describe, expect, it } from 'vitest'
import { isLoopbackHttpUrl, replaceLoopbackHost } from './stream-address'

describe('stream address classification', () => {
  it.each([
    'http://localhost:8080/video',
    'http://localhost.:8080/video',
    'http://127.0.0.1/video',
    'http://127.42.3.9/video',
    'http://[::1]:8080/video',
    'http://0.0.0.0:8080/video',
  ])('recognizes loopback HTTP (%s)', (url) => expect(isLoopbackHttpUrl(url)).toBe(true))

  it.each(['https://cdn.example/video', 'file:///tmp/video', 'not a url'])
    ('does not mistake a non-loopback source for a local server (%s)', (url) => {
      expect(isLoopbackHttpUrl(url)).toBe(false)
    })

  it('keeps the local server port, path, and query while advertising a LAN host', () => {
    expect(replaceLoopbackHost('http://127.0.0.1:17871/v/e1.m3u8?token=x', '192.168.1.8'))
      .toBe('http://192.168.1.8:17871/v/e1.m3u8?token=x')
  })
})
