import { describe, it, expect } from 'vitest'
import { parseCommits } from './changelog'

describe('parseCommits', () => {
  it('maps commits to entries, first line only, drops merge commits', () => {
    const raw = [
      { sha: 'abcdef1234', commit: { message: 'feat: a thing\n\nbody', author: { date: '2026-07-01T00:00:00Z' } } },
      { sha: 'beef000000', commit: { message: 'merge: branch x', author: { date: '2026-07-02T00:00:00Z' } } },
      { sha: '1234abcd00', commit: { message: 'fix: b', author: { date: '2026-07-03T00:00:00Z' } } },
    ]
    expect(parseCommits(raw)).toEqual([
      { sha: 'abcdef1234', date: '2026-07-01T00:00:00Z', message: 'feat: a thing' },
      { sha: '1234abcd00', date: '2026-07-03T00:00:00Z', message: 'fix: b' },
    ])
  })
})
