import { get } from 'svelte/store'
import { phttp } from '$lib/net/http'
import { jimakuApiKey } from '$lib/settings/ui'
import { EXTRA, parseFileEpisode, type ParsedFileEpisode } from '$lib/stremio/debrid/episode-file'
import type { SubQuery, SubtitleCandidate, SubtitleProvider } from './types'

// Jimaku REST API (beta) — bring-your-own key from a site account, sent raw in the `Authorization`
// header (an apiKey scheme, NOT a Bearer token). Two hops: `/entries/search` resolves the series
// directory from an AniList (or TMDB) id, `/entries/{id}/files` lists that directory's files. SEARCH
// only — downloading a picked file happens in Rust on manual pick, like the other two providers.
//
// The catalogue is community Japanese subtitles, so every row is tagged `ja`; there is no per-file
// language on the API to read one from.

const JIMAKU_BASE = 'https://jimaku.cc/api'

/** Extensions the Rust download path can actually turn into a track: text subtitles it normalizes
 *  directly, plus ZIP (unzipped there, reusing the SubDL path). The same listings also carry .7z,
 *  .rar and image-based idx/sub, which that path cannot open — surfacing those would only ever
 *  produce a row that errors when clicked. */
const PLAYABLE = /\.(?:srt|ass|ssa|vtt|zip)$/i

/** Rows the download path has to unpack. It takes the FIRST subtitle entry in archive order and
 *  discards the rest — there is no way to ask it for a particular member — so a whole-season ZIP
 *  always yields episode 1, whatever span its name claims. An archive is therefore never evidence
 *  of a specific episode, and pickEpisodeFiles treats it accordingly.
 *
 *  The real fix lives on the Rust side and is still outstanding: the wanted episode would have to
 *  reach the unzip so it can match a member's name instead of taking index 0, which means a new
 *  optional episode argument on the subtitle download command, threaded to the ZIP branch of the
 *  Jimaku path. Once an archive can answer a named episode, drop this constant, the archiveRelease
 *  label and the archive filter below — the range/batch ranking alone is then correct again. */
const ARCHIVE = /\.zip$/i

/** One row of `/entries/{id}/files`. `url` arrives absolute (the API prefixes its canonical host). */
export interface JimakuFile { name: string; url: string; size?: number }

/** How well a file answers the wanted episode. `batch` is a file with no episode in its name at
 *  all — a whole-season archive that plausibly contains it, but is not evidence of it. */
export type JimakuMatchKind = 'exact' | 'range' | 'batch'
/** `release` is the text the picker shows: the plain filename, except on an archive offered for a
 *  specific episode, where it carries the warning that only its first entry will be loaded. */
export interface JimakuMatch { file: JimakuFile; kind: JimakuMatchKind; release: string }

/** The shared filename parser strips every [bracket] group as a group tag or CRC, which is right for
 *  `[ABC1E404]` but throws away the episode in the bracketed style this catalogue is full of
 *  (`[Group][Show][01].srt`). Re-spell a digits-ONLY group as the ` - 01 ` form that parser already
 *  reads, and leave mixed groups ([1080p], CRCs) to be stripped as before. A bracketed year or
 *  resolution survives this only to be dropped by the parser's own noise pass.
 *
 *  A revision suffix (`[07v2]`) and a bracketed span (`[01-12]`) are re-spelled too: without this
 *  they fall through the bracket strip and parse to NOTHING, which lands them in the `batch` bucket
 *  — i.e. episode 7's file gets offered as a plausible carrier of episode 3. */
function unbracketEpisode(name: string): string {
  return name
    .replace(/\[(\d{1,4})\s*[-~]\s*(\d{1,4})\]/g, ' $1-$2 ')
    .replace(/\[(\d{1,4}(?:v\d+)?)\]/gi, ' - $1 ')
}

/** The span as it is WRITTEN in `name` — the two bounds and the separator between them ("2", "05",
 *  " - " for "Show 2 - 05") — which the parsed numbers have lost. Matched by value so the right
 *  occurrence is found in a name carrying several. */
function rawSpan(name: string, range: [number, number]): { first: string; last: string; sep: string } | null {
  for (const m of name.matchAll(/(\d{1,4})(\s*[-~]\s*)(\d{1,4})/g)) {
    if (Number(m[1]) === range[0] && Number(m[3]) === range[1]) return { first: m[1], last: m[3], sep: m[2] }
  }
  return null
}

/** The shared parser tries its range branch before its hyphen branch, so a series whose TITLE ends in
 *  a digit reads "Show 2 - 05" as the span 2-5 — and then answers episodes 2, 3 and 4 with episode 5's
 *  file. A real span writes both bounds at one width ("01-12", "13-24"); a title number running into
 *  the following episode number does not, so a width mismatch means it is not a span at all.
 *
 *  What the trailing number then IS depends on how it was written. A spaced separator or a padded
 *  bound is this catalogue's ordinary way of writing an episode ("Show 2 - 12", "Show 2-05"), so that
 *  is the episode. A tight, unpadded pair is a genuine span typed unevenly ("9-10", "1-12") and must
 *  never become episode 10 — it claims no episode at all and falls through to `batch`, where the name
 *  is shown as-is and nothing is promised about it.
 *
 *  Local to this provider rather than in the shared parser, which also serves in-torrent video names
 *  where the padding conventions are not the same. */
function parseJimakuName(name: string): ParsedFileEpisode {
  const p = parseFileEpisode(name)
  if (!p.range) return p
  const raw = rawSpan(name, p.range)
  if (!raw || raw.first.length === raw.last.length) return p // a real span (or unreadable — leave it be)
  const out: ParsedFileEpisode = p.season != null ? { season: p.season } : {}
  if (/\s/.test(raw.sep) || raw.last.startsWith('0')) out.episode = p.range[1]
  return out
}

/** What the picker calls an archive row that is standing in for a specific episode. Without this a row
 *  reading "Show 01-12.zip" under an episode-7 menu looks like episode 7's subtitles; it is in fact
 *  whichever entry sits first in the archive, i.e. episode 1. */
const archiveRelease = (name: string, episode: number) =>
  `${name} — archive: loads its first entry, may not be episode ${episode}`

/** Pick the files that can carry `episode`, best first:
 *  1. `exact` — the name parses to exactly this episode,
 *  2. `range` — a multi-episode file whose span covers it ("01-12"), narrowest span first,
 *  3. `batch` — no episode in the name at all, largest first.
 *  A file parsing to a DIFFERENT episode is dropped outright rather than demoted: silently handing
 *  back the wrong episode is worse than handing back nothing. A season in the name that contradicts
 *  the wanted one disqualifies too, so a multi-season directory can't answer S2E07 with S1E07. With
 *  no episode wanted (a movie) every playable file is a `batch` row — there is nothing to narrow on.
 *
 *  `range` and `batch` rows are usually whole-season ZIPs, and the download path can only return an
 *  archive's FIRST entry, so picking one while watching episode 7 loads episode 1 — the exact silent
 *  mis-answer this function exists to prevent. Until the unzip can be told which episode is wanted
 *  (see ARCHIVE), an archive row is dropped whenever a real per-episode file also answers, and named
 *  for what it is when it is the only thing on offer. Non-archive rows are untouched: those load the
 *  file whose name the user just read. */
export function pickEpisodeFiles(files: JimakuFile[], episode?: number, season?: number): JimakuMatch[] {
  const playable = files.filter((f) => PLAYABLE.test(f.name))
  if (episode == null) return playable.map((file) => ({ file, kind: 'batch' as const, release: file.name }))

  const exact: JimakuMatch[] = []
  const ranged: { match: JimakuMatch; width: number }[] = []
  const batch: JimakuMatch[] = []
  for (const file of playable) {
    const p = parseJimakuName(unbracketEpisode(file.name))
    if (p.season != null && season != null && p.season !== season) continue
    if (p.episode != null) {
      if (p.episode === episode) exact.push({ file, kind: 'exact', release: file.name })
      continue // a parsed but different episode — never a candidate for this one
    }
    if (p.range) {
      if (episode >= p.range[0] && episode <= p.range[1]) {
        ranged.push({ match: { file, kind: 'range', release: file.name }, width: p.range[1] - p.range[0] })
      }
      continue
    }
    // Creditless openings, previews and the like parse to no episode, so they would sit in `batch` and
    // be offered for every episode of the series ("Show OP 07" under an episode-3 menu). Only this
    // bucket is filtered: a numbered file has already proved which episode it is, even when its group
    // tag happens to carry one of these tokens ("[NCOP-Raws] Show - 07").
    if (EXTRA.test(file.name)) continue
    batch.push({ file, kind: 'batch', release: file.name })
  }
  ranged.sort((a, b) => a.width - b.width)
  batch.sort((a, b) => (b.file.size ?? 0) - (a.file.size ?? 0))
  const wide = [...ranged.map((r) => r.match), ...batch]
  return [
    ...exact,
    ...(exact.length ? wide.filter((m) => !ARCHIVE.test(m.file.name)) : wide)
      .map((m) => (ARCHIVE.test(m.file.name) ? { ...m, release: archiveRelease(m.file.name, episode) } : m)),
  ]
}

/** The `/entries/search` query. AniList id is the primary key; TMDB is the documented fallback and
 *  wants its `tv:1234` / `movie:1234` composite form. `anime` is left at its default rather than
 *  forced, so the service's own classification decides. Returns '' when neither id is usable. */
export function jimakuSearchParams(q: SubQuery): string {
  const p = new URLSearchParams()
  if (q.anilistId != null) p.set('anilist_id', String(q.anilistId))
  else if (q.tmdbId) p.set('tmdb_id', `${q.type === 'movie' ? 'movie' : 'tv'}:${q.tmdbId}`)
  else return ''
  return p.toString()
}

interface JimakuEntry { id?: number }

/** Resolved search query → entry id. A series directory keeps its id, but the search runs on every
 *  menu open, so without this every listing costs two sequential round trips where every sibling
 *  provider makes one. ONLY a resolved id is stored: a miss, a 401 (bad key) or a 429 (rate limit)
 *  has to stay retryable, or pasting a working key after a failed attempt would keep failing. */
const entryIds = new Map<string, number>()

export function createJimaku(): SubtitleProvider {
  return {
    id: 'jimaku',
    async search(q: SubQuery): Promise<SubtitleCandidate[]> {
      const key = get(jimakuApiKey)
      if (!key) return [] // every endpoint is authenticated — without a key there is nothing to ask
      const qs = jimakuSearchParams(q)
      if (!qs) return []
      const headers = { Authorization: key, Accept: 'application/json' }
      try {
        let id = entryIds.get(qs)
        if (id == null) {
          const found = await phttp(`${JIMAKU_BASE}/entries/search?${qs}`, { headers })
          if (!found.ok) return [] // 401 (bad key) and 429 (rate limit) both just mean "no rows"
          const entries = (await found.json()) as JimakuEntry[]
          // Entries are keyed on the id we searched, so a hit is the series directory; anything past
          // the first would be a duplicate registration and isn't worth a second round trip.
          id = Array.isArray(entries) ? entries.find((e) => e?.id != null)?.id : undefined
          if (id == null) return []
          entryIds.set(qs, id)
        }

        // Deliberately NOT sending the API's own `?episode=` filter: it drops every file it cannot
        // parse an episode out of, which silently hides whole-season batches from pickEpisodeFiles.
        const listed = await phttp(`${JIMAKU_BASE}/entries/${id}/files`, { headers })
        if (!listed.ok) return []
        const files = (await listed.json()) as JimakuFile[]
        if (!Array.isArray(files)) return []
        return pickEpisodeFiles(files.filter((f) => f?.name && f?.url), q.episode, q.season)
          .map(({ file, release }): SubtitleCandidate => ({
            provider: 'jimaku',
            lang: 'ja',
            release, // the filename, or the archive warning when the row cannot promise this episode
            download: { needsFetch: true, fileUrl: file.url },
          }))
      } catch {
        return []
      }
    },
  }
}
