import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('$lib/platform', () => ({ isAndroid: writable(false) }))
vi.mock('$lib/settings/ui', () => ({ torrentAndroidPostSeed: writable(false) }))

import { activateDirectTorrentPlayback, reportDirectTorrentBuffer } from './direct-torrent'

describe('direct torrent buffer governor', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    activateDirectTorrentPlayback(101)
  })

  it('does not resend an unchanged threshold after a successful update', async () => {
    mocks.invoke.mockResolvedValue(undefined)

    reportDirectTorrentBuffer(10, 30)
    reportDirectTorrentBuffer(12, 32)
    await Promise.resolve()

    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })

  it('retries an unchanged threshold when the native update rejects', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('bridge unavailable')).mockResolvedValue(undefined)

    reportDirectTorrentBuffer(10, 30)
    await Promise.resolve()
    reportDirectTorrentBuffer(12, 32)

    expect(mocks.invoke).toHaveBeenCalledTimes(2)
  })

  it('does not let an older rejection roll back a newer threshold', async () => {
    let rejectFirst!: (reason: unknown) => void
    mocks.invoke
      .mockReturnValueOnce(new Promise((_, reject) => { rejectFirst = reject }))
      .mockResolvedValue(undefined)

    reportDirectTorrentBuffer(10, 30)
    reportDirectTorrentBuffer(10, 90)
    rejectFirst(new Error('late rejection'))
    await Promise.resolve()
    reportDirectTorrentBuffer(12, 92)

    expect(mocks.invoke).toHaveBeenCalledTimes(2)
  })
})
