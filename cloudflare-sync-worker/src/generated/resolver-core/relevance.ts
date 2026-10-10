// GENERATED from src/lib/stremio/relevance.ts by scripts/generate-cloudflare-resolver-core.mjs.
// Edit the canonical source, then regenerate; do not edit this vendored copy.
import { BATCH_MARKER, type Stream } from './parse'

// Title relevance + cross-production filters for addon/extension streams. Pure
// (no Tauri/stores), so it's unit-testable. A shared kitsu id can pull in unrelated
// torrents or a same-title different production (One Piece's id also maps to the
// 2023 live action); these guard the picker/auto-play without dropping legit files.

const lexicalTitleTokens = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)

export function titleTokens(s: string): string[] {
  return lexicalTitleTokens(s).filter((t) => t.length > 2)
}

/** The same normalisation titleTokens uses, minus the length filter, so a phrase keeps its short
 *  words: "Dr. Stone" has to stay "dr stone" to be findable in a release name. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const nameOf = (s: Stream) =>
  s.behaviorHints?.filename || s.title?.split('\n')[0] || s.description?.split('\n')[0] || s.name || ''

// Direct providers occasionally have no useful episode label and fall back to a transport-only
// filename. That is absence of title evidence, not evidence for a title called "Direct HLS".
const DIRECT_TRANSPORT_LABEL = /^direct\s+(?:hls|mp4|dash)(?:\s|$)/i

// Release-name tokens that don't identify the anime (quality/codec/source/container/
// language/crc). Stripped so a short-title release's title ratio isn't diluted.
const RELEASE_JUNK = /^(?:\d{3,4}p|4k|uhd|x26[45]|h26[45]|hevc|avc|av1|xvid|10bit|8bit|hi10p?|bluray|bdrip|bd|blu|ray|web|webrip|webdl|hdtv|dvd|dvdrip|remux|batch|complete|repack|uncensored|dual|multi|subs?|dub|eng|jpn|jap|mkv|mp4|avi|aac|flac|opus|ac3|eac3|ddp?|dts|hdr|dv|nf|cr|amzn|[0-9a-f]{8})$/i

// Scene episode/season markers (S04E25, E25, 1x25) — never part of the anime's TITLE,
// so they must not count as content tokens (they diluted "Dr STONE S04E25" down to
// {subsplease,stone,s04e25} → only 1/3 title match → wrongly dropped).
const SCENE_CODE = /^(?:s\d{1,2}e\d{1,3}|e\d{1,3}|\d{1,3}x\d{1,3})$/i

// An episode/season marker: S01E01, 1x01, "- 067" (absolute), "Episode/EP 3". Zero-padding + a
// leading [Group] tag are fine. NOT resolutions (1x → season ≤ 99; a bare NNNN is skipped).
// Declared up here because releaseTitleTokens cuts a release name at it as well.
const EPISODE_MARKER = /\bS\d{1,2}E\d{1,3}\b|\b\d{1,2}x\d{1,3}\b|\s[-–]\s?\d{1,4}(?:v\d)?(?:\b|_)|\bepisode\s?\d+\b|\bep\s?\d{1,3}\b/i

// Metadata words that can sit INSIDE a release's title run, before any episode marker or bracket.
// Only the creditless-extra family: "Dr. Stone NCOP 2" has to stay title-relevant so refineStreams
// reports it as an opening rather than as a different show.
const HEAD_JUNK = /^(?:nc(?:op|ed|bd)\d*|creditless|textless|preview|teaser|trailer|promo)$/i

// A few indexers put their hostname in front of the actual release title without brackets.
// Remove only an unmistakable host-shaped prefix; treating any unknown leading word as a source
// label is unsafe ("Loner Life In Another World" is a title, not an indexer called "Loner").
const SOURCE_HOST_PREFIX = /^\s*(?:(?:https?:\/\/)|www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+\s*[-–|]\s*/i

// What may immediately follow a complete official title in a normalized release filename. This
// lets punctuation/numeric identities (M*A*S*H, MI-5, 9-1-1, 1917) match exactly before the fuzzy
// parser quite reasonably mistakes their numbers for episode/year metadata.
const RELEASE_IDENTITY_BOUNDARY = /^(?:s\d{1,2}e\d{1,3}|e\d{1,3}|\d{1,2}x\d{1,3}|episode\s+\d+|ep\s+\d+|\d{1,4}(?:v\d)?|19\d{2}|20\d{2}|\d{3,4}p|4k|uhd|bluray|bdrip|web|webrip|webdl|mkv|mp4)\b/i

function hasExactReleaseIdentity(name: string, wanted: string[]): boolean {
  const bare = name.replace(/^\s*\[[^\]]*\]\s*/, '').replace(SOURCE_HOST_PREFIX, '')
  const release = norm(bare)
  return wanted.some((alias) => {
    const identity = norm(alias)
    if (!identity || !release.startsWith(identity)) return false
    if (release.length === identity.length) return true
    if (release[identity.length] !== ' ') return false
    return RELEASE_IDENTITY_BOUNDARY.test(release.slice(identity.length + 1))
  })
}

/** The release's OWN claimed title, as tokens: everything before its bracketed metadata (or a
 *  bracketed alternate title), before the episode/season marker, and before the first
 *  quality/codec/number token.
 *
 *  "[Erai-raws] One Piece - 1071 [1080p][Multiple Subtitle]" → [one, piece]
 *  "[SubsPlease] One Piece Fan Letter - 01 (1080p)"          → [one, piece, fan, letter]
 *
 *  This is what anchors the title test. Counting tokens anywhere in the name only ever answered
 *  "does this release mention the show", which every spin-off of a long-running series does. */
export function releaseTitleTokens(name: string): string[] {
  const bare = name
    .replace(/^\s*\[[^\]]*\]\s*/, '') // drop a leading [Group] tag
    .replace(SOURCE_HOST_PREFIX, '') // drop an explicit unbracketed indexer hostname
  const head = bare.split(/[[({]/)[0] // bracketed metadata / alternate title is not the title
  const end = head.search(EPISODE_MARKER)
  const out: string[] = []
  for (const t of lexicalTitleTokens(end >= 0 ? head.slice(0, end) : head)) {
    // First metadata token ends the title run: everything after it is release description
    // ("One Piece 1071 1080p Multi Subs"), never more of the title.
    // S2/S03 is release season shorthand rather than a literal title word. Short title identity
    // markers themselves (Z, GT, X, II, Dr) are retained: dropping them made sibling productions
    // collapse to the same title.
    if (RELEASE_JUNK.test(t) || HEAD_JUNK.test(t) || SCENE_CODE.test(t) || /^s\d{1,2}$/.test(t) || /^\d+$/.test(t)) break
    out.push(t)
  }
  return out
}

// What may sit between two release words that spell ONE requested word: "Toukutsu Ou",
// "Toukutsu.Ou", "Toukutsu_Ou" or "Toukutsu-Ou". A spaced dash is the episode/title separator.
const WORD_BREAK = /^(?:[\s._]+|-)$/

/** Romanization disagrees about where words break. The catalogue writes "Akujo de wa Gozaimasu ga"
 *  where release groups write "Akujo dewa Gozaimasu ga", and the reverse happens ("Toukutsuou"
 *  against "Toukutsu Ou"). Every test in relevant() compares whole words, so the other spelling was
 *  a word the request had never used, and the anchor filtered out every release that wrote it.
 *
 *  Returns the lowercased name re-spelled onto the request's own word breaks: a release word that
 *  glues together consecutive words of one requested title is split back into them, and adjacent
 *  release words that together spell one requested word are joined. Only consecutive words of a
 *  single title count, so this re-spells words the request already has and never makes a new word
 *  known: "One Piece Fan Letter" is still a spin-off and "Dogulwang End Line" still names "End Line". */
function alignWordBreaks(name: string, wanted: string[]): string {
  const words = new Set<string>()
  const glued = new Map<string, string>()
  for (const alias of wanted) {
    const tokens = lexicalTitleTokens(alias)
    for (let i = 0; i < tokens.length; i++) {
      words.add(tokens[i])
      for (let j = i + 2; j <= tokens.length; j++) {
        const run = tokens.slice(i, j)
        if (!glued.has(run.join(''))) glued.set(run.join(''), run.join(' '))
      }
    }
  }
  const lower = name.toLowerCase()
  const runs = [...lower.matchAll(/[a-z0-9]+/g)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }))
  let out = ''
  let at = 0
  for (let i = 0; i < runs.length; i++) {
    // Join first, longest span first: "toukutsu ou" is one requested word written as two.
    let span = 1
    for (let k = Math.min(3, runs.length - i); k >= 2 && span === 1; k--) {
      const parts = runs.slice(i, i + k)
      const spelled = parts.map((p) => p.text).join('')
      const adjacent = parts.slice(1).every((p, n) => WORD_BREAK.test(lower.slice(parts[n].end, p.start)))
      if (adjacent && words.has(spelled) && !parts.every((p) => words.has(p.text))) span = k
    }
    // Otherwise split: "dewa" is the requested "de wa" written as one word.
    const text = span > 1
      ? runs.slice(i, i + span).map((p) => p.text).join('')
      : (!words.has(runs[i].text) && glued.get(runs[i].text)) || runs[i].text
    out += lower.slice(at, runs[i].start) + text
    at = runs[i + span - 1].end
    i += span - 1
  }
  return out + lower.slice(at)
}

// Does a release filename plausibly belong to THIS anime? Guards against cross-title
// matches on a shared id. Keeps unknowns (never drop on uncertainty).
export function relevant(stream: Stream, wanted: string[]): boolean {
  return relevantName(nameOf(stream), wanted) || relevantPackFile(stream, wanted)
}

// A label the season verifier can read, opening a file name after an optional [Group] tag:
// "Episode 01", "EP 01", "S01E01", "1x01". A bare leading number is not one: "86 - 01.mkv" is how the
// show "86" names its first episode, while a pack's "36 - 1.28.mkv" is its episode 36.
const EPISODE_LABEL_FIRST = /^\s*(?:\[[^\]]*\]\s*)?(?:s\d{1,2}\s?e\d{1,4}|\d{1,2}x\d{1,3}|episode\s*\d{1,4}|ep\.?\s*\d{1,3})(?!\d)/i
// The season of a file name that opens with "S01E01" or "1x01".
const SEASON_OF_EPISODE_LABEL = /^\s*(?:\[[^\]]*\]\s*)?(?:s(\d{1,2})\s?e|(\d{1,2})x)\d/i

// A season a folder or release name states: "S1", "S02", "S01-S03", "S01P01", "Season 1+2",
// "Seasons 1-3", "2nd Season", "The Final Season". "S01E01" is an episode, not a season.
const SEASON_MARK = /\b(?:the\s+)?final\s+season\b|\b(\d{1,2})(?:st|nd|rd|th)\s+season\b|\bseasons?\s*0*(\d{1,2})((?:\s*(?:[-~+&,]|and|to)\s*0*\d{1,2}(?!\d))*)|\bs0*(\d{1,2})(?:p\d{1,2})?((?:\s*[-~+&]\s*s?0*\d{1,2}(?!\d))*)(?![a-z\d])/gi
const FINAL_SEASON = -1
// A number closing a title, or its main part before a subtitle: "Oregairu 2", "Overlord II",
// "Mushoku Tensei II: …", "Steins;Gate 0". Not one the title counts with ("Kaiju No. 8",
// "Monster #8") or a part of one season ("Part 2").
const CLOSING_NUMBER = /(?<!(?:\b(?:no|nr|part|vol|volume|chapter|act|stage)\.?|#|n[°º])\s*)\b(\d|ii|iii|iv|v|vi|vii|viii|ix)(?=\s*(?:$|[:–-]\s))/i
const ROMAN: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 }
// Words naming a part of a pack other than its numbered episodes.
const OTHER_PART = /\b(?:ovas?|oads?|onas?|specials?|sps?|movies?|films?|extras?|bonus(?:es)?|omake|tokuten|recaps?|menus?|nc(?:op|ed)?\d*|creditless|textless|pvs?|cms?|trailers?|teasers?|previews?|promos?|featurettes?|scans?)\b/gi
// A division inside one season: "Part 01", "Cour 2", "Disc 3", "Vol. 1".
const PACK_DIVISION = /\b(?:part|cour|vol(?:ume)?|dis[ck]|box)\.?\s*0*\d{1,3}\b/gi
// Parts listed together: "Season 1+2+OVA", "Show + Show Zoku". Not an audio codec's plus ("DD+").
const JOINED_PARTS = /(?<!\b(?:dd|ddp|e?ac-?3|aac|dts|atmos|truehd)\s?)\+/i

interface PackPart { seasons: number[]; other: string[]; rest: string }

/** What a folder or release name says about WHICH part of a pack it is: the seasons it states, the
 *  non-episode parts it names, and the rest of the name without its season and division markers. */
function packPart(text: string): PackPart {
  const seasons: number[] = []
  const list = (first: number, more = '') => {
    let last = first
    seasons.push(first)
    for (const [, join, n] of more.matchAll(/([-~+&,]|and|to)\s*s?0*(\d{1,2})/gi)) {
      const next = Number(n)
      const range = /^(?:[-~]|to)$/i.test(join)
      for (let k = range ? Math.min(last, next) : next; k <= Math.max(last, next) && k - last <= 40; k++) seasons.push(k)
      last = next
    }
  }
  const rest = text.replace(SEASON_MARK, (_mark, ordinal, word, wordMore, short, shortMore) => {
    if (ordinal) seasons.push(Number(ordinal))
    else if (word) list(Number(word), wordMore)
    else if (short) list(Number(short), shortMore)
    else seasons.push(FINAL_SEASON)
    return ' '
  })
  const other = [...rest.matchAll(OTHER_PART)].map((m) => m[0].toLowerCase())
  return { seasons, other, rest: rest.replace(PACK_DIVISION, ' ') }
}

/** A number right after a folder's or release's title ("Log Horizon 2", "Steins;Gate 0"). Title runs
 *  stop at a number because in a file name it is the episode; in a name that holds whole episodes it
 *  names a sequel instead. A range ("1-13"), a padded "01" or a decimal is not one. */
function sequelNumber(name: string): string | undefined {
  const run = releaseTitleTokens(name)
  if (!run.length) return undefined
  const text = name.replace(/^\s*\[[^\]]*\]\s*/, '').replace(SOURCE_HOST_PREFIX, '').toLowerCase()
  const after = new RegExp(`^[^a-z0-9]*${run.join('[^a-z0-9]+')}[\\s._]+(0|[1-9]\\d?)\\b(?!\\.\\d|\\s*[-~]\\s*\\d)`)
  return text.match(after)?.[1]
}

/** The folders a pack file sits in, innermost first, when the add-on shows its path: the file name is
 *  itself a path, or a later line of the stream text ends with "/<file name>". A line that is the bare
 *  file name puts it at the release root (no folders). Null when no path is shown. */
function packFolders(path: string[], lines: string[], base: string): string[] | null {
  if (path.length) return [...path].reverse()
  for (const raw of lines) {
    const line = raw.trim()
    if (line === base) return []
    if (line.endsWith(`/${base}`)) return line.slice(0, -base.length - 1).split('/').reverse()
  }
  return null
}

/** Some season packs name each file by its episode alone ("Episode 01 - <episode title>.mkv"), so the
 *  file name has no title for relevantName to judge and the requested episode was filtered out as a
 *  different title. Such a file takes its identity from what contains it: the nearest folder with a
 *  title of its own ("S1 - <title>/"), else the release line.
 *
 *  The same pack also holds OVAs, other seasons and spin-offs, and add-ons do return those for the
 *  wrong request, while the season verifier only ever sees "Episode 01". So nothing on the way may
 *  name another season or a non-episode part, and two questions need an answer before the title is
 *  lent. Is the file a regular episode rather than an extra? Its SxxEyy label, a season folder or its
 *  place at the release root says so. Which season is it? Its SxxEyy label (the verifier compares
 *  that one), a season folder, or a release of that season alone. */
function relevantPackFile(stream: Stream, wanted: string[]): boolean {
  const path = (stream.behaviorHints?.filename ?? '').split('/')
  const base = path.pop() ?? ''
  if (!EPISODE_LABEL_FIRST.test(base) || releaseTitleTokens(base).length) return false
  const [release = '', ...lines] = (stream.title || stream.description || '').split('\n')
  if (!release.trim() || release.trim() === base) return false
  const known = new Set(wanted.flatMap((w) => lexicalTitleTokens(w)))
  // The seasons the request names: "… 2nd Season", or a sequel number closing one of its titles. A
  // request that names none is the first season. A requested title short of that number
  // ("Steins;Gate" for "Steins;Gate 0") is the entry the requested one continues.
  const named = new Set<number>()
  const prior = new Set<string>()
  for (const alias of wanted) {
    for (const n of packPart(alias).seasons) named.add(n)
    const closing = alias.match(CLOSING_NUMBER)
    if (!closing) continue
    const n = ROMAN[closing[1].toLowerCase()] ?? Number(closing[1])
    if (n === 1) continue
    if (n > 1) named.add(n)
    const before = lexicalTitleTokens(alias.slice(0, closing.index))
    if (before.length) prior.add(before.join(' '))
  }
  const requested = named.size ? named : new Set([1])
  const contradicts = ({ seasons }: PackPart) => seasons.length > 0 && !seasons.some((n) => requested.has(n))
  const namesRequested = ({ seasons }: PackPart) => seasons.length > 0 && seasons.every((n) => requested.has(n))
  const otherPart = ({ other }: PackPart) => other.some((w) => !known.has(w) && !known.has(w.replace(/e?s$/, '')))

  const label = base.match(SEASON_OF_EPISODE_LABEL)
  const labelSeason = Number(label?.[1] ?? label?.[2] ?? 0)
  // The verifier compares a label's season with the episode mapping; one the request itself rules
  // out is a contradiction already.
  if (labelSeason >= 1 && named.size && !named.has(labelSeason)) return false
  let regular = labelSeason >= 1
  let seasonKnown = regular
  const titled = (name: string) => {
    const sequel = sequelNumber(name)
    if (sequel != null && !known.has(sequel)) return false
    // Unless a season the request names placed the file, a bare prior title is the prior entry.
    if (sequel == null && !(named.size && seasonKnown) && prior.has(releaseTitleTokens(alignWordBreaks(name, wanted)).join(' '))) return false
    return relevantName(name, wanted)
  }

  const folders = packFolders(path, lines, base)
  // Extras sit in folders of their own or say what they are, so a file at the release root is one of
  // the pack's episodes. Which season's, the root does not say.
  if (folders?.length === 0) regular = true
  for (const folder of folders ?? []) {
    const part = packPart(folder)
    if (contradicts(part) || (!regular && otherPart(part))) return false
    if (part.seasons.length) regular = true
    if (namesRequested(part)) seasonKnown = true
    const rest = part.rest.replace(OTHER_PART, ' ')
    if (!releaseTitleTokens(rest).length) continue
    // The nearest folder with a title of its own names the entry the file belongs to. A request for
    // a later season still needs that season named, by the folder's number or its exact title: a
    // folder with the bare first title is the first season.
    const sequel = sequelNumber(rest)
    if (sequel && requested.has(Number(sequel))) seasonKnown = true
    if (!seasonKnown && !requested.has(1) && !exactTitle(rest, wanted)) return false
    return titled(rest)
  }
  const part = packPart(release)
  if (contradicts(part)) return false
  // A label numbered like one of the release's other listed seasons puts the file in that season.
  if (labelSeason >= 1 && !requested.has(labelSeason) && part.seasons.includes(labelSeason)) return false
  // Nothing placed the file apart from the release's other parts (OVAs, a second title joined with
  // "+"), so it could be one of them.
  if (!regular && (otherPart(part) || JOINED_PARTS.test(release))) return false
  if (namesRequested(part)) seasonKnown = true
  // A release of several seasons, or one that never names the requested later season.
  if (!seasonKnown && (part.seasons.length > 0 || (!requested.has(1) && !exactTitle(part.rest, wanted)))) return false
  return titled(part.rest)
}

/** A title run that IS one of the requested titles. This is intentionally alias-by-alias rather than
 *  a union comparison, so a partial franchise title does not become exact by mixing aliases. */
function headIsAlias(head: string[], wanted: string[]): boolean {
  return head.length > 0 && wanted.some((alias) => {
    const identity = lexicalTitleTokens(alias)
    if (!identity.length) return false
    if (identity.length === head.length && identity.every((token, index) => token === head[index])) return true
    // Romanization word boundaries are inconsistent across catalogues and release groups:
    // Kitsu/AniList may say "Dogul Wang" or "Toukutsuou", while a release says "Dogulwang" or
    // "Toukutsu Ou". Only collapse separators for an exact WHOLE-title identity; an extended
    // franchise title still has extra characters and remains rejected by the anchor.
    return identity.join('') === head.join('')
  })
}

/** A name whose own title is exactly one of the requested titles. */
function exactTitle(raw: string, wanted: string[]): boolean {
  const name = alignWordBreaks(raw, wanted)
  return hasExactReleaseIdentity(name, wanted) || headIsAlias(releaseTitleTokens(name), wanted)
}

/** relevant() for one release or file name on its own. */
function relevantName(raw: string, wanted: string[]): boolean {
  const name = alignWordBreaks(raw, wanted)
  const toks = new Set(titleTokens(name))
  const known = new Set(wanted.flatMap((w) => lexicalTitleTokens(w)))
  const head = releaseTitleTokens(name)
  if (hasExactReleaseIdentity(name, wanted)) return true
  // A CJK/opaque or quality-only label has no readable title run and remains unknown. A readable
  // short title ("Us", "It", "X") is not unknown merely because every word has ≤2 characters:
  // compare its complete identity run exactly enough to distinguish it from the requested title.
  if (!toks.size) return !head.length || (head.length > 0 && head.every((t) => known.has(t)))
  // ANCHOR. Both tests below measure how much of the REQUESTED title a release carries, and
  // neither can see a release that carries ALL of it and then names something else: every
  // long-running series has spin-offs whose titles START with the base title ("One Piece Fan
  // Letter", "Detective Conan: The Culprit Hanzawa", "Dragon Ball Super: Super Hero"). Those
  // scored a perfect 100% against the base title, survived, and — being modern, well-seeded
  // releases against a decades-old episode 1 — won the auto-pick outright.
  // So once the release's title starts, it must introduce no word the request has never heard of.
  // Compared against the UNION of the requested titles, so a release naming both the romaji and the
  // English title ("Kusuriya no Hitorigoto - The Apothecary Diaries - 01") is still anchored.
  // An explicit host-shaped source prefix was already stripped by releaseTitleTokens. Any other
  // unknown word before the first recognised title word belongs to the claimed title and is a
  // contradiction, not harmless decoration. This catches titles that share a generic suffix with
  // the request ("Loner Life In Another World" vs "Starting Life In Another World"). A head with
  // nothing recognisable in it at all (a CJK or Cyrillic release name, or an empty one) anchors
  // vacuously — never drop on uncertainty, and the tests below still have to find evidence.
  const titleStart = head.findIndex((t) => known.has(t))
  if (titleStart > 0 || (titleStart === 0 && !head.every((t) => known.has(t)))) return false
  // Exact normalized identity is decisive even when every token is short and therefore absent
  // from the fuzzy token set (for example M*A*S*H).
  if (headIsAlias(head, wanted)) return true
  // The release's OWN title words: its tokens minus quality/codec/hash junk, bare
  // numbers, the leading [Group] tag, and scene episode codes. A short-title release
  // ("[SubsPlease] Dr STONE S04E25 NF WEB-DL") must reduce to just {stone} — NOT
  // {subsplease, stone, s04e25} — so its content ratio against a LONG official title
  // ("Dr. Stone: Science Future") isn't sunk by group/episode noise. Nothing after an explicit
  // episode marker is title either: scene names append an episode title, "AAC2.0", "MSubs" and a
  // "-Group" suffix, which outvoted "Spell.Lender.S01E01.Kicked.Out...MSubs-Group".
  const bare = name.replace(/^\s*\[[^\]]*\]\s*/, '') // drop a leading [Group] tag
  const marker = bare.search(EPISODE_MARKER)
  const content = titleTokens(marker > 0 ? bare.slice(0, marker) : bare).filter(
    (t) => !RELEASE_JUNK.test(t) && !/^\d+$/.test(t) && !SCENE_CODE.test(t),
  )
  for (const w of wanted) {
    // DISTINCT tokens: a repeated word in the official title used to inflate its own match ratio.
    // "Tsuma Tsuma" tokenises to [tsuma, tsuma], so any release containing that one very common
    // word scored 100% and a different show played (AniList 2507, which is also "Wife with Wife"
    // — the same trap in English, matching "Wife Swap Diaries").
    const wt = [...new Set(titleTokens(w))]
    if (!wt.length) continue
    const hits = wt.filter((t) => toks.has(t)).length
    // (a) release carries ≥50% of the official title's distinct tokens (full-title releases).
    //     One matching token is not evidence on its own — that is what let any release containing
    //     the word "tsuma" pass for "Tsuma Tsuma". So a single hit only counts when the title
    //     appears VERBATIM, which "Tsuma no Haha" does not and "[SakuraCircle] Tsuma Tsuma - 01"
    //     does. Tokenisation drops very short words ("Dr"), so the phrase is matched on the
    //     normalised strings rather than on tokens. A one-word title has no phrase to speak of and
    //     is left entirely to (b), which asks the harder question: is the release mostly ABOUT
    //     this show. Otherwise "Bleach Blade Battlers" would pass for "Bleach".
    const phrase = norm(w)
    const enough = hits >= 2 || (phrase.includes(' ') && norm(name).includes(phrase))
    if (enough && hits / wt.length >= 0.5) return true
    // (b) the release's own title words are mostly this anime's (short-title releases):
    //     ≥60% of the release's content tokens appear in the official title.
    if (content.length && content.filter((t) => wt.includes(t)).length / content.length >= 0.6) return true
  }
  return false
}

/**
 * Whether a trusted row explicitly identifies a different title.
 *
 * Trust is allowed to cover missing/opaque text (a CJK filename, a bare quality label, or a direct
 * transport placeholder), but it must never erase contradictory identity evidence. Torrent
 * extensions put the release name in `behaviorHints.filename`; online providers additionally keep
 * the canonical title selected by their search/detail flow in `__sourceTitle`.
 */
export function hasExplicitTitleConflict(stream: Stream, wanted: string[]): boolean {
  const sourceTitle = stream.__sourceTitle?.trim()
  const claimed = sourceTitle || stream.behaviorHints?.filename?.trim()
  if (!claimed || (!sourceTitle && DIRECT_TRANSPORT_LABEL.test(claimed))) return false

  // No Latin title run means the value is opaque to this matcher. A number/quality-only label also
  // lands here. Preserve the existing "never drop on uncertainty" behaviour for both.
  if (!releaseTitleTokens(claimed).length) {
    // A provider's canonical source title is stronger than a filename parse. Numeric-only titles
    // have no release-title run, but are still readable and exactly comparable; CJK remains opaque
    // to this ASCII matcher and is preserved as unknown.
    return !!sourceTitle && !!norm(claimed) && !relevant({ behaviorHints: { filename: claimed } }, wanted)
  }
  return !relevant({ behaviorHints: { filename: claimed } }, wanted)
}

// An uploader's own disclaimer that the file is NOT the requested production — a release named
// "Example Film 2026 (NOT the acclaimed FILM)" — outranks every fuzzy heuristic: the title run
// matches perfectly, the year matches, and only that phrase tells the truth. Match it opening a
// bracket, or inline when it names a production word, so a legitimate note like
// "(subs not the best)" never triggers it.
const SELF_DISCLAIMER = /[([]\s*not\s+(?:the|a|an)\b|\bnot\s+(?:the|a|an)\b[^\n]{0,60}?\b(?:film|movie|version|release)\b/i
export function selfDeclaredOtherProduction(stream: Stream): boolean {
  return SELF_DISCLAIMER.test(nameOf(stream))
}

// Non-episode EXTRA files (openings/endings/creditless/previews/menus) that addons
// sometimes index under an episode. e.g. "Death Note OP 2 [4K 60FPS Creditless].mp4"
// is 4K + tiny, so it wrongly WINS the quality auto-pick over the real episode. Drop
// them. High-precision tokens only (won't touch a normal "Death Note - 37" release).
// tlr/tsr are the scene's trailer/teaser abbreviations ("Title_IMAX_TLR-2_3840x2024…"): a trailer
// pack under a film's id parses as a 4K, correct-year, title-relevant release and wins outright.
const EPISODE_EXTRA = /\b(?:ncop\d*|nced\d*|ncbd|creditless|textless|non[-\s]?credit|clean\s+(?:opening|ending)|op\s?\d{1,2}|ed\s?\d{1,2}|preview|teaser|\btrailer\b|tlr\d*|tsr\d*|promo|\bpv\b|\bcm\b|menu)\b/i
// The same markers in other scripts; \b cannot see boundaries next to non-ASCII letters.
const EPISODE_EXTRA_WORDS = /(?<![\p{L}\p{N}])(?:трейлер|тизер|tráiler|bande[-\s]?annonce)(?![\p{L}\p{N}])/iu
export function isEpisodeExtra(stream: Stream): boolean {
  // Underscores are word characters, so an underscore-separated release name hides every token
  // from \b. Test it with them as spaces.
  const name = nameOf(stream).replace(/_/g, ' ')
  return EPISODE_EXTRA.test(name) || EPISODE_EXTRA_WORDS.test(name)
}

// Same-title, different production. A shared kitsu id (One Piece = the 1999 anime
// AND the 2023 Netflix live action) survives relevant() because the title matches.
// Two independent tells, either drops the file:
//   (1) `absoluteNumbered` — a long-running anime (One Piece, Naruto, Conan) ships as
//       "One Piece - 001", never scene "S01E01", so ANY SxxExx file is a different
//       production (catches a year-less live-action "One Piece S01E01").
//   (2) a disambiguation YEAR newer than the anime's debut alongside scene SxxExx
//       numbering (catches "One.Piece.2023.S01E01" for shorter shows too).
// Both keep unknowns (never drop a plain absolute-numbered release).
export function likelyOtherProduction(stream: Stream, animeYear?: number, absoluteNumbered = false): boolean {
  const name = nameOf(stream)
  const hasSceneEp = /\bS\d{1,2}E\d{1,3}\b/i.test(name)
  if (hasSceneEp && absoluteNumbered) return true // long-runner + SxxExx ⇒ not the anime
  if (!animeYear) return false
  const years = [...name.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]))
    .filter((y) => y >= 1950 && y <= 2035)
  if (!years.length || years.includes(animeYear)) return false
  // Scene-numbered file + a NEWER disambiguation year ⇒ a remake/live-action after the anime
  // ("One.Piece.2023.S01E01" under the 1999 anime's id).
  if (hasSceneEp) return years.some((y) => y > animeYear + 1)
  // No scene episode: a plain absolute-numbered episode ("[Group] Title - 067") is legit, so
  // keep anything with a "- NNN" episode number. But a MOVIE-like file (no episode number)
  // whose only year is clearly OFF from the anime's debut is a different production sharing the
  // kitsu id — e.g. the 1995 Ghost in the Shell film polluting the 2026 series. Drop it.
  const bare = name.replace(/^\s*\[[^\]]*\]\s*/, '')
  if (/-\s*\d{1,4}(?:v\d)?\b/.test(bare)) return false
  return years.some((y) => y < animeYear - 1 || y > animeYear + 1)
}

// EPISODE_MARKER (the S01E01 / "- 067" / "EP 3" shapes) is declared at the top of this file,
// because releaseTitleTokens cuts a release name at it too.
// A season/complete/range PACK marker — one definition, shared with the picker's "Batch" pill.
// They were separate regexes with different ideas of what a pack looks like, so a release could
// be treated as a pack by one and a single episode by the other.

// A STANDALONE MOVIE/film file: no episode marker AND no batch/season marker. When the request
// is a MULTI-EPISODE SERIES, such a file is a different production sharing the id — the year-less
// 1995 "Ghost in the Shell" BluRay rip, or "Ghost in the Shell 2: Innocence", polluting the 2026
// SERIES. Season packs (legit) carry a batch marker and are kept; single episodes carry an
// episode marker and are kept. Only apply this to multi-episode series (see refineStreams) — a
// real movie/OVA request WANTS the marker-less file.
export function isStandaloneMovie(stream: Stream): boolean {
  // Underscores separate words in release names; read as spaces they no longer hide the markers.
  const name = nameOf(stream).replace(/_/g, ' ')
  return !stream.__batch && !EPISODE_MARKER.test(name) && !BATCH_MARKER.test(name) && !LOOSE_EPISODE_NUMBER.test(name)
}

// Episode numbering the markers above cannot read, every form taken from files this rule used to
// drop as films: about one row in thirteen of a saved corpus of real add-on rows, none of them a
// film. It only keeps a file out of the film bucket and never rejects anything, so it may be
// generous, but years (19xx/20xx) are excluded and a lone digit only counts before a bracketed tag,
// so a dated film or a numbered sequel ("Title 2 (2011)", "Title 2.mkv") still reads as a film. In
// order: S01E01v2, Ep01 / Episode.01, E020, 第14话, "01. Title", a zero-padded 01 / 001 between
// separators, [49], a 2-4 digit number before tags or the end of the name, and a lone digit before
// a bracketed tag.
const NOT_YEAR = '(?!(?:19|20)\\d\\d(?!\\d))'
const NOT_YEAR_TAG = String.raw`(?!\s*[[(](?:19|20)\d\d[\])])`
const LOOSE_EPISODE_NUMBER = new RegExp([
  String.raw`\bS\d{1,2}E\d{1,4}v\d\b`,
  String.raw`\b(?:ep|episode)[\s.]?\d{1,4}(?:v\d)?\b`,
  String.raw`\bE\d{2,4}(?:v\d)?\b`,
  String.raw`第\s*\d{1,4}\s*[话話集回]`,
  String.raw`^\s*${NOT_YEAR}\d{1,4}(?:v\d)?\s*[.\-–]\s`,
  String.raw`(?:^|[\s.(\[-])0\d{1,3}(?:v\d)?(?=$|[\s.)\]-])`,
  String.raw`\[\s*${NOT_YEAR}\d{1,4}(?:v\d)?\s*\]`,
  String.raw`\s${NOT_YEAR}\d{2,4}(?!\d)(?:v\d)?${NOT_YEAR_TAG}(?=\s*(?:[[(]|\d{3,4}p\b|\.[a-z0-9]{2,4}$|$))`,
  String.raw`\s\d(?:v\d)?${NOT_YEAR_TAG}(?=\s*[[(])`,
].join('|'), 'i')

// A SEQUEL-season marker used to DROP a file: a named final season, or a season numbered ≥ 2. Note
// "Final Season" carries NO number, so parseSeasonEp/isWrongSeason (which key off a season NUMBER)
// can't see it — yet it's a wholly separate AniList entry from the base series. `season 1-3` (a batch
// spanning S1) is intentionally NOT matched: the number right after "season" is 1. "Part N"/"Cour N"
// are deliberately EXCLUDED here — a single entry's cours are routinely labeled "Part 2" (Vinland
// Saga S1), so dropping on them would kill legit same-entry files.
const SEQUEL_SEASON = /\b(?:the\s+)?final\s+season\b|\bseason\s*0*(?:[2-9]|[1-9]\d)\b|\b(?:[2-9]|[1-9]\d)(?:st|nd|rd|th)\s+season\b/i
// ANY explicit season/part marker (INCLUDING season 1 / a final season). Used to tell whether the
// REQUESTED title itself names a season — if so it isn't the base entry and this guard is skipped.
const ANY_SEASON = /\b(?:the\s+)?final\s+season\b|\bseason\s*0*\d+\b|\b\d+(?:st|nd|rd|th)\s+season\b|\bpart\s*0*\d+\b|\bcour\s*0*\d+\b/i

// Same-franchise WRONG SEASON. Addons index a franchise under shared/adjacent ids, so a request for
// the BASE entry ("Shingeki no Kyojin") pulls in sequel-season files ("Shingeki no Kyojin The Final
// Season - 01") that survive relevant() (the base title matches) AND the SxxExx season gate (a
// number-less "Final Season" isn't parsed as a season). This fires ONLY when the requested title
// names NO season (⇒ it's the base) and the file explicitly names a sequel season — so a season-1,
// batch, or plain absolute-numbered release is never touched. Keeps unknowns (never drop on doubt).
export function wrongFranchiseSeason(stream: Stream, wanted: string[]): boolean {
  if (wanted.some((t) => ANY_SEASON.test(t))) return false // request itself names a season — not the base
  return SEQUEL_SEASON.test(nameOf(stream))
}
