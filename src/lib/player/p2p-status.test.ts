import { describe, expect, it } from 'vitest'
import { isDirectP2PStream, shouldShowP2PStatus } from './p2p-status'

describe('P2P playback status visibility', () => {
  it('defaults can distinguish the first buffer from a later stall', () => {
    expect(shouldShowP2PStatus('initial', true, true, false)).toBe(true)
    expect(shouldShowP2PStatus('initial', true, true, true)).toBe(false)
    expect(shouldShowP2PStatus('buffering', true, true, true)).toBe(true)
    expect(shouldShowP2PStatus('buffering', true, false, true)).toBe(false)
  })

  it('supports always-visible and always-hidden modes', () => {
    expect(shouldShowP2PStatus('always', true, false, true)).toBe(true)
    expect(shouldShowP2PStatus('hidden', true, true, false)).toBe(false)
  })

  it('never appears for a debrid URL, even when it carries an info hash', () => {
    const debrid = { url: 'https://cdn.example/video.mkv', infoHash: 'abc123' }
    expect(isDirectP2PStream(debrid)).toBe(false)
    expect(shouldShowP2PStatus('always', isDirectP2PStream(debrid), true, false)).toBe(false)
  })

  it('recognises only the local torrent playback endpoint', () => {
    expect(isDirectP2PStream({
      url: 'http://127.0.0.1:49152/torrents/7/stream',
      infoHash: 'abc123',
    })).toBe(true)
    expect(isDirectP2PStream({ url: 'http://127.0.0.1:49152/other/7', infoHash: 'abc123' })).toBe(false)
  })
})
