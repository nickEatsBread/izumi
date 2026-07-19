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

/** Map a track language code to an English name, or `undefined` for missing/undetermined
 *  languages ("", "und", "undefined") so the caller falls back to the title. */
export function langName(lang?: string): string | undefined {
  const l = lang?.trim().toLowerCase()
  if (!l || l === 'und' || l === 'undefined' || l === 'unknown') return undefined
  if (LANG_NAMES[l]) return LANG_NAMES[l]
  try {
    // Resolves many 639-1 codes (and some 639-2) the map above doesn't list.
    const n = new Intl.DisplayNames(['en'], { type: 'language' }).of(l)
    if (n && n.toLowerCase() !== l) return n
  } catch { /* Intl may reject a malformed code — fall through */ }
  return l.toUpperCase()
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
function baseLabel(t: Track): string {
  const lang = langName(t.lang)
  const title = distinctiveTitle(t.title, t.lang)
  const primary = lang ?? title ?? (t.type === 'sub' ? 'Subtitle' : `Track ${t.id}`)
  const bits: string[] = []
  // A distinctive title becomes a qualifier when the language already leads.
  if (lang && title) bits.push(title)
  if (t.type === 'sub' && isSdh(t.title)) bits.push('SDH')
  if (t.type === 'audio') { const c = chLabel(t.channels); if (c) bits.push(c) }
  if (t.forced || isForcedTitle(t.title)) bits.push('Forced')
  return bits.length ? `${primary} · ${bits.join(' · ')}` : primary
}

// A base label plus, for audio only, the codec — the useful disambiguator between two same-
// language audio tracks (AAC vs DTS). Never applied to subtitles (codec there is pure noise).
const withCodec = (t: Track, base: string) =>
  t.type === 'audio' && t.codec ? `${base} · ${t.codec.toUpperCase()}` : base

/** The display label for `t`, disambiguated against the other tracks of its kind in `group`:
 *  language-forward, codec appended only for colliding audio tracks, and a numeric suffix as a
 *  last resort so two rows are never identical. */
export function trackLabel(t: Track, group: Track[]): string {
  const base = baseLabel(t)
  if (group.filter((o) => baseLabel(o) === base).length <= 1) return base

  // Collision. Try the codec (audio); if that makes it unique, use it.
  const tagged = withCodec(t, base)
  if (group.filter((o) => withCodec(o, baseLabel(o)) === tagged).length <= 1) return tagged

  // Still identical (same lang + codec, or codec-less subtitles) → number them so a pick is
  // always possible. Index is 1-based within the colliding subset.
  const peers = group.filter((o) => baseLabel(o) === base)
  return `${tagged} (${peers.findIndex((o) => o.id === t.id) + 1})`
}
