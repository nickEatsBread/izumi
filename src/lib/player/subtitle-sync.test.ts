import { describe, expect, it } from 'vitest'
import { correctedSrt, parseSubtitle } from './subtitle-sync'

describe('subtitle synchronization text handling', () => {
  it('parses SRT and WebVTT timestamps', () => {
    expect(parseSubtitle('1\n00:00:01,250 --> 00:00:02,500\nHello').at(0)).toMatchObject({
      start: 1.25, end: 2.5, text: 'Hello',
    })
    expect(parseSubtitle('WEBVTT\n\n00:03.000 --> 00:04.500\nWorld').at(0)).toMatchObject({
      start: 3, end: 4.5, text: 'World',
    })
  })

  it('applies timing ratio and offset to SRT output', () => {
    const output = correctedSrt([{ start: 10, end: 12, text: 'Line' }], {
      ratio: 1.25, offsetSec: 2, confidence: 0.8,
    })
    expect(output).toContain('00:00:14,500 --> 00:00:17,000')
  })
})
