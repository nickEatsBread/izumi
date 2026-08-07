import { describe, expect, it } from 'vitest'
import type { Stream } from './parse'
import {
  allowedByPriority, applyPriorityFilter, originIdOf, priorityIndexOf, priorityPoints,
} from './source-priority'

const row = (originId?: string): Stream => ({
  url: `https://example.com/${originId ?? 'none'}.mp4`,
  name: originId ?? 'no origin',
  __origin: originId ? { kind: 'online-extension', id: originId, name: originId } : undefined,
} as Stream)

describe('priorityIndexOf', () => {
  it('reports the position in the trust order, and -1 for unlisted or origin-less rows', () => {
    const priority = ['alpha', 'beta']
    expect(priorityIndexOf(row('alpha'), priority)).toBe(0)
    expect(priorityIndexOf(row('beta'), priority)).toBe(1)
    expect(priorityIndexOf(row('gamma'), priority)).toBe(-1)
    expect(priorityIndexOf(row(undefined), priority)).toBe(-1)
    expect(originIdOf(row(undefined))).toBeUndefined()
  })
})

describe('priorityPoints', () => {
  it('descends with position and never falls to zero for a listed source', () => {
    expect(priorityPoints(0)).toBe(30)
    expect(priorityPoints(1)).toBe(24)
    expect(priorityPoints(2)).toBe(18)
    // Floors rather than going negative — being tenth on the list is still a preference.
    expect(priorityPoints(20)).toBe(6)
  })

  it('scores an unlisted source at zero rather than penalising it', () => {
    expect(priorityPoints(-1)).toBe(0)
  })

  it('beats the resolution spread, so a preferred source wins its tier', () => {
    // 2160p earns 25 against 1080p's 20 in score.ts; the top preference must clear that gap.
    expect(priorityPoints(0)).toBeGreaterThan(25 - 20)
  })
})

describe('allowedByPriority / applyPriorityFilter', () => {
  const priority = ['alpha']

  it('keeps everything in prefer mode — the order is a ranking, not a gate', () => {
    expect(allowedByPriority(row('gamma'), priority, 'prefer')).toBe(true)
    const all = [row('alpha'), row('gamma')]
    expect(applyPriorityFilter(all, priority, 'prefer')).toBe(all)
  })

  it('keeps only listed origins in strict mode', () => {
    expect(allowedByPriority(row('alpha'), priority, 'strict')).toBe(true)
    expect(allowedByPriority(row('gamma'), priority, 'strict')).toBe(false)
    expect(allowedByPriority(row(undefined), priority, 'strict')).toBe(false)
    const kept = applyPriorityFilter([row('alpha'), row('gamma'), row(undefined)], priority, 'strict')
    expect(kept.map(originIdOf)).toEqual(['alpha'])
  })

  it('treats an empty trust order as "no opinion", never as "nothing allowed"', () => {
    // Otherwise strict mode with an unconfigured list would empty every picker in the app.
    expect(allowedByPriority(row('gamma'), [], 'strict')).toBe(true)
    const all = [row('gamma')]
    expect(applyPriorityFilter(all, [], 'strict')).toBe(all)
  })
})
