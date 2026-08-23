import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  gameModeBitmapOverlayActive,
  gameModeChromeActive,
  gameModeDock,
  gameModeDockIsLive,
  gameModeSnapshotCrop,
  gameModeSideSheetCrop,
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

  it('keeps ordinary controls off the bitmap path so native OSD can animate at 60Hz', () => {
    expect(gameModeBitmapOverlayActive({ ...base, controlsVisible: true })).toBe(false)
  })

  it('keeps toasts and the proper P2P card on the bitmap overlay during load', () => {
    expect(gameModeBitmapOverlayActive({ ...base, dynamicOverlay: true, p2pVisible: true })).toBe(true)
    expect(gameModeBitmapOverlayActive({ ...base, dynamicOverlay: true, noticeVisible: true })).toBe(true)
    expect(gameModeBitmapOverlayActive({ ...base, p2pVisible: true })).toBe(true)
  })

  it('snapshots menus/comments so opening them does not blank fullscreen mpv', () => {
    expect(gameModeBitmapOverlayActive({ ...base, trackMenuOpen: true })).toBe(true)
    expect(gameModeBitmapOverlayActive({ ...base, playerMenuOpen: true })).toBe(true)
    expect(gameModeBitmapOverlayActive({ ...base, commentsOpen: true })).toBe(true)
    expect(gameModeBitmapOverlayActive({ ...base, statsOpen: true })).toBe(true)
  })

  it('yields idle controls to the native loading/scrub overlay', () => {
    expect(gameModeBitmapOverlayActive({ ...base, controlsVisible: true, dynamicOverlay: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, dynamicOverlay: true })).toBe(false)
  })

  it('snapshots the polished HTML Skip pill', () => {
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
  it('treats skip/notice as native chrome', () => {
    expect(gameModeChromeActive({ skip: true, notice: false, p2p: false })).toBe(true)
    expect(gameModeChromeActive({ skip: false, notice: false, p2p: false })).toBe(false)
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
    expect(overlay).not.toContain('dynamicOverlay: controlsVisible')
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
    expect(overlay).not.toContain('gameModeP2pLine')
    expect(overlay).not.toContain('p2pText')
    expect(overlay).toContain('gmDynamicOwnsChrome')
    expect(overlay).toContain('gmNativeControls')
    expect(overlay).toContain('controlsVisible && (!overlayFull || $playerSideSheetOpen)')
    expect(overlay).toContain('currentSeg && !overlayActive')
    expect(overlay).not.toContain('!overlayFull && !showSkip')
    expect(overlay).toContain('measureNativeChrome')
    expect(overlay).toContain('controlItems')
    expect(overlay).toContain('timelineSegments: segments.map')
    expect(overlay).toContain('chapterMarks: chapters.map')
    expect(overlay).toContain('fast: overlayFast')
    expect(overlay).toContain('if (!gmMode || !p2pVisible) return')
    expect(overlay).toContain('ontoggleplay={togglePlayback}')
    expect(overlay).toContain("if (action !== 'playerClose') poke()")
    expect(overlay).toContain('controls: visible && nativeControls')
    expect(overlay).toContain('loading || get(scrub).active || controlsVisible || showSkip')
    expect(overlay).toContain('if (picker && !picker.hidden) return')
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
    expect(gameModeDock({ ...base, playerMenuOpen: true }).hide).toBe(false)
    expect(gameModeDock({ ...base, trackMenuOpen: true }).hide).toBe(false)
    expect(gameModeDock({ ...base, commentsOpen: true }).hide).toBe(false)
    expect(gameModeDock({ ...base, streamPickerOpen: true }).hide).toBe(true)
  })
})

describe('Game-mode Leanback motion', () => {
  it('keeps a growing play highlight and D-pad settings overlay on top of video', () => {
    const css = readFileSync(fileURLToPath(new URL('../../app.css', import.meta.url)), 'utf8')
    expect(css).toContain('.gm-play.focus-ring-inset:focus')
    const controls = readFileSync(fileURLToPath(new URL('../components/player/Controls.svelte', import.meta.url)), 'utf8')
    expect(controls).toContain('gm-play')
    expect(controls).toContain('data-gm-control-root')
    expect(controls).toContain('data-gm-title')
    expect(controls).toContain('gmActivate')
    expect(controls).toContain('gm-open-tracks')
    expect(controls).toContain('player-menu-nav')
    expect(controls).not.toContain("case 'down': gmMove(1)")
    const comments = readFileSync(fileURLToPath(new URL('../components/player/CommentsPanel.svelte', import.meta.url)), 'utf8')
    expect(comments).toContain('dq-gm-hide')
    const seekbar = readFileSync(fileURLToPath(new URL('../components/player/Seekbar.svelte', import.meta.url)), 'utf8')
    expect(seekbar).toContain('class:opacity-0={gm}')
    const menu = readFileSync(fileURLToPath(new URL('../components/player/TrackMenu.svelte', import.meta.url)), 'utf8')
    expect(menu).toContain('gm-open-tracks')
    expect(menu).toContain('bumpPlayerOverlay')
    expect(menu).toContain('pointerAllowed')
    const picker = readFileSync(fileURLToPath(new URL('../components/player/StreamPicker.svelte', import.meta.url)), 'utf8')
    expect(picker).toContain("trap.querySelector<HTMLElement>('[data-source-row]')")
    expect(picker).toContain('bind:this={pickerTrap}')
    expect(picker).not.toContain("document.querySelector<HTMLElement>('[data-best-source]')")
  })

  it('clips a right-side sheet instead of snapshotting the full player', () => {
    expect(gameModeSideSheetCrop(1280, 800, { left: 896, top: 40, width: 352, height: 720 }))
      .toEqual({ x: 872, y: 16, w: 400, h: 768 })
    expect(gameModeSideSheetCrop(1280, 800, null)).toBeNull()
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
