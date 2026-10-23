import { describe, expect, it } from 'vitest'
import { releaseHighlights } from './notes'

const BODY = `Download an installer for your platform below. The app auto-updates.

## Changes
- chore: release v0.1.73 (c4e3163e)
- fix(player): capture editor stills and GIFs through the **video output** (#147) (4a650d50)
- Deck: TV-style player menus over the paused frame (#146) (80530732)
- feat: \`hold-to-2x\` audio, see [the guide](https://example.com/guide) (3be7f510)
- fix: cap the cache (2500000) at __init__ (#150)
* ci: pin the runner image (1234abcd)

**Full changelog:** https://example.com/compare/v0.1.72...v0.1.73`

describe('releaseHighlights', () => {
  it('keeps user-facing bullets and strips commit noise and markdown', () => {
    expect(releaseHighlights(BODY)).toEqual({
      items: [
        'Capture editor stills and GIFs through the video output',
        'Deck: TV-style player menus over the paused frame',
        'Hold-to-2x audio, see the guide',
        'Cap the cache (2500000) at __init__',
      ],
      more: 0,
    })
  })

  it('caps the list and counts the rest', () => {
    const body = Array.from({ length: 8 }, (_, i) => `- fix: change ${i}`).join('\n')
    expect(releaseHighlights(body, 5)).toEqual({
      items: ['Change 0', 'Change 1', 'Change 2', 'Change 3', 'Change 4'],
      more: 3,
    })
  })

  it('returns nothing for a body without bullets', () => {
    expect(releaseHighlights('Bug fixes.')).toEqual({ items: [], more: 0 })
    expect(releaseHighlights('')).toEqual({ items: [], more: 0 })
  })
})
