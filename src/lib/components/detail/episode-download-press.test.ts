import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Media } from '$lib/anilist/types'
import type { DownloadItem } from '$lib/downloads/state'

const { startDownload, goto } = vi.hoisted(() => ({ startDownload: vi.fn(async () => {}), goto: vi.fn(async () => {}) }))
vi.mock('$lib/downloads/store', () => ({ startDownload }))
vi.mock('$app/navigation', () => ({ goto }))

import { downloadAudio, downloadCachedOnly, downloadCodec, downloadQuality } from '$lib/settings/ui'
import { downloadDefaults, pressEpisodeDownload } from './episode-download-press'

const media = { id: 21, title: { romaji: 'Show' } } as Media
const item = (status: DownloadItem['status']) => ({ id: '21:5', mediaId: 21, episode: 5, title: 'Show — E5', bytes: 0, downloaded: 0, status, addedAt: 1 }) as DownloadItem

// The press both the episode's own download button and the series header's Download E{n} make.
describe('a press on an episode download', () => {
  beforeEach(() => {
    startDownload.mockClear()
    goto.mockClear()
    downloadQuality.set('1080')
    downloadCachedOnly.set(true)
    downloadAudio.set('dub')
    downloadCodec.set('h265')
  })

  it('queues the episode it names with the Settings → Downloads defaults', () => {
    expect(downloadDefaults()).toEqual({ quality: '1080', cachedOnly: true, audio: 'dub', codec: 'h265' })
    expect(pressEpisodeDownload(media, 5)).toBe('queue')
    expect(startDownload).toHaveBeenCalledExactlyOnceWith(media, 5, { quality: '1080', cachedOnly: true, audio: 'dub', codec: 'h265' })
    expect(goto).not.toHaveBeenCalled()
  })

  it('queues a failed download again', () => {
    expect(pressEpisodeDownload(media, 5, item('error'))).toBe('queue')
    expect(startDownload).toHaveBeenCalledOnce()
  })

  it('opens Downloads once the episode is queued, downloading, paused or saved, and never queues it twice', () => {
    for (const status of ['queued', 'downloading', 'paused', 'done'] as const) {
      expect(pressEpisodeDownload(media, 5, item(status))).toBe('manage')
    }
    expect(startDownload).not.toHaveBeenCalled()
    expect(goto).toHaveBeenCalledTimes(4)
    expect(goto).toHaveBeenCalledWith('/app/downloads')
  })
})
