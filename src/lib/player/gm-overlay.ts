/** Game-mode overlay policy: when the HTML chrome is snapshotted into mpv. Loading and
 * scrubbing stay native ASS; P2P / toasts / menus are real HTML snapshotted onto the video. */

export function gameModeBitmapOverlayActive(input: {
  gameMode: boolean
  playing: boolean
  dynamicOverlay: boolean
  controlsVisible: boolean
  trackMenuOpen: boolean
  playerMenuOpen: boolean
  commentsOpen: boolean
  p2pVisible?: boolean
  noticeVisible?: boolean
  skipVisible?: boolean
}): boolean {
  if (!input.gameMode || !input.playing) return false
  // Menus/comments unmap mpv and paint as live HTML. Fullscreen chrome uses one settled
  // WebKit snapshot; Rust animates that bitmap inside mpv without re-rastering WebKit.
  if (input.commentsOpen || input.trackMenuOpen || input.playerMenuOpen) return false
  if (input.noticeVisible || input.skipVisible) return true
  if (input.p2pVisible && !input.dynamicOverlay) return true
  if (input.dynamicOverlay) return false
  return input.controlsVisible
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

export function gameModeP2pLine(stats: {
  downloadMbps: number
  uploadMbps: number
  livePeers: number
} | null): string {
  if (!stats) return 'P2P  Connecting to peers…'
  const down = Number.isFinite(stats.downloadMbps) ? stats.downloadMbps : 0
  const up = Number.isFinite(stats.uploadMbps) ? stats.uploadMbps : 0
  const peers = stats.livePeers === 1 ? '1 peer' : `${stats.livePeers} peers`
  return `P2P  ↓ ${down.toFixed(1)}  ↑ ${up.toFixed(1)}  ${peers}`
}

/** Discord / SMTC / MPRIS do not reach the Deck session and steal wakeups. */
export function presenceAllowed(gameMode: boolean): boolean {
  return !gameMode
}

/** Live webview: unmap mpv for opaque full-screen HTML (comments, settings, ☰, source picker).
 * Control chrome remains over a fullscreen mpv child and is animated as a native bitmap. */
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
    input.commentsOpen
    || input.playerMenuOpen
    || input.trackMenuOpen
    || input.streamPickerOpen
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
