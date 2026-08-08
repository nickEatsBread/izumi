import { describe, expect, it } from 'vitest'
import { activeChapterIndex, chapterRowLabel, formatChapterTime, isGenericChapterTitle, nextChapterTarget, prevChapterTarget, sortChapters } from './chapters'
import type { Chapter } from './chapter-skip'

// A typical well-tagged episode: cold open, opening, two acts, ending, next-episode preview.
const EPISODE: Chapter[] = [
  { time: 0, title: 'Intro' },
  { time: 85, title: 'OP' },
  { time: 175, title: 'Part A' },
  { time: 600, title: 'Part B' },
  { time: 1320, title: 'ED' },
  { time: 1410, title: 'Preview' },
]

describe('sortChapters', () => {
  it('orders an unsorted list and drops nonsense times', () => {
    const out = sortChapters([
      { time: 85, title: 'OP' },
      { time: Number.NaN, title: 'Broken' },
      { time: -5, title: 'Negative' },
      { time: 0, title: 'Intro' },
    ])
    expect(out.map((c) => c.title)).toEqual(['Intro', 'OP'])
  })

  it('does not mutate its input', () => {
    const input = [{ time: 10, title: 'B' }, { time: 0, title: 'A' }]
    sortChapters(input)
    expect(input[0].title).toBe('B')
  })
})

describe('activeChapterIndex', () => {
  it('finds the chapter containing the position', () => {
    expect(activeChapterIndex(EPISODE, 300)).toBe(2)
  })

  it('is inclusive of the chapter start, so landing exactly on a boundary enters it', () => {
    expect(activeChapterIndex(EPISODE, 175)).toBe(2)
  })

  it('reports the last chapter once past its start', () => {
    expect(activeChapterIndex(EPISODE, 1500)).toBe(5)
  })

  it('returns -1 for an empty list', () => {
    expect(activeChapterIndex([], 42)).toBe(-1)
  })

  it('returns -1 when the position precedes the first chapter start', () => {
    // A file whose first chapter mark is not at 0 — the pre-roll belongs to no chapter.
    expect(activeChapterIndex([{ time: 30, title: 'Start' }], 10)).toBe(-1)
  })
})

describe('nextChapterTarget', () => {
  it('returns the start of the following chapter', () => {
    expect(nextChapterTarget(EPISODE, 300)).toBe(600)
  })

  it('returns null in the last chapter, rather than seeking to the end', () => {
    expect(nextChapterTarget(EPISODE, 1500)).toBeNull()
  })

  it('jumps to the first chapter when the position precedes it', () => {
    expect(nextChapterTarget([{ time: 30, title: 'Start' }], 10)).toBe(30)
  })

  it('returns null for an empty list', () => {
    expect(nextChapterTarget([], 42)).toBeNull()
  })
})

describe('prevChapterTarget', () => {
  it('restarts the current chapter when well inside it', () => {
    expect(prevChapterTarget(EPISODE, 300)).toBe(175)
  })

  it('goes back one when the position just entered the chapter', () => {
    // 2s past the Part A mark — the user meant the OP, not "restart Part A".
    expect(prevChapterTarget(EPISODE, 177)).toBe(85)
  })

  it('treats exactly the threshold as still inside the current chapter', () => {
    expect(prevChapterTarget(EPISODE, 178)).toBe(175)
  })

  it('returns null at the very start, where there is nowhere to go', () => {
    expect(prevChapterTarget(EPISODE, 1)).toBeNull()
  })

  it('returns null when the position precedes the first chapter', () => {
    expect(prevChapterTarget([{ time: 30, title: 'Start' }], 10)).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(prevChapterTarget([], 42)).toBeNull()
  })
})

describe('formatChapterTime', () => {
  it('formats under an hour as m:ss', () => {
    expect(formatChapterTime(0)).toBe('0:00')
    expect(formatChapterTime(85)).toBe('1:25')
    expect(formatChapterTime(600)).toBe('10:00')
  })

  it('formats an hour or more as h:mm:ss', () => {
    expect(formatChapterTime(3661)).toBe('1:01:01')
  })

  it('clamps a negative time rather than printing a minus sign', () => {
    expect(formatChapterTime(-5)).toBe('0:00')
  })
})

describe('chapterRowLabel', () => {
  it('pairs the title with its timestamp', () => {
    expect(chapterRowLabel({ time: 85, title: 'OP' })).toBe('OP — 1:25')
  })

  it('falls back to a generic word for an untitled chapter', () => {
    expect(chapterRowLabel({ time: 85, title: '   ' })).toBe('Chapter — 1:25')
  })
})

describe('isGenericChapterTitle', () => {
  it('flags titles that carry no information', () => {
    for (const t of ['Chapter 1', 'chapter 12', 'Part 3', 'Track 2', 'Untitled', '7', '', '   ', 'Act 1', 'Scene 2', 'Segment 3']) {
      expect(isGenericChapterTitle(t), t).toBe(true)
    }
  })

  it('keeps titles worth showing', () => {
    for (const t of ['OP', 'Part A', 'Ending', 'Preview', 'Cold Open']) {
      expect(isGenericChapterTitle(t), t).toBe(false)
    }
  })
})
