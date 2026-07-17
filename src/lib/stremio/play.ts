import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { get } from 'svelte/store'
import { addonOriginId, enabledAddonUrls } from './sources'
import { getIndex, lookupKitsu } from './idmap'
import { getStreams, fetchAddonStreams, streamId, pickBest, rankStreams, parseSeasonEp, isWrongSeason, isUncached, isCached, describe, type Stream } from './addon'
import { relevant, likelyOtherProduction, isEpisodeExtra, isStandaloneMovie, wrongFranchiseSeason } from './relevance'
import { getKitsuId, getEpisodeSeasonMap, getExtensionIds } from '$lib/anizip'
import { kitsuIdFromMal } from './kitsu'
import { fetchMediaById } from '$lib/anilist/fetch-media'
import { downloadOf } from '$lib/downloads/state'
import { resolveHash, providerName } from './debrid'
import { resolveOnlineStreams } from './onlinestream'
import { fetchAddonSubtitles, type ExternalSubtitle } from './subtitles'
import { queryExtensions } from '$lib/extensions/manager'
import { queryTorrentProviders, toProviderMedia } from '$lib/extensions/torrentProvider'
import type { TorrentResult } from '$lib/extensions/types'
import { extToStream } from './ext-stream'
import { dedupeStreams, dedupeBy } from './dedupe'
import { markWatched } from '$lib/trackers'
import { savePosition, getPosition, clearPosition, watched } from '$lib/player/progress'
import { recordPlay, localHistory } from '$lib/player/history'
import { rememberSourceOrigin, sourceOrigins, type RememberedSource } from '$lib/player/source-origin'
import { playing, nowPlaying, streamPicker, playerNotice, spriteKey, bingeSource, nowPlayingMedia, debridCaching } from '$lib/player/session'
import {
  preferredAudioLang, preferredSubLang, autoSelectSource, preferredQuality, skipFiller,
  autoplayNext, enableExternalPlayer, externalPlayerPath, debridKey, debridProvider, enabledExtensionUrls, bingePreload,
  playerCacheMb, playerCacheBytes,
} from '$lib/settings/ui'
import { fillerEpisodes } from '$lib/anime/filler'
import { applyContinuationState } from './continuation'
import { title, cover } from '$lib/anilist/media'
import { isAndroid } from '$lib/platform'
import { playViaIntent } from '$lib/player/android-playback'
import { hasEmbeddedPlayer, mpvLoad, androidMpvActive, mpvState, startMpvEvents, androidStreamInfo } from '$lib/player/android-mpv'
import type { Media } from '$lib/anilist/types'

export type PlayState = { status: 'idle' | 'resolving' | 'playing' | 'error'; message?: string }

// Module-level listener handles from the *previous* play. We unlisten these
// before attaching new ones so repeated plays don't stack listeners (this is a
// plain module, not a component — no runes/lifecycle to lean on).
let stop: Array<() => void> = []

// The in-flight source resolve (playEpisode). A new play or an explicit picker close aborts it
// so a superseded resolve settles to idle AT ONCE — instead of blocking the next episode click
// (the caller's `resolving` flag stayed stuck) while its now-orphaned fetches finish. The fetches
// themselves are best-effort and left to complete in the background.
let resolveAbort: AbortController | null = null
/** Abort the in-flight source resolve — called when the picker is closed (X / click-off / Esc). */
export function cancelResolve() { resolveAbort?.abort(); resolveAbort = null }

// Wire the mpv event stream (emitted from Rust) to progress tracking, resume,
// and auto next-episode. Called once per play, after playback has started.
async function attach(media: Media, episode: number, onState: (s: PlayState) => void) {
  // Tear down any listeners from the previous play first.
  stop.forEach((f) => f())
  stop = []
  let marked = false
  let lastSave = 0
  let warmed = false
  stop.push(
    await listen<[number, number]>('player-progress', (e) => {
      const [pos, dur] = e.payload
      // Throttle position writes to ~once every 5s to avoid store churn.
      if (Date.now() - lastSave > 5000) {
        savePosition(media.id, episode, pos, dur)
        lastSave = Date.now()
      }
      // Once we cross the watch threshold, mark this episode on the tracker(s)
      // exactly once (guarded by `marked`). markWatched handles local history + the
      // only-increase / complete-on-finish guards.
      if (!marked && watched(pos, dur)) {
        marked = true
        markWatched(media, episode)
      }
      // Binge preload: pre-resolve the next episode in the last stretch so Next /
      // auto-advance starts instantly, then warm the debrid/CDN edge in the final
      // seconds (kept late + small so it can't starve the current episode's tail).
      if (get(bingePreload) && dur > 0) {
        if (pos / dur > 0.85) prefetchNext(media, episode)
        if (!warmed && dur - pos < 20 && prefetched?.mediaId === media.id && prefetched.episode === episode + 1 && prefetched.stream.url) {
          warmed = true
          invoke('player_prefetch', { url: prefetched.stream.url }).catch(() => {})
        }
      }
    }),
  )
  // Finalize on close: the position write is throttled to 5s and the watch-mark only fires on a
  // live progress event ≥ threshold — so skimming to the end and immediately backing out could
  // save neither. The player dispatches `player-finalize` with its last pos/dur on close; persist
  // the resume point + mark watched here (idempotent — recordProgress maxes, `marked` guards).
  const onFinalize = (ev: Event) => {
    const { pos, dur } = (ev as CustomEvent<{ pos: number; dur: number }>).detail ?? {}
    if (!dur || dur <= 0) return
    savePosition(media.id, episode, pos, dur)
    if (!marked && watched(pos, dur)) {
      marked = true
      markWatched(media, episode)
    }
  }
  window.addEventListener('player-finalize', onFinalize)
  stop.push(() => window.removeEventListener('player-finalize', onFinalize))
  stop.push(
    await listen('player-ended', async () => {
      // Finished: forget the resume point, then auto-advance if there's a next episode (bounded by
      // the known total). Fires when EITHER "Auto-play next" OR "Binge (preload)" is on — preload
      // warms the next episode near the end precisely so it continues automatically, so having it on
      // implies auto-advance. Advance continues the same release seamlessly, else opens the picker.
      clearPosition(media.id, episode)
      if (!get(autoplayNext) && !get(bingePreload)) return
      const airedTotal = media.nextAiringEpisode?.episode ? media.nextAiringEpisode.episode - 1 : (media.episodes ?? 0)
      let next = episode + 1
      // Optionally skip past filler episodes (AnimeFillerList).
      if (get(skipFiller)) {
        const filler = await fillerEpisodes(media.id)
        while (next <= airedTotal && filler.includes(next)) next++
      }
      if (next <= airedTotal) resolveAndPlayBest(media, next, onState)
    }),
  )
}

// Android embedded-player tracking: mirrors attach() but driven by the mpv plugin's observed-
// property stream (mpvState) instead of the desktop player-* events. No scrub-prefetch (that's a
// desktop-only command). Re-attaches per episode; the previous episode's subscription is torn down.
let stopAndroid: (() => void) | null = null
function attachAndroid(media: Media, episode: number, onState: (s: PlayState) => void) {
  stopAndroid?.()
  let marked = false
  let lastSave = 0
  let ended = false
  const onEnded = async () => {
    clearPosition(media.id, episode)
    if (!get(autoplayNext) && !get(bingePreload)) return
    const airedTotal = media.nextAiringEpisode?.episode ? media.nextAiringEpisode.episode - 1 : (media.episodes ?? 0)
    let next = episode + 1
    if (get(skipFiller)) {
      const filler = await fillerEpisodes(media.id)
      while (next <= airedTotal && filler.includes(next)) next++
    }
    if (next <= airedTotal) resolveAndPlayBest(media, next, onState)
  }
  // mpvState updates on every observed time-pos/duration/pause/eof — same cadence as the desktop
  // player-progress event, so the throttle + watch-threshold logic transfers directly.
  const unsub = mpvState.subscribe((s) => {
    const { pos, dur, eof } = s
    if (dur > 0 && Date.now() - lastSave > 5000) {
      savePosition(media.id, episode, pos, dur)
      lastSave = Date.now()
    }
    if (!marked && watched(pos, dur)) {
      marked = true
      markWatched(media, episode)
    }
    // Preload the next episode's stream near the end so auto-advance / Next starts instantly.
    if (get(bingePreload) && dur > 0 && pos / dur > 0.85) prefetchNext(media, episode)
    if (eof && !ended) { ended = true; onEnded() }
  })
  stopAndroid = unsub
}

/** Persist the resume point + mark-watched on manual close, then stop tracking. The throttled save
 *  can miss the last few seconds, so the AndroidPlayer calls this with its final pos/dur on close.
 *  Idempotent (savePosition maxes; markWatched has only-increase / complete-on-finish guards). */
export function finalizeAndroidWatch(pos: number, dur: number) {
  const np = get(nowPlaying)
  if (np.id != null && np.episode != null && dur > 0) {
    savePosition(np.id, np.episode, pos, dur)
    if (currentMedia && watched(pos, dur)) markWatched(currentMedia, np.episode)
  }
  stopAndroid?.()
  stopAndroid = null
}

// Enforce the season the user is on (hard-drop). Addons return
// cross-season files: Torrentio overflows TVDB seasons (kitsu:X:17 → S04E01), and
// Comet indexes S1 BluRay batches under a later season's kitsu id — so a S4E1
// request gets both correct S04E01 files AND wrong S01 batches, and a season-blind
// ranker can auto-play the wrong one. We DROP confident wrong-season files (parsed
// season/abs present and contradicting the ground truth), then float confident
// matches above unknown parses. Unknown parses are kept (never drop on
// uncertainty); if AniZip has no season/abs, `want` gates nothing.
function verifySeason(streams: Stream[], want: { season?: number; abs?: number }): Stream[] {
  const kept = streams.filter((s) => !isWrongSeason(s, want))
  if (!kept.length) return streams // safety net: never empty the list on over-eager parsing
  const good: Stream[] = [], unknown: Stream[] = []
  for (const s of kept) {
    const p = parseSeasonEp(s)
    const matches = (want.season != null && p.season === want.season) || (want.abs != null && p.abs === want.abs)
    ;(matches ? good : unknown).push(s)
  }
  return [...good, ...unknown]
}

// Collapse Torrentio's per-file batch explosion: any infoHash contributing 2+ file
// rows is a season/complete pack (a single-episode torrent yields exactly one row),
// so keep one row per packed hash. Fixes One Piece ep1 (a 458-file dub pack → 1).
// Runs BEFORE dedupeStreams (which keys url-first), so this infoHash pass is the first —
// and for same-hash extension duplicates the ONLY — place a live-seeded copy can win over a
// 0/unknown-seeder copy of the same torrent; dedupeBy carries that tiebreak. Batch packs are
// addon rows (not torrent-ext), so they collapse first-wins exactly as before.
function collapseBatches(streams: Stream[]): Stream[] {
  return dedupeBy(streams, (s) => s.infoHash ?? '')
}

// Resolve the streams for an episode (kitsu id map → addons, plus any enabled
// source extensions). Returns the ranked list (cached first; uncached shown +
// flagged, dead sunk) plus the cached count, with wrong-season files dropped.
// Throws a user-facing message on failure.
// Season/title refinement shared by addon + extension streams: collapse Torrentio's
// per-file batch explosion (One Piece dub pack = 458 rows → 1) and drop cross-title
// matches (a shared kitsu id can pull in an unrelated live-action). Sync/fast.
function refineStreams(media: Media, raw: Stream[]): Stream[] {
  const wantedTitles = [title(media), media.title.romaji, media.title.english].filter((t): t is string => !!t)
  const animeYear = media.startDate?.year ?? undefined
  // Long-running absolute-numbered anime (One Piece, Naruto, Conan…) ship as
  // "One Piece - 001", never scene "S01E01" — so any SxxExx file is a different
  // production (the live action / a remake). airedTotal covers ongoing shows whose
  // media.episodes is still null.
  const airedTotal = media.nextAiringEpisode?.episode ? media.nextAiringEpisode.episode - 1 : (media.episodes ?? 0)
  const absoluteNumbered = (media.episodes ?? airedTotal) > 60
  // A MULTI-EPISODE SERIES (not a movie/single-ep OVA): a standalone-movie file (no episode/batch
  // marker) is a different production sharing the id — e.g. the 1995 GitS film / GitS 2: Innocence
  // under the 2026 series. Drop those; keep every S01E01 + season pack. Not applied to movies.
  const isSeries = media.format !== 'MOVIE' && (media.episodes ?? airedTotal) > 1
  // Direct streams and id-VERIFIED extension results skip the release-NAME heuristics: a source
  // that matched this exact episode's production id (accuracy 'high') outranks any title parse —
  // e.g. a CJK-titled release carries zero romaji/english tokens and relevant() would drop it.
  const trusted = (s: Stream) => !!s.__stream || s.__accuracy === 'high'
  return dedupeStreams(
    collapseBatches(raw)
      .filter((s) => trusted(s) || relevant(s, wantedTitles))
      .filter((s) => trusted(s) || !likelyOtherProduction(s, animeYear, absoluteNumbered))
      .filter((s) => trusted(s) || !isEpisodeExtra(s))
      .filter((s) => trusted(s) || !isSeries || !isStandaloneMovie(s))
      // Same-franchise wrong season: base-entry request pulling in "… The Final Season" / "Season 2"
      // files a number-less season gate can't catch (Attack on Titan S1 → Final Season episodes).
      .filter((s) => trusted(s) || !wrongFranchiseSeason(s, wantedTitles)),
  )
}

// Resolve an episode's streams from the ADDONS ONLY — the fast, playable path.
// Extensions are queried separately (see extToStreams) and merged into the
// picker afterwards, because their results are uncached (never auto-play) and their
// worker-spawn + esm.sh + search latency must NOT sit on the click-to-play path.
// Returns the ranked list (cached first) + cached count + season target + kitsu id.
// Resolve the Kitsu id (addons index by it). Prefer the Fribb id list; fall back to
// AniZip's mapping, then Kitsu-from-MAL, when it misses (some titles aren't in Fribb).
async function resolveKitsu(media: Media): Promise<number | undefined> {
  const idx = await getIndex()
  let kitsu = lookupKitsu(idx, media.id)
  if (!kitsu) kitsu = await getKitsuId(media.id)
  if (!kitsu) kitsu = await kitsuIdFromMal(media.idMal)
  return kitsu
}

async function resolveStreams(media: Media, episode: number | undefined): Promise<{ streams: Stream[]; cachedCount: number; want?: { season?: number; abs?: number }; kitsu?: number }> {
  const bases = get(enabledAddonUrls)
  if (!bases.length) throw new Error('No sources configured — add an addon URL in Settings.')
  const kitsu = await resolveKitsu(media)
  // No Kitsu id ⇒ addons (which index by it) can't be queried. Auto-advance is cached-addon-only,
  // so return nothing and let the caller fall back to the manual picker (its title/id extension
  // search can still find a title that isn't in Kitsu).
  if (!kitsu) return { streams: [], cachedCount: 0 }

  // Fetch streams and the AniZip season map CONCURRENTLY (independent round-trips).
  const seasonP = episode != null ? getEpisodeSeasonMap(media.id) : Promise.resolve({} as Record<number, { season?: number; abs?: number }>)
  const { streams: addonStreams, total, cachedCount } = await getStreams(bases, streamId(kitsu, episode), media.format === 'MOVIE' ? 'movie' : 'series')

  let streams = refineStreams(media, addonStreams)

  // Season enforcement: pair the requested episode with its AniZip season/absolute
  // number, then hard-drop returned files that contradict it. `want` is threaded to
  // pickBest so auto-select can't re-promote a wrong-season file either.
  let want: { season?: number; abs?: number } | undefined
  if (episode != null) {
    const w = (await seasonP)[episode]
    if (w && (w.season != null || w.abs != null)) { want = w; streams = verifySeason(streams, want) }
  }

  // Only hard-fail when there's nothing playable AND no extensions to fall back on;
  // otherwise let the picker fill from extensions asynchronously.
  if (!streams.length && !get(enabledExtensionUrls).length) {
    throw new Error(total > 0
      ? `Found ${total} torrents but none are usable (all dead or notice entries). Try another source.`
      : 'No streams found for this title/episode yet.')
  }
  return { streams, cachedCount, want, kitsu }
}

// Query source extensions for an episode → raw `Stream[]` (extToStream-mapped, NOT
// yet refined — the caller's refine pass dedupes/season-verifies them together with
// the addon streams). Best-effort: [] on failure/none. Results stream through `onBatch`
// PER SOURCE as each settles — one slow/wedged source no longer holds back the rest.
async function extToStreams(
  media: Media,
  episode: number | undefined,
  kitsu: number | undefined,
  onBatch: (s: Stream[]) => void,
  onlyOriginId?: string,
): Promise<void> {
  try {
    // Resolve the production-specific AniZip ids (AniDB/TVDB + absolute episode) so ID-based
    // extensions (those keyed by AniDB) hit the RIGHT title + a freshly-aired episode. Cached
    // with the season map, so no extra round-trip. Titles include synonyms for string-search
    // providers. This is what lets extensions resolve new/ambiguous anime the kitsu:id:ep addon
    // path misses.
    const ids = await getExtensionIds(media.id, episode)
    // Titles handed to extensions, shaped for how their search runtimes consume them:
    // - ( ) " | are boolean operators on nyaa-style engines, and the extension runtime joins our
    //   titles into (a)|(b) groups VERBATIM — one parenthesized synonym ("… (Seikatsu Nouryoku
    //   Kaimu) …") silently zeroes the whole search, clean groups included. Strip those chars;
    //   release names tokenize identically without them.
    // - Long light-novel titles carry a subtitle tail ("Saijo no Osewa: Takane no …") that release
    //   groups drop; the seeded files use just the short prefix, which AniList synonyms don't
    //   include. Append the before-separator prefix as an extra variant.
    // Sanitized originals stay FIRST — providers that resolve media by trying titles in order
    // (capped at a few attempts) should spend them on the closest-to-canonical forms.
    const sanitize = (t: string) => t.replace(/[()"|]/g, ' ').replace(/\s+/g, ' ').trim()
    const base = [title(media), media.title.romaji, media.title.english, ...(media.synonyms ?? [])]
      .filter((t): t is string => !!t && t.length > 3)
    const shortVariants = base.map((t) => t.split(/[:~]/, 1)[0].trim())
    const titles = [...new Set([...base.map(sanitize), ...shortVariants.map(sanitize)])]
      .filter((t) => t.length > 3)
    const query = {
      anilistId: media.id, malId: media.idMal ?? undefined, kitsuId: kitsu,
      // Field names are the extension-SDK contract — sources destructure tvdbAid/tvdbEid/mvdbAid/
      // imdbAid/absoluteEpisode VERBATIM. Sending our internal names (tvdbId/tvdbEId/tmdbId/imdbId/
      // absoluteEpisodeNumber) starved every TVDB-keyed provider into a silent [] (it resolved the
      // media by title similarity, then bailed at its episode gate with all ids undefined).
      anidbAid: ids.anidbAid, anidbEid: ids.anidbEid, tvdbAid: ids.tvdbId, tvdbEid: ids.tvdbEId,
      mvdbAid: ids.tmdbId, imdbAid: ids.imdbId, season: ids.season,
      // Same fallback the reference runtime uses: absolute when mapped, else the per-season number.
      absoluteEpisode: ids.absoluteEpisodeNumber ?? ids.episodeNumber,
      titles,
      // Full media + raw AniZip objects are part of the SDK's TorrentQuery — sources may read
      // production fields we don't distill into ids.
      media, mappingsA: ids.mappingsA, mappingsE: ids.mappingsE,
      // Airing shows often have episodes=null on AniList; derive the aired count like the
      // reference runtime so sources' "is this episodic" gates still work mid-season.
      episode,
      episodeCount: media.episodes
        ?? (media.nextAiringEpisode?.episode ? media.nextAiringEpisode.episode - 1 : undefined),
      // Quality is a PREFERENCE, not a source-side filter: the SDK's `resolution` makes sources
      // hard-EXCLUDE every other tier, so a 4K preference returned zero results for 1080p-only
      // shows (i.e. nearly all anime — the reference client sidesteps this by not offering a 4K
      // tier at all). Query unfiltered; pickBest/ranking target the preferred tier and fall back
      // to the best available, same as the addon path always has.
      resolution: undefined,
      // libmpv decodes everything we throw at it, so no codec-capability exclusions (the SDK field
      // exists for platforms that can't play HEVC/AC3/etc).
      exclusions: [],
      isAndroid: get(isAndroid),
    }
    // Both extension flavours resolve to TorrentResult and share the RD resolve path: the legacy
    // torrent extensions (single/batch/movie) plus the anime-torrent-provider extensions
    // (search/smartSearch). Query both concurrently; each source's batch folds in as it lands.
    const fold = (rs: TorrentResult[]) => onBatch(rs.map((r) => extToStream(r, r.provider ?? 'Extension')))
    await Promise.all([
      queryExtensions(query, fold, onlyOriginId),
      queryTorrentProviders(query, toProviderMedia(media), fold, onlyOriginId),
    ])
  } catch { /* best-effort: failed sources contributed nothing */ }
}

// Release-continuity across episodes. A stream continues the last-played release when it
// shares the Stremio bingeGroup, the exact pack infoHash, OR the parsed release group
// (fansub author) — the group match is what continues extension/fansub content, which
// carries no bingeGroup. `describe(s).group` is the same parse the picker heading uses.
export interface ContinueHint { bingeGroup?: string; infoHash?: string; group?: string }
function matchesRelease(s: Stream, c: ContinueHint): boolean {
  return !!(
    (c.bingeGroup && s.behaviorHints?.bingeGroup === c.bingeGroup)
    || (c.infoHash && s.infoHash === c.infoHash)
    || (c.group && describe(s).group?.toLowerCase() === c.group.toLowerCase())
  )
}
// The continuity hint for the NEXT episode of `media`: the release identity of what's
// playing now. undefined when continuity is off, nothing is playing, or it's a different
// title — the caller then just opens the picker normally.
function continueHint(media: Media): ContinueHint | undefined {
  if (!get(bingePreload)) return undefined
  const b = get(bingeSource)
  if (!b || b.mediaId !== media.id || !(b.bingeGroup || b.infoHash || b.group)) return undefined
  return { bingeGroup: b.bingeGroup, infoHash: b.infoHash, group: b.group }
}
// A stream mpv can start without a multi-minute debrid cache: a direct online stream, an
// already-resolved url, or a debrid-cached torrent (⚡ — resolves in ~1s).
const playableNow = (s: Stream) => !!(s.__stream || s.url || isCached(s))
// The SAME-release source for this episode, ready-to-play only (never a debrid download or
// a wrong-season file). undefined when continuity is off or nothing matches — the caller
// then opens the picker instead of auto-playing an unrelated best-quality file.
function pickSameRelease(media: Media, streams: Stream[], want?: { season?: number; abs?: number }): Stream | undefined {
  const c = continueHint(media)
  if (!c) return undefined
  return streams.find((s) => matchesRelease(s, c) && playableNow(s) && !isUncached(s) && !(want && isWrongSeason(s, want)))
}

// Next episode resolved ahead of time (near the end of the current one) so Next /
// auto-advance starts instantly — no addon query or debrid round-trip at the cut.
let prefetched: { mediaId: number; episode: number; stream: Stream } | null = null
let prefetching = false

/** Resolve the next episode's (cached, same-release-preferred) stream in the
 *  background so the transition is instant. Best-effort; cached-only (never
 *  proactively starts a debrid download). */
async function prefetchNext(media: Media, episode: number) {
  if (!get(bingePreload)) return
  const airedTotal = media.nextAiringEpisode?.episode ? media.nextAiringEpisode.episode - 1 : (media.episodes ?? 0)
  const next = episode + 1
  if (next > airedTotal || prefetching) return
  if (prefetched?.mediaId === media.id && prefetched.episode === next) return
  prefetching = true
  try {
    const { streams, want } = await resolveStreams(media, next)
    const best = pickSameRelease(media, streams, want)
    if (!best) return // no cached same-release — leave it to the picker rather than force a download
    let s = best
    if (!s.url && s.infoHash) {
      s = { ...s, url: await resolveHash(get(debridProvider), get(debridKey), s.__magnet ?? s.infoHash) }
    }
    if (s.url) prefetched = { mediaId: media.id, episode: next, stream: s }
  }
  catch { /* best-effort — the normal resolve runs at play time */ }
  finally { prefetching = false }
}

/** Consume a matching prefetched stream, if one is ready for this exact episode. */
function takePrefetched(mediaId: number, episode: number): Stream | null {
  const pf = prefetched
  if (pf && pf.mediaId === mediaId && pf.episode === episode && pf.stream.url) { prefetched = null; return pf.stream }
  return null
}

// User-initiated play: resolve, then show the source picker. The user picks a source and
// `playStream` starts it. `cont` (set by auto-advance) carries the previous episode's
// release identity: as sources fold in, a same-release one auto-continues without the user
// touching the picker — a ready one instantly, an uncached one after the list settles.
export async function playEpisode(media: Media, episode: number | undefined, onState: (s: PlayState) => void, cont?: ContinueHint) {
  // Supersede any resolve still running from a previous click (its fetches keep going in the
  // background, but this one owns the picker now). `signal` also lets an explicit close abort us.
  // Done FIRST so even an offline/instant play cancels a stale resolve that's still holding a picker.
  resolveAbort?.abort()
  const abort = new AbortController()
  resolveAbort = abort
  const { signal } = abort
  // Offline first: a completed local download plays instantly — no resolve, no
  // picker. libmpv opens an absolute local path exactly like a remote URL.
  const local = episode != null ? downloadOf(media.id, episode) : undefined
  if (local?.status === 'done' && local.path) {
    return await playStream(media, episode, { url: local.path, name: '📥 Downloaded' } as Stream, onState)
  }
  onState({ status: 'resolving' })
  // Open the picker immediately in a skeleton (resolving) state — no "Resolving
  // stream…" text; it fills in with real sources as EACH addon responds.
  streamPicker.set({ media, episode, streams: [], cachedCount: 0, resolving: true })
  const stillCurrent = () => {
    const current = get(streamPicker)
    return !!current && current.media.id === media.id && current.episode === episode
  }
  const showPickerError = (message: string) => {
    if (stillCurrent()) {
      streamPicker.update((current) => current ? {
        ...current,
        resolving: false,
        playbackError: message,
      } : current)
    }
    onState({ status: 'error', message })
  }
  try {
    // Instant path: this episode was prefetched near the end of the previous one
    // (binge continuity) — skip the picker entirely.
    if (get(autoSelectSource) && episode != null) {
      const pre = takePrefetched(media.id, episode)
      if (pre) { streamPicker.set(null); return await playStream(media, episode, pre, onState) }
    }

    const bases = get(enabledAddonUrls)
    const hasExt = get(enabledExtensionUrls).length > 0
    if (!bases.length && !hasExt) throw new Error('No sources configured — add an addon URL in Settings.')
    const kitsu = await resolveKitsu(media)
    // Addons index by Kitsu id; extensions search by title/MAL/AniDB. A title with no Kitsu id
    // (e.g. an OVA that isn't in Kitsu) can still be sourced by extensions, so only hard-fail when
    // there's no Kitsu id AND no extension to fall back on. When kitsu is missing we skip the addon
    // queries entirely and let the extension wave do the sourcing.
    if (!kitsu && !hasExt) throw new Error('No addon mapping for this title (not in Kitsu). Add a source extension to find it by title.')

    const type = media.format === 'MOVIE' ? 'movie' : 'series'
    const seasonP = episode != null ? getEpisodeSeasonMap(media.id) : Promise.resolve({} as Record<number, { season?: number; abs?: number }>)

    // Fold each addon's streams into the picker AS IT RESPONDS (one
    // origin loads, the rest stream in, the list re-ranks + animated-sorts live)
    // rather than waiting on the slowest. `want` (season) applies as soon as AniZip
    // answers, concurrent with the addon fetches.
    let acc: Stream[] = []
    let want: { season?: number; abs?: number } | undefined
    let totalRaw = 0
    // A remembered release may be tried automatically, but a matching source is not proof that
    // playback can actually start (the URL/debrid entry/player can still fail). Keep the picker
    // mounted until playStream reports `playing`; on failure it remains available as the fallback.
    let continuationAttempted = false
    let continuationAttempt: Promise<boolean> | null = null
    let continuationError = ''
    let seasonSettled = false // AniZip season target resolved (or known-absent) — gates auto-continue
    const tryContinuation = (stream: Stream) => {
      continuationAttempted = true
      continuationAttempt = (async () => {
        let played = false
        await playStream(media, episode, stream, (state) => {
          const result = applyContinuationState(state, () => streamPicker.set(null), onState)
          played ||= result.played
          continuationError ||= result.error
        })
        return played
      })()
    }
    const refresh = (resolving: boolean) => {
      if (!stillCurrent()) return
      let s = refineStreams(media, acc)
      if (want && (want.season != null || want.abs != null)) s = verifySeason(s, want)
      streamPicker.set({ media, episode, streams: s, cachedCount: s.filter((x) => !!x.url && !isUncached(x)).length, resolving })
      // Binge continuity: the instant a same-release, ready-to-play source appears, continue on it
      // automatically (close the picker, no interaction). An uncached same-release is handled once
      // the list settles (below), so a late-arriving cached one still wins here. Gated on
      // seasonSettled so a same-group WRONG-season file can't sneak in before AniZip answers, and on
      // no debrid cache being in flight so we never stomp a source the user just picked themselves
      // (an uncached manual pick keeps the picker open while it caches).
      if (cont && !continuationAttempted && seasonSettled && !get(debridCaching)) {
        const hit = s.find((x) => matchesRelease(x, cont) && playableNow(x) && !isUncached(x) && !(want && isWrongSeason(x, want)))
        if (hit) tryContinuation(hit)
      }
    }

    // Resolve the season target, then unblock + re-run auto-continue. `.finally` so a title with
    // no AniZip season data still flips seasonSettled (nothing to wrong-season against).
    const seasonReady = seasonP.then((m) => {
      const w = episode != null ? m[episode] : undefined
      if (w && (w.season != null || w.abs != null)) want = w
    }).catch(() => {}).finally(() => { seasonSettled = true; refresh(true) })

    // Each SOURCE (every addon + the extensions as one wave) folds into the picker as
    // it lands — a genuine multi-source trickle + live re-sort, not a
    // late extension dump. `resolving` only flips false once ALL sources settle (so
    // the autoplay countdown targets the FINAL best pick).
    // Addons only when we have the Kitsu id they need; the extension wave always runs if configured.
    let pending = (kitsu != null ? bases.length : 0) + (hasExt ? 2 : 0)
    await new Promise<void>((resolve) => {
      // Stop waiting the moment we're superseded/closed — the in-flight fetches keep going and
      // fold in harmlessly (refresh() no-ops once the picker is no longer ours), but we settle now.
      if (signal.aborted) return resolve()
      signal.addEventListener('abort', () => resolve(), { once: true })
      if (!pending) return resolve()
      const done = () => { if (--pending === 0) resolve() }
      if (kitsu != null) {
        const id = streamId(kitsu, episode)
        for (const base of bases) {
          fetchAddonStreams(base, id, type)
            .then((r) => { acc = [...acc, ...r.streams]; totalRaw += r.total; refresh(true) })
            .catch(() => {})
            .finally(done)
        }
      }
      if (hasExt) {
        extToStreams(media, episode, kitsu, (s) => { if (s.length) { acc = [...acc, ...s]; refresh(true) } })
          .catch(() => {})
          .finally(done)
      }
      if (hasExt) {
        resolveOnlineStreams(media, episode)
          .then((s) => { if (s.length) { acc = [...acc, ...s]; refresh(true) } })
          .catch(() => {})
          .finally(done)
      }
    })
    await seasonReady
    // Superseded by a newer play, or the picker was closed → settle to idle NOW so the caller's
    // `resolving` guard clears and the next episode click works (don't wait on orphaned fetches).
    if (signal.aborted) return onState({ status: 'idle' })
    // A ready-to-play same-release source may have been tried while results streamed in. Wait for
    // its real outcome: success closes the picker; failure finishes populating it for manual choice.
    if (continuationAttempt && await continuationAttempt) return
    refresh(false)
    if (continuationError && stillCurrent()) {
      streamPicker.update((current) => current ? { ...current, playbackError: continuationError } : current)
    }

    // Binge continuity fallback: no ready-to-play same-release appeared, but a same-release
    // source EXISTS (uncached) — continue on it (debrid caches it, with the cancelable
    // overlay) rather than making the user re-pick the same release every episode. Only the
    // "no same release at all" case falls through to leave the picker open for a manual pick.
    // Gated on stillCurrent() so a slow extension wave can't hijack a source the user already
    // picked (which closed this picker) or a different episode they navigated to meanwhile, and on
    // no debrid cache in flight (an uncached manual pick keeps the picker open while it caches, so
    // stillCurrent() alone wouldn't catch it).
    if (cont && !continuationAttempted && stillCurrent() && !get(debridCaching)) {
      let s = refineStreams(media, acc)
      if (want && (want.season != null || want.abs != null)) s = verifySeason(s, want)
      const hit = s.find((x) => matchesRelease(x, cont))
      if (hit) {
        tryContinuation(hit)
        if (continuationAttempt && await continuationAttempt) return
        if (continuationError && stillCurrent()) {
          streamPicker.update((current) => current ? { ...current, playbackError: continuationError } : current)
        }
      }
    }

    // The user already acted on this picker (picked a source / navigated away) → it's no longer
    // current; settle this resolve neutrally instead of firing a spurious "no streams" error.
    if (!stillCurrent()) return onState({ status: 'idle' })

    // Nothing playable → honest error.
    if (!get(streamPicker)?.streams.length) {
      return showPickerError(totalRaw > 0
        ? `Found ${totalRaw} torrents but none are usable (all dead or notice entries). Try another source.`
        : 'No streams found for this title/episode yet.')
    }
    onState({ status: 'idle' })
  }
  catch (e) {
    showPickerError(e instanceof Error ? e.message : String(e))
  }
}

/** Query the last successful origin for Continue Watching using a freshly fetched Media record.
 *  Resolved URLs are never reused (they expire and can carry credentials); the origin performs a
 *  new lookup for this episode. A missing origin/release or unusable result returns undefined so
 *  the unrestricted progressive picker can take over. */
async function resolveRememberedSource(media: Media, episode: number, remembered: RememberedSource): Promise<Stream | undefined> {
  let streams: Stream[] = []
  if (remembered.origin.kind === 'addon') {
    const base = get(enabledAddonUrls).find((url) => addonOriginId(url) === remembered.origin.id)
    if (!base) return undefined
    const kitsu = await resolveKitsu(media)
    if (!kitsu) return undefined
    streams = (await fetchAddonStreams(base, streamId(kitsu, episode), media.format === 'MOVIE' ? 'movie' : 'series')).streams
  } else if (remembered.origin.kind === 'online-extension') {
    streams = await resolveOnlineStreams(media, episode, remembered.origin.id)
  } else {
    const kitsu = await resolveKitsu(media)
    await extToStreams(media, episode, kitsu, (batch) => { streams = [...streams, ...batch] }, remembered.origin.id)
  }

  streams = refineStreams(media, streams)
  const map = await getEpisodeSeasonMap(media.id).catch(() => ({} as Record<number, { season?: number; abs?: number }>))
  const want = map[episode]
  if (want && (want.season != null || want.abs != null)) streams = verifySeason(streams, want)
  if (!streams.length) return undefined

  const release = remembered.release
  const same = release && (release.infoHash || release.bingeGroup || release.group)
    ? streams.find((stream) => matchesRelease(stream, release))
    : undefined
  if (remembered.origin.kind === 'torrent-extension') {
    // Torrent extensions cannot advertise debrid cache state. Only reuse the exact release;
    // an unrelated first search result is not a continuation.
    return same
  }
  if (same && playableNow(same) && !isUncached(same)) return same
  // Same origin remains useful even if that origin renamed/repacked the episode. Within the pinned
  // origin, prefer its best ready source; never auto-start an uncached unrelated torrent.
  return pickBest(rankStreams(streams), get(preferredQuality), want)
}

/** Resume from Continue Watching / the detail Continue button. Refresh the trimmed home-card Media
 *  snapshot first, then try the remembered origin. A miss or playback error falls through to the
 *  same unrestricted picker used by a direct episode click — without retrying the failed release. */
export async function resumeEpisode(media: Media, episode: number, onState: (s: PlayState) => void) {
  onState({ status: 'resolving' })
  const current = await fetchMediaById(media.id).catch(() => media)
  const remembered = get(sourceOrigins)[current.id]
  if (remembered) {
    try {
      const stream = await resolveRememberedSource(current, episode, remembered)
      if (stream) {
        let played = false
        await playStream(current, episode, stream, (state) => {
          if (state.status === 'playing') played = true
          // Do not surface the remembered-source error yet: the complete picker is the recovery UI.
          if (state.status !== 'error') onState(state)
        })
        if (played) return
      }
    } catch { /* stale/offline origin: the complete picker below is the recovery path */ }
  }
  return await playEpisode(current, episode, onState)
}

// Advance to an episode (auto next-episode + the in-player Prev/Next buttons). Continues
// the SAME release seamlessly when a cached one exists; otherwise opens the picker for the
// episode (auto-continuing an extension/uncached same-release, else leaving it for a pick).
async function resolveAndPlayBest(media: Media, episode: number | undefined, onState: (s: PlayState) => void) {
  // Instant path: use the stream prefetched near the end of the previous episode.
  if (episode != null) {
    const pre = takePrefetched(media.id, episode)
    if (pre) return await playStream(media, episode, pre, onState)
  }
  onState({ status: 'resolving' })
  // Seamless continuity: if the addons already have a CACHED source from the same release
  // we were watching, play it straight away — no picker between back-to-back episodes.
  try {
    const { streams, want } = await resolveStreams(media, episode)
    const same = pickSameRelease(media, streams, want)
    if (same) return await playStream(media, episode, same, onState)
  }
  catch { /* no addons / nothing yet — the full picker below still queries extensions */ }
  // No cached same-release: open the full source picker (addons + extensions) for this
  // episode, carrying the continuity hint so a same-release source auto-continues when it
  // lands (extension/fansub content), and otherwise the user picks. This replaces the old
  // dead-end "no cached source" toast — the next episode always goes somewhere.
  return await playEpisode(media, episode, onState, continueHint(media))
}

// Play a specific chosen stream: embed mpv into the main window + wire progress /
// resume / auto next-episode. Closes the picker.
export async function playStream(media: Media, episode: number | undefined, stream: Stream, onState: (s: PlayState) => void) {
  // Remember what's playing so the player's "Change source" can re-open the picker for it.
  nowPlayingMedia.set({ media, episode })
  // Fetch external subtitles from any subtitle-capable addon (OpenSubtitles etc) CONCURRENTLY with the
  // slow source resolve below, so they're ready by embed time without adding latency. Skipped for the
  // external/Android players (they own subtitle handling). Best-effort — [] on any failure.
  const subsP: Promise<ExternalSubtitle[]> = get(isAndroid) || get(enableExternalPlayer)
    ? Promise.resolve([])
    : fetchAddonSubtitles(get(enabledAddonUrls), media, episode, stream.behaviorHints?.filename).catch(() => [])
  // Note: the picker closes itself on the 'playing' state (so an embed error stays
  // visible in it); auto-next calls this with no picker open.
  // Extension / P2P results carry only an infoHash — resolve it to a cached HTTP url
  // through Real-Debrid before playing (addon-provided streams already have a url).
  if (!stream?.url && stream?.infoHash) {
    const provider = get(debridProvider)
    const key = get(debridKey)
    const pname = providerName(provider)
    if (!key) return onState({ status: 'error', message: `This source needs a ${pname} key — add it in Settings → Extensions.` })
    onState({ status: 'resolving' })
    // A CACHED (⚡/[RD+]) source resolves in ~1s (debrid already has it), so it plays off the
    // picker's lightweight spinner with no full-screen "downloading to debrid" screen. That
    // screen is only for a genuine multi-minute cache: shown upfront for a known-uncached pick,
    // and escalated to if a supposedly-cached hash turns out stale and actually starts
    // downloading. The AbortController lets Cancel stop the poll (the torrent keeps caching at
    // the service, so a later retry is instant).
    const controller = new AbortController()
    let overlayShown = false
    const showCaching = () => {
      if (overlayShown) return
      overlayShown = true
      debridCaching.set({
        provider: pname, title: title(media), episode, cover: cover(media), info: { stage: 'queued' },
        // Optimistic cancel: close the screen IMMEDIATELY on the first click, then abort the poll in
        // the background. The eventual AbortError just settles playStream to 'idle' (re-enabling the
        // picker); a late onStatus can't resurrect the screen because the store is already null.
        cancel: () => { debridCaching.set(null); controller.abort() },
      })
    }
    // Known-uncached → show the caching screen upfront. Otherwise DELAY it: a genuinely-cached hash
    // resolves in ~1s (no screen, no flash), but a stale/mislabeled "cached" hash that RD has to
    // re-fetch dwells in 'queued'/'downloading' — after a short grace the screen appears so the user
    // isn't stuck on a frozen picker with no way to cancel. (poll only ever reports queued/downloading.)
    let overlayTimer: ReturnType<typeof setTimeout> | undefined
    if (isUncached(stream)) showCaching()
    else overlayTimer = setTimeout(showCaching, 1500)
    try {
      const url = await resolveHash(provider, key, stream.__magnet ?? stream.infoHash, {
        signal: controller.signal,
        timeoutMs: 30 * 60 * 1000,
        onStatus: (i) => { if (overlayShown) debridCaching.update((c) => (c ? { ...c, info: i } : c)) },
      })
      clearTimeout(overlayTimer)
      stream = { ...stream, url }
      debridCaching.set(null)
    }
    catch (e) {
      clearTimeout(overlayTimer)
      debridCaching.set(null)
      // User-initiated cancel: quietly return to the picker, no error toast.
      if (e instanceof Error && e.name === 'AbortError') return onState({ status: 'idle' })
      return onState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
  if (!stream?.url) return onState({ status: 'error', message: 'That source has no playable link.' })
  const rememberSuccess = () => rememberSourceOrigin(media.id, stream.__origin, {
    infoHash: stream.infoHash,
    bingeGroup: stream.behaviorHints?.bingeGroup,
    group: describe(stream).group,
  })
  try {
    currentMedia = media
    // Resume from the last saved position for this exact episode, if any.
    const startSeconds = episode != null ? getPosition(media.id, episode) : 0
    const label = episode != null ? `${title(media)} — Episode ${episode}` : title(media)
    const airedTotal = media.nextAiringEpisode?.episode ? media.nextAiringEpisode.episode - 1 : (media.episodes ?? null)
    const total = media.episodes ?? airedTotal
    nowPlaying.set({
      title: label, animeTitle: title(media), id: media.id, malId: media.idMal ?? null,
      episode: episode ?? null, total, airedTotal,
    })
    // Local watch history: record the open now (covers embedded + external playback), so Continue
    // Watching lists this show even with no AniList/MyAnimeList linked. Also remember this source's
    // release identity so Continue Watching can resume the SAME release later. Progress bumps on watch.
    recordPlay(media, episode, { group: describe(stream).group, bingeGroup: stream.behaviorHints?.bingeGroup })

    // Android: hand the resolved URL to an external video player (no embedded mpv on mobile). This
    // returns before the desktop embed below, so nothing libmpv-related runs and `playing` stays
    // false (browse UI stays up, no overlay). The episode is marked watched when the user returns.
    if (get(isAndroid)) {
      // "Full" flavor: embedded libmpv player (renders in-app). The plugin only exists when the
      // app was built with the `android-mpv` feature; on the "lite" build hasEmbeddedPlayer() is
      // false and we fall through to the external-player intent below.
      if (await hasEmbeddedPlayer()) {
        const addonSubs = await Promise.race([subsP, new Promise<ExternalSubtitle[]>((r) => setTimeout(() => r([]), 4000))])
        const subs = [
          ...(stream.__stream ? (stream.__subtitles ?? []).map((s: { url: string }) => s.url) : []),
          ...addonSubs.map((s) => s.url),
        ]
        await startMpvEvents()
        await mpvLoad({ url: stream.url, title: label, startPos: startSeconds || 0, subtitles: subs })
        // Stash the resolved URL + headers so the scrubber's thumbnail grabber can decode frames.
        androidStreamInfo.set({ url: stream.url, headers: (stream.__stream ? stream.__headers : undefined) ?? {} })
        androidMpvActive.set(true)
        rememberSuccess()
        onState({ status: 'playing' })
        if (episode != null) attachAndroid(media, episode, onState)
        return
      }
      // A completed download resolves to an absolute on-disk path (not an http URL); flag it so the
      // native side exposes it through a FileProvider content:// URI (a raw file path can't be
      // ACTION_VIEW'd across apps since Android 7).
      const isLocalFile = !/^https?:\/\//i.test(stream.url)
      const ok = await playViaIntent(media, episode ?? null, stream.url, isLocalFile)
      if (ok) rememberSuccess()
      return onState(
        ok
          ? { status: 'playing' }
          : { status: 'error', message: 'No video player installed — install mpv-android or VLC.' },
      )
    }

    // External player: hand the stream URL to the user's chosen executable and skip
    // the embedded path. No player-progress comes back, so we can't track/resume
    // while external (documented in the setting's helper text).
    if (get(enableExternalPlayer)) {
      const path = get(externalPlayerPath)
      if (!path) return onState({ status: 'error', message: 'No external player selected — set its path in Settings.' })
      await invoke('spawn_external_player', { path, url: stream.url })
      rememberSuccess()
      onState({ status: 'playing' })
      return
    }

    // Seed the scrub-preview sprite key (infoHash identifies the exact file; fall
    // back to media-episode). The seekbar kicks off generation once mpv reports the
    // duration. Set BEFORE embed so the seekbar sees it as soon as the overlay mounts.
    spriteKey.set(stream.infoHash ?? `${media.id}-${episode ?? 0}`)

    // Remember this stream's release identity so the next episode can continue from
    // the SAME release without re-picking — by pack infoHash / Stremio bingeGroup, or the
    // parsed release group (fansub author) for extension content that has neither.
    bingeSource.set({ mediaId: media.id, bingeGroup: stream.behaviorHints?.bingeGroup, infoHash: stream.infoHash, group: describe(stream).group })

    // Embed mpv FIRST — it renders behind the still-opaque webview — THEN reveal the
    // overlay + punch the transparent hole. Otherwise the window is briefly
    // transparent with nothing behind it and the desktop flashes through.
    // Size the demuxer cache for THIS file before loading it: the preset scales up with the file's
    // bitrate (videoSize ÷ runtime), so a 4K Blu-ray buffers as many seconds as the preset holds for
    // 1080p instead of rebuffering on a fixed byte cap. Applied on the next load (this one).
    const durationSec = media.duration ? media.duration * 60 : undefined
    await invoke('set_player_cache', {
      bytes: playerCacheBytes(get(playerCacheMb), stream.behaviorHints?.videoSize, durationSec),
    }).catch(() => {})
    // Await the addon subtitles (bounded — a slow subtitle addon must not hold up playback), and merge
    // them with any the source itself carried (online-stream __subtitles). mpv sub-adds all of them;
    // slang auto-selects the preferred language.
    const addonSubs = await Promise.race([subsP, new Promise<ExternalSubtitle[]>((r) => setTimeout(() => r([]), 4000))])
    const subtitles = [
      ...(stream.__stream ? stream.__subtitles ?? [] : []),
      ...addonSubs.map((s) => ({ url: s.url, lang: s.lang })),
    ]
    // alang/slang drive mpv's preferred-language track auto-selection.
    await invoke('player_embed', {
      url: stream.url,
      startSeconds: startSeconds || undefined,
      alang: get(preferredAudioLang),
      slang: get(preferredSubLang),
      headers: stream.__stream ? stream.__headers : undefined,
      subtitles: subtitles.length ? subtitles : undefined,
    })
    rememberSuccess()
    playing.set(true)
    onState({ status: 'playing' })
    // Progress now fires on *actual watch* (~85%), not on play — see attach().
    if (episode != null) await attach(media, episode, onState)
  }
  catch (e) { onState({ status: 'error', message: String(e) }) }
}

// The Media currently playing, so the in-player Prev/Next buttons can resolve the
// adjacent episode without the caller threading it back in.
let currentMedia: Media | null = null

// Surface auto-advance / prev-next progress + errors as a transient overlay toast.
const noticeState = (s: PlayState) => {
  if (s.status === 'resolving') playerNotice.set('Loading episode…')
  else if (s.status === 'error') playerNotice.set(s.message ?? 'Playback failed.')
  else playerNotice.set('')
}

/** Play a raw debrid URL that has no AniList Media (the Cloud library). Embeds mpv,
 *  sets nowPlaying with null ids so no progress-tracking / next-episode fires, and
 *  honors the external-player setting exactly like playStream. */
export async function playRawUrl(url: string, label: string, onState: (s: PlayState) => void = noticeState) {
  if (!url) return onState({ status: 'error', message: 'That file has no playable link.' })
  try {
    // External player: hand off and stop (no embed, no tracking).
    if (get(enableExternalPlayer)) {
      const path = get(externalPlayerPath)
      if (!path) return onState({ status: 'error', message: 'No external player selected — set its path in Settings.' })
      await invoke('spawn_external_player', { path, url })
      return onState({ status: 'playing' })
    }
    // These items carry no Media, so Prev/Next must not act on a stale one.
    currentMedia = null
    nowPlayingMedia.set(null)
    nowPlaying.set({ title: label, animeTitle: label, id: null, malId: null, episode: null, total: null, airedTotal: null })
    spriteKey.set(null)   // no per-file scrub sprites for cloud items
    bingeSource.set(null) // no release-continuity chain
    await invoke('player_embed', { url, alang: get(preferredAudioLang), slang: get(preferredSubLang) })
    playing.set(true)
    onState({ status: 'playing' })
  }
  catch (e) { onState({ status: 'error', message: String(e) }) }
}

/** Play the previous episode (in-player button). No-op past episode 1. */
export function playPrev(onState: (s: PlayState) => void = noticeState) {
  const ep = get(nowPlaying).episode
  if (!currentMedia || ep == null || ep <= 1) return
  resolveAndPlayBest(currentMedia, ep - 1, onState)
}
/** Play the next episode (in-player button). Bounds are enforced by the button's
 *  visibility gate + resolveAndPlayBest's honest "no cached source" error. */
export function playNext(onState: (s: PlayState) => void = noticeState) {
  const ep = get(nowPlaying).episode
  if (!currentMedia || ep == null) return
  resolveAndPlayBest(currentMedia, ep + 1, onState)
}

export interface ResolvedDownload { url: string; filename: string; quality?: string; provider?: string; infoHash?: string }

// Resolve a single episode to a DIRECT downloadable url — no player, no mpv. Reuses
// the same resolveStreams+pickBest path as playback; resolves an uncached/extension
// pick through debrid when nothing is cached. Fetches the Media by id so it works
// even for a persisted download resumed after an app restart.
export async function resolveDownloadUrl(mediaId: number, episode: number): Promise<ResolvedDownload> {
  const media = await fetchMediaById(mediaId)
  const { streams, want } = await resolveStreams(media, episode)
  const best = pickBest(streams, get(preferredQuality), want) ?? streams[0]
  if (!best) throw new Error('No source found to download.')
  let url = best.url
  let prov: string | undefined
  if (!url && best.infoHash) {
    const p = get(debridProvider), key = get(debridKey)
    if (!key) throw new Error(`Add a ${providerName(p)} key in Settings → Extensions.`)
    url = await resolveHash(p, key, best.__magnet ?? best.infoHash)
    prov = providerName(p)
  }
  if (!url) throw new Error('That source has no downloadable link.')
  const info = describe(best)
  const ext = url.split('?')[0].match(/\.(mkv|mp4|avi|mov|webm)$/i)?.[1]?.toLowerCase() ?? 'mkv'
  const base = best.behaviorHints?.filename || `${title(media)} - E${episode}`
  const filename = /\.(?:mkv|mp4|avi|mov|webm)$/i.test(base) ? base : `${base}.${ext}`
  return { url, filename, quality: info.quality ? `${info.quality}p` : undefined, provider: prov ?? info.provider, infoHash: best.infoHash }
}
