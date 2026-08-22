import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DECK_ZOOM_HOLD_CLASS, deckWebviewZoom, holdDeckBrowseZoom, releaseDeckBrowseZoom } from './webview-zoom'

describe('deckWebviewZoom', () => {
  it('enlarges the browse UI', () => {
    expect(deckWebviewZoom(1, false)).toBe(1.25)
    expect(deckWebviewZoom(1.2, false)).toBe(1.5)
  })

  it('always keeps the native player at 1:1 regardless of the saved UI scale', () => {
    expect(deckWebviewZoom(1, true)).toBe(1)
    expect(deckWebviewZoom(1.4, true)).toBe(1)
  })

  it('hides the document while restoring browse zoom after the player closes', () => {
    expect(holdDeckBrowseZoom).toBeTypeOf('function')
    expect(releaseDeckBrowseZoom).toBeTypeOf('function')
    const css = readFileSync(fileURLToPath(new URL('../../app.css', import.meta.url)), 'utf8')
    expect(css).toContain('.deck-zoom-hold body')
    const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')
    expect(overlay).toContain('holdDeckBrowseZoom()')
    const layout = readFileSync(fileURLToPath(new URL('../../routes/app/+layout.svelte', import.meta.url)), 'utf8')
    expect(layout).toContain('releaseDeckBrowseZoom')
  })
})
