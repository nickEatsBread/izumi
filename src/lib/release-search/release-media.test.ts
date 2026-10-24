import { describe, expect, it } from 'vitest'
import { compatibilityMediaId } from '$lib/catalog/identity'
import type { Stream } from '$lib/stremio/parse'
import { isPackRelease, isReleaseMedia, releaseMedia } from './release-media'

const single: Stream = { infoHash: 'ab'.repeat(20), title: 'Quiet Harbor 05 [720p]', behaviorHints: { filename: 'Quiet Harbor 05 [720p]' } }
const pack: Stream = { infoHash: 'CD'.repeat(20), title: 'Quiet.Harbor.S01.1080p.BluRay.x265', __batch: true, behaviorHints: { filename: 'Quiet.Harbor.S01.1080p.BluRay.x265' } }

describe('releaseMedia', () => {
  it('gives a release a stable negative id from its infohash, whatever the case', () => {
    const a = releaseMedia(single)
    expect(a.id).toBeLessThan(0)
    expect(releaseMedia({ ...single, infoHash: single.infoHash!.toUpperCase() }).id).toBe(a.id)
    expect(releaseMedia(pack).id).not.toBe(a.id)
  })

  it('keeps the existing provider ids unchanged after the hash is shared', () => {
    // Value computed from the pre-refactor function: persisted TMDB/Stremio ids must not move.
    expect(compatibilityMediaId({ provider: 'tmdb', type: 'series', id: '1399' })).toBe(-41757680)
  })

  it('carries the picked release, its pack flag and the searched season', () => {
    const media = releaseMedia(pack, { episode: 5, season: 1 })
    expect(isReleaseMedia(media)).toBe(true)
    expect(media.release).toEqual({ stream: pack, pack: true, season: 1 })
    expect(media.title.userPreferred).toBe('Quiet.Harbor.S01.1080p.BluRay.x265')
    expect(releaseMedia(single).release?.pack).toBe(false)
    expect(isReleaseMedia({})).toBe(false)
    expect(isReleaseMedia(null)).toBe(false)
  })

  it('treats a batch-named release as a pack even when its source did not say so', () => {
    expect(isPackRelease({ infoHash: 'ef'.repeat(20), title: 'Quiet Harbor (01-12) [Batch] [1080p]' })).toBe(true)
    expect(isPackRelease(single)).toBe(false)
  })
})
