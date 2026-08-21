import { describe, expect, it } from 'vitest'
import { videoFrameSize } from './video-frame'

describe('videoFrameSize', () => {
  it('keeps 1080p when the max width is the native width', () => {
    expect(videoFrameSize(1920, 1080, 1920)).toEqual({ width: 1920, height: 1080 })
  })

  it('scales a 1080p frame down to a 720-wide GIF', () => {
    expect(videoFrameSize(1920, 1080, 720)).toEqual({ width: 720, height: 405 })
  })

  it('does not upscale a 480p source', () => {
    expect(videoFrameSize(854, 480, 1920)).toEqual({ width: 854, height: 480 })
  })
})
