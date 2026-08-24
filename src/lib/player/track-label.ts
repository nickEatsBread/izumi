// Human-readable labels for mpv audio/subtitle tracks, shared by the desktop track menu
// (Controls.svelte) and the Game-mode picker (TrackMenu.svelte) so they never diverge.
//
// The problem this fixes: a multi-language Blu-ray (e.g. "Your Name") carries several
// subtitle tracks whose container TITLE is the same generic string ("Full Subtitles") and
// whose codec is identical ("hdmv_pgs_subtitle") — so a title-first label rendered all of
// them as "Full Subtitles · HDMV_PGS_SUBTITLE", indistinguishable. The real differentiator
// is the LANGUAGE, so labels lead with the language name; the codec is never shown for
// subtitles (it's noise), and a numeric suffix guarantees no two rows are ever identical.
//
// Convention follows standard media players (Plex/Jellyfin/Infuse): language name first,
// then qualifiers — "English", "Spanish · Forced", "English · SDH", "English · Commentary".

export type Track = {
  id: number
  type: string
  title?: string
  lang?: string
  selected?: boolean
  codec?: string
  channels?: number
  default?: boolean
  forced?: boolean
  external?: boolean
  externalFilename?: string
}

export type TrackLabelContext = {
  /** Exact source filename selected by the player. Used only for tightly matched recovery
   * profiles when a broken mux omitted every subtitle language/title tag. */
  filename?: string
}

// ISO 639-2 (what mpv usually reports: jpn/eng/fre…) + 639-1 → English name. Covers the
// languages that actually show up on anime/movie releases; anything else falls back to
// Intl.DisplayNames, then to the upper-cased code so a track is never left blank.
const LANG_NAMES: Record<string, string> = {
  eng: 'English', en: 'English',
  jpn: 'Japanese', ja: 'Japanese',
  spa: 'Spanish', es: 'Spanish',
  fre: 'French', fra: 'French', fr: 'French',
  ger: 'German', deu: 'German', de: 'German',
  ita: 'Italian', it: 'Italian',
  por: 'Portuguese', pt: 'Portuguese',
  rus: 'Russian', ru: 'Russian',
  kor: 'Korean', ko: 'Korean',
  chi: 'Chinese', zho: 'Chinese', zh: 'Chinese',
  ara: 'Arabic', ar: 'Arabic',
  dut: 'Dutch', nld: 'Dutch', nl: 'Dutch',
  pol: 'Polish', pl: 'Polish',
  swe: 'Swedish', sv: 'Swedish',
  nor: 'Norwegian', no: 'Norwegian',
  dan: 'Danish', da: 'Danish',
  fin: 'Finnish', fi: 'Finnish',
  tur: 'Turkish', tr: 'Turkish',
  hun: 'Hungarian', hu: 'Hungarian',
  cze: 'Czech', ces: 'Czech', cs: 'Czech',
  gre: 'Greek', ell: 'Greek', el: 'Greek',
  heb: 'Hebrew', he: 'Hebrew',
  hin: 'Hindi', hi: 'Hindi',
  tha: 'Thai', th: 'Thai',
  vie: 'Vietnamese', vi: 'Vietnamese',
  ind: 'Indonesian', id: 'Indonesian',
  may: 'Malay', msa: 'Malay', ms: 'Malay',
  ukr: 'Ukrainian', uk: 'Ukrainian',
  rum: 'Romanian', ron: 'Romanian', ro: 'Romanian',
  bul: 'Bulgarian', bg: 'Bulgarian',
  hrv: 'Croatian', hr: 'Croatian',
  srp: 'Serbian', sr: 'Serbian',
  slo: 'Slovak', slk: 'Slovak', sk: 'Slovak',
  slv: 'Slovenian', sl: 'Slovenian',
  fil: 'Filipino', tl: 'Filipino',
}

/** BCP-47 locales. Keep the region so two Spanishes/Portugueses don't collapse
 *  to "Spanish (1)" / "Spanish (2)" in the player menu. */
const LOCALE_NAMES: Record<string, string> = {
  'es-419': 'Spanish (Latin America)',
  'es-es': 'Spanish (Spain)',
  'es-mx': 'Spanish (Mexico)',
  'pt-br': 'Portuguese (Brazil)',
  'pt-pt': 'Portuguese (Portugal)',
  'zh-cn': 'Chinese (Simplified)',
  'zh-hans': 'Chinese (Simplified)',
  'zh-hk': 'Chinese (Hong Kong)',
  'zh-tw': 'Chinese (Traditional)',
  'zh-hant': 'Chinese (Traditional)',
  'en-us': 'English',
  'en-gb': 'English (UK)',
  'ja-jp': 'Japanese',
  'ar-sa': 'Arabic',
  'de-de': 'German',
  'fr-fr': 'French',
  'it-it': 'Italian',
  'pl-pl': 'Polish',
  'ru-ru': 'Russian',
  'hi-in': 'Hindi',
  'th-th': 'Thai',
  'vi-vn': 'Vietnamese',
  'id-id': 'Indonesian',
  'ms-my': 'Malay',
}

/** Map a track language code to an English name, or `undefined` for missing/undetermined
 *  languages ("", "und", "undefined") so the caller falls back to the title. */
export function langName(lang?: string): string | undefined {
  const l = lang?.trim().toLowerCase().replace(/_/g, '-')
  if (!l || l === 'und' || l === 'undefined' || l === 'unknown') return undefined
  if (LANG_NAMES[l]) return LANG_NAMES[l]
  if (LOCALE_NAMES[l]) return LOCALE_NAMES[l]
  const primary = l.split('-')[0] ?? l
  const region = l.split('-')[1]
  if (region) {
    try {
      const n = new Intl.DisplayNames(['en'], { type: 'language' }).of(l)
      if (n && n.toLowerCase() !== l && n.toLowerCase() !== primary) return n
    } catch { /* Intl may reject a malformed locale — fall through */ }
    const regionLabel = localeRegionName(region)
    const base = LANG_NAMES[primary]
    if (base && regionLabel) return `${base} (${regionLabel})`
  }
  if (primary && LANG_NAMES[primary]) return LANG_NAMES[primary]
  try {
    // Resolves many 639-1 codes (and some 639-2) the map above doesn't list.
    const n = new Intl.DisplayNames(['en'], { type: 'language' }).of(l)
      ?? new Intl.DisplayNames(['en'], { type: 'language' }).of(primary)
    if (n && n.toLowerCase() !== l && n.toLowerCase() !== primary) return n
  } catch { /* Intl may reject a malformed code — fall through */ }
  return l.toUpperCase()
}

function localeRegionName(region: string): string | undefined {
  const known: Record<string, string> = {
    '419': 'Latin America',
    es: 'Spain',
    br: 'Brazil',
    pt: 'Portugal',
    mx: 'Mexico',
    hk: 'Hong Kong',
    cn: 'Simplified',
    tw: 'Traditional',
    gb: 'UK',
    us: 'US',
  }
  if (known[region]) return known[region]
  try {
    const n = new Intl.DisplayNames(['en'], { type: 'region' }).of(region.toUpperCase())
    if (n && n.toLowerCase() !== region) return n
  } catch { /* ignore */ }
  return undefined
}

// Track titles that carry no distinguishing information beyond the language / full-vs-forced
// distinction (the codec name, empty, or a generic "Full Subtitles"/"Subtitle Track" label).
// Treated as absent so the language leads instead of a wall of identical titles.
const GENERIC_TITLE =
  /^(full[\s_-]*subtitles?|subtitles?|subtitle[\s_-]*track|regular|default|track[\s_-]*\d+|hdmv[\s_-]*pgs[\s_-]*subtitle|pgs|subrip|srt|s_text\/?\w*|ass|ssa|vobsub|dvd[\s_-]*subtitle|und(efined)?)$/i

/** A container title that adds information beyond the language and the SDH/Forced badges we
 *  already render — e.g. "Signs & Songs", "Commentary". Returns `undefined` for generic titles
 *  and for titles that merely restate the language ("English") or a badge ("English SDH"), so a
 *  label never reads "English · English". */
export function distinctiveTitle(title?: string, lang?: string): string | undefined {
  const t = title?.trim()
  if (!t || GENERIC_TITLE.test(t)) return undefined
  const ln = langName(lang)?.toLowerCase()
  let rest = t.toLowerCase()
  if (ln) rest = rest.split(ln).join(' ')
  // Strip the language + the descriptor words we surface elsewhere; keep real names (Commentary,
  // Signs & Songs…). If nothing distinctive remains, the title only restates known info → drop it.
  rest = rest
    .replace(/\b(sdh|cc|hi|forced|full|regular|default|subtitles?|subs?|track|und(?:efined)?)\b/gi, ' ')
    .replace(/[^a-z0-9]+/gi, '')
  return rest.length >= 2 ? t : undefined
}

// Subtitles for the deaf / hard-of-hearing — surfaced from the title (mpv doesn't expose a
// dedicated flag in the fields we read). Conservative so it can't false-positive on "cc" inside
// a word.
const SDH_RE = /\b(sdh|cc|hi)\b|hearing[\s-]?impaired|for the deaf/i
const isSdh = (title?: string) => !!title && SDH_RE.test(title)
// Some releases mark a forced track only in its title, not with the forced flag.
const isForcedTitle = (title?: string) => !!title && /\bforced\b/i.test(title)
const isSignsOnlyTitle = (title?: string) => !!title && /signs?.*(songs?|karaoke)|(?:songs?|karaoke).*signs?/i.test(title)
const isFullDialogueTitle = (title?: string) => !!title && /full[\s_-]*(?:subtitles?|subs?)|dialogue|honorific/i.test(title)

// Some external subtitle files retain their language in the filename even when mpv cannot infer
// a `lang` property from it. Prefer explicit words and region tags; bare two-letter tokens are
// deliberately not guessed because ordinary release names contain words such as "it" and "no".
const TEXT_LANGS: [RegExp, string][] = [
  [/\b(?:brazilian[\s._-]+portuguese|portuguese[\s._-]+(?:brazil|br)|pt[\s._-]*br)\b/i, 'pt-BR'],
  [/\b(?:latin[\s._-]+american[\s._-]+spanish|spanish[\s._-]+(?:latin[\s._-]+america|latam)|es[\s._-]*(?:419|latam))\b/i, 'es-419'],
  [/\b(?:castilian|spanish[\s._-]+spain|es[\s._-]*es)\b/i, 'es-ES'],
  [/\b(?:english|eng)\b/i, 'eng'],
  [/\b(?:arabic|ara)\b/i, 'ara'],
  [/\b(?:portuguese|por)\b/i, 'por'],
  [/\b(?:spanish|spa)\b/i, 'spa'],
  [/\b(?:french|fra|fre)\b/i, 'fra'],
  [/\b(?:german|deu|ger)\b/i, 'deu'],
  [/\b(?:italian|ita)\b/i, 'ita'],
  [/\b(?:polish|pol)\b/i, 'pol'],
  [/\b(?:russian|rus)\b/i, 'rus'],
  [/\b(?:japanese|jpn)\b/i, 'jpn'],
]

function languageInText(text?: string): string | undefined {
  if (!text) return undefined
  return TEXT_LANGS.find(([pattern]) => pattern.test(text))?.[1]
}

// This is the exact language order used by the current Crunchyroll multi-subtitle MeGusta mux.
// Affected files carry no language or title tags at all and incorrectly flag the full English
// dialogue track as forced. Never infer from position unless every structural fingerprint below
// matches, so a random untagged ten-track file is left as honest "Subtitle (n)" labels.
const MEGUSTA_CR_ASS_10 = [
  'eng', 'ara', 'pt-BR', 'es-ES', 'fra', 'deu', 'ita', 'es-419', 'pol', 'rus',
] as const

function isMeGustaCrunchyrollProfile(group: Track[], context?: TrackLabelContext): boolean {
  const filename = context?.filename ?? ''
  return /(?:^|[^a-z0-9])megusta(?:$|[^a-z0-9])/i.test(filename)
    && group.length === MEGUSTA_CR_ASS_10.length
    && group.every((track) =>
      track.type === 'sub'
      && track.codec?.toLowerCase() === 'ass'
      && !langName(track.lang)
      && !distinctiveTitle(track.title, track.lang)
      && !track.external)
    && !!group[0]?.default
    && !!group[0]?.forced
    && group.slice(1).every((track) => !track.default && !track.forced)
}

function recoveredProfileLang(t: Track, group: Track[], context?: TrackLabelContext): string | undefined {
  if (!isMeGustaCrunchyrollProfile(group, context)) return undefined
  const index = group.findIndex((track) => track.id === t.id)
  return index >= 0 ? MEGUSTA_CR_ASS_10[index] : undefined
}

export type SubtitleKind = 'signs' | 'forced' | 'sdh' | 'full' | 'other'

/** Classify a subtitle track for auto-selection (Signs vs full dialogue vs forced). */
export function subtitleKind(t: Track): SubtitleKind {
  if (isSignsOnlyTitle(t.title)) return 'signs'
  if (t.forced || isForcedTitle(t.title)) return 'forced'
  if (isSdh(t.title)) return 'sdh'
  if (isFullDialogueTitle(t.title)) return 'full'
  return 'other'
}

// Some anime muxers tag subtitle tracks by the AUDIO they accompany: `eng / Signs & Songs` and
// `jpn / Full Subtitles`, even though both tracks contain English text. Correct the menu language
// only when that exact paired layout proves what the otherwise misleading `jpn` tag means.
function effectiveLang(t: Track, group: Track[], context?: TrackLabelContext): string | undefined {
  if (
    t.type === 'sub'
    && ['ja', 'jpn', 'japanese'].includes(t.lang?.trim().toLowerCase() ?? '')
    && isFullDialogueTitle(t.title)
    && group.some((other) =>
      other.type === 'sub'
      && ['en', 'eng', 'english'].includes(other.lang?.trim().toLowerCase() ?? '')
      && isSignsOnlyTitle(other.title))
  ) return 'eng'
  const taggedLang = langName(t.lang) ? t.lang : undefined
  return taggedLang
    ?? languageInText(t.title)
    ?? languageInText(t.externalFilename)
    ?? recoveredProfileLang(t, group, context)
}

/** Audio channel count → a friendly layout name. */
export function chLabel(n?: number): string {
  if (!n) return ''
  if (n >= 8) return '7.1'
  if (n >= 6) return '5.1'
  if (n === 2) return '2.0'
  if (n === 1) return 'Mono'
  return `${n}ch`
}

// The label BEFORE collision-disambiguation: "{language|title} · {qualifiers…}".
function baseLabel(t: Track, group: Track[], context?: TrackLabelContext): string {
  const effective = effectiveLang(t, group, context)
  const lang = langName(effective)
  const title = distinctiveTitle(t.title, effective)
  const primary = lang ?? title ?? (t.type === 'sub' ? 'Subtitle' : `Track ${t.id}`)
  const bits: string[] = []
  // A distinctive title becomes a qualifier when the language already leads.
  if (lang && title) bits.push(title)
  if (t.type === 'sub' && isSdh(t.title)) bits.push('SDH')
  if (t.type === 'audio') { const c = chLabel(t.channels); if (c) bits.push(c) }
  // The matched MeGusta profile's first track contains full English dialogue; its forced bit is a
  // bad mux flag, verified from the ASS payload. Suppress that one false badge only.
  const badProfileForcedFlag = t.forced
    && group[0]?.id === t.id
    && isMeGustaCrunchyrollProfile(group, context)
  if ((!badProfileForcedFlag && t.forced) || isForcedTitle(t.title)) bits.push('Forced')
  return bits.length ? `${primary} · ${bits.join(' · ')}` : primary
}

// A base label plus, for audio only, the codec — the useful disambiguator between two same-
// language audio tracks (AAC vs DTS). Never applied to subtitles (codec there is pure noise).
const withCodec = (t: Track, base: string) =>
  t.type === 'audio' && t.codec ? `${base} · ${t.codec.toUpperCase()}` : base

/** The display label for `t`, disambiguated against the other tracks of its kind in `group`:
 *  language-forward, codec appended only for colliding audio tracks, and a numeric suffix as a
 *  last resort so two rows are never identical. */
export function trackLabel(t: Track, group: Track[], context?: TrackLabelContext): string {
  const base = baseLabel(t, group, context)
  if (group.filter((o) => baseLabel(o, group, context) === base).length <= 1) return base

  // Collision. Try the codec (audio); if that makes it unique, use it.
  const tagged = withCodec(t, base)
  if (group.filter((o) => withCodec(o, baseLabel(o, group, context)) === tagged).length <= 1) return tagged

  // Still identical (same lang + codec, or codec-less subtitles) → number them so a pick is
  // always possible. Index is 1-based within the colliding subset.
  const peers = group.filter((o) => baseLabel(o, group, context) === base)
  return `${tagged} (${peers.findIndex((o) => o.id === t.id) + 1})`
}
