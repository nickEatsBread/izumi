import type { Stream } from './parse'
import { titleTokens } from './relevance'
import { get } from 'svelte/store'
import type { Media } from '$lib/anilist/types'
import { title } from '$lib/anilist/media'
import { preferredAudioLang, preferredSubLang, providerLanguages, providerAudio } from '$lib/settings/ui'
import { runningStreamExtensions } from '$lib/extensions/manager'
import { normalizeLang, subtitleTitle } from './sublang'
import { memo, cacheableList } from './online-cache'

// onlinestream-provider extension SDK shapes. Fields we consume.
export interface SnSearchResult { id: string; title: string; url?: string; subOrDub?: string }
export interface SnEpisode { id: string; number: number; url?: string; title?: string }
// Seanime VideoSubtitle is {url, language, isDefault}; providers vary (some emit `lang`/`label`/
// `default`), so accept them all and normalize in videoSourceToStream.
// `headers` mirrors the reference's SubtitleFile.headers: some sidecar subtitle URLs are gated on
// Referer exactly like the video is, and a subtitle fetched without them silently 403s.
export interface SnVideoSubtitle { url: string; language?: string; lang?: string; label?: string; isDefault?: boolean; default?: boolean; headers?: Record<string, string> }
export interface SnAudioTrack { url: string; language?: string; lang?: string; label?: string; title?: string; headers?: Record<string, string> }
export interface SnVideoSource {
  url: string
  type?: string
  quality?: string
  subtitles?: SnVideoSubtitle[]
  audioTracks?: SnAudioTrack[]
  /** A source can override its server's headers. An explicit empty object is meaningful:
   * some CDNs reject the embed Referer even though the sibling HLS source requires it. */
  headers?: Record<string, string>
}
export interface SnEpisodeServer { server?: string; headers?: Record<string, string>; videoSources?: SnVideoSource[] }
export interface SnSettings { episodeServers?: string[]; supportsDub?: boolean }

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

/** Pick the search result whose title best overlaps the media's known titles (token
 *  intersection). Returns undefined if nothing overlaps (never guess a wrong show). */
export function pickSearchResult(results: SnSearchResult[], titles: string[]): SnSearchResult | undefined {
  const wanted = new Set(titles.flatMap((t) => titleTokens(t)))
  if (!wanted.size) return undefined
  let best: SnSearchResult | undefined
  let bestScore = 0
  for (const r of results) {
    const toks = titleTokens(r.title ?? '')
    const score = toks.filter((t) => wanted.has(t)).length
    if (score > bestScore) { bestScore = score; best = r }
  }
  return bestScore > 0 ? best : undefined
}

/** Find the episode entry whose number equals the requested episode. */
export function pickEpisode(eps: SnEpisode[], episode: number): SnEpisode | undefined {
  return eps.find((e) => e.number === episode)
}

/** Map one VideoSource (+ its server headers) to a direct streaming Stream. */
export function videoSourceToStream(
  vs: SnVideoSource, server: string, headers: Record<string, string>, provider: string,
  epTitle?: string, audio?: 'sub' | 'dub', originId?: string, lang?: string, langMismatch?: boolean,
): Stream {
  const quality = vs.quality || 'auto'
  const kind = /m3u8|hls/i.test(vs.type ?? '') ? 'HLS' : 'MP4'
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
    name: `⚡ ${provider}${server && server !== 'default' ? ` · ${server}` : ''} · ${quality}`,
    __stream: true,
    __headers: vs.headers ?? headers,
    __audio: audio,
    // Normalize the provider's subtitle shape: `language`/`lang`/`label` → lang, and carry
    // `isDefault` so the player auto-selects the intended track (both were being dropped).
    // `lang` is normalized to an ISO code because mpv's `slang` matches on codes — a raw provider
    // label like "wowmdildo {+Eternal Blizzard}" can never match, so the track loads but is never
    // auto-selected. The original label is kept as `title` for the track menu.
    __subtitles: (vs.subtitles ?? []).map((s) => {
      const raw = s.language ?? s.lang ?? s.label
      return {
        url: s.url,
        lang: normalizeLang(raw),
        title: subtitleTitle(raw),
        isDefault: s.isDefault ?? s.default ?? false,
        headers: s.headers,
      }
    }),
    __audioTracks: (vs.audioTracks ?? []).map((track) => {
      const raw = track.language ?? track.lang ?? track.label
      return {
        url: track.url,
        lang: normalizeLang(raw),
        title: track.title ?? track.label ?? subtitleTitle(raw),
        headers: track.headers,
      }
    }),
    __lang: lang,
    __langMismatch: langMismatch,
    __addonName: provider,
    __origin: originId ? { kind: 'online-extension', id: originId, name: provider } : undefined,
    behaviorHints: { filename: epTitle?.trim() || `Direct ${kind}${server ? ` · ${server}` : ''}` },
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
): Promise<Stream[]> {
  if (episode == null) return []
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
  const titles = [title(media), media.title.romaji, media.title.english, ...(media.synonyms ?? [])]
    .filter((t): t is string => !!t && t.length > 1)
  const preferDub = get(preferredAudioLang) === 'eng'
  // Search + resolve the requested episode for one sub/dub pass. null = no match this pass.
  // Both hops are memoized: neither the search nor the episode list depends on WHICH episode was
  // asked for, so re-running them per episode was pure waste — the dominant cost of opening the
  // picker on episode 2 of a binge.
  const findEp = async (ext: (typeof exts)[number], dub: boolean): Promise<SnEpisode | null> => {
    const results = await memo(
      `search|${ext.id}|${dub}|${titles[0]}|${media.seasonYear ?? ''}`,
      () => ext.call('search', { query: titles[0], dub, year: media.seasonYear ?? undefined }).catch(() => null),
      cacheableList,
    ) as SnSearchResult[] | null
    const best = pickSearchResult(results ?? [], titles)
    if (!best) return null
    const eps = await memo(
      `episodes|${ext.id}|${best.id}`,
      () => ext.call('findEpisodes', best.id).catch(() => null),
      cacheableList,
    ) as SnEpisode[] | null
    return pickEpisode(eps ?? [], episode) ?? null
  }
  const per = await Promise.all(exts.map(async (ext): Promise<Stream[]> => {
    try {
      // Settings first: `supportsDub` decides whether a dub pass is worth running at all, so a
      // sub-only provider is never queried twice. Memoized because it never varies per episode and
      // was costing a serial worker round-trip before any network request could start.
      const settings = await memo(
        `settings|${ext.id}`,
        () => ext.call('getSettings').catch(() => null),
        (v) => v != null,
      ) as SnSettings | null
      const servers = settings?.episodeServers?.length ? settings.episodeServers : ['default']
      // One audio flavour: search with the dub flag, resolve the episode, fan out over servers.
      const resolvePass = async (dub: boolean): Promise<Stream[]> => {
      const ep = await findEp(ext, dub)
      if (!ep) return []
      const audio: 'sub' | 'dub' = dub ? 'dub' : 'sub'
      // Aggregate EVERY server that returns sources (not first-server-wins) so the picker shows
      // all alternatives + a working fallback when one server's stream is dead. Dedupe by url.
      const out: Stream[] = []
      // Give the row a real label — anime title + episode (+ the provider's episode title when it's
      // more than a bare "Episode N") — instead of the provider's generic "Episode 01", so the
      // onlinestream row reads like the torrent rows do.
      const epName = ep.title?.trim()
      const hasRealTitle = !!epName && epName !== `Episode ${episode}` && epName !== String(episode)
      const epLabel = `${title(media)} — Episode ${episode}${hasRealTitle ? ` · ${epName}` : ''}`
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
          if (idx >= servers.length) return
          found[idx] = (await ext.call('findEpisodeServer', ep, servers[idx]).catch(() => null)) as SnEpisodeServer | null
        }
      }))
      for (const [idx, es] of found.entries()) {
        if (es?.videoSources?.length) {
          for (const vs of es.videoSources) out.push(videoSourceToStream(vs, es.server ?? servers[idx], es.headers ?? {}, ext.name, epLabel, audio, ext.id, ext.lang, !matchesPreferredLang(ext.lang, prefLang) && !!ext.lang))
        }
      }
        return out
      }
      // Run the audio flavours concurrently rather than dub-then-fallback, so a title that has BOTH
      // offers both instead of hiding one behind a global setting.
      const passes = passesForAudio(dubPasses(settings?.supportsDub, preferDub), get(providerAudio))
      if (!passes.length) return []
      const results = await Promise.all(passes.map(resolvePass))
      // Dedupe across passes in pass order (preferred audio first). A provider that ignores the dub
      // flag returns the same URL for both passes; without this it would appear twice, once
      // mislabelled.
      const seen = new Set<string>()
      const rows: Stream[] = []
      for (const set of results) {
        for (const s of set) {
          if (!s.url || seen.has(s.url)) continue
          seen.add(s.url)
          rows.push(s)
        }
      }
      // Hand this provider's rows over the moment they exist, rather than holding them until every
      // other provider has finished.
      if (onBatch && rows.length) onBatch(rows)
      return rows
    }
    catch { return [] }
  }))
  return per.flat()
}
