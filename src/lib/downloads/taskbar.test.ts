import { describe, expect, it } from 'vitest'
import { downloadTaskbarProgress } from './taskbar'

describe('downloadTaskbarProgress', () => {
  it('clears the taskbar when no episode is actively downloading', () => {
    expect(downloadTaskbarProgress([
      { status: 'queued', bytes: 0, downloaded: 0 },
      { status: 'paused', bytes: 100, downloaded: 25 },
      { status: 'done', bytes: 100, downloaded: 100 },
    ])).toEqual({ status: 'none' })
  })

  it('is indeterminate until every active download has a known size', () => {
    expect(downloadTaskbarProgress([
      { status: 'downloading', bytes: 100, downloaded: 25 },
      { status: 'downloading', bytes: 0, downloaded: 0 },
    ])).toEqual({ status: 'indeterminate' })
  })

  it('weights concurrent downloads by bytes and never reports completion early', () => {
    expect(downloadTaskbarProgress([
      { status: 'downloading', bytes: 100, downloaded: 50 },
      { status: 'downloading', bytes: 300, downloaded: 150 },
      { status: 'done', bytes: 10_000, downloaded: 10_000 },
    ])).toEqual({ status: 'normal', progress: 50 })
    expect(downloadTaskbarProgress([
      { status: 'downloading', bytes: 100, downloaded: 100 },
    ])).toEqual({ status: 'normal', progress: 99 })
  })
})
