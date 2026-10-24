import { describe, expect, it, vi } from 'vitest'
import { readYoutubeMessage, youtubeCommand, youtubeHandshake } from './youtube-channel'

const frame = {} as Window
const direct = { src: 'https://www.youtube-nocookie.com/embed/x' }
const bridged = { src: 'http://127.0.0.1:4000/embed', bridgeOrigin: 'http://127.0.0.1:4000' }
const info = JSON.stringify({ event: 'infoDelivery', info: { playerState: 1, currentTime: 12.5, duration: 90, muted: false } })

describe('readYoutubeMessage', () => {
  it('reads a direct embed event from a YouTube origin', () => {
    expect(readYoutubeMessage({ source: frame, origin: 'https://www.youtube.com', data: info }, frame, direct))
      .toEqual({ event: 'infoDelivery', info: { playerState: 1, currentTime: 12.5, duration: 90, muted: false } })
  })

  it('ignores another window, another origin, or a frame that has no source yet', () => {
    expect(readYoutubeMessage({ source: {} as Window, origin: 'https://www.youtube.com', data: info }, frame, direct)).toBeNull()
    expect(readYoutubeMessage({ source: frame, origin: 'https://evil.example', data: info }, frame, direct)).toBeNull()
    expect(readYoutubeMessage({ source: frame, origin: 'https://www.youtube.com', data: info }, frame, undefined)).toBeNull()
  })

  it('unwraps the bridge envelope, from the bridge origin only', () => {
    const data = { type: 'izumi-youtube-event', payload: info }
    expect(readYoutubeMessage({ source: frame, origin: bridged.bridgeOrigin, data }, frame, bridged)?.info.duration).toBe(90)
    expect(readYoutubeMessage({ source: frame, origin: 'https://www.youtube.com', data }, frame, bridged)).toBeNull()
    expect(readYoutubeMessage({ source: frame, origin: bridged.bridgeOrigin, data: { type: 'other', payload: info } }, frame, bridged)).toBeNull()
    // A bridged embed never takes a bare YouTube message, even from its own frame.
    expect(readYoutubeMessage({ source: frame, origin: bridged.bridgeOrigin, data: info }, frame, bridged)).toBeNull()
  })

  it('rejects bad JSON, non-string payloads and messages without an event, and defaults info', () => {
    const read = (data: unknown) => readYoutubeMessage({ source: frame, origin: 'https://www.youtube.com', data }, frame, direct)
    expect(read('{not json')).toBeNull()
    expect(read({ event: 'onReady' })).toBeNull()
    expect(read(JSON.stringify({ info: {} }))).toBeNull()
    expect(read('null')).toBeNull()
    expect(read(JSON.stringify({ event: 'onReady' }))).toEqual({ event: 'onReady', info: {} })
    expect(read(JSON.stringify({ event: 'onError', info: 150 }))).toEqual({ event: 'onError', info: {} })
  })
})

describe('youtube commands', () => {
  it('posts the handshake and commands to the YouTube origin, or wrapped to the bridge', () => {
    const postMessage = vi.fn()
    const target = { postMessage } as unknown as Window
    youtubeHandshake(target, direct)
    expect(postMessage).toHaveBeenLastCalledWith(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), 'https://www.youtube-nocookie.com')
    youtubeCommand(target, bridged, 'seekTo', [30, true])
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: 'izumi-youtube-command', payload: JSON.stringify({ event: 'command', func: 'seekTo', args: [30, true] }) },
      'http://127.0.0.1:4000',
    )
    youtubeCommand(undefined, direct, 'playVideo')
    youtubeCommand(target, undefined, 'playVideo')
    expect(postMessage).toHaveBeenCalledTimes(2)
  })
})
