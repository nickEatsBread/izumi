import type { AudioLang, SubLang } from '$lib/settings/ui'
import { normalizeLang } from '$lib/stremio/sublang'
import { subtitleKind, type Track } from './track-label'

function langMatches(track: Track, wanted: 'eng' | 'jpn'): boolean {
  const raw = track.lang?.trim().toLowerCase() ?? ''
  const iso = normalizeLang(track.lang)
  if (wanted === 'eng') {
    return iso === 'eng' || raw === 'en' || raw === 'eng' || raw.startsWith('en-') || raw.startsWith('en_')
  }
  return iso === 'jpn' || raw === 'ja' || raw === 'jpn' || raw.startsWith('ja-') || raw.startsWith('ja_')
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
  // An unlabelled track is often the mux's only English track, so it remains a safe fallback.
  // A positively-labelled foreign track is not: selecting French/Russian merely because English
  // is absent conceals the source mismatch and is worse than leaving mpv's language policy alone.
  const unlabelled = subs.filter((track) => !track.lang?.trim() || track.lang.trim().toLowerCase() === 'und')
  const pool = inLang.length ? inLang : unlabelled
  if (!pool.length) return undefined
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
