import { describe, it, expect } from 'vitest'
import { magnetOf, pickLargestVideo } from './debrid/http'

describe('debrid magnetOf', () => {
  it('builds a magnet from a bare hash', () =>
    expect(magnetOf('A'.repeat(40))).toBe(`magnet:?xt=urn:btih:${'A'.repeat(40)}`))
  it('passes an existing magnet through', () =>
    expect(magnetOf('magnet:?xt=urn:btih:xyz&dn=foo')).toBe('magnet:?xt=urn:btih:xyz&dn=foo'))
})

describe('debrid pickLargestVideo', () => {
  it('picks the largest video, skipping samples/extras', () => {
    const files = [
      { name: 'Show/sample.mkv', bytes: 50_000_000 },
      { name: 'Show/Show S01E01.mkv', bytes: 1_400_000_000 },
      { name: 'Show/extras.mp4', bytes: 20_000_000 },
    ]
    expect(pickLargestVideo(files)?.name).toBe('Show/Show S01E01.mkv')
  })
  it('falls back to the largest file when nothing looks like video', () => {
    const files = [{ name: 'a.bin', bytes: 100 }, { name: 'b.bin', bytes: 999 }]
    expect(pickLargestVideo(files)?.name).toBe('b.bin')
  })
  it('returns undefined for an empty list', () => expect(pickLargestVideo([])).toBeUndefined())
})
