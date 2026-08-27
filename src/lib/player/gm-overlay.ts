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
}): boolean {
  if (!input.gameMode || !input.playing) return false
  // Comments are a full-viewport, opaque live WebKit surface on Gamescope. Capturing Disqus into
  // mpv made late iframe loads invisible and forced every scroll frame through GPU readback.
  if (input.commentsOpen) return false
  // Discrete menus only change on focus/selection, so a settled bitmap remains appropriate.
  if (input.trackMenuOpen || input.playerMenuOpen || input.statsOpen || input.sourcePickerOpen || input.connectingOpen || input.subtitleEditorOpen) return true
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

/** Player chrome, source selection and connection feedback all stay as bitmap overlays over the
 * fullscreen child. Unmapping mpv during either half of a source swap caused a black flash. */
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
}): { bottom: number; right: number; top: number; hide: boolean } {
  void input.noticeVisible
  void input.sourcePickerOpen
  void input.connecting
  void input.subtitleEditorOpen
  void input.loading
  void input.controlsVisible
  // Disqus is both late-loading and continuously interactive. Give it the live WebKit surface
  // while its opaque full-screen panel is open instead of snapshotting it over the X11 child.
  if (input.commentsOpen) return { bottom: 0, right: 0, top: 0, hide: true }
  return { bottom: 0, right: 0, top: 0, hide: false }
}

export function gameModeDockIsLive(dock: { bottom: number; right: number; top: number; hide: boolean }): boolean {
  return dock.hide || dock.bottom > 0 || dock.right > 0 || dock.top > 0
}
