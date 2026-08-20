import type { AudioLang, SubLang } from '$lib/settings/ui'
import { subtitleKind, type Track } from './track-label'

function langMatches(track: Track, wanted: 'eng' | 'jpn'): boolean {
  const code = track.lang?.trim().toLowerCase() ?? ''
  if (wanted === 'eng') return code === 'eng' || code === 'en' || code === 'english'
  return code === 'jpn' || code === 'ja' || code === 'japanese'
}

/** Choose the subtitle track after loadfile.
 *
 *  Sub watch (JP audio + EN subs): full dialogue, never Signs & Songs.
 *  Dub watch (EN audio + EN subs): Signs/Forced if present, otherwise off — full English
 *  subs on an English dub duplicate the dialogue.
 *  `none` turns subs off. `undefined` means leave mpv's slang pick alone. */
export function pickSubtitleTrackId(
  tracks: Track[],
  audioLang: AudioLang,
  subLang: SubLang,
): number | 'no' | undefined {
  if (subLang === 'none') return 'no'
  const subs = tracks.filter((track) => track.type === 'sub')
  if (!subs.length) return undefined
  const inLang = subs.filter((track) => langMatches(track, subLang))
  const pool = inLang.length ? inLang : subs
  const dubbing = audioLang === 'eng' && subLang === 'eng'
  if (dubbing) {
    const signs = pool.find((track) => {
      const kind = subtitleKind(track)
      return kind === 'signs' || kind === 'forced'
    })
    return signs?.id ?? 'no'
  }
  const rank = (track: Track) => {
    const kind = subtitleKind(track)
    if (kind === 'full') return 0
    if (kind === 'other') return 1
    if (kind === 'sdh') return 2
    if (kind === 'forced') return 3
    return 4
  }
  return [...pool].sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0]?.id
}
