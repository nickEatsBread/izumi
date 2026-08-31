import { describe, expect, it } from 'vitest'
import { introDbUrl, segmentsFromIntroDb } from './introdb'

describe('IntroDB segments', () => {
  it('builds the public episode lookup without credentials', () => {
    const url = new URL(introDbUrl('tt0903747', 2, 3))
    expect(url.origin + url.pathname).toBe('https://api.introdb.app/segments')
    expect(Object.fromEntries(url.searchParams)).toEqual({ imdb_id: 'tt0903747', season: '2', episode: '3' })
  })

  it('maps intro, recap and outro using seconds or milliseconds', () => {
    expect(segmentsFromIntroDb({
      intro: { start_ms: 2_000, end_ms: 58_000 },
      recap: { start_sec: '01:00', end_sec: '02:15' },
      outro: { start_sec: 1_300, end_sec: 1_390 },
    }, 1_350)).toEqual([
      { start: 2, end: 58, type: 'op', label: 'Opening' },
      { start: 60, end: 135, type: 'recap', label: 'Recap' },
      { start: 1_300, end: 1_350, type: 'ed', label: 'Ending' },
    ])
  })

  it('accepts multiple windows and drops invalid ranges', () => {
    expect(segmentsFromIntroDb({
      recap: [
        { start_sec: 0, end_sec: 20 },
        { start_sec: 120, end_sec: 90 },
        { start_sec: 300, end_sec: 330 },
      ],
    })).toEqual([
      { start: 0, end: 20, type: 'recap', label: 'Recap' },
      { start: 300, end: 330, type: 'recap', label: 'Recap' },
    ])
  })
})
