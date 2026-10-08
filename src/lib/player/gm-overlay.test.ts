import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  gameModeBitmapOverlayActive,
  gameModeChromeActive,
  gameModeDock,
  gameModeDockIsLive,
  gameModeLiveMenuOpen,
  gameModeSnapshotCrop,
  gameModeSideSheetCrop,
  presenceAllowed,
  scheduleGameModeOverlay,
  usesGameModeBitmapCompositor,
} from './gm-overlay'

describe('Gamescope compositor routing', () => {
  it('uses bitmap/native chrome only for the XWayland path', () => {
    expect(usesGameModeBitmapCompositor(true, 'x11-snapshot')).toBe(true)
    expect(usesGameModeBitmapCompositor(true, 'wayland-live')).toBe(false)
    expect(usesGameModeBitmapCompositor(false, 'desktop-live')).toBe(false)
  })
})

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

  it('leaves menus, the picker and comments live, and snapshots only picture-relative panels', () => {
    expect(gameModeBitmapOverlayActive({ ...base, trackMenuOpen: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, playerMenuOpen: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, commentsOpen: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, sourcePickerOpen: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, connectingOpen: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, statsOpen: true })).toBe(true)
    expect(gameModeBitmapOverlayActive({ ...base, subtitleEditorOpen: true })).toBe(true)
  })

  it('yields idle controls to the native loading/scrub overlay', () => {
    expect(gameModeBitmapOverlayActive({ ...base, controlsVisible: true, dynamicOverlay: true })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, dynamicOverlay: true })).toBe(false)
  })

  it('snapshots the polished HTML Skip pill', () => {
    expect(gameModeBitmapOverlayActive({ ...base, skipVisible: true })).toBe(true)
  })

  it('snapshots an open nav layer or the on-screen keyboard over the video', () => {
    expect(gameModeBitmapOverlayActive({ ...base, navLayerOpen: true })).toBe(true)
    expect(gameModeBitmapOverlayActive({ ...base, oskOpen: true })).toBe(true)
    expect(gameModeBitmapOverlayActive({ ...base, navLayerOpen: true, playing: false })).toBe(false)
    expect(gameModeBitmapOverlayActive({ ...base, oskOpen: true, gameMode: false })).toBe(false)
    // Live comments already show the keyboard above them; capturing them would stall Disqus.
    expect(gameModeBitmapOverlayActive({ ...base, oskOpen: true, commentsOpen: true })).toBe(false)
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
    expect(overlay).toContain('sourcePickerOpen')
    expect(overlay).toContain('subtitleEditorOpen')
    expect(overlay).toContain('onpaint={gmBitmapMode ? bumpPlayerOverlay : undefined}')
    expect(overlay).toContain('streamPickerDismissedAt')
    expect(overlay).not.toContain('gameModeP2pLine')
    expect(overlay).not.toContain('p2pText')
    expect(overlay).toContain('gmDynamicOwnsChrome')
    expect(overlay).toContain('gmNativeControls')
    expect(overlay).toContain('usesGameModeBitmapCompositor')
    expect(overlay).toContain('native={gmBitmapMode}')
    expect(overlay).toContain('controlsVisible && !gmMenuStage && !gmVideoHidden && (!overlayFull || $playerSideSheetOpen)')
    expect(overlay).toContain('currentSeg && !overlayActive')
    expect(overlay).not.toContain('!overlayFull && !showSkip')
    expect(overlay).toContain('measureNativeChrome')
    expect(overlay).toContain('controlItems')
    expect(overlay).toContain('timelineSegments: segments.map')
    expect(overlay).toContain('chapterMarks: chapters.map')
    expect(overlay).toContain('fast: false')
    expect(overlay).not.toContain('commentsOverlayMoving')
    expect(overlay).not.toContain("'[data-gm-comments-surface]'")
    expect(overlay).not.toContain('paintedCommentsCrop')
    expect(overlay).toContain('exactCrop: false')
    expect(overlay).toContain('const nativeSheet = sheetMotion')
    expect(overlay).toContain('const paintedNativeSheet = paintedSheetMotion')
    expect(overlay).not.toContain('commentsOpen && $discussionExpanded')
    expect(overlay).toContain('if (!gmBitmapMode || !p2pVisible) return')
    expect(overlay).toContain('ontoggleplay={togglePlayback}')
    expect(overlay).toContain("const quietSeek = gmMode && (action === 'playerSeekBack' || action === 'playerSeekForward')")
    expect(overlay).toContain("const quietCapture = action === 'playerScreenshot' || action === 'playerGif'")
    expect(overlay).toContain("if (action !== 'playerClose' && !quietSeek && !quietCapture) poke()")
    expect(overlay).toContain('controls: visible && nativeControls')
    expect(overlay).toContain('loading || get(scrub).active || controlsVisible || showSkip')
    expect(overlay).toContain('if (picker && !picker.hidden) return')
    expect(overlay).not.toContain('class:gm-chrome-in')
    expect(overlay).toContain('onpointerdown={onOverlayPointerDown}')
    expect(overlay).toContain("if (!gmMode || e.button !== 0 || !e.isPrimary) return")
    expect(overlay).toContain('ontouchstart={onOverlayTouchStart}')
    expect(overlay).toContain('onclickcapture={captureOverlayClick}')
    expect(overlay).toContain("listenSafe('gm-native-touch-begin'")
    expect(overlay).toContain('function revealFromTouchBegin(): boolean')
    expect(overlay).toContain('suppressTouchRevealClickUntil = performance.now() + 900')
    expect(overlay).toContain('e.stopImmediatePropagation()')
  })

  it('swallows only the click of the touch that revealed the controls', () => {
    const body = overlay.replace(/\r\n/g, '\n')
    expect(body).toContain('ontouchmove={onOverlayTouchMove}')
    // The revealing touch is adopted once; any later touch disarms the window, since its own click
    // is a real press on whatever the reveal put there. The window keeps its full length: the
    // compatibility click's latency after the lift is not something to guess.
    expect(body).toContain('      if (revealTouch) {\n')
    expect(body).toContain('        suppressTouchRevealClickUntil = 0\n        revealTouch = null\n      } else {')
    expect(body).not.toContain('onOverlayTouchEnd')
    // A drag disarms it too, and a tap elsewhere inside the window is a real press.
    expect(body).toContain('Math.hypot(touch.clientX - revealTouch.x, touch.clientY - revealTouch.y) > 12')
    expect(body).toContain('Math.hypot(e.clientX - revealTouch.x, e.clientY - revealTouch.y) > 24) return')
  })

  it('pauses behind live menus over the frozen frame instead of shrinking the video', () => {
    const body = overlay.replace(/\r\n/g, '\n')
    expect(overlay).toContain('gameModeLiveMenuOpen({')
    expect(overlay).toContain('const frozen = gmMenuStage || gmVideoHidden')
    expect(overlay).toContain("document.documentElement.classList.toggle('gm-frozen', frozen)")
    // Pause first, so the captured frame is the one the video window keeps showing; never in a
    // watch party, where a pause stops the whole room.
    expect(body).toContain("await gmPauseForMenu()\n    // The capture is the window as shown, OSD included: let mpv redraw without the controls.\n    await new Promise((resolve) => setTimeout(resolve, GM_OSD_CLEAR_MS))\n    if (token !== gmStageToken) return\n    const stream = $nowPlayingStream.url\n    const url = firstFrame ? await captureFrozenFrame() : ''")
    expect(overlay).toContain('if (!firstFrame || paused || get(watchParty)) return')
    // Every close and teardown supersedes a freeze still capturing.
    expect(overlay).toContain('const thaw = ++gmStageToken')
    // The video window unmaps only once the frame is painted, and maps back before resuming.
    expect(body).toContain("await framePainted(gmFrameImg)\n    if (token !== gmStageToken) return\n    gmVideoHidden = true")
    // The menus reveal only once the unmap has landed, so the dim starts from nothing.
    expect(body).toContain("await new Promise((resolve) => setTimeout(resolve, GM_UNMAP_SETTLE_MS))\n    if (token !== gmStageToken) return\n    gmStage.set('frozen')")
    expect(overlay).toContain('const dock = gameModeDock({ commentsOpen: $commentsOpen, frozen: gmVideoHidden })')
    // A source picked from the menu shows its own first frame before the video window returns,
    // and the old source is never resumed over it.
    expect(overlay).toContain('gmFirstFrameWaiters.push(resolve)')
    expect(overlay).toContain('setTimeout(resolve, GM_FIRST_FRAME_WAIT_MS)')
    expect(overlay).toContain('if ($nowPlayingStream.url === gmPausedStream) {')
    // Any other pause (the user, the subtitle editor, the sleep timer) owns the play state again.
    expect(overlay).toContain("if (args[0] === 'pause' && !gmOwnPause) gmPausedForMenu = false")
    expect(overlay).toContain('paused={paused && !gmPausedForMenu}')
    // The control-strip snapshot never carries the paused picture over the moving video.
    expect(overlay).toContain('if (gmMenuStage || $gmFrozenFrame != null) {')
    expect(overlay).toContain('data-gm-stage')
    // The frame is the window as shown (fit, letterbox and subtitles included), OSD hidden first.
    expect(overlay).toContain('class="h-full w-full object-contain" />')
    expect(overlay).toContain('animateControls: $playerProgressAnimations && !gmMenuStage,')
    expect(overlay).toContain('await new Promise((resolve) => setTimeout(resolve, GM_OSD_CLEAR_MS))')
    expect(overlay).toContain(':global(html.gm-frozen [data-gm-menu-surface])')
    expect(overlay).not.toContain('gm-docked')
    for (const file of ['TrackMenu', 'StreamPicker', 'SourceConnecting', 'UpNextOverlay', 'SeriesRatingPrompt', 'Controls']) {
      const source = readFileSync(fileURLToPath(new URL(`../components/player/${file}.svelte`, import.meta.url)), 'utf8')
      expect(source, file).toContain('data-gm-menu-surface')
      expect(source, file).not.toContain('data-gm-dock-avoid')
    }
    // The caching screen is opaque on purpose: it hides the frame rather than dimming it.
    const caching = readFileSync(fileURLToPath(new URL('../components/player/DebridCaching.svelte', import.meta.url)), 'utf8')
    expect(caching).not.toContain('data-gm-menu-surface')
    const controls = readFileSync(fileURLToPath(new URL('../components/player/Controls.svelte', import.meta.url)), 'utf8')
    expect(controls).toContain('data-gm-bar')
  })

  it('draws the Deck player menus as TV side panels that slide over the paused frame', () => {
    for (const file of ['TrackMenu', 'StreamPicker', 'Controls']) {
      const source = readFileSync(fileURLToPath(new URL(`../components/player/${file}.svelte`, import.meta.url)), 'utf8')
      expect(source, file).toContain('data-gm-tv-panel')
      expect(source, file).toContain("import { gmPanel, gmPanelOut } from '$lib/player/gm-freeze'")
      expect(source, file).toMatch(/inset-y-0 right-0|justify-items-end/)
      expect(source, file).toContain('<Glyph family="deck" button="b" />')
    }
    const menu = readFileSync(fileURLToPath(new URL('../components/player/TrackMenu.svelte', import.meta.url)), 'utf8')
    // B steps back out of a category before it closes the panel.
    expect(menu).toContain("case 'b': ascend(); break")
    expect(menu).toContain('{#key level}')
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
  it('keeps the video full screen and never shrinks it', () => {
    expect(gameModeDock({ commentsOpen: false, frozen: false })).toEqual({ bottom: 0, right: 0, top: 0, hide: false })
    expect(gameModeDockIsLive(gameModeDock({ commentsOpen: false, frozen: false }))).toBe(false)
  })

  it('unmaps the video only behind the painted frozen frame or the opaque comments panel', () => {
    expect(gameModeDock({ commentsOpen: false, frozen: true })).toEqual({ bottom: 0, right: 0, top: 0, hide: true })
    expect(gameModeDock({ commentsOpen: true, frozen: false }).hide).toBe(true)
    expect(gameModeDockIsLive(gameModeDock({ commentsOpen: false, frozen: true }))).toBe(true)
  })

  it('names every live menu surface', () => {
    expect(gameModeLiveMenuOpen({ playerMenuOpen: false, trackMenuOpen: false })).toBe(false)
    expect(gameModeLiveMenuOpen({ playerMenuOpen: false, trackMenuOpen: false, upNextOpen: true })).toBe(true)
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
    expect(comments).toContain("$gameMode ? 'bg-transparent' : 'bg-black/60'")
    const seekbar = readFileSync(fileURLToPath(new URL('../components/player/Seekbar.svelte', import.meta.url)), 'utf8')
    expect(seekbar).toContain('class:opacity-0={native}')
    const menu = readFileSync(fileURLToPath(new URL('../components/player/TrackMenu.svelte', import.meta.url)), 'utf8')
    expect(menu).toContain('gm-open-tracks')
    expect(menu).toContain('bumpPlayerOverlay')
    expect(menu).toContain('pointerAllowed')
    const picker = readFileSync(fileURLToPath(new URL('../components/player/StreamPicker.svelte', import.meta.url)), 'utf8')
    expect(picker).toContain("trap.querySelector<HTMLElement>('[data-source-row]')")
    expect(picker).toContain('bind:this={pickerTrap}')
    expect(picker).not.toContain("document.querySelector<HTMLElement>('[data-best-source]')")
    const connecting = readFileSync(fileURLToPath(new URL('../components/player/SourceConnecting.svelte', import.meta.url)), 'utf8')
    expect(connecting).toContain('{:else if $gameMode && $playing}')
    expect(connecting).toContain('bg-black/45')
  })

  it('passes the open layer and keyboard to the bitmap policy', () => {
    const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')
    expect(overlay).toContain('navLayerOpen: $navLayerOpen,')
    expect(overlay).toContain('oskOpen: $oskOpen,')
  })

  it('lets the picker exclusively consume a Game-mode B edge', () => {
    const gamepad = readFileSync(fileURLToPath(new URL('../nav/gamepad.ts', import.meta.url)), 'utf8')
    const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')
    expect(gamepad).toContain('streamPickerDismissedAt.set(performance.now())')
    expect(overlay).toContain('performance.now() - get(streamPickerDismissedAt) < 500')
  })

  it('lets B cancel a source switch, not just hide the picker', () => {
    const gamepad = readFileSync(fileURLToPath(new URL('../nav/gamepad.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    const picker = readFileSync(fileURLToPath(new URL('../components/player/StreamPicker.svelte', import.meta.url)), 'utf8')
    expect(gamepad).toContain("window.dispatchEvent(new Event('stream-picker-dismiss'))\n        streamPicker.set(null)")
    expect(picker).toContain("window.addEventListener('stream-picker-dismiss', onDismiss)")
    expect(picker).toContain('const onDismiss = () => close()')
    // A pick already handed to playStream stops only through the card's own cancel.
    const close = picker.slice(picker.indexOf('  function close() {'))
    expect(close.indexOf('if (pickerStore === streamPicker) $connecting?.cancel()')).toBeGreaterThan(-1)
    expect(close.indexOf('if (pickerStore === streamPicker) $connecting?.cancel()')).toBeLessThan(close.indexOf('connecting.set(null)'))
  })

  it('cancels the switching card or caching screen on B instead of closing the player', () => {
    const gamepad = readFileSync(fileURLToPath(new URL('../nav/gamepad.ts', import.meta.url)), 'utf8')
    const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')
    // The card with no picker under it: the player listener is its only B owner.
    expect(overlay).toContain('const pendingSwitch = get(connecting)')
    expect(overlay).toContain('if (e.payload.pressed) pendingSwitch.cancel()')
    // The caching screen is the router's; it stamps the picker hand-off before cancelling.
    expect(overlay).toContain('if (get(debridCaching)) return')
    const caching = gamepad.slice(gamepad.indexOf('if (get(debridCaching)) {'))
    expect(caching.indexOf('streamPickerDismissedAt.set(performance.now())')).toBeGreaterThan(-1)
    expect(caching.indexOf('streamPickerDismissedAt.set(performance.now())')).toBeLessThan(caching.indexOf('get(debridCaching)?.cancel()'))
    // Both checks sit before the B → close() fallthrough.
    expect(overlay.indexOf('const pendingSwitch = get(connecting)')).toBeLessThan(overlay.indexOf('// Reveals the page underneath (the series page you launched from), NOT home'))
    // The track menu under the card leaves that B to it, so one press cannot do both.
    const menu = readFileSync(fileURLToPath(new URL('../components/player/TrackMenu.svelte', import.meta.url)), 'utf8')
    expect(menu).toContain("if (e.payload.name === 'b' && get(connecting)) return")
  })

  it('opens the settings sheet with D-pad Up during playback', () => {
    const gamepad = readFileSync(fileURLToPath(new URL('../nav/gamepad.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
    const controls = readFileSync(fileURLToPath(new URL('../components/player/Controls.svelte', import.meta.url)), 'utf8')
    expect(gamepad).toContain("} else if (dir === 'up' && !repeat) {")
    expect(gamepad).toContain("window.dispatchEvent(new Event('player-settings-request'))")
    expect(gamepad).not.toContain("new Event('player-open-settings')")
    // The overlay is mounted for the whole playback (Controls only while the bar shows): it leaves
    // Up to whatever owns it, reveals the bar, then hands the request to the mounted Controls.
    const handler = overlay.slice(overlay.indexOf('const onRequest = async () => {'))
    expect(handler).toContain('if (subtitleEditorOpen || get(playerStatsOpen) || get(upNextPrompt) || get(connecting) || get(debridCaching)')
    expect(handler.indexOf('poke()')).toBeLessThan(handler.indexOf('await tick()'))
    expect(handler.indexOf('await tick()')).toBeLessThan(handler.indexOf("window.dispatchEvent(new Event('player-open-settings'))"))
    expect(overlay).toContain("window.addEventListener('player-settings-request', onRequest)")
    expect(controls).toContain("window.addEventListener('player-open-settings', onOpenSettings)")
    expect(controls).toContain("window.removeEventListener('player-open-settings', onOpenSettings)")
  })

  it('routes picker Up/Down locally instead of relying on hidden-page geometry', () => {
    const gamepad = readFileSync(fileURLToPath(new URL('../nav/gamepad.ts', import.meta.url)), 'utf8')
    const picker = readFileSync(fileURLToPath(new URL('../components/player/StreamPicker.svelte', import.meta.url)), 'utf8')
    expect(gamepad).toContain("new CustomEvent('stream-picker-nav', { detail: dir })")
    expect(picker).toContain("window.addEventListener('stream-picker-nav', onNav)")
  })

  it('keeps native Deck metadata and right-side icons aligned with the HTML HUD', () => {
    const controls = readFileSync(fileURLToPath(new URL('../components/player/Controls.svelte', import.meta.url)), 'utf8')
    const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')
    const nativeHud = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/player/gm_osd.rs', import.meta.url)), 'utf8')
    expect(controls).toContain("'text-3xl font-black leading-tight drop-shadow'")
    expect(controls).toContain("'text-lg font-semibold leading-snug text-white/75'")
    expect(nativeHud).toContain('state.title_size')
    expect(nativeHud).toContain('state.title_weight')
    expect(nativeHud).toContain('state.episode_size')
    expect(nativeHud).toContain('state.episode_weight')
    expect(overlay).toContain('Math.max(Number.isFinite(cssSize) ? cssSize : 0, rect.height)')
    expect(nativeHud).toContain('\\fnDejaVu Sans Mono')
    expect(nativeHud).toContain('SeekbarTween')
    expect(nativeHud).toContain('item.w.min(item.h) * 0.42')
    expect(controls).toContain('MessageSquare')
    expect(controls).toContain('aria-label="Audio, subtitles and server"><Captions')
    expect(controls).not.toContain('aria-label="Switch server"')
    expect(nativeHud).toContain('Lucide Settings silhouette')
    expect(nativeHud).toContain('Lucide MessageSquare')
    expect(nativeHud).toContain('Lucide Captions')
    expect(nativeHud).toContain('\\\\p4')
    expect(nativeHud).not.toContain('\\\\p1')
    expect(nativeHud).not.toContain('rect_blur')
    expect(nativeHud).not.toContain('fade_h')
    expect(nativeHud).toContain('soft_rect')
    expect(nativeHud).toContain('surface_opacity')
    expect(nativeHud).not.toContain('let bands = 16usize')
    expect(nativeHud).not.toContain('PAD_SCRUB_TAU')
    expect(nativeHud).not.toContain('smooth_scrub_time')
    expect(overlay).not.toContain('gmDynRaf')
    expect(overlay).toContain('lastChromeLayoutKey')
    expect(overlay).toContain('moveScrub(t, true)')
    expect(nativeHud).toContain('alpha_hex(opacity * 0.50)')
    expect(nativeHud).not.toContain('rounded_rect_ring(')
  })

  it('clips a right-side sheet instead of snapshotting the full player', () => {
    expect(gameModeSideSheetCrop(1280, 800, { left: 896, top: 40, width: 352, height: 720 }))
      .toEqual({ x: 872, y: 16, w: 400, h: 768 })
    expect(gameModeSideSheetCrop(1280, 800, { left: 180, top: 60, width: 920, height: 680 }, 0))
      .toEqual({ x: 180, y: 60, w: 920, h: 680 })
    expect(gameModeSideSheetCrop(1280, 800, null)).toBeNull()
  })

  it('does not snapshot the live Game-mode comments surface', () => {
    const overlay = readFileSync(fileURLToPath(new URL('../components/player/PlayerOverlay.svelte', import.meta.url)), 'utf8')
    expect(overlay).not.toContain('commentsRect')
    expect(overlay).not.toContain('paintedComments')
  })

  it('honours a crop while the native overlay is continuously refreshing', () => {
    const native = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/player/linux_overlay.rs', import.meta.url)), 'utf8')
    expect(native).toContain('*strip = crop;')
    expect(native).toContain('for y in scan_y..scan_bottom')
    expect(native).toContain('for x in scan_x..scan_right')
    expect(native).not.toContain('*strip = if fast { None } else { crop };')
  })

  it('settles idle comments and skips the bounds scan for their exact crop', () => {
    const native = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/player/linux_overlay.rs', import.meta.url)), 'utf8')
    expect(native).toContain('SnapshotOptions::TRANSPARENT_BACKGROUND')
    expect(native).toContain('if exact_crop && strip.is_some()')
    expect(native).toContain('clip_to_strip((0, 0, w as usize, h as usize), strip)')
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
