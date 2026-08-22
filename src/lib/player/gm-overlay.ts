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
}): boolean {
  if (!input.gameMode || !input.playing) return false
  if (input.p2pVisible || input.noticeVisible) return true
  if (input.dynamicOverlay) return false
  return input.controlsVisible || input.trackMenuOpen || input.playerMenuOpen || input.commentsOpen
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

/** Live webview insets. Chrome and settings sit on top of fullscreen video via overlay-add
 * (docking made the picture tiny). Only comments hide the mpv child so the iframe is live. */
export function gameModeDock(input: {
  loading: boolean
  controlsVisible: boolean
  playerMenuOpen: boolean
  trackMenuOpen: boolean
  commentsOpen: boolean
  noticeVisible: boolean
}): { bottom: number; right: number; top: number; hide: boolean } {
  void input.loading
  void input.controlsVisible
  void input.playerMenuOpen
  void input.trackMenuOpen
  void input.noticeVisible
  if (input.commentsOpen) {
    return { bottom: 0, right: 0, top: 0, hide: true }
  }
  return { bottom: 0, right: 0, top: 0, hide: false }
}

export function gameModeDockIsLive(dock: { bottom: number; right: number; top: number; hide: boolean }): boolean {
  return dock.hide || dock.bottom > 0 || dock.right > 0 || dock.top > 0
}
