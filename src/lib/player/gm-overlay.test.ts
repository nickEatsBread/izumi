import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  gameModeBitmapOverlayActive,
  gameModeChromeActive,
  gameModeDock,
  gameModeDockIsLive,
  gameModeP2pLine,
  gameModeSnapshotCrop,
  presenceAllowed,
  scheduleGameModeOverlay,
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

  it('does not snapshot an idle video with no chrome', () => {
    expect(gameModeBitmapOverlayActive(base)).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, skipVisible: true })).toBe(true)
  })

  it('snapshots controls once so Rust can animate them over fullscreen mpv', () => {
    expect(gameModeBitmapOverlayActive({ ...base, controlsVisible: true })).toBe(true)
  })

  it('keeps toasts on the bitmap overlay during load, and leaves loading P2P to native ASS', () => {
    expect(gameModeBitmapOverlayActive({ ...base, dynamicOverlay: true, p2pVisible: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, dynamicOverlay: true, noticeVisible: true })).toBe(true)
    expect(gameModeBitmapOverlayActive({ ...base, p2pVisible: true })).toBe(true)
  })

  it('does not snapshot menus — those unmap mpv and paint live', () => {
    expect(gameModeBitmapOverlayActive({ ...base, trackMenuOpen: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, playerMenuOpen: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, commentsOpen: true })).toBe(false)
  })

  it('yields idle controls to the native loading/scrub overlay', () => {
    expect(gameModeBitmapOverlayActive({ ...base, controlsVisible: true, dynamicOverlay: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, dynamicOverlay: true })).toBe(false)
  })

  it('snapshots the Skip chip as HTML instead of ASS', () => {
    expect(gameModeBitmapOverlayActive({ ...base, skipVisible: true })).toBe(true)
  })
})

describe('gameModeSnapshotCrop', () => {
  it('crops idle snapshots to the bottom control strip', () => {
    expect(gameModeSnapshotCrop(1280, 800, false)).toEqual({ x: 0, y: 512, w: 1280, h: 288 })
    expect(gameModeSnapshotCrop(1280, 800, true)).toBeNull()
  })
})

describe('gameMode chrome + presence', () => {
  it('treats skip/notice/p2p as native chrome', () => {
    expect(gameModeChromeActive({ skip: true, notice: false, p2p: false })).toBe(true)
    expect(gameModeChromeActive({ skip: false, notice: false, p2p: false })).toBe(false)
    expect(gameModeP2pLine(null)).toBe('P2P  Connecting to peers…')
    expect(gameModeP2pLine({ downloadMbps: 8.25, uploadMbps: 0.4, livePeers: 12 }))
      .toBe('P2P  ↓ 8.3  ↑ 0.4  12 peers')
  })

  it('does not publish desktop presence in Game mode', () => {
    expect(presenceAllowed(true)).toBe(false)
    expect(presenceAllowed(false)).toBe(true)
  })

  it('kills backdrop-filter for the whole Game-mode document', () => {
    const css = readFileSync(fileURLToPath(new URL('../../app.css', import.meta.url)), 'utf8')
    expect(css).toContain('html.gamemode, html.gamemode *')
    expect(css).toContain('backdrop-filter: none !important')
    expect(css).toContain('.gamemode .izumi-player-root .gm-sheet [data-focusable]')
    expect(css).toContain('transition: none')
    expect(css).toContain('html.gamemode .group:hover .sm\\:group-hover\\:opacity-100')
  })
})

describe('PlayerOverlay Game-mode wiring', () => {
  const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')

  it('uses the bitmap overlay helper and snapshots HTML P2P/toasts', () => {
    expect(overlay).toContain('gameModeBitmapOverlayActive')
    expect(overlay).toContain('p2pVisible')
    expect(overlay).toContain('noticeVisible')
    expect(overlay).not.toContain('controlsVisible || showSkip')
    expect(overlay).toContain('skipVisible: showSkip')
    expect(overlay).toContain('scheduleGameModeOverlay')
    expect(overlay).toContain('gameModeSnapshotCrop')
    expect(overlay).toContain('reportDirectTorrentFirstFrame')
    expect(overlay).toContain('presenceAllowed(gmMode)')
    expect(overlay).toContain('<P2PStatusOverlay buffering={loading} firstFrameSeen={firstFrame} />')
    expect(overlay).not.toContain('$playerNotice && !gmMode')
    expect(overlay).toContain('player_gm_dock')
    expect(overlay).toContain('playerOverlayRev')
    expect(overlay).toContain("void paused")
    expect(overlay).toContain('streamPickerOpen')
    expect(overlay).toContain('gameModeP2pLine')
    expect(overlay).not.toContain('class:gm-chrome-in')
  })

  it('re-focuses the overlay after fullscreen so player hotkeys keep working', () => {
    // Native macOS fullscreen steals first responder from WKWebView. The capture-phase
    // key listener is on `window`, but if the webview is not first responder the events
    // never reach JS until the user clicks the overlay.
    expect(overlay).toContain('void $fullscreen')
    expect(overlay).toContain('overlayRoot?.focus({ preventScroll: true })')
    expect(overlay).toContain('[50, 200, 450]')
  })
})

describe('gameModeDock', () => {
  const base = {
    loading: false,
    controlsVisible: false,
    playerMenuOpen: false,
    trackMenuOpen: false,
    commentsOpen: false,
    noticeVisible: false,
  }

  it('keeps controls over fullscreen video and hides mpv only for live HTML surfaces', () => {
    expect(gameModeDock({ ...base, loading: true })).toEqual({ bottom: 0, right: 0, top: 0, hide: false })
    expect(gameModeDock({ ...base, controlsVisible: true })).toEqual({ bottom: 0, right: 0, top: 0, hide: false })
    expect(gameModeDockIsLive(gameModeDock({ ...base, controlsVisible: true }))).toBe(false)
    expect(gameModeDock({ ...base, playerMenuOpen: true }).hide).toBe(true)
    expect(gameModeDock({ ...base, trackMenuOpen: true }).hide).toBe(true)
    expect(gameModeDock({ ...base, commentsOpen: true }).hide).toBe(true)
    expect(gameModeDock({ ...base, streamPickerOpen: true }).hide).toBe(true)
  })
})

describe('Game-mode Leanback motion', () => {
  it('keeps a growing play highlight and D-pad settings overlay on top of video', () => {
    const css = readFileSync(fileURLToPath(new URL('../../app.css', import.meta.url)), 'utf8')
    expect(css).toContain('.gm-play.focus-ring-inset:focus')
    const controls = readFileSync(fileURLToPath(new URL('../components/player/Controls.svelte', import.meta.url)), 'utf8')
    expect(controls).toContain('gm-play')
    expect(controls).toContain('gmActivate')
    expect(controls).toContain('gm-open-tracks')
    expect(controls).toContain('player-menu-nav')
    const comments = readFileSync(fileURLToPath(new URL('../components/player/CommentsPanel.svelte', import.meta.url)), 'utf8')
    expect(comments).toContain('dq-gm-hide')
    const menu = readFileSync(fileURLToPath(new URL('../components/player/TrackMenu.svelte', import.meta.url)), 'utf8')
    expect(menu).toContain('gm-open-tracks')
    expect(menu).toContain('bumpPlayerOverlay')
    expect(menu).toContain('pointerAllowed')
  })
})

describe('scheduleGameModeOverlay', () => {
  it('does not run after cancel', async () => {
    let ran = false
    const cancel = scheduleGameModeOverlay(() => { ran = true })
    cancel()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(ran).toBe(false)
  })
})

describe('Game-mode skip chip + settings sheet', () => {
  it('uses a white pill Skip button and a dimmed right settings sheet', () => {
    const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')
    expect(overlay).toContain('rounded-full bg-white')
    expect(overlay).toContain("Skip {currentSeg.label}")
    expect(overlay).not.toContain('class:opacity-0={gmMode && !overlayActive}')
    const controls = readFileSync(fileURLToPath(new URL('../components/player/Controls.svelte', import.meta.url)), 'utf8')
    expect(controls).toContain('fixed inset-0 z-40 bg-black/50')
  })
})
