import { describe, expect, it } from 'vitest'
import { classifyChapter, mergeSkipSegments, segmentsFromChapters, type Chapter } from './chapter-skip'
import { mergeOverlapping, type Segment } from '$lib/stremio/aniskip'

describe('chapter title classification', () => {
  it('recognises the common opening namings', () => {
    for (const t of ['OP', 'op', 'Opening', 'OP1', 'NCOP', 'Opening Credits', 'Intro', 'Theme Song', 'OP - Gurenge']) {
      expect(classifyChapter(t), t).toBe('op')
    }
  })

  it('recognises the common ending namings', () => {
    for (const t of ['ED', 'Ending', 'ED2', 'NCED', 'Outro', 'Closing', 'End Credits', 'Ending Song']) {
      expect(classifyChapter(t), t).toBe('ed')
    }
  })

  it('recognises recaps', () => {
    for (const t of ['Recap', 'Previously', 'Previously On', 'Summary']) {
      expect(classifyChapter(t), t).toBe('recap')
    }
  })

  it('refuses generic namings rather than guessing', () => {
    // A false positive here seeks the user out of real content — far worse than no skip button.
    for (const t of ['Chapter 01', 'Chapter 2', 'Part 1', 'Untitled', '00:00:00', 'A', '', '   ', 'Episode 5']) {
      expect(classifyChapter(t), t).toBeNull()
    }
  })

  it('does not match a theme word buried in an episode-title chapter', () => {
    // These are chapter names for actual content. Matching on a contained word would skip the scene.
    expect(classifyChapter('The Opening of the Gate')).toBeNull()
    expect(classifyChapter('Reopening the case')).toBeNull()
    expect(classifyChapter('Shopping trip')).toBeNull()
    expect(classifyChapter('A Recap of the Plan')).toBeNull()
  })
})

describe('segmentsFromChapters', () => {
  const chapters: Chapter[] = [
    { time: 0, title: 'Prologue' },
    { time: 24, title: 'Opening' },
    { time: 114, title: 'Part A' },
    { time: 1_290, title: 'Ending' },
    { time: 1_380, title: 'Preview' },
  ]

  it('derives OP/ED bands bounded by the next chapter', () => {
    const segs = segmentsFromChapters(chapters, 1_420)
    expect(segs).toEqual([
      { start: 24, end: 114, type: 'op', label: 'Opening' },
      { start: 1_290, end: 1_380, type: 'ed', label: 'Ending' },
    ])
  })

  it('runs the last chapter to the file duration', () => {
    expect(segmentsFromChapters([{ time: 1_300, title: 'ED' }], 1_390)[0])
      .toEqual({ start: 1_300, end: 1_390, type: 'ed', label: 'Ending' })
  })

  it('returns nothing without a duration, rather than a segment of unknown length', () => {
    expect(segmentsFromChapters(chapters, 0)).toEqual([])
  })

  it('returns nothing for a generically chaptered release', () => {
    expect(segmentsFromChapters(
      [{ time: 0, title: 'Chapter 01' }, { time: 600, title: 'Chapter 02' }], 1_400,
    )).toEqual([])
  })

  it('rejects an implausibly long theme (a mis-tagged chapter)', () => {
    // "Opening" running 20 minutes is a muxing accident, not an OP.
    expect(segmentsFromChapters([{ time: 60, title: 'Opening' }], 1_400)).toEqual([])
  })

  it('rejects a segment too short to be worth skipping', () => {
    expect(segmentsFromChapters(
      [{ time: 60, title: 'OP' }, { time: 62, title: 'Part A' }], 1_400,
    )).toEqual([])
  })

  it('sorts unordered chapters and drops ones past the end of the file', () => {
    const segs = segmentsFromChapters(
      [
        { time: 1_300, title: 'ED' },
        { time: 24, title: 'OP' },
        { time: 114, title: 'Part A' },
        { time: 9_999, title: 'OP' },
      ],
      1_400,
    )
    expect(segs.map((s) => s.type)).toEqual(['op', 'ed'])
    expect(segs[0]).toEqual({ start: 24, end: 114, type: 'op', label: 'Opening' })
  })

  it('rejects an OP whose next chapter is 20 minutes away — nothing bounds it as a theme', () => {
    expect(segmentsFromChapters(
      [{ time: 24, title: 'OP' }, { time: 1_300, title: 'ED' }], 1_400,
    ).map((s) => s.type)).toEqual(['ed'])
  })
})

describe('mergeOverlapping', () => {
  it('unions an op and a mixed-op annotation of the same theme', () => {
    const merged = mergeOverlapping([
      { start: 24, end: 114, type: 'op', label: 'Opening' },
      { start: 30, end: 120, type: 'op', label: 'Opening' },
    ])
    expect(merged).toEqual([{ start: 24, end: 120, type: 'op', label: 'Opening' }])
  })

  it('keeps distinct types apart even when they overlap', () => {
    const merged = mergeOverlapping([
      { start: 0, end: 90, type: 'recap', label: 'Recap' },
      { start: 60, end: 150, type: 'op', label: 'Opening' },
    ])
    expect(merged).toHaveLength(2)
  })

  it('keeps two genuinely separate segments of one type', () => {
    const merged = mergeOverlapping([
      { start: 24, end: 114, type: 'op', label: 'Opening' },
      { start: 1_290, end: 1_380, type: 'op', label: 'Opening' },
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('mergeSkipSegments', () => {
  const aniskip: Segment[] = [{ start: 24, end: 114, type: 'op', label: 'Opening' }]

  it('drops a chapter segment that AniSkip already covers', () => {
    const merged = mergeSkipSegments(aniskip, [{ start: 20, end: 110, type: 'op', label: 'Opening' }])
    expect(merged).toEqual(aniskip)
  })

  it('keeps a chapter segment AniSkip missed', () => {
    const ed: Segment = { start: 1_290, end: 1_380, type: 'ed', label: 'Ending' }
    expect(mergeSkipSegments(aniskip, [ed])).toEqual([...aniskip, ed])
  })

  it('falls back entirely to chapters when AniSkip has nothing', () => {
    const chapterSegs: Segment[] = [{ start: 24, end: 114, type: 'op', label: 'Opening' }]
    expect(mergeSkipSegments([], chapterSegs)).toEqual(chapterSegs)
  })

  it('returns segments in playback order', () => {
    const merged = mergeSkipSegments(aniskip, [{ start: 0, end: 20, type: 'recap', label: 'Recap' }])
    expect(merged.map((s) => s.start)).toEqual([0, 24])
  })
})
