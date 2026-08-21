import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  gameModeBitmapOverlayActive,
  gameModeChromeActive,
  gameModeP2pLine,
  gameModeSnapshotCrop,
  presenceAllowed,
} from './gm-overlay'

describe('gameModeBitmapOverlayActive', () => {
  const base = {
    gameMode: true,
    playing: true,
    dynamicOverlay: false,
    controlsVisible: false,
    trackMenuOpen: false,
    playerMenuOpen: false,
    commentsOpen: false,
  }

  it('does not snapshot for skip, toast, or P2P alone', () => {
    expect(gameModeBitmapOverlayActive(base)).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, controlsVisible: true })).toBe(true)
    expect(gameModeBitmapOverlayActive({ ...base, trackMenuOpen: true })).toBe(true)
  })

  it('yields to the native loading/scrub overlay', () => {
    expect(gameModeBitmapOverlayActive({ ...base, controlsVisible: true, dynamicOverlay: true })).toBe(false)
  })
})

describe('gameModeSnapshotCrop', () => {
  it('crops idle snapshots to the bottom control strip', () => {
    expect(gameModeSnapshotCrop(1280, 800, false)).toEqual({ x: 0, y: 576, w: 1280, h: 224 })
    expect(gameModeSnapshotCrop(1280, 800, true)).toBeNull()
  })
})

describe('gameMode chrome + presence', () => {
  it('treats skip/notice/p2p as native chrome', () => {
    expect(gameModeChromeActive({ skip: true, notice: false, p2p: false })).toBe(true)
    expect(gameModeChromeActive({ skip: false, notice: false, p2p: false })).toBe(false)
    expect(gameModeP2pLine(null)).toBe('Connecting to peers…')
    expect(gameModeP2pLine({ downloadMbps: 8.25, uploadMbps: 0.4, livePeers: 12 }))
      .toBe('↓ 8.3  ↑ 0.4  12 peers')
  })

  it('does not publish desktop presence in Game mode', () => {
    expect(presenceAllowed(true)).toBe(false)
    expect(presenceAllowed(false)).toBe(true)
  })

  it('kills backdrop-filter for the whole Game-mode document', () => {
    const css = readFileSync(fileURLToPath(new URL('../../app.css', import.meta.url)), 'utf8')
    expect(css).toContain('html.gamemode, html.gamemode *')
    expect(css).toContain('backdrop-filter: none !important')
  })
})

describe('PlayerOverlay Game-mode wiring', () => {
  const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')

  it('uses the bitmap overlay helper and does not snapshot skip/toasts alone', () => {
    expect(overlay).toContain('gameModeBitmapOverlayActive')
    expect(overlay).not.toContain('controlsVisible || showSkip')
    expect(overlay).toContain('gameModeSnapshotCrop')
    expect(overlay).toContain('reportDirectTorrentFirstFrame')
    expect(overlay).toContain('presenceAllowed(gmMode)')
  })
})
