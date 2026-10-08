import { describe, expect, it } from 'vitest'
import type { Media } from '$lib/anilist/types'
import { mergeInstant } from '$lib/player/continue-watching'
import { historyResumeProgress, type HistoryEntry } from '$lib/player/history'
import { resumeEp } from '$lib/anilist/media'
import { seriesFraction, seriesResumeProgress, seriesUnderWay } from './resume'

const media = (over: Partial<Media> = {}): Media =>
  ({ id: 1004, title: { romaji: 'Show' }, episodes: 12, status: 'FINISHED', ...over }) as Media
const entry = (episode: number, progress: number, over: Partial<HistoryEntry> = {}): HistoryEntry =>
  ({ media: media(), episode, progress, updatedAt: 1000, ...over })

describe('the series Play button resumes where Continue Watching does', () => {
  it('opens an episode that was opened and not finished', () => {
    // Episode 5 opened (a saved position), nothing finished: Continue Watching names Episode 5.
    const history = { 1004: entry(5, 0) }
    expect(seriesResumeProgress(media(), history, {}, {})).toBe(4)
    expect(resumeEp(media(), seriesResumeProgress(media(), history, {}, {}))).toBe(5)
    const [row] = mergeInstant([], history, {})
    expect(resumeEp(row.media, row.progress)).toBe(5)
  })

  it('keeps the episodes finished when they are further along', () => {
    expect(seriesResumeProgress(media(), { 1004: entry(2, 6) }, {}, {})).toBe(6)
    // A list entry or this session's plays count as before.
    expect(seriesResumeProgress(media({ mediaListEntry: { progress: 8 } } as Partial<Media>), { 1004: entry(3, 0) }, {}, {})).toBe(8)
    expect(seriesResumeProgress(media(), { 1004: entry(3, 0) }, { 1004: 7 }, {})).toBe(7)
  })

  it('starts at the beginning without any history', () => {
    expect(seriesResumeProgress(media(), {}, {}, {})).toBe(0)
  })

  it('follows an exact count chosen from the episode tools, even a rewind', () => {
    expect(seriesResumeProgress(media(), { 1004: entry(9, 9) }, {}, { 1004: 2 })).toBe(2)
  })

  it('reads the history of a provider card and of its mapped AniList title', () => {
    const provider = media({ id: -77, catalog: { provider: 'kitsu', id: '77' }, externalIds: { anilist: 1004 } } as unknown as Partial<Media>)
    expect(seriesResumeProgress(provider, { 1004: entry(4, 0) }, {}, {})).toBe(3)
  })

  it('shares one rule with Continue Watching', () => {
    expect(historyResumeProgress({ episode: 5, progress: 0 })).toBe(4)
    expect(historyResumeProgress({ episode: 5, progress: 5 })).toBe(5)
    expect(historyResumeProgress({ episode: 1, progress: 0 })).toBe(0)
  })
})

describe('a series under way', () => {
  it('counts an episode 1 left part-way, which counts nothing as finished', () => {
    // Episode 1 opened and stopped 60 s in: Continue Watching names Episode 1 and Play resumes there.
    const history = { 1004: entry(1, 0) }
    const through = seriesResumeProgress(media(), history, {}, {})
    expect(through).toBe(0)
    expect(seriesUnderWay(through, { pos: 60, dur: 1440 })).toBe(true)
    // A position whose length is not known yet still resumes there.
    expect(seriesUnderWay(through, { pos: 60, dur: 0 })).toBe(true)
  })

  it('counts an episode finished or opened past the first, with or without a position', () => {
    expect(seriesUnderWay(seriesResumeProgress(media(), { 1004: entry(5, 0) }, {}, {}))).toBe(true)
    expect(seriesUnderWay(seriesResumeProgress(media(), { 1004: entry(1, 1) }, {}, {}))).toBe(true)
  })

  it('is not under way with nothing opened, nothing saved or a position cleared on finishing', () => {
    expect(seriesUnderWay(0)).toBe(false)
    expect(seriesUnderWay(0, { pos: 0, dur: 1440 })).toBe(false)
    expect(seriesUnderWay(0, { pos: 0, dur: 1440, cleared: true })).toBe(false)
    expect(seriesUnderWay(0, { pos: 300, dur: 1440, cleared: true })).toBe(false)
  })
})

describe('the share of a series watched', () => {
  it('adds how far into the Play episode the viewer got', () => {
    expect(seriesFraction(5, 4, 0.5, 12)).toBeCloseTo(4.5 / 12)
    expect(seriesFraction(1, 0, 0, 12)).toBe(0)
  })
  it('is everything once the episodes watched reach the total', () => {
    expect(seriesFraction(12, 12, 0, 12)).toBe(1)
    expect(seriesFraction(12, 20, 0, 12)).toBe(1)
  })
  it('needs a count', () => {
    expect(seriesFraction(3, 2, 0.4, 0)).toBeUndefined()
  })
})
