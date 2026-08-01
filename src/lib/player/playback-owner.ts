import type { Media } from '$lib/anilist/types'
import type { Stream } from '$lib/stremio/addon'

export type PlaybackOwner = symbol

/** What the player was last actually wired for. Ownership alone cannot express this: a new resolve
 * invalidates the owner the moment it starts, long before (and possibly without ever) replacing the
 * file on screen, so the owner says "something newer is in progress" while this says "this is what
 * is playing right now". */
export type PlaybackIdentity = {
  media: Media
  episode: number | undefined
  stream: Stream
}

let activeOwner: PlaybackOwner | null = null
let loadedIdentity: PlaybackIdentity | null = null

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

/** Called once a source has genuinely been handed to the embedded player, never on the way there —
 * a resolve that errors out must leave the previous file's identity standing, because that file is
 * the one still playing. Pass null for a file that has no episode identity at all (a cloud-library
 * link): leaving the previous episode's identity standing there would let its retained pool match,
 * and a stall would "recover" by loading that old episode over the cloud file. */
export function recordPlaybackIdentity(identity: PlaybackIdentity | null): void {
  loadedIdentity = identity
}

export function currentPlaybackIdentity(): PlaybackIdentity | null {
  return loadedIdentity
}
