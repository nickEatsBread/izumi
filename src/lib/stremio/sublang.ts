// Subtitle language normalization.
//
// Providers label subtitle tracks with whatever the source site happened to print: an ISO code
// ('en', 'eng', 'pt-BR'), an English name ('French'), a native name ('Français'), or free text with
// no language in it at all ('wowmdildo {+Eternal Blizzard}' — a real release-group label from a live
// provider). mpv's `slang` auto-select matches on ISO codes, so an unnormalized label means the
// track is loaded but NEVER auto-selected.
//
// Two outputs, deliberately separate:
//   normalizeLang() → an ISO 639-2/B code for mpv to match on, or undefined when the label carries
//                     no language (guessing here would auto-select the wrong track).
//   subtitleTitle() → the human label for the track menu, preserving the provider's own text.

// ISO 639-1 → 639-2/B, plus the aliases we actually see in the wild. mpv matches `slang` against
// the track's language tag, and izumi's settings speak 639-2 ('eng'), so 639-2/B is the target.
// Not exhaustive by design — the languages providers actually ship, and unknown stays unknown.
const LANGS: { code: string; aliases: string[] }[] = [
  { code: 'eng', aliases: ['en', 'eng', 'english'] },
  { code: 'jpn', aliases: ['ja', 'jp', 'jpn', 'japanese', 'nihongo', '日本語'] },
  { code: 'fre', aliases: ['fr', 'fra', 'fre', 'french', 'francais', 'français', 'vostfr', 'vf'] },
  { code: 'ger', aliases: ['de', 'deu', 'ger', 'german', 'deutsch'] },
  { code: 'spa', aliases: ['es', 'spa', 'spanish', 'espanol', 'español', 'castellano', 'latino'] },
  { code: 'ita', aliases: ['it', 'ita', 'italian', 'italiano'] },
  { code: 'por', aliases: ['pt', 'por', 'portuguese', 'portugues', 'português', 'brazilian'] },
  { code: 'rus', aliases: ['ru', 'rus', 'russian', 'русский'] },
  { code: 'ara', aliases: ['ar', 'ara', 'arabic', 'العربية'] },
  { code: 'chi', aliases: ['zh', 'chi', 'zho', 'chinese', 'mandarin', 'cantonese', '中文', 'cn'] },
  { code: 'kor', aliases: ['ko', 'kor', 'korean', '한국어'] },
  { code: 'ind', aliases: ['id', 'ind', 'indonesian', 'bahasa', 'indonesia'] },
  { code: 'tur', aliases: ['tr', 'tur', 'turkish', 'türkçe', 'turkce'] },
  { code: 'pol', aliases: ['pl', 'pol', 'polish', 'polski'] },
  { code: 'dut', aliases: ['nl', 'nld', 'dut', 'dutch', 'nederlands'] },
  { code: 'swe', aliases: ['sv', 'swe', 'swedish', 'svenska'] },
  { code: 'nor', aliases: ['no', 'nor', 'norwegian', 'norsk'] },
  { code: 'dan', aliases: ['da', 'dan', 'danish', 'dansk'] },
  { code: 'fin', aliases: ['fi', 'fin', 'finnish', 'suomi'] },
  { code: 'cze', aliases: ['cs', 'ces', 'cze', 'czech', 'cestina', 'čeština'] },
  { code: 'gre', aliases: ['el', 'ell', 'gre', 'greek', 'ελληνικά'] },
  { code: 'heb', aliases: ['he', 'heb', 'hebrew', 'עברית'] },
  { code: 'hin', aliases: ['hi', 'hin', 'hindi', 'हिन्दी'] },
  { code: 'tha', aliases: ['th', 'tha', 'thai', 'ไทย'] },
  { code: 'vie', aliases: ['vi', 'vie', 'vietnamese', 'tiengviet', 'tiếng việt'] },
  { code: 'ukr', aliases: ['uk', 'ukr', 'ukrainian', 'українська'] },
  { code: 'rum', aliases: ['ro', 'ron', 'rum', 'romanian', 'romana', 'română'] },
  { code: 'hun', aliases: ['hu', 'hun', 'hungarian', 'magyar'] },
  { code: 'bul', aliases: ['bg', 'bul', 'bulgarian'] },
  { code: 'hrv', aliases: ['hr', 'hrv', 'croatian', 'hrvatski'] },
  { code: 'srp', aliases: ['sr', 'srp', 'serbian'] },
  { code: 'fil', aliases: ['tl', 'fil', 'tgl', 'filipino', 'tagalog'] },
  { code: 'may', aliases: ['ms', 'msa', 'may', 'malay', 'melayu'] },
  { code: 'per', aliases: ['fa', 'fas', 'per', 'persian', 'farsi'] },
]

/**
 * The ISO 639-1 codes offered when choosing which source languages to search, derived from the
 * table above so there is ONE list to maintain.
 *
 * Deliberately the full set rather than only the languages the installed extensions happen to
 * declare: a source may declare nothing, and a user may want to choose a language before adding a
 * source that serves it. Provider manifests use 639-1, so that is what is stored and compared.
 */
export const SOURCE_LANGUAGES: string[] = LANGS
  .map((l) => l.aliases.find((a) => a.length === 2))
  .filter((c): c is string => !!c)
  .sort()

const BY_ALIAS = new Map<string, string>()
for (const { code, aliases } of LANGS) {
  BY_ALIAS.set(code, code)
  for (const a of aliases) BY_ALIAS.set(a, code)
}

// Tokens that ride along with a language but are not one, so 'English [CC]' and 'eng-forced'
// still resolve. Kept out of the alias table so they can never MATCH on their own.
const NOISE = new Set(['cc', 'sdh', 'forced', 'full', 'sub', 'subs', 'subtitle', 'subtitles', 'default', 'srt', 'vtt', 'ass', 'ssa'])

/** Split a label into comparable tokens: lowercase, punctuation → spaces, drop noise words. */
function tokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[[\](){}<>_.,;:|/\\+*"'’-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t))
}

/**
 * Best-effort ISO 639-2/B code for a provider's subtitle label, or undefined when the label
 * carries no recognizable language. Undefined is a real answer — mpv leaves the track unselected
 * rather than auto-selecting something that might be the wrong language.
 */
export function normalizeLang(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  // Whole-string hit first: handles 'pt-BR' and 'Português (Brasil)' collapsing to one token set,
  // and avoids a stray token in a long label winning over the label's real meaning.
  const whole = trimmed.toLowerCase().replace(/[\s_]+/g, '')
  if (BY_ALIAS.has(whole)) return BY_ALIAS.get(whole)
  const parts = tokens(trimmed)
  // A region-tagged code ('pt-BR' → ['pt','br']) resolves on its first token.
  for (const t of parts) {
    const hit = BY_ALIAS.get(t)
    if (hit) return hit
  }
  return undefined
}

/** The label to show in the track menu. Falls back to the resolved code, then to 'Subtitles'. */
export function subtitleTitle(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (trimmed) return trimmed
  return 'Subtitles'
}

/** True when a normalized code matches the user's preferred subtitle language setting. */
export function isPreferredLang(code: string | undefined, preferred: string): boolean {
  return !!code && code === preferred
}
