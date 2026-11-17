import { langsEqual, normalizeLang } from '$lib/stremio/sublang'
import { subtitleKind, type Track } from './track-label'

const orderOf = (value: string | readonly string[]): string[] =>
  (typeof value === 'string' ? value.split(',') : [...value]).map((tag) => tag.trim()).filter(Boolean)

/** Choose the subtitle track after loadfile.
 *
 *  `subtitleOrder` lists languages most wanted first (`['eng', 'fre']`, or a single code); the first
 *  one with a track wins. `audioLang` is the language actually playing (or the audio preference).
 *  Subtitles in the audio's own language (an English dub with English subs): Signs/Forced if
 *  present, otherwise off, since full subtitles would duplicate the dialogue. Otherwise full
 *  dialogue, never Signs & Songs. `none` turns subs off. `undefined` means leave mpv's slang pick
 *  alone. */
export function pickSubtitleTrackId(
  tracks: Track[],
  audioLang: string | undefined,
  subtitleOrder: string | readonly string[],
): number | 'no' | undefined {
  const order = orderOf(subtitleOrder)
  if (order[0] === 'none') return 'no'
  const subs = tracks.filter((track) => track.type === 'sub')
  if (!subs.length) return undefined
  let wanted = order[0]
  let pool: Track[] = []
  for (const lang of order) {
    pool = subs.filter((track) => langsEqual(track.lang, lang))
    if (pool.length) { wanted = lang; break }
  }
  // An unlabelled track is often the mux's only English track, so it remains a safe fallback.
  // A positively-labelled foreign track is not: selecting French/Russian merely because English
  // is absent conceals the source mismatch and is worse than leaving mpv's language policy alone.
  if (!pool.length) pool = subs.filter((track) => !track.lang?.trim() || track.lang.trim().toLowerCase() === 'und')
  if (!pool.length) return undefined
  const sameAsAudio = !!wanted && !!normalizeLang(audioLang) && normalizeLang(audioLang) === normalizeLang(wanted)
  if (sameAsAudio) {
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

/** The language of the audio track mpv has selected, when the track list says. */
export const selectedAudioLang = (tracks: Track[]): string | undefined =>
  tracks.find((track) => track.type === 'audio' && track.selected)?.lang
