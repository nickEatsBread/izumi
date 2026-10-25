import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { isSourceSelection, sourcePackageOf } from './source-catalogs'
import { sourceProgressReporter, sourceStream } from './source-streams'
import { sourceFacts } from './providers/stremio'

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
