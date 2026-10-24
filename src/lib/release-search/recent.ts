import { get } from 'svelte/store'
import { profiledPersisted } from '$lib/profiles/store'
import { incognito } from '$lib/stores/incognito'
import type { Stream } from '$lib/stremio/parse'

/** A release played in search box mode. Resume reads the position store under `mediaId`, so this
 *  keeps only what replaying and labelling the release needs. */
export interface RecentRelease {
  mediaId: number
  episode: number
  season?: number
  title: string
  stream: Stream
  playedAt: number
}

export const RECENT_RELEASE_LIMIT = 20
export const recentReleases = profiledPersisted<RecentRelease[]>('recent-releases', [])

export function rememberRelease(entry: Omit<RecentRelease, 'playedAt'>): void {
  if (get(incognito)) return
  // Extension icons can be inline base64; twenty of them would bloat every save.
  const stream = { ...entry.stream, __logo: undefined }
  recentReleases.update((list) => [
    { ...entry, stream, playedAt: Date.now() },
    ...list.filter((item) => item.mediaId !== entry.mediaId),
  ].slice(0, RECENT_RELEASE_LIMIT))
}

export function forgetRelease(mediaId: number): void {
  recentReleases.update((list) => list.filter((item) => item.mediaId !== mediaId))
}
