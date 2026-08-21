import { describe, expect, it } from 'vitest'
import { BUFFER_SPINNER_DELAY_MS, bufferSpinnerAction, overlayIsLoading } from './overlay-loading'

const idle = {
  eof: false,
  paused: true,
  buffering: true,
  seeking: false,
  coreIdle: true,
  firstFrame: false,
  pos: 0,
}

describe('overlayIsLoading', () => {
  it('shows a spinner after episode click even though the video element is still paused', () => {
    expect(overlayIsLoading(idle)).toBe(true)
  })

  it('hides the spinner once a frame is up and the user paused', () => {
    expect(overlayIsLoading({ ...idle, firstFrame: true, coreIdle: false, buffering: false })).toBe(false)
  })

  it('shows a spinner for a mid-playback stall while playing', () => {
    expect(overlayIsLoading({
      ...idle,
      paused: false,
      firstFrame: true,
      coreIdle: false,
      buffering: true,
      pos: 12,
    })).toBe(true)
  })

  it('does not spin at end of file', () => {
    expect(overlayIsLoading({ ...idle, eof: true, firstFrame: true })).toBe(false)
  })
})

describe('bufferSpinnerAction', () => {
  it('arms once and does not reset the clock on another stall pulse', () => {
    expect(BUFFER_SPINNER_DELAY_MS).toBeLessThanOrEqual(200)
    expect(bufferSpinnerAction(false, false, true)).toBe('arm')
    expect(bufferSpinnerAction(false, true, true)).toBe('noop')
    expect(bufferSpinnerAction(true, false, true)).toBe('noop')
  })

  it('hides immediately when the stall ends', () => {
    expect(bufferSpinnerAction(true, false, false)).toBe('hide')
    expect(bufferSpinnerAction(false, true, false)).toBe('hide')
    expect(bufferSpinnerAction(false, false, false)).toBe('noop')
  })
})
