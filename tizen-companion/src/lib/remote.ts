export type RemoteAction =
  | 'up' | 'down' | 'left' | 'right' | 'select' | 'back'
  | 'play' | 'pause' | 'playPause' | 'stop' | 'rewind' | 'fastForward'

const KEY_CODES: Record<number, RemoteAction> = {
  13: 'select',
  19: 'pause',
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  10009: 'back',
  10252: 'playPause',
  412: 'rewind',
  413: 'stop',
  415: 'play',
  417: 'fastForward',
}

const KEY_NAMES: Record<string, RemoteAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'select',
  Escape: 'back',
  Backspace: 'back',
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaPlayPause: 'playPause',
  MediaStop: 'stop',
  MediaRewind: 'rewind',
  MediaFastForward: 'fastForward',
}

export function remoteAction(event: KeyboardEvent): RemoteAction | undefined {
  return KEY_NAMES[event.key] ?? KEY_CODES[event.keyCode]
}

export function registerRemoteKeys(): void {
  const input = window.tizen?.tvinputdevice
  if (!input) return
  const keys = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward']
  try {
    if (input.registerKeyBatch) input.registerKeyBatch(keys)
    else keys.forEach((key) => input.registerKey(key))
  } catch {
    // Some emulators expose the API without supporting every media key.
  }
}
