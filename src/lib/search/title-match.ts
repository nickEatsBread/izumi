import type { Media } from '$lib/anilist/types'

// Typo- and spacing-tolerant title matching for search. AniList's search only matches whole words
// spelled exactly, so a typo ("freiren"), a respaced title ("onepiece") or a half-typed word
// ("frier") finds nothing there, and some catalogs answer a query they cannot match with their
// default listing instead of nothing. Search ranks and filters its results with this score, which
// accepts the first three and gives the unrelated listing nothing.

/** A result scoring below this is not shown. */
export const RELEVANT_MATCH = 0.6
/** A result scoring this or more is taken to be the title the viewer meant. */
export const STRONG_MATCH = 0.8

// Words titles abbreviate. Both sides are rewritten, so "kaiju number 8" is "Kaiju No. 8".
const ABBREVIATED: Readonly<Record<string, string>> = {
  number: 'no', doctor: 'dr', mister: 'mr', saint: 'st', versus: 'vs',
}

// Japanese, Chinese, Thai and their neighbours do not separate words with spaces, so a query in them
// can only be found inside a title, not word by word. Latin, Cyrillic, Greek or Hangul words cannot.
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u
const HAS_DIGIT = /\p{N}/u

/** Lowercase, unaccented, punctuation-free words. */
export function foldTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[×✕]/g, ' x ')
    .replace(/['’‘`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Folded words, with the abbreviations titles use. */
export function normalizeTitle(value: string): string {
  return foldTitle(value).split(' ').map((word) => ABBREVIATED[word] ?? word).join(' ')
}

/** Optimal-string-alignment distance (swapping two neighbouring letters is one edit), or `max + 1`
 *  as soon as the distance is known to exceed `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let before: number[] = []
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      let value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1)
      row[j] = value
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > max) return max + 1
    before = previous
    previous = row
  }
  return Math.min(previous[b.length], max + 1)
}

// Typos allowed in a word: none in short words ("on" is not "no") or in numbers ("2" is not "0"), and
// two only in long ones ("oshinoko" is not "Oshiruko").
const typoAllowance = (word: string): number =>
  HAS_DIGIT.test(word) ? 0 : word.length >= 9 ? 2 : word.length >= 4 ? 1 : 0

/** How closely one query word matches one title word. `typing` marks the query's last word, which
 *  may still be incomplete ("frier" for "frieren"). A word glued from several (`joined`) gets one
 *  typo at most: "chainsaw men" is "Chainsaw Man", but "dragon ball" is not "Dragon Half". */
function wordSimilarity(query: string, word: string, typing: boolean, minPrefix: number, joined: boolean): number {
  if (query === word) return 1
  if (typing && query.length >= minPrefix && word.startsWith(query)) return 0.75 + 0.2 * (query.length / word.length)
  const allowed = joined ? Math.min(1, typoAllowance(query)) : typoAllowance(query)
  if (!allowed) return 0
  const distance = editDistance(query, word, allowed)
  if (distance <= allowed) return 1 - distance / (query.length + 1)
  // A typo in the word being typed: "freir" is heading for "frieren".
  if (typing && query.length >= 4 && word.length > query.length
    && editDistance(query, word.slice(0, query.length), 1) <= 1) return 0.65 + 0.15 * (query.length / word.length)
  return 0
}

interface Run { text: string; from: number; to: number }

// Single words plus runs of up to three neighbours written as one, so "bluelock" can meet "blue lock"
// and "tora dora" can meet "toradora" inside a longer title.
function runs(words: string[]): Run[] {
  const out: Run[] = []
  for (let from = 0; from < words.length; from++) {
    for (let to = from + 1; to <= Math.min(words.length, from + 3); to++) {
      out.push({ text: words.slice(from, to).join(''), from, to })
    }
  }
  return out
}

interface Pair { query: Run; title: Run; similarity: number; weight: number }

// Matched words the title has in a different order than the query count half: common romaji words
// ("kimi", "no") turn up scattered through many long titles that are not the one being typed.
function inOrder(pairs: Pair[]): Set<Pair> {
  const sorted = [...pairs].sort((a, b) => a.query.from - b.query.from)
  const length = sorted.map(() => 1)
  const previous = sorted.map(() => -1)
  for (let i = 0; i < sorted.length; i++) {
    for (let j = 0; j < i; j++) {
      if (sorted[j].title.from < sorted[i].title.from && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1
        previous[i] = j
      }
    }
  }
  const kept = new Set<Pair>()
  for (let i = length.indexOf(Math.max(...length)); i >= 0; i = previous[i]) kept.add(sorted[i])
  return kept
}

/** Pair query words with title words one to one, best pairs first. Scores the similarity-weighted
 *  share of the query's letters that found a partner, plus a little for the share of the title used. */
function wordScore(query: string, title: string): number {
  const queryWords = query.split(' ')
  const titleWords = title.split(' ')
  const minPrefix = queryWords.length > 1 ? 1 : 3
  const pairs: Pair[] = []
  for (const q of runs(queryWords)) {
    const typing = q.to === queryWords.length
    for (const t of runs(titleWords)) {
      const joined = q.to - q.from > 1 || t.to - t.from > 1
      const similarity = wordSimilarity(q.text, t.text, typing, minPrefix, joined)
      if (similarity > 0) pairs.push({ query: q, title: t, similarity, weight: q.text.length * similarity })
    }
  }
  pairs.sort((a, b) => b.weight - a.weight || b.similarity - a.similarity)
  const usedQuery = new Array<boolean>(queryWords.length).fill(false)
  const usedTitle = new Array<boolean>(titleWords.length).fill(false)
  const free = (used: boolean[], run: Run) => used.slice(run.from, run.to).every((value) => !value)
  const matched: Pair[] = []
  for (const pair of pairs) {
    if (!free(usedQuery, pair.query) || !free(usedTitle, pair.title)) continue
    usedQuery.fill(true, pair.query.from, pair.query.to)
    usedTitle.fill(true, pair.title.from, pair.title.to)
    matched.push(pair)
  }
  if (!matched.length) return 0
  const ordered = inOrder(matched)
  let covered = 0
  let titleLetters = 0
  for (const pair of matched) {
    covered += ordered.has(pair) ? pair.weight : pair.weight / 2
    titleLetters += pair.title.text.length
  }
  const queryLetters = queryWords.join('').length
  return 0.85 * (covered / queryLetters) + 0.05 * (titleLetters / title.replace(/ /g, '').length)
}

// The query written without spaces against the start of the title, allowing one typo:
// "sololevelling" for "Solo Leveling".
function compactTypoScore(query: string, title: string, closeness: number): number {
  if (HAS_DIGIT.test(query) || query.length < 5) return 0
  for (const length of [query.length - 1, query.length, query.length + 1]) {
    if (length < 1 || length > title.length) continue
    if (editDistance(query, title.slice(0, length), 1) <= 1) return 0.72 + 0.05 * closeness
  }
  return 0
}

/** How well `title` answers the search `query`, from 0 (unrelated) to 1 (the same title). A title
 *  that merely contains the query scores less the longer it is, so a series outranks its movie. */
export function titleMatchScore(query: string, title: string): number {
  const q = normalizeTitle(query)
  const t = normalizeTitle(title)
  if (!q || !t) return 0
  if (q === t) return 1
  const qc = q.replace(/ /g, '')
  const tc = t.replace(/ /g, '')
  if (qc === tc) return 0.97
  const closeness = Math.min(1, qc.length / tc.length)
  let best = 0
  if (t.startsWith(`${q} `)) best = 0.9 + 0.04 * closeness
  else if (` ${t} `.includes(` ${q} `)) best = 0.8 + 0.04 * closeness
  if (qc.length >= 4 && tc.startsWith(qc)) best = Math.max(best, 0.85 + 0.04 * closeness)
  else if (qc.length >= 5 && tc.includes(qc)) best = Math.max(best, 0.75 + 0.04 * closeness)
  if (UNSPACED_SCRIPT.test(qc) && tc.includes(qc)) best = Math.max(best, 0.8 + 0.04 * closeness)
  return Math.max(best, compactTypoScore(qc, tc, closeness), wordScore(q, t))
}

/** The best score any of a record's titles earns. */
export function bestTitleScore(query: string, titles: readonly (string | null | undefined)[]): number {
  let best = 0
  for (const title of titles) if (title) best = Math.max(best, titleMatchScore(query, title))
  return best
}

type Titled = Pick<Media, 'title' | 'synonyms'>

/** A record's own titles, as opposed to the alternate names in its synonyms. */
export const canonicalTitles = (media: Titled): (string | undefined)[] =>
  [media.title.english, media.title.romaji, media.title.native, media.title.userPreferred]

// Live search re-ranks every record each time another source answers; score each record once per query.
const matches = new WeakMap<Titled, { query: string; canonical: number; alternate: number }>()

/** How well a record's own titles, and separately its alternate names, match the query. */
export function mediaMatch(media: Titled, query: string): { canonical: number; alternate: number } {
  const known = matches.get(media)
  if (known?.query === query) return { canonical: known.canonical, alternate: known.alternate }
  const canonical = bestTitleScore(query, canonicalTitles(media))
  const alternate = bestTitleScore(query, media.synonyms ?? [])
  matches.set(media, { query, canonical, alternate })
  return { canonical, alternate }
}

/** Up to 0.08 more for a widely watched title: among titles that all contain the query it decides
 *  the order (a series before its promo video), but it never lifts a loose match over a close one. */
export const popularityBoost = (media: Pick<Media, 'popularity'>): number =>
  0.08 * Math.min(1, Math.log10((media.popularity ?? 0) + 1) / 6)
