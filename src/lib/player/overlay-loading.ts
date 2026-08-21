/** How long a stall must last before the spinner is shown. Cached seeks finish
 *  faster than this; jumping into unbuffered media does not. YouTube-class
 *  players sit around 150ms — long enough to skip a flash, short enough to feel
 *  instant. Do not restart this timer on every `buffering=true` pulse. */
export const BUFFER_SPINNER_DELAY_MS = 150

export function bufferSpinnerAction(
  showing: boolean,
  pending: boolean,
  next: boolean,
): 'hide' | 'arm' | 'noop' {
  if (!next) return showing || pending ? 'hide' : 'noop'
  if (showing || pending) return 'noop'
  return 'arm'
}

/** Whether the player overlay should show the startup/buffer spinner.

 *  Encrypted playback opens the overlay before Shaka has attached, and the
 *  HTML video is paused until `play()`. Treating that as a user pause hid the
 *  spinner, so the player sat idle for a second or more after an episode click. */
export function overlayIsLoading(state: {
  eof: boolean
  paused: boolean
  buffering: boolean
  seeking: boolean
  coreIdle: boolean
  firstFrame: boolean
  pos: number
}): boolean {
  if (state.eof) return false
  if (!state.firstFrame) return true
  if (state.paused) return false
  return state.buffering || state.seeking || (state.coreIdle && state.pos > 0)
}
