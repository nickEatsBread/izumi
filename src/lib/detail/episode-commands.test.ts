import { afterEach, describe, expect, it, vi } from 'vitest'
import { onDownloadSelect, PENDING_MS, startDownloadSelect, type DownloadSelectRequest } from './episode-commands'

const stops: Array<() => void> = []
const listen = (mediaId: number) => {
  const seen: DownloadSelectRequest[] = []
  stops.push(onDownloadSelect(mediaId, (request) => seen.push(request)))
  return seen
}
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  // Drop any request a test left waiting.
  stops.push(onDownloadSelect(-1, () => {}))
  for (const stop of stops.splice(0)) stop()
  vi.useRealTimers()
})

describe('download selection requests', () => {
  it('reach the open episode list at once', () => {
    const seen = listen(1001)
    expect(startDownloadSelect(1)).toBe(true)
    expect(startDownloadSelect(4, 1001)).toBe(true)
    expect(seen).toEqual([{ episode: 1, mediaId: undefined }, { episode: 4, mediaId: 1001 }])
  })

  it('wait for a list that opens next, and run once', () => {
    expect(startDownloadSelect(3, 1001)).toBe(false)
    const seen = listen(1001)
    expect(seen).toEqual([{ episode: 3, mediaId: 1001 }])
    expect(listen(1001)).toEqual([])
  })

  it('never reach another series', () => {
    const other = listen(2002)
    expect(startDownloadSelect(1, 1001)).toBe(false)
    expect(other).toEqual([])
    // The waiting request is dropped by the next list to open, whichever series it shows.
    expect(listen(2002)).toEqual([])
    expect(listen(1001)).toEqual([])
  })

  it('stop waiting after a short while', () => {
    vi.useFakeTimers()
    startDownloadSelect(2, 1001)
    vi.advanceTimersByTime(PENDING_MS + 1)
    expect(listen(1001)).toEqual([])
  })

  it('stop reaching a list once it closes, without closing a newer one', () => {
    const first = listen(1001)
    const stopFirst = stops.pop()!
    const second = listen(1001)
    stopFirst()
    expect(startDownloadSelect(5)).toBe(true)
    expect(first).toEqual([])
    expect(second).toEqual([{ episode: 5, mediaId: undefined }])
    stops.pop()!()
    expect(startDownloadSelect(6)).toBe(false)
  })
})
