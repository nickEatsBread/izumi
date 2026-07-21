import { invoke } from '@tauri-apps/api/core'
import { title } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'
import { armPendingReturn, armPendingWatch } from './android-tracking'

/** Hand a resolved stream URL (or a local downloaded file path) to an external Android player via
 *  the extplayer plugin's ACTION_VIEW chooser. On success, arm return-based tracking for the
 *  episode. Returns false if no player is installed / the launch failed (caller surfaces it). */
export async function playViaIntent(
  media: Media | null,
  episode: number | null,
  url: string,
  isLocal = false,
  onReturn?: () => void,
): Promise<boolean> {
  const label = media
    ? `${title(media)}${episode != null ? ` — Episode ${episode}` : ''}`
    : url
  try {
    await invoke('plugin:extplayer|play_external', { payload: { url, title: label, isLocal } })
    if (media && episode != null) armPendingWatch(media, episode, onReturn)
    else if (onReturn) armPendingReturn(onReturn)
    return true
  } catch {
    return false
  }
}
