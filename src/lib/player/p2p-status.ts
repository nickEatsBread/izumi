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
