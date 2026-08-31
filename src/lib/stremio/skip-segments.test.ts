import { describe, expect, it } from 'vitest'
import { mergeRemoteSkipSegments } from './skip-segments'

describe('remote skip source priority', () => {
  it('prefers AniSkip on overlap and fills missing segment types from IntroDB', () => {
    const merged = mergeRemoteSkipSegments(
      [{ start: 60, end: 150, type: 'op', label: 'Opening' }],
      [
        { start: 65, end: 145, type: 'op', label: 'Opening' },
        { start: 1_300, end: 1_390, type: 'ed', label: 'Ending' },
      ],
    )
    expect(merged).toEqual([
      { start: 60, end: 150, type: 'op', label: 'Opening' },
      { start: 1_300, end: 1_390, type: 'ed', label: 'Ending' },
    ])
  })
})
