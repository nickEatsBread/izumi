import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { selectedCastSubtitle } from './desktop-cast'

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
})
