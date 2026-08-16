export type RecoveryFirstFrameResult = 'ready' | 'timeout' | 'load-error'

export interface RecoveryFirstFrameWaiters {
  androidEmbedded: boolean
  androidTimeoutMs: number
  waitForAndroid: (timeoutMs: number) => Promise<boolean>
  waitForDesktop: () => Promise<RecoveryFirstFrameResult>
}

/** Verify a watchdog replacement with the player that actually owns the screen.
 * Android's embedded mpv reports its first visible frame through PLAYBACK_RESTART; desktop uses
 * Tauri player events. Mixing those signals makes a healthy Android torrent time out and advances
 * the recovery chain over video that has already started. */
export async function waitForRecoveryFirstFrame({
  androidEmbedded,
  androidTimeoutMs,
  waitForAndroid,
  waitForDesktop,
}: RecoveryFirstFrameWaiters): Promise<RecoveryFirstFrameResult> {
  if (androidEmbedded) {
    return await waitForAndroid(androidTimeoutMs) ? 'ready' : 'timeout'
  }
  return await waitForDesktop()
}
