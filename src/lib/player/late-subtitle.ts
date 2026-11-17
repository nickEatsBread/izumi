import { invoke } from '@tauri-apps/api/core'
import { lateSubtitleRevision } from './session'

/** Attach a subtitle URL to the file that is already playing. mpv adds it without selecting it, so
 *  the bump lets the overlay's subtitle choice consider it. The command wants both strings, and
 *  add-on results often carry no title. */
export async function attachLateSubtitle(url: string, lang?: string, title?: string) {
  await invoke('player_attach_subtitle_url', { url, lang: lang || 'und', title: title || lang || 'Online subtitles' })
  lateSubtitleRevision.update((n) => n + 1)
}
