import type { Stream } from './parse'
import { get, writable } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { title } from '$lib/anilist/media'
import { preferredAudioLang, preferredSubLang, providerLanguages, providerAudio } from '$lib/settings/ui'
import { runningStreamExtensions } from '$lib/extensions/manager'
import { isBcp47Locale, normalizeLang, subtitleTitle, trackLang } from './sublang'
import { parseStreamDrm } from '$lib/player/drm'
import { memo, cacheableList } from './online-cache'
import { currentResolveTrace, traceResolve, traceResolveError } from '$lib/debug/resolve-trace'

// Serial alias-search bounds (see findEp). A provider answers or it doesn't — walking every
// synonym only multiplies a dead provider's timeout, and it used to do so per episode.
const MAX_SEARCH_ALIASES = 5
const SEARCH_FAILURE_COOLDOWN_MS = 90_000
// Capped: one entry per (provider, title) the user browsed, and entries are only useful for their
// 90s window — an uncapped Map would accumulate for the life of the process. Evicting the oldest
// half at the ceiling keeps this O(1)-amortized and needs no timers.
const SEARCH_FAILURE_MAX = 300
const searchFailures = new Map<string, number>()
function noteSearchFailure(key: string): void {
  if (searchFailures.size >= SEARCH_FAILURE_MAX) {
    // Insertion-ordered, so the first half of the keys are the oldest recorded failures.
    const stale = [...searchFailures.keys()].slice(0, Math.floor(SEARCH_FAILURE_MAX / 2))
    for (const k of stale) searchFailures.delete(k)
  }
  searchFailures.set(key, Date.now())
}

/** Why a provider contributed no rows, when it said so out loud.
 *
 *  Every provider call is best-effort — one dead source must never fail the whole resolve — but
 *  swallowing the reason turned an actionable message into an empty picker. A source gated behind
 *  a login reports exactly that ("please log in to google drive through webview"); without this the
 *  user sees silence and reasonably concludes izumi is broken. Reset per resolve. */
export const providerProblems = writable<{ provider: string; message: string }[]>([])

/** Trim a runtime/provider message to something a picker row can carry. */
export function providerProblemText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  // Rust hands the payload back as a JSON string when the runtime reported a structured error.
  // Escaped whitespace survives that round-trip literally, so it has to be collapsed rather than
  // split on — otherwise the row reads `boom\n\tat Foo.bar(Unknown Source)`.
  const unquoted = raw.replace(/^"(.*)"$/s, '$1').replace(/\\[nrt]/g, ' ').replace(/ {2,}/g, ' ').trim()
  const firstLine = unquoted.split('\n')[0].trim()
  return firstLine.length > 200 ? `${firstLine.slice(0, 197)}…` : firstLine
}

// onlinestream-provider extension SDK shapes. Fields we consume.
export interface SnSearchResult { id: string; title: string; url?: string; subOrDub?: string }
export interface SnEpisode {
  id: string
  number: number
  url?: string
  title?: string
  /** Canonical title returned by the provider's detail page. JVM sources can expose this, which
   * lets us catch a search result that redirects to a different anime before resolving video. */
  sourceTitle?: string
}
// Seanime VideoSubtitle is {url, language, isDefault}; providers vary (some emit `lang`/`label`/
// `default`), so accept them all and normalize in videoSourceToStream.
// `headers` mirrors the reference's SubtitleFile.headers: some sidecar subtitle URLs are gated on
// Referer exactly like the video is, and a subtitle fetched without them silently 403s.
export interface SnVideoSubtitle {
  url: string
  language?: string
  lang?: string
  label?: string
  isDefault?: boolean
  default?: boolean
  headers?: Record<string, string>
  kind?: 'subtitles' | 'captions'
  switchUrl?: string
}
export interface SnAudioTrack {
  url?: string
  language?: string
  lang?: string
  label?: string
  title?: string
  headers?: Record<string, string>
  switchUrl?: string
}
export interface SnVideoSource {
  url: string
  /** Internal JVM bridge marker: its HttpServer is wildcard-bound despite advertising localhost. */
  localServer?: boolean
  type?: string
  quality?: string
  /** Extractor/server identity for this individual source. JVM providers return every server in
   * one getVideoList call, so the enclosing EpisodeServer name is only the provider name. */
  server?: string
  /** Actual flavour reported by this individual source; overrides the search pass when present. */
  audio?: 'sub' | 'dub'
  audioLang?: string
  subtitleMode?: 'soft' | 'hard'
  subtitles?: SnVideoSubtitle[]
  audioTracks?: SnAudioTrack[]
  /** A source can override its server's headers. An explicit empty object is meaningful:
   * some CDNs reject the embed Referer even though the sibling HLS source requires it. */
  headers?: Record<string, string>
  drm?: unknown
  /** Seek-bar hover sprite / BIF URL. */
  previewUrl?: string
  /** Capability-tokened LAN equivalent returned by a local provider sidecar. */
  share?: SnVideoSource
}
export interface SnEpisodeServer { server?: string; headers?: Record<string, string>; videoSources?: SnVideoSource[] }
export interface SnSettings { episodeServers?: string[]; supportsDub?: boolean; returnsMixedAudio?: boolean }

// Provider content languages are ISO 639-1 in the manifests ('fr'); the user's setting is ISO 639-2
// ('eng'). Map the handful we care about so the two can be compared.
const SUB_LANG_ALIASES: Record<string, string[]> = { eng: ['en', 'eng'], jpn: ['ja', 'jp', 'jpn'] }

/** True when a provider serves content in the user's preferred subtitle language. Providers that
 *  declare nothing are treated as unknown (neither match nor mismatch) — never dropped. */
export function matchesPreferredLang(providerLang: string | undefined, preferred: string): boolean {
  if (!providerLang) return false
  const want = SUB_LANG_ALIASES[preferred] ?? [preferred]
  return want.includes(providerLang.toLowerCase())
}

/** Rank for source ordering: 0 = preferred language, 1 = undeclared, 2 = a different language.
 *  Ordering only — a foreign source is still listed, because for many shows it is the ONLY one. */
export function langRank(providerLang: string | undefined, preferred: string): number {
  if (matchesPreferredLang(providerLang, preferred)) return 0
  return providerLang ? 2 : 1
}

/**
 * Which audio flavours to query, in display order (`true` = dub). The reference app models dub and
 * sub as SEPARATE episode lists on one title and lets the user pick between them; izumi previously
 * resolved exactly one flavour, so a viewer whose audio setting was Japanese could never see a dub
 * at all, and a viewer set to English never saw the sub whenever a dub existed.
 *
 *  - provider says it has dubs  → both, preferred first
 *  - provider says it has none  → sub only, so a sub-only provider is never queried twice
 *  - provider says nothing      → the preferred flavour, plus the sub fallback when dub is
 *                                 preferred (most anime is sub-only, so a dub-only query would
 *                                 return nothing for it)
 */
export function dubPasses(supportsDub: boolean | undefined, preferDub: boolean): boolean[] {
  if (supportsDub === true) return preferDub ? [true, false] : [false, true]
  if (supportsDub === false) return [false]
  return preferDub ? [true, false] : [false]
}

/** Narrow the audio flavours to the user's setting. 'both' keeps the provider-driven choice above;
 *  a one-flavour setting can leave NOTHING to run (dub-only wanted from a sub-only provider), and
 *  that provider is then skipped entirely rather than queried for results that get discarded. */
export function passesForAudio(passes: boolean[], audio: 'both' | 'sub' | 'dub'): boolean[] {
  if (audio === 'both') return passes
  const want = audio === 'dub'
  return passes.includes(want) ? [want] : []
}

/**
 * Whether a provider's content language is one the user wants queried.
 *
 * An EMPTY allowlist means "all" — the same sentinel idea the reference app uses. A provider that
 * declares no language is always kept: dropping it would silently lose working sources over missing
 * metadata rather than over a real mismatch.
 */
export function allowedByLanguage(providerLang: string | undefined, allowed: string[]): boolean {
  if (!allowed.length || !providerLang) return true
  return allowed.map((l) => l.toLowerCase()).includes(providerLang.toLowerCase())
}

const SEARCH_TITLE_NOISE = new Set([
  'a', 'an', 'and', 'at', 'dub', 'dubbed', 'eng', 'english', 'for', 'in', 'jpn', 'japanese',
  'no', 'of', 'on', 'or', 'sub', 'subbed', 'the', 'to', 'tv', 'wa',
])
const IDENTITY_MARKERS = new Set([
  'cour', 'film', 'movie', 'ona', 'ova', 'part', 'recap', 'season', 'special',
])

/** Stable title form for exact comparisons and search-query dedupe. */
export function normalizeSearchTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function searchTitleWords(value: string): string[] {
  return normalizeSearchTitle(value)
    .split(' ')
    .filter((word) => word && !SEARCH_TITLE_NOISE.has(word) && word.length > 1)
}

function sameWords(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((word, index) => word === b[index])
}

/**
 * Confidence that one provider title identifies one of the media's known titles.
 *
 * Search providers often return fuzzy results. A single shared word is not identity: AniDB returned
 * "Jubei-chan ... Lovely Eyepatch" for "Lovely Day ..." and the previous matcher accepted it solely
 * because both contained "Lovely". Compare each alias independently, require substantial coverage
 * on BOTH sides, and reject asymmetric production markers/numbers (movie, season 2, OVA, etc.).
 */
export function searchTitleScore(candidate: string, titles: string[]): number {
  const candidateNormalized = normalizeSearchTitle(candidate)
  const candidateWords = searchTitleWords(candidate)
  if (!candidateNormalized || !candidateWords.length) return 0

  let best = 0
  for (const wanted of titles) {
    const wantedNormalized = normalizeSearchTitle(wanted)
    const wantedWords = searchTitleWords(wanted)
    if (!wantedNormalized || !wantedWords.length) continue

    // Exact provider title (or exact meaningful words with harmless "(Dub)"/"(TV)" noise) wins.
    if (candidateNormalized === wantedNormalized || sameWords(candidateWords, wantedWords)) {
      best = Math.max(best, 1000)
      continue
    }

    const candidateSet = new Set(candidateWords)
    const wantedSet = new Set(wantedWords)
    const shared = [...candidateSet].filter((word) => wantedSet.has(word)).length
    if (shared < 2) continue

    // A marker or number on only one side usually denotes a different AniList production.
    const asymmetricMarker = [...new Set([...candidateSet, ...wantedSet])]
      .some((word) =>
        (IDENTITY_MARKERS.has(word) || /^\d+$/.test(word))
        && candidateSet.has(word) !== wantedSet.has(word),
      )
    if (asymmetricMarker) continue

    const wantedCoverage = shared / wantedSet.size
    const candidateCoverage = shared / candidateSet.size
    if (wantedCoverage < 0.6 || candidateCoverage < 2 / 3) continue
    const dice = (2 * shared) / (wantedSet.size + candidateSet.size)
    best = Math.max(best, Math.round(dice * 100) + shared)
  }
  return best
}

/** Pick the strongest CONFIDENT result. Results with only a vague overlap are rejected. */
export function pickSearchResult(results: SnSearchResult[], titles: string[]): SnSearchResult | undefined {
  let best: SnSearchResult | undefined
  let bestScore = 0
  for (const r of results) {
    const score = searchTitleScore(r.title ?? '', titles)
    if (score > bestScore) { bestScore = score; best = r }
  }
  return bestScore > 0 ? best : undefined
}

/** Provider-facing query order: primary title first, then unique aliases only when it misses. */
export function searchQueries(titles: string[]): string[] {
  const seen = new Set<string>()
  return titles.filter((candidate) => {
    const key = normalizeSearchTitle(candidate)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The picker header is the requested AniList media; each row must name the provider match instead
 * of laundering it through the requested title. */
export function providerEpisodeLabel(matchedTitle: string, episode: number, episodeTitle?: string): string {
  const epName = episodeTitle?.trim()
  const hasRealTitle = !!epName
    && normalizeSearchTitle(epName) !== `episode ${episode}`
    && epName !== String(episode)
  return `${matchedTitle.trim()} — Episode ${episode}${hasRealTitle ? ` · ${epName}` : ''}`
}

/** Find the episode entry whose number equals the requested episode. */
export function pickEpisode(eps: SnEpisode[], episode: number): SnEpisode | undefined {
  return eps.find((e) => e.number === episode)
}

/** Map one VideoSource (+ its server headers) to a direct streaming Stream. */
export function videoSourceToStream(
  vs: SnVideoSource, server: string, headers: Record<string, string>, provider: string,
  epTitle?: string, audio?: 'sub' | 'dub', originId?: string, lang?: string, langMismatch?: boolean,
  preferredSubtitle?: string, sourceTitle?: string,
): Stream {
  const quality = vs.quality || 'auto'
  const kind = /m3u8|hls/i.test(vs.type ?? '') ? 'HLS' : 'MP4'
  const sourceServer = vs.server ?? server
  const mappedSubtitles = (vs.subtitles ?? []).map((s) => {
    const raw = s.language ?? s.lang ?? s.label
    const kind = s.kind === 'captions' ? 'captions' as const : s.kind === 'subtitles' ? 'subtitles' as const : undefined
    return {
      url: s.url,
      lang: trackLang(raw),
      title: kind === 'captions' ? 'CC' : (isBcp47Locale(raw) ? undefined : subtitleTitle(raw)),
      isDefault: s.isDefault ?? s.default ?? false,
      headers: s.headers,
      kind,
      switchUrl: s.switchUrl,
    }
  })
  // Providers frequently return English.vtt without marking it default. `sub-add auto` happens
  // after loadfile and mpv does not revisit slang selection for that new external track, so it
  // appears in the menu but stays off. Select the preferred matching sidecar when the provider did
  // not choose one itself; "none" remains an explicit request for no subtitles.
  if (preferredSubtitle && preferredSubtitle !== 'none' && !mappedSubtitles.some((s) => s.isDefault)) {
    const preferred = normalizeLang(preferredSubtitle)
    const match = mappedSubtitles.find((s) => normalizeLang(s.lang) === preferred || s.lang === preferredSubtitle)
    if (match) match.isDefault = true
  }
  const party = vs.share
    ? videoSourceToStream(
        { ...vs.share, share: undefined }, server, headers, provider, epTitle, audio, originId,
        lang, langMismatch, preferredSubtitle, sourceTitle,
      )
    : undefined
  return {
    url: vs.url,
    // `⚡` marks it instant-cached (isCached) and the `· quality` token feeds resolutionOf's
    // badge. The picker's HEADING comes from __addonName, not this name — without it the row
    // rendered as a generic "Source" (name has no `[XX]` bracket for describe() to sniff).
    // The language badge is only present for a NON-preferred language, so a French or Italian
    // source is obvious before you play it instead of after the subtitles appear.
    // A provider with a single unnamed server reports it as "default" — printing that adds a token
    // that identifies nothing, so it is dropped and the row reads "⚡ Provider · 1080p".
    // The LANGUAGE is not encoded here: the picker renders `describe()`'s badges plus __addonName
    // and never shows `name`, which is why a language baked into this string was invisible.
    name: `⚡ ${provider}${sourceServer && sourceServer !== 'default' ? ` · ${sourceServer}` : ''} · ${quality}`,
    __stream: true,
    __hosted: vs.localServer || undefined,
    __manifest: kind === 'HLS' ? 'hls' : /dash|mpd/i.test(vs.type ?? '') ? 'dash' : undefined,
    __headers: vs.headers ?? headers,
    __audio: vs.audio ?? audio,
    __audioLang: vs.audioLang,
    __server: sourceServer && sourceServer !== 'default' ? sourceServer : undefined,
    __quality: quality,
    __subtitleMode: vs.subtitleMode,
    // Normalize the provider's subtitle shape: `language`/`lang`/`label` → lang, and carry
    // `isDefault` so the player auto-selects the intended track (both were being dropped).
    // `lang` is normalized to an ISO code because mpv's `slang` matches on codes — a raw provider
    // label like "wowmdildo {+Eternal Blizzard}" can never match, so the track loads but is never
    // auto-selected. The original label is kept as `title` for the track menu.
    __subtitles: mappedSubtitles,
    __audioTracks: (vs.audioTracks ?? []).map((track) => {
      const raw = track.language ?? track.lang ?? track.label
      return {
        url: track.url,
        lang: trackLang(raw),
        title: isBcp47Locale(raw) ? undefined : (track.title ?? track.label ?? subtitleTitle(raw)),
        headers: track.headers,
        switchUrl: track.switchUrl,
      }
    }),
    __lang: lang,
    __langMismatch: langMismatch,
    __addonName: provider,
    __sourceTitle: sourceTitle?.trim() || undefined,
    __origin: originId ? { kind: 'online-extension', id: originId, name: provider } : undefined,
    __drm: parseStreamDrm(vs.drm),
    __previewUrl: vs.previewUrl,
    __party: party ? {
      url: party.url,
      __headers: party.__headers,
      __drm: party.__drm,
      __subtitles: party.__subtitles,
      __audioTracks: party.__audioTracks,
      __previewUrl: party.__previewUrl,
      __audioLang: party.__audioLang,
    } : undefined,
    behaviorHints: { filename: epTitle?.trim() || `Direct ${kind}${sourceServer ? ` · ${sourceServer}` : ''}` },
  }
}

/** Resolve direct (non-debrid) streaming sources for an episode from every configured
 *  onlinestream-provider extension, in parallel. Best-effort: [] when none configured / all fail.
 *  Episode only (these providers are episode-indexed).
 *
 *  `onBatch` (optional) fires with each extension's rows AS IT SETTLES, matching the torrent wave
 *  (`queryExtensions`). Without it the whole wave was gated on the SLOWEST provider — and a wedged
 *  one costs the full 20s cap — so a provider that answered in 200ms still showed nothing until
 *  every other one had finished. */
export async function resolveOnlineStreams(
  media: Media, episode: number | undefined, onlyId?: string, onBatch?: (rs: Stream[]) => void,
  signal?: AbortSignal,
): Promise<Stream[]> {
  if (episode == null) return []
  const trace = currentResolveTrace(media.id, episode)
  // Superseded resolve (user already picked a source): issue NO hops — every scrape below spawns
  // worker HTTP that competes with the picked source's playback path. Checked again before each
  // hop tier, so an abort mid-wave stops the chain at the next boundary.
  if (signal?.aborted) return []
  providerProblems.set([])
  const unordered = await runningStreamExtensions(onlyId)
  if (!unordered.length) return []
  // A typical catalog is HALF non-English (Italian, German, French, Indonesian, …). Results are
  // emitted in extension order, and the picker's auto-select countdown takes the first row — so
  // without this a French provider silently wins the race and the episode plays with French subs.
  // Sort only; nothing is dropped, since a foreign provider is often the sole source for a show.
  // `sort` is stable, so providers within a rank keep their configured order.
  const subLang = get(preferredSubLang)
  const prefLang = subLang === 'none' ? 'eng' : subLang
  // Drop providers whose language the user doesn't want BEFORE any query — a skipped provider
  // costs nothing, so this is the cheapest speed control as well as a relevance one.
  const allowedLangs = get(providerLanguages)
  const exts = [...unordered]
    .filter((e) => allowedByLanguage(e.lang, allowedLangs))
    .sort((a, b) => langRank(a.lang, prefLang) - langRank(b.lang, prefLang))
  if (!exts.length) return []
  traceResolve(trace, 'online providers ready', {
    configured: unordered.length,
    queried: exts.map((extension) => extension.name),
    skippedByLanguage: unordered.length - exts.length,
  })
  const titles = [title(media), media.title.romaji, media.title.english, ...(media.synonyms ?? [])]
    .filter((t): t is string => !!t && t.length > 1)
  const queries = searchQueries(titles)
  // Providers commonly disambiguate remakes with a year and append the production type even when
  // AniList's title does not ("Fruits Basket (2019)", "Title OVA"). Treat those as known aliases,
  // while still rejecting a DIFFERENT year/type through searchTitleScore's asymmetric markers.
  const formatMarker = ({ MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special' } as Record<string, string>)[media.format ?? '']
  const identityTitles = titles.flatMap((knownTitle) => {
    const variants = [knownTitle]
    if (media.seasonYear) variants.push(`${knownTitle} ${media.seasonYear}`)
    if (formatMarker) variants.push(`${knownTitle} ${formatMarker}`)
    if (media.seasonYear && formatMarker) variants.push(`${knownTitle} ${formatMarker} ${media.seasonYear}`)
    return variants
  })
  const preferDub = get(preferredAudioLang) === 'eng'
  // Search + resolve the requested episode for one sub/dub pass. null = no match this pass.
  // Both hops are memoized: neither the search nor the episode list depends on WHICH episode was
  // asked for, so re-running them per episode was pure waste — the dominant cost of opening the
  // picker on episode 2 of a binge.
  // Record once per provider: the first failure is the informative one, and a provider whose every
  // server fails would otherwise repeat the same line for each.
  const noteProblem = (ext: { id: string; name: string }, error: unknown) => {
    // An aborted bridged fetch is the resolve being superseded, not the provider misbehaving.
    if ((error as Error)?.name === 'AbortError') return
    const message = providerProblemText(error)
    if (!message) return
    providerProblems.update((all) =>
      all.some((p) => p.provider === ext.name) ? all : [...all, { provider: ext.name, message }])
  }
  const findEp = async (
    ext: (typeof exts)[number],
    dub: boolean,
  ): Promise<{ episode: SnEpisode; matchedTitle: string } | null> => {
    // Failure cooldown: memo deliberately does NOT cache a null (timed-out/errored) search, so a
    // dead provider used to re-pay its full serial alias sweep — each query up to the 20s cap — on
    // EVERY episode transition. A provider whose searches all failed for this title sits out for a
    // while instead; a provider that merely doesn't CARRY the title is unaffected (empty arrays
    // memo-cache normally).
    const failKey = `${ext.id}|${media.id}`
    const failedAt = searchFailures.get(failKey)
    if (failedAt && Date.now() - failedAt < SEARCH_FAILURE_COOLDOWN_MS) return null
    let best: SnSearchResult | undefined
    let sawFailure = false
    let sawAnswer = false
    // Most providers match the primary title, so this is still one request in the normal case.
    // Only a failed/weak match falls back through the media's romaji, English and synonym titles.
    // The sweep is capped: aliases are ordered closest-to-canonical first, and a provider that
    // matched none of the first few will not match the tenth — while a dead provider would burn
    // its 20s timeout PER alias, serially.
    for (const query of queries.slice(0, MAX_SEARCH_ALIASES)) {
      if (signal?.aborted) return null
      const searchStartedAt = performance.now()
      traceResolve(trace, 'online provider search start', {
        provider: ext.name, audio: dub ? 'dub' : 'sub', aliasAttempt: queries.indexOf(query) + 1,
      })
      const results = await memo(
        `search|${ext.id}|${dub}|${JSON.stringify(query)}|${media.seasonYear ?? ''}`,
        () => ext.call('search', { query, dub, year: media.seasonYear ?? undefined })
          .catch((error: unknown) => { noteProblem(ext, error); return null }),
        cacheableList,
      ) as SnSearchResult[] | null
      traceResolve(trace, 'online provider search finish', {
        provider: ext.name,
        audio: dub ? 'dub' : 'sub',
        durationMs: Math.round(performance.now() - searchStartedAt),
        answers: results?.length ?? 0,
        failed: results === null,
      })
      if (results === null) sawFailure = true
      else sawAnswer = true
      best = pickSearchResult(results ?? [], identityTitles)
      if (best) break
    }
    if (!best) {
      // An abort mid-sweep makes the "every search failed" signal a lie — the provider was cut
      // off, not dead — and would mute it for the whole cooldown on the next picker open.
      if (sawFailure && !sawAnswer && !signal?.aborted) noteSearchFailure(failKey)
      return null
    }
    searchFailures.delete(failKey)
    const episodesStartedAt = performance.now()
    traceResolve(trace, 'online provider episode list start', { provider: ext.name })
    const eps = await memo(
      `episodes|${ext.id}|${best.id}`,
      // Where a login-gated source fails: the detail page is what fetches the episode list, so this
      // is the catch that carries "please log in to google drive through webview".
      () => ext.call('findEpisodes', best.id).catch((error: unknown) => { noteProblem(ext, error); return null }),
      cacheableList,
    ) as SnEpisode[] | null
    traceResolve(trace, 'online provider episode list finish', {
      provider: ext.name,
      durationMs: Math.round(performance.now() - episodesStartedAt),
      episodes: eps?.length ?? 0,
      failed: eps === null,
    })
    const matchedEpisode = pickEpisode(eps ?? [], episode)
    if (!matchedEpisode) return null
    // JVM detail pages expose their canonical title. Validate that too: a fuzzy search result can
    // redirect, and resolving video after that redirect would bind the right episode NUMBER to the
    // wrong production.
    const matchedTitle = matchedEpisode.sourceTitle?.trim() || best.title?.trim()
    if (!matchedTitle || searchTitleScore(matchedTitle, identityTitles) === 0) return null
    return { episode: matchedEpisode, matchedTitle }
  }
  const per = await Promise.all(exts.map(async (ext): Promise<Stream[]> => {
    if (signal?.aborted) return []
    const providerStartedAt = performance.now()
    traceResolve(trace, 'online provider start', { provider: ext.name, language: ext.lang })
    try {
      // Settings first: `supportsDub` decides whether a dub pass is worth running at all, so a
      // sub-only provider is never queried twice. Memoized because it never varies per episode and
      // was costing a serial worker round-trip before any network request could start.
      const settings = await memo(
        `settings|${ext.id}`,
        () => ext.call('getSettings').catch(() => null),
        (v) => v != null,
      ) as SnSettings | null
      traceResolve(trace, 'online provider settings ready', {
        provider: ext.name,
        servers: settings?.episodeServers?.length ?? 1,
        supportsDub: settings?.supportsDub,
        mixedAudio: settings?.returnsMixedAudio,
      })
      const servers = settings?.episodeServers?.length ? settings.episodeServers : ['default']
      // One audio flavour: search with the dub flag, resolve the episode, fan out over servers.
      const resolvePass = async (dub: boolean): Promise<Stream[]> => {
      if (signal?.aborted) return []
      const match = await findEp(ext, dub)
      if (!match) return []
      const { episode: ep, matchedTitle } = match
      const audio: 'sub' | 'dub' = dub ? 'dub' : 'sub'
      // Aggregate EVERY server that returns sources (not first-server-wins) so the picker shows
      // all alternatives + a working fallback when one server's stream is dead. Dedupe by url.
      const out: Stream[] = []
      // The modal header names the requested anime. The row names the title the provider actually
      // matched, so a bad source can never masquerade as the requested show.
      const epLabel = providerEpisodeLabel(matchedTitle, episode, ep.title)
      // Servers were scraped one at a time, so this wave cost the SUM of every server's round-trip
      // — and it gates `resolving`, which gates the picker's auto-select countdown, so it delays
      // first frame for anyone with autoplay on. Run them with a small concurrency cap: bounded
      // because some embed hosts throttle parallel requests from one IP, and an unbounded fan-out
      // is a plausible rate-limit trigger. Results are collected in the original server order.
      const CONCURRENCY = 3
      const found: (SnEpisodeServer | null)[] = new Array(servers.length).fill(null)
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, servers.length) }, async () => {
        for (;;) {
          const idx = cursor++
          if (signal?.aborted || idx >= servers.length) return
          const serverStartedAt = performance.now()
          traceResolve(trace, 'online provider server start', {
            provider: ext.name, server: servers[idx], audio,
          })
          found[idx] = (await ext.call('findEpisodeServer', ep, servers[idx])
            .catch((error: unknown) => { noteProblem(ext, error); return null })) as SnEpisodeServer | null
          traceResolve(trace, 'online provider server finish', {
            provider: ext.name,
            server: servers[idx],
            audio,
            durationMs: Math.round(performance.now() - serverStartedAt),
            videoSources: found[idx]?.videoSources?.length ?? 0,
          })
        }
      }))
      for (const [idx, es] of found.entries()) {
        if (es?.videoSources?.length) {
          for (const vs of es.videoSources) out.push(videoSourceToStream(
            vs,
            es.server ?? servers[idx],
            es.headers ?? {},
            ext.name,
            epLabel,
            audio,
            ext.id,
            ext.lang,
            !matchesPreferredLang(ext.lang, prefLang) && !!ext.lang,
            subLang,
            matchedTitle,
          ))
        }
      }
        return out
      }
      // Run the audio flavours concurrently rather than dub-then-fallback, so a title that has BOTH
      // offers both instead of hiding one behind a global setting.
      const audioFilter = get(providerAudio)
      // Aniyomi getVideoList is already a mixed server/sub/dub response. One pass is enough; the
      // per-video title supplies the real audio flavour below, avoiding two identical expensive
      // extractor calls and two localhost proxy instances racing each other.
      const passes = settings?.returnsMixedAudio
        ? [false]
        : passesForAudio(dubPasses(settings?.supportsDub, preferDub), audioFilter)
      if (!passes.length) {
        traceResolve(trace, 'online provider skipped by audio filter', { provider: ext.name })
        return []
      }
      if (signal?.aborted) return []
      const results = await Promise.all(passes.map(resolvePass))
      // Dedupe across passes in pass order (preferred audio first). A provider that ignores the dub
      // flag returns the same URL for both passes; without this it would appear twice, once
      // mislabelled.
      const seen = new Set<string>()
      const rows: Stream[] = []
      for (const set of results) {
        for (const s of set) {
          if (!s.url || seen.has(s.url)) continue
          if (settings?.returnsMixedAudio && audioFilter !== 'both' && s.__audio !== audioFilter) continue
          seen.add(s.url)
          rows.push(s)
        }
      }
      // Hand this provider's rows over the moment they exist, rather than holding them until every
      // other provider has finished.
      if (onBatch && rows.length) onBatch(rows)
      traceResolve(trace, 'online provider finish', {
        provider: ext.name,
        durationMs: Math.round(performance.now() - providerStartedAt),
        rows: rows.length,
      })
      return rows
    }
    catch (error) {
      noteProblem(ext, error)
      traceResolveError(trace, 'online provider failed', error, {
        provider: ext.name,
        durationMs: Math.round(performance.now() - providerStartedAt),
      })
      return []
    }
  }))
  return per.flat()
}
