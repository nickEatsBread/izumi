import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { matchRememberedTrack, mergeSeriesTrackPreferences, rememberSeriesTrack, seriesTrackPreferences } from './track-preferences'

describe('per-series track preferences', () => {
  beforeEach(() => {
    seriesTrackPreferences.set({})
    vi.spyOn(Date, 'now').mockReturnValue(100)
  })

  afterEach(() => vi.restoreAllMocks())

  it('matches a stable language/title/codec identity instead of a changing player id', () => {
    rememberSeriesTrack(42, 'subtitle', { id: 7, type: 'sub', lang: 'en', title: 'Full Dialogue', codec: 'ass' })
    const preference = get(seriesTrackPreferences)['42']?.subtitle
    const match = matchRememberedTrack([
      { id: 1, type: 'sub', lang: 'en', title: 'Signs', codec: 'ass' },
      { id: 19, type: 'sub', lang: 'en', title: 'Full Dialogue', codec: 'ass' },
    ], preference)
    expect(match?.id).toBe(19)
  })

  it('keeps the remembered language ahead of a generic title match', () => {
    const match = matchRememberedTrack([
      { id: 1, type: 'audio', lang: 'jpn', title: 'Stereo', codec: 'aac' },
      { id: 2, type: 'audio', lang: 'eng', title: 'Dub', codec: 'aac' },
    ], { lang: 'eng', title: 'stereo', codec: 'aac', updatedAt: 100 })
    expect(match?.id).toBe(2)
  })

  it('remembers subtitles being explicitly disabled', () => {
    rememberSeriesTrack(42, 'subtitle', null)
    expect(matchRememberedTrack([{ id: 1, type: 'sub' }], get(seriesTrackPreferences)['42']?.subtitle)).toBeNull()
  })

  it('merges only newer preferences from another device', () => {
    seriesTrackPreferences.set({ '42': { audio: { lang: 'jpn', updatedAt: 20 } } })
    expect(mergeSeriesTrackPreferences({ '42': { audio: { lang: 'eng', updatedAt: 10 }, subtitle: { off: true, updatedAt: 30 } } })).toBe(1)
    expect(get(seriesTrackPreferences)['42']).toMatchObject({ audio: { lang: 'jpn' }, subtitle: { off: true } })
  })
})
