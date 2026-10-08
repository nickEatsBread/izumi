/** Game-mode overlay policy: ordinary controls/progress are native ASS so their reveal/hide can
 * run at display cadence. Complex panels, comments, P2P and toasts remain bitmap chrome. */

export type PlayerCompositorPath = 'desktop-live' | 'x11-snapshot' | 'wayland-live'

/** Only Gamescope's XWayland child-window path needs WebKit snapshots and native ASS chrome. */
export function usesGameModeBitmapCompositor(
  gameMode: boolean,
  path: PlayerCompositorPath,
): boolean {
  return gameMode && path === 'x11-snapshot'
}

export function gameModeBitmapOverlayActive(input: {
  gameMode: boolean
  playing: boolean
  dynamicOverlay: boolean
  controlsVisible: boolean
  trackMenuOpen: boolean
  playerMenuOpen: boolean
  commentsOpen: boolean
  statsOpen?: boolean
  p2pVisible?: boolean
  noticeVisible?: boolean
  skipVisible?: boolean
  sourcePickerOpen?: boolean
  connectingOpen?: boolean
  subtitleEditorOpen?: boolean
  /** A nav layer (a dropdown, sheet or the select chooser) is open over the video. */
  navLayerOpen?: boolean
  /** The on-screen keyboard is open over the video. */
  oskOpen?: boolean
}): boolean {
  if (!input.gameMode || !input.playing) return false
  // Comments are a full-viewport, opaque live WebKit surface on Gamescope. Capturing Disqus into
  // mpv made late iframe loads invisible and forced every scroll frame through GPU readback.
  if (input.commentsOpen) return false
  // A layer or the keyboard is plain HTML: without the bitmap it would own the pad while staying
  // invisible behind mpv. (Over live comments the webview already shows it, hence the order.)
  if (input.navLayerOpen || input.oskOpen) return true
  // Menus, the source picker and the switching card render live beside the docked video tile
  // (gameModeDock), so they never come through here. Stats and the subtitle mover stay over
  // full-size video: both are read against the picture itself.
  if (input.statsOpen || input.subtitleEditorOpen) return true
  // Keep the polished HTML Skip pill. The native progress/controls continue independently below
  // its transparent bitmap; PlayerOverlay must never disable gmNativeControls just because this
  // chip is visible (that coupling was the disappearing-seekbar bug).
  if (input.noticeVisible || input.skipVisible) return true
  // P2P always uses its proper HTML card, including before the first frame. The old native ASS
  // text line was a visibly different fallback and could replace the card during loading.
  if (input.p2pVisible) return true
  void input.controlsVisible
  void input.dynamicOverlay
  return false
}

/** Wait one paint + a short macrotask so WebKit has laid out menus/toasts before we snapshot. */
export function scheduleGameModeOverlay(run: () => void): () => void {
  let cancelled = false
  let timeout: ReturnType<typeof setTimeout> | 0 = 0
  const later = () => { if (!cancelled) run() }
  const outer = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(() => { timeout = setTimeout(later, 32) })
    : 0
  if (!outer) timeout = setTimeout(later, 32)
  return () => {
    cancelled = true
    if (typeof cancelAnimationFrame === 'function' && outer) cancelAnimationFrame(outer)
    if (timeout) clearTimeout(timeout)
  }
}

/** Bottom control-strip crop in CSS pixels. Menus, P2P, and toasts need the full viewport. */
export function gameModeSnapshotCrop(
  width: number,
  height: number,
  full: boolean,
): { x: number; y: number; w: number; h: number } | null {
  if (full || width <= 0 || height <= 0) return null
  const h = Math.max(1, Math.round(height * 0.36))
  return { x: 0, y: Math.max(0, height - h), w: width, h }
}

/** Crop a Game-mode side sheet with enough breathing room for its border/shadow. The backdrop is
 * native, so keeping this bitmap small makes the slide substantially cheaper than moving a full
 * 1280×800 WebKit snapshot. */
export function gameModeSideSheetCrop(
  viewportWidth: number,
  viewportHeight: number,
  rect: { left: number; top: number; width: number; height: number } | null,
  margin = 24,
): { x: number; y: number; w: number; h: number } | null {
  if (!rect || viewportWidth <= 0 || viewportHeight <= 0 || rect.width <= 0 || rect.height <= 0) return null
  const safeMargin = Math.max(0, margin)
  const x = Math.max(0, Math.floor(rect.left - safeMargin))
  const y = Math.max(0, Math.floor(rect.top - safeMargin))
  const right = Math.min(viewportWidth, Math.ceil(rect.left + rect.width + safeMargin))
  const bottom = Math.min(viewportHeight, Math.ceil(rect.top + rect.height + safeMargin))
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null
}

export function gameModeChromeActive(input: {
  skip: boolean
  notice: boolean
  p2p: boolean
}): boolean {
  return input.skip || input.notice || input.p2p
}

/** Discord / SMTC / MPRIS do not reach the Deck session and steal wakeups. */
export function presenceAllowed(gameMode: boolean): boolean {
  return !gameMode
}

/** What the video window gives up, as fractions of the Game-mode window, while a menu is open: it
 * keeps a 16:9 tile in the top-left corner (40% × 36%, 512×288 on the Deck) and the menu renders
 * live in the rest. `html.gm-docked` moves menu surfaces out from under the tile (app.css). */
export const GAME_MODE_MENU_TILE = { right: 0.6, bottom: 0.64 } as const

/** A menu, prompt or the source picker is open over the playing video. Each renders live beside a
 * docked video tile rather than as a WebKit snapshot pushed into mpv: a snapshot was never
 * refreshed by scrolling or late-loading rows, so taps landed on rows the viewer could not see,
 * and every change cost two full-window software renders. */
export function gameModeLiveMenuOpen(input: {
  playerMenuOpen: boolean
  trackMenuOpen: boolean
  sourcePickerOpen?: boolean
  connecting?: boolean
  cachingOpen?: boolean
  ratingOpen?: boolean
  upNextOpen?: boolean
}): boolean {
  return input.playerMenuOpen || input.trackMenuOpen || !!input.sourcePickerOpen || !!input.connecting
    || !!input.cachingOpen || !!input.ratingOpen || !!input.upNextOpen
}

/** Where the Game-mode video window sits: full screen with bitmap chrome over it, a corner tile
 * beside a live menu, or unmapped under the opaque comments panel. Moving the window never
 * unmaps it, so a source swap made from the picker does not flash black. */
export function gameModeDock(input: {
  loading: boolean
  controlsVisible: boolean
  playerMenuOpen: boolean
  trackMenuOpen: boolean
  commentsOpen: boolean
  noticeVisible: boolean
  sourcePickerOpen?: boolean
  connecting?: boolean
  subtitleEditorOpen?: boolean
  cachingOpen?: boolean
  ratingOpen?: boolean
  upNextOpen?: boolean
}): { bottom: number; right: number; top: number; hide: boolean } {
  void input.noticeVisible
  void input.subtitleEditorOpen
  void input.loading
  void input.controlsVisible
  // Disqus is both late-loading and continuously interactive. Give it the live WebKit surface
  // while its opaque full-screen panel is open instead of snapshotting it over the X11 child.
  if (input.commentsOpen) return { bottom: 0, right: 0, top: 0, hide: true }
  if (gameModeLiveMenuOpen(input)) return { bottom: GAME_MODE_MENU_TILE.bottom, right: GAME_MODE_MENU_TILE.right, top: 0, hide: false }
  return { bottom: 0, right: 0, top: 0, hide: false }
}

export function gameModeDockIsLive(dock: { bottom: number; right: number; top: number; hide: boolean }): boolean {
  return dock.hide || dock.bottom > 0 || dock.right > 0 || dock.top > 0
}
