import { describe, it, expect } from 'vitest'
import {
  classifyMine, isDropped, isMine, hasMySources, emptyMySets, splitAniListIds, type MySets,
} from './my-shows'
import type { Media } from './types'

const media = (id: number, idMal?: number) => ({ id, idMal }) as Media
const sets = (over: Partial<MySets>): MySets => ({ ...emptyMySets(), ...over })

describe('classifyMine', () => {
  it('marks an AniList watching entry', () => {
    expect(classifyMine(media(1), sets({ aniWatching: new Set([1]) }))).toBe('watching')
  })

  it('marks a MAL planning entry by idMal', () => {
    expect(classifyMine(media(1, 99), sets({ malPlanning: new Set([99]) }))).toBe('planning')
  })

  it('treats local history as watching when nothing says otherwise', () => {
    expect(classifyMine(media(1), sets({ local: new Set([1]) }))).toBe('watching')
  })

  it('drops a locally-watched show once AniList says DROPPED', () => {
    const s = sets({ local: new Set([1]), aniDropped: new Set([1]) })
    expect(classifyMine(media(1), s)).toBeNull()
    expect(isMine(media(1), s)).toBe(false)
  })

  it('drops a locally-watched show once MAL says dropped', () => {
    const s = sets({ local: new Set([1]), malDropped: new Set([99]) })
    expect(classifyMine(media(1, 99), s)).toBeNull()
  })

  it('keeps a show that one tracker dropped but another still lists as watching', () => {
    const s = sets({ local: new Set([1]), aniDropped: new Set([1]), malWatching: new Set([99]) })
    expect(classifyMine(media(1, 99), s)).toBe('watching')
  })

  it('does not let a dropped idMal veto a different title with no idMal', () => {
    expect(classifyMine(media(1), sets({ local: new Set([1]), malDropped: new Set([99]) }))).toBe('watching')
  })
})

describe('isDropped', () => {
  it('is false for an untracked title', () => {
    expect(isDropped(media(1, 99), emptyMySets())).toBe(false)
  })
})

describe('hasMySources', () => {
  it('does not count a dropped list as a source to personalize from', () => {
    expect(hasMySources(sets({ aniDropped: new Set([1]), malDropped: new Set([99]) }))).toBe(false)
  })
})

describe('splitAniListIds', () => {
  it('splits one status_in collection and deduplicates custom-list copies', () => {
    const result = splitAniListIds({ MediaListCollection: { lists: [
      { entries: [
        { status: 'CURRENT', media: { id: 1 } },
        { status: 'PLANNING', media: { id: 2 } },
      ] },
      { entries: [
        { status: 'CURRENT', media: { id: 1 } },
        { status: 'DROPPED', media: { id: 3 } },
      ] },
    ] } })
    expect([...result.CURRENT]).toEqual([1])
    expect([...result.PLANNING]).toEqual([2])
    expect([...result.DROPPED]).toEqual([3])
  })
})
