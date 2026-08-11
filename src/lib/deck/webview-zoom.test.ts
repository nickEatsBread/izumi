import { describe, expect, it } from 'vitest'
import { deckWebviewZoom } from './webview-zoom'

describe('deckWebviewZoom', () => {
  it('enlarges the browse UI', () => {
    expect(deckWebviewZoom(1, false)).toBe(1.25)
    expect(deckWebviewZoom(1.2, false)).toBe(1.5)
  })

  it('always keeps the native player at 1:1 regardless of the saved UI scale', () => {
    expect(deckWebviewZoom(1, true)).toBe(1)
    expect(deckWebviewZoom(1.4, true)).toBe(1)
  })
})
