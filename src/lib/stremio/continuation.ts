type PlaybackState = {
  status: 'idle' | 'resolving' | 'playing' | 'error'
  message?: string
}

/** Forward an automatic continuation result without dismissing the source picker prematurely. */
export function applyContinuationState(
  state: PlaybackState,
  closePicker: () => void,
  onState: (state: PlaybackState) => void,
) {
  const played = state.status === 'playing'
  if (played) closePicker()
  onState(state)
  return {
    played,
    error: state.status === 'error' ? (state.message ?? 'Playback failed.') : '',
  }
}
