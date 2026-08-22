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

/** Gamescope cannot blend the live webview over its mpv child, so the spinner and scrub bar
 * are native ASS. P2P / toasts stay HTML and are snapshotted onto the video. Comments keep
 * the live webview surface. */
export function shouldUseGameModeDynamicOverlay(input: {
  loading: boolean
  scrubbing: boolean
  commentsOpen: boolean
  directP2P: boolean
}): boolean {
  if (input.commentsOpen) return false
  void input.directP2P
  void input.scrubbing
  // Scrub uses the live HTML seekbar once the video is docked. Only the pre-first-frame
  // spinner still needs the native ASS layer on the fullscreen mpv child.
  return input.loading
}
