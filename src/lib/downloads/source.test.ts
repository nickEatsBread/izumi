import { describe, expect, it } from 'vitest'
import type { Stream } from '$lib/stremio/parse'
import { findSource, savableStream, savedSource } from './source'

const addon = { kind: 'addon', id: 'addon-a' } as Stream['__origin']
const online = { kind: 'online-extension', id: 'provider' } as Stream['__origin']

describe('the source a download saves', () => {
  it('drops the resolver bookkeeping', () => {
    const stream = { name: 'A', infoHash: 'abc', __candidate: { routeId: 'r' }, __evidence: { requestId: 'x' } } as unknown as Stream
    expect(savedSource(stream)).toEqual({ name: 'A', infoHash: 'abc' })
  })

  it('finds the same torrent file in a fresh resolve', () => {
    const saved = { name: 'A', infoHash: 'ABC', fileIdx: 2, __origin: addon } as Stream
    const fresh = [
      { name: 'A', infoHash: 'abc', fileIdx: 1, __origin: addon },
      { name: 'A', infoHash: 'abc', fileIdx: 2, __origin: addon },
    ] as Stream[]
    expect(findSource(fresh, saved)).toBe(fresh[1])
  })

  it('finds an online row again by its label when its link was tokenized anew', () => {
    const row = (title: string, token: string) => ({
      name: 'Provider', title, url: `https://cdn.example/${token}/master.m3u8`, __stream: true, __origin: online, __audio: 'sub',
    }) as Stream
    const saved = row('1080p', 'old')
    const fresh = [row('720p', 'new1'), row('1080p', 'new2')]
    expect(findSource(fresh, saved)).toBe(fresh[1])
  })

  it('finds nothing when the source no longer lists it', () => {
    const saved = { name: 'A', infoHash: 'abc', __origin: addon } as Stream
    expect(findSource([{ name: 'B', infoHash: 'def', __origin: addon } as Stream], saved)).toBeUndefined()
  })

  it('saves a playing torrent or link, never a file already on this device', () => {
    expect(savableStream({ infoHash: 'abc' } as Stream)).toBeTruthy()
    expect(savableStream({ url: 'https://cdn.example/e.mkv' } as Stream)).toBeTruthy()
    expect(savableStream({ url: 'C:\\Users\\me\\Downloads\\e.mkv' } as Stream)).toBeUndefined()
    expect(savableStream({ url: 'file:///home/me/e/video.mp4' } as Stream)).toBeUndefined()
    expect(savableStream(null)).toBeUndefined()
  })
})
