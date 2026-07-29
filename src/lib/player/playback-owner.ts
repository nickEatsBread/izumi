export type PlaybackOwner = symbol

let activeOwner: PlaybackOwner | null = null

/** A normal source load takes ownership. A recovery load may only retain the owner it captured;
 * if another episode/source has taken over meanwhile, it is stale and must not start. */
export function beginPlaybackOwner(recoveryOwner?: PlaybackOwner): PlaybackOwner | null {
  if (recoveryOwner) return activeOwner === recoveryOwner ? recoveryOwner : null
  activeOwner = Symbol('playback')
  return activeOwner
}

/** Invalidate in-flight recovery as soon as a new episode resolve begins, before its source loads. */
export function invalidatePlaybackOwner(): void {
  activeOwner = Symbol('playback-pending')
}

export function currentPlaybackOwner(): PlaybackOwner | null {
  return activeOwner
}

export function ownsPlayback(owner: PlaybackOwner): boolean {
  return activeOwner === owner
}
