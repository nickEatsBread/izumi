export type P2PStatusVisibility = 'hidden' | 'buffering' | 'initial' | 'always'

/** A debrid stream may still carry an info hash, so the local engine URL is part of the test. */
export function isDirectP2PStream(stream: { url?: string; infoHash?: string | null } | null | undefined): boolean {
  return !!stream?.infoHash && /^http:\/\/127\.0\.0\.1:\d+\/torrents\//.test(stream.url ?? '')
}

export function shouldShowP2PStatus(
  visibility: P2PStatusVisibility,
  directP2P: boolean,
  buffering: boolean,
  firstFrameSeen: boolean,
): boolean {
  if (!directP2P || visibility === 'hidden') return false
  if (visibility === 'always') return true
  if (visibility === 'buffering') return buffering
  return buffering && !firstFrameSeen
}

/** Gamescope cannot blend the live webview over its mpv child, so ordinary loading and scrubbing
 * use a native ASS overlay. Interactive comments must keep the webview surface. Direct-P2P
 * startup chrome is also native (`gameModeP2pLine`) — the HTML transfer panel is desktop-only. */
export function shouldUseGameModeDynamicOverlay(input: {
  loading: boolean
  scrubbing: boolean
  commentsOpen: boolean
  directP2P: boolean
}): boolean {
  if (input.commentsOpen) return false
  void input.directP2P
  return input.scrubbing || input.loading
}
