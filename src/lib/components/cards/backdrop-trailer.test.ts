import { describe, expect, it } from 'vitest'
import { backdropTrailerOn } from './backdrop-trailer'
import { youtubeTrailerId } from './youtube-embed'

const on = { enabled: true, id: 'abc', desktop: true, reducedMotion: false, saveData: false, playerUp: false, pageHidden: false, held: false }

describe('backdrop trailers', () => {
  it('plays only when the theme asks, there is a trailer and nothing holds it back', () => {
    expect(backdropTrailerOn(on)).toBe(true)
    for (const key of ['enabled', 'desktop'] as const) expect(backdropTrailerOn({ ...on, [key]: false })).toBe(false)
    for (const key of ['reducedMotion', 'saveData', 'playerUp', 'pageHidden', 'held'] as const) expect(backdropTrailerOn({ ...on, [key]: true })).toBe(false)
    expect(backdropTrailerOn({ ...on, id: undefined })).toBe(false)
  })
  it('takes YouTube trailers only', () => {
    expect(youtubeTrailerId({ id: 'x1', site: 'youtube' })).toBe('x1')
    expect(youtubeTrailerId({ id: 'x1', site: 'YouTube' })).toBe('x1')
    expect(youtubeTrailerId({ id: 'x1' })).toBe('x1')
    expect(youtubeTrailerId({ id: 'x1', site: 'dailymotion' })).toBeUndefined()
    expect(youtubeTrailerId(null)).toBeUndefined()
    expect(youtubeTrailerId(undefined)).toBeUndefined()
  })
})
