import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { episodeBarPercent } from '$lib/player/progress'

// The compact ("non-card") episode layout used `watchedThrough` for exactly one thing — blurring
// spoiler titles — so a season MAL reports as fully watched rendered every episode looking
// untouched, while the card layout showed them all finished off the same number.

const list = readFileSync(fileURLToPath(new URL('./EpisodeList.svelte', import.meta.url)), 'utf8')

describe('compact episode layout watched state', () => {
  it('derives watched + progress the same way the card layout does', () => {
    expect(list).toContain('{@const done = watchedThrough >= ep}')
    expect(list).toContain('episodeBarPercent($positions[progressKey(media.id, ep)], done, released)')
  })

  it('tints the episode-number chip when watched instead of hiding the number', () => {
    // Identity is what you scan for in a dense grid — the number has to stay readable.
    expect(list).toContain("{done ? 'bg-theme/25 text-theme' : 'bg-background/40'}")
  })

  it('draws the resume bar, but not while selecting', () => {
    expect(list).toContain('{#if pct > 0 && !selecting}')
  })

  it('fills the bar for a tracker-counted episode with no local position', () => {
    // The exact case in the report: watched on MAL, never played on this device.
    expect(episodeBarPercent(undefined, true, true)).toBe(100)
    expect(episodeBarPercent(undefined, false, true)).toBe(0)
    // An unaired episode never shows progress.
    expect(episodeBarPercent(undefined, true, false)).toBe(0)
  })
})
