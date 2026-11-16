import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { attachLateSubtitle } from './late-subtitle'
import { lateSubtitleRevision } from './session'

describe('attachLateSubtitle', () => {
  beforeEach(() => {
    invoke.mockReset()
    lateSubtitleRevision.set(0)
  })

  it('names an add-on result that carries no title or language, which the command requires', async () => {
    invoke.mockResolvedValue(undefined)
    await attachLateSubtitle('https://subs.test/1.srt', undefined, undefined)
    expect(invoke).toHaveBeenLastCalledWith('player_attach_subtitle_url', { url: 'https://subs.test/1.srt', lang: 'und', title: 'Online subtitles' })
    await attachLateSubtitle('https://subs.test/2.srt', 'eng')
    expect(invoke).toHaveBeenLastCalledWith('player_attach_subtitle_url', { url: 'https://subs.test/2.srt', lang: 'eng', title: 'eng' })
  })

  it('asks the subtitle choice to run again only for a track that attached', async () => {
    invoke.mockResolvedValueOnce(undefined)
    await attachLateSubtitle('https://subs.test/1.srt', 'eng', 'English')
    expect(get(lateSubtitleRevision)).toBe(1)
    invoke.mockRejectedValueOnce('The video changed before this subtitle could load.')
    await expect(attachLateSubtitle('https://subs.test/2.srt', 'eng', 'English')).rejects.toBeTruthy()
    expect(get(lateSubtitleRevision)).toBe(1)
  })
})
