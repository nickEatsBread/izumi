import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { get } from 'svelte/store'
import { addonUrls } from './sources'
import { getIndex, lookupKitsu } from './idmap'
import { getStreams, fetchAddonStreams, streamId, pickBest, parseSeasonEp, isWrongSeason, isUncached, describe, type Stream } from './addon'
import { relevant, likelyOtherProduction, isEpisodeExtra, isStandaloneMovie } from './relevance'
import { getKitsuId, getEpisodeSeasonMap, getExtensionIds } from '$lib/anizip'
import { kitsuIdFromMal } from './kitsu'
import { fetchMediaById } from '$lib/anilist/fetch-media'
import { downloadOf } from '$lib/downloads/state'
import { resolveHash, providerName } from './debrid'
import { resolveOnlineStreams } from './onlinestream'
import { queryExtensions } from '$lib/extensions/manager'
import type { TorrentResult } from '$lib/extensions/types'
import { updateProgress } from '$lib/trackers'
import { savePosition, getPosition, clearPosition, watched } from '$lib/player/progress'
import { playing, nowPlaying, streamPicker, playerNotice, spriteKey, bingeSource, nowPlayingMedia, debridCaching } from '$lib/player/session'
import {
  preferredAudioLang, preferredSubLang, autoSelectSource, preferredQuality, skipFiller,
  autoplayNext, enableExternalPlayer, externalPlayerPath, debridKey, debridProvider, extensionUrls, bingePreload,
} from '$lib/settings/ui'
import { fillerEpisodes } from '$lib/anime/filler'
import { title, cover } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'

export type PlayState = { status: 'idle' | 'resolving' | 'playing' | 'error'; message?: string }

// Module-level listener handles from the *previous* play. We unlisten these
// before attaching new ones so repeated plays don't stack listeners (this is a
// plain module, not a component — no runes/lifecycle to lean on).
let stop: Array<() => void> = []

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
      // exactly once (guarded by `marked`).
      if (!marked && watched(pos, dur)) {
        marked = true
        updateProgress(media, episode, 'CURRENT').then((t) => t.length && console.log('tracked on', t.join(', ')))
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
  stop.push(
    await listen('player-ended', async () => {
      // Finished: forget the resume point, then auto-advance if enabled and there's
      // a next episode (bounded by the known total). Auto-advance plays the best
      // cached source directly — no picker between back-to-back episodes.
      clearPosition(media.id, episode)
      if (!get(autoplayNext)) return
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
function collapseBatches(streams: Stream[]): Stream[] {
  const counts = new Map<string, number>()
  for (const s of streams) if (s.infoHash) counts.set(s.infoHash, (counts.get(s.infoHash) ?? 0) + 1)
  const seen = new Set<string>()
  return streams.filter((s) => {
    if (!s.infoHash || (counts.get(s.infoHash) ?? 0) <= 1) return true
    if (seen.has(s.infoHash)) return false
    seen.add(s.infoHash); return true
  })
}

// Drop exact duplicates across addons: the same torrent/file is often returned by
// several addons as an identical resolve URL (or infoHash) — e.g. Torrentio AND Comet
// both surface the same S00 special. A duplicate resolve URL would also crash the
// picker's keyed {#each} (Svelte each_key_duplicate), so this is correctness, not just
// tidiness. Keyed by resolved url first (collapseBatches only dedupes by infoHash, and
// resolve-URL rows often carry no infoHash field).
function dedupeStreams(streams: Stream[]): Stream[] {
  const seen = new Set<string>()
  return streams.filter((s) => {
    const k = s.url ?? s.infoHash ?? s.behaviorHints?.filename ?? s.name ?? ''
    if (!k) return true
    if (seen.has(k)) return false
    seen.add(k); return true
  })
}

// Map an extension torrent result into our Stream shape. It carries only an
// infoHash (no url) — resolved through Real-Debrid on pick (playStream). The ⬇ in
// the name marks it uncached so describe() flags it and it never auto-plays.
function extToStream(r: TorrentResult, extName: string): Stream {
  const gb = r.size ? `${(r.size / 1073741824).toFixed(2)} GB` : ''
  const prov = (extName.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'EXT')
  return {
    infoHash: r.hash,
    name: `[${prov}⬇] ${extName}`,
    title: `${r.title}\n👤 ${r.seeders ?? 0}${gb ? ` 💾 ${gb}` : ''}`,
    behaviorHints: { filename: r.title, videoSize: r.size },
  }
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
  return dedupeStreams(
    collapseBatches(raw)
      .filter((s) => s.__stream || relevant(s, wantedTitles))
      .filter((s) => s.__stream || !likelyOtherProduction(s, animeYear, absoluteNumbered))
      .filter((s) => s.__stream || !isEpisodeExtra(s))
      .filter((s) => s.__stream || !isSeries || !isStandaloneMovie(s)),
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
  const bases = get(addonUrls)
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
  if (!streams.length && !get(extensionUrls).length) {
    throw new Error(total > 0
      ? `Found ${total} torrents but none are usable (all dead or notice entries). Try another source.`
      : 'No streams found for this title/episode yet.')
  }
  return { streams, cachedCount, want, kitsu }
}

// Query source extensions for an episode → raw `Stream[]` (extToStream-mapped, NOT
// yet refined — the caller's refine pass dedupes/season-verifies them together with
// the addon streams). Best-effort: [] on failure/none. This is the slower SECOND wave
// that folds into the picker after the addons (a multi-source trickle).
async function extToStreams(media: Media, episode: number | undefined, kitsu?: number): Promise<Stream[]> {
  try {
    // Resolve the production-specific AniZip ids (AniDB/TVDB + absolute episode) so ID-based
    // extensions (those keyed by AniDB) hit the RIGHT title + a freshly-aired episode. Cached
    // with the season map, so no extra round-trip. Titles include synonyms for string-search
    // providers. This is what lets extensions resolve new/ambiguous anime the kitsu:id:ep addon
    // path misses.
    const ids = await getExtensionIds(media.id, episode)
    const titles = [...new Set(
      [title(media), media.title.romaji, media.title.english, ...(media.synonyms ?? [])]
        .filter((t): t is string => !!t && t.length > 3),
    )]
    const ext = await queryExtensions({
      anilistId: media.id, malId: media.idMal ?? undefined, kitsuId: kitsu,
      anidbAid: ids.anidbAid, tvdbId: ids.tvdbId, tvdbEId: ids.tvdbEId,
      tmdbId: ids.tmdbId, imdbId: ids.imdbId, season: ids.season,
      absoluteEpisodeNumber: ids.absoluteEpisodeNumber,
      titles,
      episode, episodeCount: media.episodes ?? undefined,
      resolution: get(preferredQuality) === 'any' ? undefined : get(preferredQuality),
    })
    return ext.map((r) => extToStream(r, 'Extension'))
  } catch { return [] }
}

// Prefer continuing from the SAME release as the last-played stream — matching its
// Stremio bingeGroup or pack infoHash — when that stream is CACHED. This is the
// "folder" continuity: the next episode stays on the same release/quality instead of
// re-picking. Falls back to the normal best-cached pick. Gated on the setting.
function pickBinge(media: Media, streams: Stream[], want?: { season?: number; abs?: number }): Stream | undefined {
  if (get(bingePreload)) {
    const b = get(bingeSource)
    if (b && b.mediaId === media.id && (b.bingeGroup || b.infoHash)) {
      const same = streams.find((s) =>
        ((b.bingeGroup && s.behaviorHints?.bingeGroup === b.bingeGroup) || (b.infoHash && s.infoHash === b.infoHash))
        && !!s.url && !isUncached(s)
        && !(want && isWrongSeason(s, want)))
      if (same) return same
    }
  }
  return pickBest(streams, get(preferredQuality), want)
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
    const best = pickBinge(media, streams, want)
    if (!best) return // nothing cached — leave it to the picker rather than force a download
    let s = best
    if (!s.url && s.infoHash) {
      s = { ...s, url: await resolveHash(get(debridProvider), get(debridKey), s.infoHash) }
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

// User-initiated play: resolve, then show the source picker. The
// user picks a source and `playStream` starts it.
export async function playEpisode(media: Media, episode: number | undefined, onState: (s: PlayState) => void) {
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
  try {
    // Instant path: this episode was prefetched near the end of the previous one
    // (binge continuity) — skip the picker entirely.
    if (get(autoSelectSource) && episode != null) {
      const pre = takePrefetched(media.id, episode)
      if (pre) { streamPicker.set(null); return await playStream(media, episode, pre, onState) }
    }

    const bases = get(addonUrls)
    const hasExt = get(extensionUrls).length > 0
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
    const stillCurrent = () => { const c = get(streamPicker); return !!c && c.media.id === media.id && c.episode === episode }
    const refresh = (resolving: boolean) => {
      if (!stillCurrent()) return
      let s = refineStreams(media, acc)
      if (want && (want.season != null || want.abs != null)) s = verifySeason(s, want)
      streamPicker.set({ media, episode, streams: s, cachedCount: s.filter((x) => !!x.url && !isUncached(x)).length, resolving })
    }

    const seasonReady = seasonP.then((m) => {
      const w = episode != null ? m[episode] : undefined
      if (w && (w.season != null || w.abs != null)) { want = w; refresh(true) }
    }).catch(() => {})

    // Each SOURCE (every addon + the extensions as one wave) folds into the picker as
    // it lands — a genuine multi-source trickle + live re-sort, not a
    // late extension dump. `resolving` only flips false once ALL sources settle (so
    // the autoplay countdown targets the FINAL best pick).
    // Addons only when we have the Kitsu id they need; the extension wave always runs if configured.
    let pending = (kitsu != null ? bases.length : 0) + (hasExt ? 2 : 0)
    await new Promise<void>((resolve) => {
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
        extToStreams(media, episode, kitsu)
          .then((s) => { if (s.length) { acc = [...acc, ...s]; refresh(true) } })
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
    refresh(false)

    // Nothing playable → honest error.
    if (!get(streamPicker)?.streams.length) {
      streamPicker.set(null)
      return onState({ status: 'error', message: totalRaw > 0
        ? `Found ${totalRaw} torrents but none are usable (all dead or notice entries). Try another source.`
        : 'No streams found for this title/episode yet.' })
    }
    onState({ status: 'idle' })
  }
  catch (e) {
    streamPicker.set(null)
    onState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

// Resolve + play the single best (highest-quality) source, skipping the picker —
// used for auto next-episode.
async function resolveAndPlayBest(media: Media, episode: number | undefined, onState: (s: PlayState) => void) {
  // Instant path: use the stream prefetched near the end of the previous episode.
  if (episode != null) {
    const pre = takePrefetched(media.id, episode)
    if (pre) return await playStream(media, episode, pre, onState)
  }
  onState({ status: 'resolving' })
  try {
    const { streams, want } = await resolveStreams(media, episode)
    // Cached-only for auto-advance: never silently launch a debrid download or a
    // wrong-season file between back-to-back episodes. pickBinge keeps the same
    // release across episodes when it's cached.
    const best = pickBinge(media, streams, want)
    if (!best) return onState({ status: 'error', message: "Next episode has no cached source — open it to pick one." })
    await playStream(media, episode, best, onState)
  }
  catch (e) { onState({ status: 'error', message: e instanceof Error ? e.message : String(e) }) }
}

// Play a specific chosen stream: embed mpv into the main window + wire progress /
// resume / auto next-episode. Closes the picker.
export async function playStream(media: Media, episode: number | undefined, stream: Stream, onState: (s: PlayState) => void) {
  // Remember what's playing so the player's "Change source" can re-open the picker for it.
  nowPlayingMedia.set({ media, episode })
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
    // Show the full-screen caching progress instead of a silent picker spin: an uncached
    // torrent takes minutes to cache at the service. The AbortController lets Cancel stop the
    // poll (the torrent keeps caching at the service, so a later retry is instant).
    const controller = new AbortController()
    debridCaching.set({
      provider: pname,
      title: title(media),
      episode,
      cover: cover(media),
      info: { stage: 'queued' },
      // Optimistic cancel: close the screen IMMEDIATELY on the first click, then abort the poll in
      // the background. The eventual AbortError just settles playStream to 'idle' (re-enabling the
      // picker); a late onStatus can't resurrect the screen because the store is already null.
      cancel: () => { debridCaching.set(null); controller.abort() },
    })
    try {
      const url = await resolveHash(provider, key, stream.infoHash, {
        signal: controller.signal,
        timeoutMs: 30 * 60 * 1000,
        onStatus: (i) => debridCaching.update((c) => (c ? { ...c, info: i } : c)),
      })
      stream = { ...stream, url }
      debridCaching.set(null)
    }
    catch (e) {
      debridCaching.set(null)
      // User-initiated cancel: quietly return to the picker, no error toast.
      if (e instanceof Error && e.name === 'AbortError') return onState({ status: 'idle' })
      return onState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
  if (!stream?.url) return onState({ status: 'error', message: 'That source has no playable link.' })
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

    // External player: hand the stream URL to the user's chosen executable and skip
    // the embedded path. No player-progress comes back, so we can't track/resume
    // while external (documented in the setting's helper text).
    if (get(enableExternalPlayer)) {
      const path = get(externalPlayerPath)
      if (!path) return onState({ status: 'error', message: 'No external player selected — set its path in Settings.' })
      await invoke('spawn_external_player', { path, url: stream.url })
      onState({ status: 'playing' })
      return
    }

    // Seed the scrub-preview sprite key (infoHash identifies the exact file; fall
    // back to media-episode). The seekbar kicks off generation once mpv reports the
    // duration. Set BEFORE embed so the seekbar sees it as soon as the overlay mounts.
    spriteKey.set(stream.infoHash ?? `${media.id}-${episode ?? 0}`)

    // Remember this stream's release identity so the next episode can continue from
    // the SAME release/pack (bingeGroup / infoHash) without re-picking.
    bingeSource.set({ mediaId: media.id, bingeGroup: stream.behaviorHints?.bingeGroup, infoHash: stream.infoHash })

    // Embed mpv FIRST — it renders behind the still-opaque webview — THEN reveal the
    // overlay + punch the transparent hole. Otherwise the window is briefly
    // transparent with nothing behind it and the desktop flashes through.
    // alang/slang drive mpv's preferred-language track auto-selection.
    await invoke('player_embed', {
      url: stream.url,
      startSeconds: startSeconds || undefined,
      alang: get(preferredAudioLang),
      slang: get(preferredSubLang),
      headers: stream.__stream ? stream.__headers : undefined,
      subtitles: stream.__stream ? stream.__subtitles : undefined,
    })
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
    url = await resolveHash(p, key, best.infoHash)
    prov = providerName(p)
  }
  if (!url) throw new Error('That source has no downloadable link.')
  const info = describe(best)
  const ext = url.split('?')[0].match(/\.(mkv|mp4|avi|mov|webm)$/i)?.[1]?.toLowerCase() ?? 'mkv'
  const base = best.behaviorHints?.filename || `${title(media)} - E${episode}`
  const filename = /\.(?:mkv|mp4|avi|mov|webm)$/i.test(base) ? base : `${base}.${ext}`
  return { url, filename, quality: info.quality ? `${info.quality}p` : undefined, provider: prov ?? info.provider, infoHash: best.infoHash }
}
