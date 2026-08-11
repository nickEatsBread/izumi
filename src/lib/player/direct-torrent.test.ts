import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('$lib/platform', () => ({ isAndroid: writable(false) }))
vi.mock('$lib/settings/ui', () => ({ torrentAndroidPostSeed: writable(false) }))

import {
  activateDirectTorrentPlayback,
  directTorrentPlayerAttached,
  prepareDirectTorrentNext,
  reportDirectTorrentBuffer,
} from './direct-torrent'

describe('direct torrent buffer governor', () => {
  const bufferCalls = () => mocks.invoke.mock.calls
    .filter(([command]) => command === 'torrent_playback_buffer')

  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    activateDirectTorrentPlayback(101)
  })

  it('does not resend an unchanged threshold after a successful update', async () => {
    mocks.invoke.mockResolvedValue(undefined)

    reportDirectTorrentBuffer(10, 30)
    reportDirectTorrentBuffer(12, 32)
    await Promise.resolve()

    expect(bufferCalls()).toHaveLength(1)
  })

  // The file selection handed to the engine must never be narrowed once playback owns the stream:
  // librqbit calls a torrent with every selected piece present "finished" and sheds its seeders.
  it('never narrows the native file selection during playback', async () => {
    reportDirectTorrentBuffer(10, 30)
    await Promise.resolve()

    expect(mocks.invoke.mock.calls
      .filter(([command]) => command === 'torrent_playback_streaming')).toHaveLength(0)
  })

  it('releases the native startup priority stream after mpv accepts the URL', async () => {
    await directTorrentPlayerAttached(101)

    expect(mocks.invoke).toHaveBeenCalledWith('torrent_playback_player_attached', {
      playbackId: 101,
    })
  })

  it('prepares the next file inside the active season pack', async () => {
    mocks.invoke.mockResolvedValue({
      fileIndex: 3,
      filename: 'Show S01E04.mkv',
      size: 400_000_000,
      downloadedBytes: 0,
      sameTorrent: false,
    })

    await prepareDirectTorrentNext({
      infoHash: 'a'.repeat(40),
      magnet: `magnet:?xt=urn:btih:${'a'.repeat(40)}`,
      preferredFilename: 'Show S01E04.mkv',
      seriesTitle: 'Show',
      episode: 4,
      absoluteEpisode: 4,
      season: 1,
    })

    expect(mocks.invoke).toHaveBeenCalledWith('torrent_playback_prepare_next', {
      playbackId: 101,
      infoHash: 'a'.repeat(40),
      magnet: `magnet:?xt=urn:btih:${'a'.repeat(40)}`,
      preferredFilename: 'Show S01E04.mkv',
      seriesTitle: 'Show',
      episode: 4,
      absoluteEpisode: 4,
      season: 1,
    })
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
