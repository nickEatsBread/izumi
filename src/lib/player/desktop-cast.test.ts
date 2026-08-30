import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { get } from 'svelte/store'
import {
  desktopCastSession,
  desktopCastStatus,
  desktopCastContentType,
  desktopCastSupportsDlnaSubtitles,
  prepareDesktopCast,
  reconcileDesktopCastStatus,
  seekActiveDesktopCast,
  selectedCastSubtitle,
} from './desktop-cast'

describe('desktop Cast subtitle selection', () => {
  afterEach(() => {
    desktopCastSession.set(null)
    desktopCastStatus.set(null)
    vi.mocked(invoke).mockReset()
  })

  const source = {
    url: 'https://media.example/episode.mp4',
    subtitles: [
      { url: 'https://subs.example/en.srt', lang: 'en', title: 'English' },
      { url: 'https://subs.example/fr.vtt', lang: 'fr', title: 'Français' },
      { url: 'https://subs.example/signs.ass', lang: 'en', title: 'Signs' },
    ],
  }

  it('prefers the exact selected external URL', () => {
    expect(selectedCastSubtitle(source, [{
      type: 'sub', selected: true, lang: 'en', title: 'Wrong label',
      externalFilename: 'https://subs.example/en.srt',
    }])?.url).toBe('https://subs.example/en.srt')
  })

  it('falls back to the selected language or title', () => {
    expect(selectedCastSubtitle(source, [{ type: 'sub', selected: true, lang: 'fr' }])?.url)
      .toBe('https://subs.example/fr.vtt')
  })

  it('does not send ASS/SSA tracks to the Default Media Receiver', () => {
    expect(selectedCastSubtitle(source, [{ type: 'sub', selected: true, title: 'Signs' }])).toBeNull()
  })

  it('uses the MIME aliases advertised by Samsung AllShare TVs', () => {
    const samsung = {
      id: 'samsung', name: '[TV] Samsung Tizen TV', manufacturer: 'Samsung Electronics',
      address: '192.168.1.40', port: 9197, protocol: 'dlna' as const,
    }
    expect(desktopCastContentType(samsung, 'video/x-matroska')).toBe('video/x-mkv')
    expect(desktopCastContentType(samsung, 'audio/flac')).toBe('audio/x-flac')
    expect(desktopCastSupportsDlnaSubtitles(samsung)).toBe(true)
  })

  it('requests Samsung SRT delivery from the LAN relay', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ url: 'http://relay/media', relayed: true, subtitles: [] })
    await prepareDesktopCast(source, source.subtitles.slice(0, 2), {
      forceRelay: true,
      contentType: 'video/x-mkv',
      subtitleDelivery: 'samsungDlna',
    })
    expect(invoke).toHaveBeenCalledWith('cast_prepare_source', {
      request: expect.objectContaining({ subtitleDelivery: 'samsungDlna' }),
    })
  })

  it('keeps a usable remote clock when a legacy renderer omits position fields', () => {
    const previous = {
      state: 'playing' as const,
      positionSeconds: 725,
      durationSeconds: 2_751,
      volume: 0.4,
    }
    expect(reconcileDesktopCastStatus(previous, {
      state: 'idle',
      positionSeconds: 0,
    })).toEqual({
      state: 'idle',
      positionSeconds: 725,
      durationSeconds: 2_751,
      volume: 0.4,
    })
  })

  it('accepts an intentional seek back to the beginning', () => {
    expect(reconcileDesktopCastStatus({
      state: 'playing', positionSeconds: 725, durationSeconds: 2_751,
    }, {
      state: 'playing', positionSeconds: 0,
    }, true).positionSeconds).toBe(0)
  })

  it('routes a matching player seek to the active remote session', async () => {
    desktopCastSession.set({
      deviceId: 'tv', deviceName: 'TV', backend: 'dlna', mediaId: 42, episode: 3,
      subtitles: [], activeTrackIds: [],
    })
    desktopCastStatus.set({ state: 'playing', positionSeconds: 100, durationSeconds: 1_400 })
    vi.mocked(invoke).mockResolvedValueOnce({
      state: 'playing', positionSeconds: 100, durationSeconds: 1_400,
    })

    await expect(seekActiveDesktopCast(615, 42, 3)).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('desktop_cast_control', {
      request: { action: 'seek', positionSeconds: 615 },
    })
    expect(get(desktopCastStatus)?.positionSeconds).toBe(615)
  })

  it('does not send a seek from a different player item to the cast', async () => {
    desktopCastSession.set({
      deviceId: 'tv', deviceName: 'TV', backend: 'dlna', mediaId: 42, episode: 3,
      subtitles: [], activeTrackIds: [],
    })
    await expect(seekActiveDesktopCast(615, 99, 1)).resolves.toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })
})
