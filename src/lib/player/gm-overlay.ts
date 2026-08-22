/** Game-mode overlay policy: ordinary controls/progress are native ASS so their reveal/hide can
 * run at display cadence. Complex panels, comments, P2P and toasts remain bitmap chrome. */

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
}): boolean {
  if (!input.gameMode || !input.playing) return false
  // Menus/comments are also painted into mpv: leaving them as live HTML requires unmapping the
  // opaque Gamescope video window, which made the output go black. Discrete menus re-snapshot on
  // focus changes; comments use the native self-paced refresh loop while scrolling.
  if (input.commentsOpen || input.trackMenuOpen || input.playerMenuOpen || input.statsOpen) return true
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

/** Only source-resolution surfaces unmap mpv. Player chrome, settings, tracks and comments remain
 * bitmap overlays over the fullscreen child so opening them never blanks the video. */
export function gameModeDock(input: {
  loading: boolean
  controlsVisible: boolean
  playerMenuOpen: boolean
  trackMenuOpen: boolean
  commentsOpen: boolean
  noticeVisible: boolean
  streamPickerOpen?: boolean
}): { bottom: number; right: number; top: number; hide: boolean } {
  void input.noticeVisible
  if (
    input.streamPickerOpen
  ) {
    return { bottom: 0, right: 0, top: 0, hide: true }
  }
  void input.loading
  void input.controlsVisible
  return { bottom: 0, right: 0, top: 0, hide: false }
}

export function gameModeDockIsLive(dock: { bottom: number; right: number; top: number; hide: boolean }): boolean {
  return dock.hide || dock.bottom > 0 || dock.right > 0 || dock.top > 0
}
