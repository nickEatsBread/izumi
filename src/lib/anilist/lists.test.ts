import { describe, it, expect } from 'vitest'
import { flattenEntries } from './lists'
const COLL = { MediaListCollection: { lists: [
  { entries: [ { progress: 3, media: { id: 1, title: {} } }, { progress: 0, media: { id: 2, title: {} } } ] },
  { entries: [ { progress: 12, media: { id: 3, title: {} } } ] },
] } }
describe('flattenEntries', () => {
  it('flattens list entries to {media, progress}[]', () => {
    const r = flattenEntries(COLL as any)
    expect(r.length).toBe(3); expect(r[0].media.id).toBe(1); expect(r[0].progress).toBe(3)
  })
  it('returns [] for missing data', () => expect(flattenEntries(undefined as any)).toEqual([]))
})
