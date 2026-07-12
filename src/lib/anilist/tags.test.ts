import { describe, it, expect } from 'vitest'
import { cycleTag, tagState, topCategory, groupTags, type MediaTag } from './tags'

describe('cycleTag', () => {
  it('cycles neutral → include → exclude → neutral', () => {
    let inc: string[] = [], exc: string[] = []
    ;({ include: inc, exclude: exc } = cycleTag('Isekai', inc, exc))
    expect(inc).toEqual(['Isekai']); expect(exc).toEqual([])
    ;({ include: inc, exclude: exc } = cycleTag('Isekai', inc, exc))
    expect(inc).toEqual([]); expect(exc).toEqual(['Isekai'])
    ;({ include: inc, exclude: exc } = cycleTag('Isekai', inc, exc))
    expect(inc).toEqual([]); expect(exc).toEqual([])
  })

  it('never duplicates a name across include and exclude', () => {
    const r = cycleTag('Gore', ['Gore'], [])       // include → exclude
    expect(r.include).toEqual([]); expect(r.exclude).toEqual(['Gore'])
    expect(r.include.includes('Gore') && r.exclude.includes('Gore')).toBe(false)
  })

  it('does not mutate the input arrays', () => {
    const inc = ['A'], exc = ['B']
    cycleTag('C', inc, exc)
    expect(inc).toEqual(['A']); expect(exc).toEqual(['B'])
  })
})

describe('tagState', () => {
  it('reports the tri-state', () => {
    expect(tagState('A', ['A'], [])).toBe('include')
    expect(tagState('A', [], ['A'])).toBe('exclude')
    expect(tagState('A', [], [])).toBe('neutral')
  })
})

describe('topCategory', () => {
  it('takes the part before the first dash', () => {
    expect(topCategory('Theme-Action')).toBe('Theme')
    expect(topCategory('Setting-Time-Period')).toBe('Setting')
    expect(topCategory('Demographic')).toBe('Demographic')
  })
})

const TAGS: MediaTag[] = [
  { name: 'Isekai', category: 'Theme-Fantasy' },
  { name: 'Swordplay', category: 'Theme-Action' },
  { name: 'Cute Girls', category: 'Cast-Traits' },
  { name: 'Gore', category: 'Theme-Other', isGeneralSpoiler: true },
  { name: 'Nudity', category: 'Sexual Content', isAdult: true },
]

describe('groupTags', () => {
  it('groups by top-level category in input order', () => {
    const g = groupTags(TAGS, { showSpoilers: true, showAdult: true })
    expect(g.map((x) => x.category)).toEqual(['Theme', 'Cast', 'Sexual Content'])
    expect(g[0].tags.map((t) => t.name)).toEqual(['Isekai', 'Swordplay', 'Gore'])
  })

  it('hides spoiler tags unless showSpoilers', () => {
    const names = groupTags(TAGS, { showAdult: true }).flatMap((g) => g.tags.map((t) => t.name))
    expect(names).not.toContain('Gore')
    expect(groupTags(TAGS, { showAdult: true, showSpoilers: true }).flatMap((g) => g.tags.map((t) => t.name))).toContain('Gore')
  })

  it('hides adult tags unless showAdult', () => {
    const names = groupTags(TAGS, {}).flatMap((g) => g.tags.map((t) => t.name))
    expect(names).not.toContain('Nudity')
  })

  it('filters by search substring (case-insensitive)', () => {
    const g = groupTags(TAGS, { search: 'sword', showSpoilers: true, showAdult: true })
    expect(g.flatMap((x) => x.tags.map((t) => t.name))).toEqual(['Swordplay'])
  })

  it('always keeps a selected tag visible even when it would be filtered out', () => {
    // 'Gore' is a spoiler + doesn't match the search, but it's selected → still shown.
    const g = groupTags(TAGS, { search: 'zzz', selected: ['Gore'] })
    expect(g.flatMap((x) => x.tags.map((t) => t.name))).toEqual(['Gore'])
  })
})
