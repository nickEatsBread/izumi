import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  desktopCastContentType,
  desktopCastSupportsDlnaSubtitles,
  prepareDesktopCast,
  selectedCastSubtitle,
} from './desktop-cast'

describe('desktop Cast subtitle selection', () => {
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
})
