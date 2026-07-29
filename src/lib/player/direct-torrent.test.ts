import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('$lib/platform', () => ({ isAndroid: writable(false) }))
vi.mock('$lib/settings/ui', () => ({ torrentAndroidPostSeed: writable(false) }))

import {
  activateDirectTorrentPlayback,
  confirmDirectTorrentFileLoaded,
  reportDirectTorrentBuffer,
} from './direct-torrent'

describe('direct torrent buffer governor', () => {
  const bufferCalls = () => mocks.invoke.mock.calls
    .filter(([command]) => command === 'torrent_playback_buffer')

  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    activateDirectTorrentPlayback(101, 'http://127.0.0.1:1234/torrents/1/stream/0')
  })

  it('does not resend an unchanged threshold after a successful update', async () => {
    mocks.invoke.mockResolvedValue(undefined)

    reportDirectTorrentBuffer(10, 30)
    reportDirectTorrentBuffer(12, 32)
    confirmDirectTorrentFileLoaded('http://127.0.0.1:1234/torrents/1/stream/0')
    confirmDirectTorrentFileLoaded('http://127.0.0.1:1234/torrents/1/stream/0')
    await Promise.resolve()

    expect(bufferCalls()).toHaveLength(1)
    expect(mocks.invoke.mock.calls
      .filter(([command]) => command === 'torrent_playback_streaming')).toHaveLength(1)
  })

  it('ignores a late FileLoaded event from the previous episode', () => {
    confirmDirectTorrentFileLoaded('http://127.0.0.1:1234/torrents/0/stream/0')
    expect(mocks.invoke.mock.calls
      .filter(([command]) => command === 'torrent_playback_streaming')).toHaveLength(0)
  })

  it('retries an unchanged threshold when the native update rejects', async () => {
    let attempts = 0
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'torrent_playback_buffer' && attempts++ === 0) {
        return Promise.reject(new Error('bridge unavailable'))
      }
      return Promise.resolve()
    })

    reportDirectTorrentBuffer(10, 30)
    await Promise.resolve()
    reportDirectTorrentBuffer(12, 32)

    expect(bufferCalls()).toHaveLength(2)
  })

  it('does not let an older rejection roll back a newer threshold', async () => {
    let rejectFirst!: (reason: unknown) => void
    let firstBuffer = true
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'torrent_playback_buffer' && firstBuffer) {
        firstBuffer = false
        return new Promise((_, reject) => { rejectFirst = reject })
      }
      return Promise.resolve()
    })

    reportDirectTorrentBuffer(10, 30)
    reportDirectTorrentBuffer(10, 90)
    rejectFirst(new Error('late rejection'))
    await Promise.resolve()
    reportDirectTorrentBuffer(12, 92)

    expect(bufferCalls()).toHaveLength(2)
  })
})
