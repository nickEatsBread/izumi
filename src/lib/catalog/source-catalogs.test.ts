import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { isSourceSelection, sourcePackageOf } from './source-catalogs'
import { sourceProgressReporter, sourceStream } from './source-streams'
import { mapStremioMeta, sourceFacts } from './providers/stremio'
import { refineStreams } from '$lib/stremio/refine'

const BASE = 'http://127.0.0.1:40001/stremio'

describe('source catalogs', () => {
  afterEach(() => { invoke.mockReset(); vi.useRealTimers() })

  it('names a source screen by its package only', () => {
    expect(isSourceSelection('source:example.source')).toBe(true)
    expect(isSourceSelection('source:../x')).toBe(false)
    expect(isSourceSelection('stremio')).toBe(false)
    expect(sourcePackageOf('source:example.source')).toBe('example.source')
  })

  it('keeps only well-formed facts, and no watchlist address for an unknown base', () => {
    expect(sourceFacts({
      rating: '14+', audio: 'Sub | Dub', isNew: true,
      continue: { videoId: 'x:E1', label: 'S1 E2', remainingSec: 300, progress: 1.7 },
      upNext: { videoId: 'x:E2', playhead: 'soon' },
      watchlist: true, watchlistUrl: `${BASE}/watchlist/x`,
    }, BASE)).toEqual({
      rating: '14+', audio: 'Sub | Dub', isNew: true,
      card: { videoId: 'x:E1', label: 'S1 E2', remainingSec: 300, progress: 1 },
      upNext: { videoId: 'x:E2', label: undefined, playhead: undefined },
      watchlist: true,
    })
    expect(sourceFacts({ rating: 'x'.repeat(40) }, BASE)).toBeUndefined()
    expect(sourceFacts('nope', BASE)).toBeUndefined()
  })

  it('maps a direct video source and keeps its progress address on the source only', () => {
    const own = sourceStream({ url: `${BASE}/v/1/manifest.mpd`, type: 'dash', izumi: { onlinestream: true, headers: { a: 'b', n: 1 }, progressUrl: `${BASE}/progress?video=x` } }, BASE, 'Example', 'example.source', 0)
    expect(own).toMatchObject({ url: `${BASE}/v/1/manifest.mpd`, __addonName: 'Example', __headers: { a: 'b' }, __progressUrl: `${BASE}/progress?video=x`, __origin: { kind: 'online-extension', id: 'example.source' } })
    const foreign = sourceStream({ url: 'https://cdn.test/a.mp4', izumi: { progressUrl: 'https://elsewhere.test/p' } }, BASE, 'Example', 'example.source', 1)
    expect(foreign?.__progressUrl).toBeUndefined()
    expect(sourceStream({ name: 'no url' }, BASE, 'Example', 'example.source', 2)).toBeUndefined()
  })

  it('keeps a source stream whose episode has its own name', () => {
    const media = { id: -5, title: { romaji: 'Black Clover', english: 'Black Clover' }, catalog: { provider: 'stremio', type: 'series', id: 'x', addonId: 'source-example.source' } } as never
    const own = sourceStream({ url: `${BASE}/v/1/manifest.mpd`, type: 'dash', izumi: { onlinestream: true } }, BASE, 'Example', 'example.source', 0, 'Asta and Yuno', 'Black Clover')!
    const plain = sourceStream({ url: 'https://cdn.test/e1.mp4', name: 'Example', title: 'Asta and Yuno' }, BASE, 'Example', 'example.source', 1, 'Asta and Yuno', 'Black Clover')!
    expect(refineStreams(media, [own, plain]).kept).toHaveLength(2)
  })

  it('reports the playhead at most every interval and once more at the end', () => {
    invoke.mockResolvedValue({ status: 200, body: '' })
    vi.useFakeTimers()
    const reporter = sourceProgressReporter({ url: 'x', __progressUrl: `${BASE}/progress?video=x` }, 30_000)!
    reporter.progress(10)
    reporter.progress(20)
    vi.advanceTimersByTime(30_000)
    reporter.progress(40)
    reporter.flush(55.9)
    reporter.flush()
    const bodies = invoke.mock.calls.filter(([command]) => command === 'ext_fetch').map(([, args]) => JSON.parse(args.body).position)
    expect(bodies).toEqual([10, 40, 55])
    expect(sourceProgressReporter({ url: 'x' })).toBeUndefined()
  })
})

describe('playing a source title from a card', () => {
  it('plays the card episode from its playhead, else where the source resumes, else the first', async () => {
    const { sourcePlayTarget } = await import('./source-play')
    const detail = {
      id: -1, title: { romaji: 'One' },
      videos: [
        { id: 'x:E1', number: 1, playhead: 1300, watched: true },
        { id: 'x:E2', number: 2, playhead: 300 },
        { id: 'x:E3', number: 3 },
      ],
      sourceFacts: { upNext: { videoId: 'x:E2', playhead: 320 } },
    } as never
    expect(sourcePlayTarget(detail, 'x:E3')).toEqual({ video: expect.objectContaining({ id: 'x:E3' }) })
    expect(sourcePlayTarget(detail, 'x:E1')).toEqual({ video: expect.objectContaining({ id: 'x:E1' }) })
    expect(sourcePlayTarget(detail, 'x:E2')?.startSeconds).toBe(320)
    expect(sourcePlayTarget(detail)?.video.id).toBe('x:E2')
    expect(sourcePlayTarget({ ...(detail as object), videos: [] } as never)).toBeUndefined()
  })
})

describe('source episodes named on AniList', () => {
  it('keeps the AniList entry and episode a source gives each video, and only whole ids', () => {
    const media = mapStremioMeta({
      id: 'cr:1', type: 'series', name: 'Some Series',
      videos: [
        { id: 'cr:a', season: 1, episode: 1, izumi: { track: { anilist: 700, mal: 7700, episode: 1 } } },
        { id: 'cr:b', season: 3, episode: 1, izumi: { track: { anilist: 701, episode: 1 } } },
        { id: 'cr:c', season: 3, episode: 2, izumi: { track: { anilist: '701', episode: 2.5 } } },
      ],
    } as never, BASE)
    expect(media?.videos?.map((video) => video.track)).toEqual([
      { anilist: 700, mal: 7700, episode: 1 },
      { anilist: 701, episode: 1 },
      undefined,
    ])
  })
})
