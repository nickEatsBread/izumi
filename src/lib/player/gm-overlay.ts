/** Game-mode overlay policy: when the HTML chrome is snapshotted into mpv, and when
 * skip / P2P / toasts are drawn as native ASS instead. */

export function gameModeBitmapOverlayActive(input: {
  gameMode: boolean
  playing: boolean
  dynamicOverlay: boolean
  controlsVisible: boolean
  trackMenuOpen: boolean
  playerMenuOpen: boolean
  commentsOpen: boolean
}): boolean {
  return input.gameMode && input.playing && !input.dynamicOverlay && (
    input.controlsVisible || input.trackMenuOpen || input.playerMenuOpen || input.commentsOpen
  )
}

/** Bottom control-strip crop in CSS pixels. Menus need the full viewport. */
export function gameModeSnapshotCrop(
  width: number,
  height: number,
  fast: boolean,
): { x: number; y: number; w: number; h: number } | null {
  if (fast || width <= 0 || height <= 0) return null
  const h = Math.max(1, Math.round(height * 0.28))
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
  if (!stats) return 'Connecting to peers…'
  const down = Number.isFinite(stats.downloadMbps) ? stats.downloadMbps : 0
  const up = Number.isFinite(stats.uploadMbps) ? stats.uploadMbps : 0
  const peers = stats.livePeers === 1 ? '1 peer' : `${stats.livePeers} peers`
  return `↓ ${down.toFixed(1)}  ↑ ${up.toFixed(1)}  ${peers}`
}

/** Discord / SMTC / MPRIS do not reach the Deck session and steal wakeups. */
export function presenceAllowed(gameMode: boolean): boolean {
  return !gameMode
}
