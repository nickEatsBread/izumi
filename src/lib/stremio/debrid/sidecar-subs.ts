import { VIDEO } from './http'

// TS twin of select_subtitles / subtitle_language / subtitle_title in
// src-tauri/src/direct_torrent_select.rs and src-tauri/src/direct_torrent.rs. Both sides are
// pinned to __fixtures__/sidecar-cases.json so debrid and direct playback can never disagree
// about which subtitle belongs to which episode.

const SUBTITLE = /\.(?:ass|ssa|srt|vtt)$/i
const SEPARATOR = /^[._\-[( ]/

const normalized = (name: string) => name.replace(/\\/g, '/').trim().toLowerCase()

/** Lower-cased basename with the extension removed. */
function basenameStem(name: string): string {
  const base = normalized(name).split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** Case-preserving basename with the extension removed (titles keep their original case). */
function rawStem(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

export function isSubtitleFile(name: string): boolean {
  return SUBTITLE.test(name)
}

/** External subtitle files belonging to `video`. A subtitle matches when its basename is the
 *  video's complete stem followed by a separator, which keeps episode 1 away from episode 10.
 *  When the torrent holds exactly one video every subtitle is accepted — single-episode
 *  releases often name sidecars nothing like the video (`Subs/eng.ass`). */
export function selectSidecars<T extends { name: string }>(files: T[], video: T): T[] {
  const subs = files.filter((f) => isSubtitleFile(f.name))
  if (files.filter((f) => VIDEO.test(f.name)).length === 1) return subs
  const stem = basenameStem(video.name)
  return subs.filter((f) => {
    const s = basenameStem(f.name)
    if (!s.startsWith(stem)) return false
    const suffix = s.slice(stem.length)
    return suffix === '' || SEPARATOR.test(suffix)
  })
}

const LANGUAGES: Record<string, string> = {
  en: 'eng', eng: 'eng', english: 'eng',
  ja: 'jpn', jpn: 'jpn', japanese: 'jpn',
  zh: 'chi', chi: 'chi', zho: 'chi', chinese: 'chi',
  ko: 'kor', kor: 'kor', korean: 'kor',
  es: 'spa', spa: 'spa', spanish: 'spa',
  fr: 'fre', fre: 'fre', fra: 'fre', french: 'fre',
  de: 'ger', ger: 'ger', deu: 'ger', german: 'ger',
  it: 'ita', ita: 'ita', italian: 'ita',
  pt: 'por', por: 'por', portuguese: 'por',
  ru: 'rus', rus: 'rus', russian: 'rus',
  ar: 'ara', ara: 'ara', arabic: 'ara',
  pl: 'pol', pol: 'pol', polish: 'pol',
  tr: 'tur', tur: 'tur', turkish: 'tur',
}

/** Best-effort ISO 639-2 inference from directory and filename tokens. `und` is preferable to
 *  guessing: the player still lists the track and the filename remains its title. */
export function sidecarLanguage(name: string): string {
  for (const token of normalized(name).split(/[^a-z]+/)) {
    const lang = LANGUAGES[token]
    if (lang) return lang
  }
  return 'und'
}

/** Human label for the track: the part of the subtitle name that is not the video's stem,
 *  minus a leading language word. Returns 'Subtitle' when nothing distinguishes it. */
export function sidecarTitle(videoName: string, subtitleName: string): string {
  const videoStem = rawStem(videoName)
  const subtitleStem = rawStem(subtitleName)
  const suffix = (subtitleStem.startsWith(videoStem) ? subtitleStem.slice(videoStem.length) : subtitleStem)
    .replace(/^[._\-[\]() ]+/, '')
    .replace(/[._\-[\]() ]+$/, '')
  let words = suffix.split(/[._-]/).filter(Boolean)
  if (words.length && sidecarLanguage(words[0]) !== 'und') words = words.slice(1)
  return words.length ? words.join(' ') : 'Subtitle'
}
