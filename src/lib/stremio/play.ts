import { invoke } from '@tauri-apps/api/core'
import { listen, type EventCallback } from '@tauri-apps/api/event'
import { get } from 'svelte/store'
import { addonOriginId, enabledAddonUrls } from './sources'
import { getIndex, lookupKitsu } from './idmap'
import { getStreams, fetchAddonStreams, streamId, pickBest, pickCandidates, rankStreams, parseSeasonEp, isWrongSeason, isUncached, isCached, describe, type Stream } from './addon'
import { refineStreams, type Rejection } from './refine'
import { buildStreamIds } from './stream-ids'
import { shouldShowCachingScreen } from './caching-screen'
import type { RankOptions } from './addon'
import { scoreInfo } from './score'

/** Ranking inputs that live in settings rather than on a stream. The non-interactive paths must
 *  use the same ones the picker does, or "best" means two different things depending on whether a
 *  human was looking. */
const directP2pEnabled = () => get(torrentPlaybackMode) === 'direct' || !get(debridKey)
const rankOpts = (anilistId?: number): RankOptions => ({
  audioLang: get(preferredAudioLang),
  directP2p: directP2pEnabled(),
  // Synchronous by necessity — this is a settings snapshot, not an async step — so it reads what a
  // previous lookup already learned rather than starting one. A cold title simply ranks without the
  // preference, the same way it did before the annotation existed.
  seadexHashes: get(seadexAnnotations) ? knownBestHashes(anilistId) : undefined,
  cacheCheck: get(debridKey) ? cacheCheckMode(get(debridProvider)) : 'none',
  sourcePriority: get(sourcePriority),
})
import { getKitsuId, getEpisodeSeasonMap, getExtensionIds } from '$lib/anizip'
import { kitsuIdFromMal } from './kitsu'
import { fetchMediaById } from '$lib/anilist/fetch-media'
import { downloadOf, type DownloadPreferences } from '$lib/downloads/state'
import { resolveHash, resolveSidecars, providerName, cacheCheckMode, checkCached, isDebridBlocked, type EpisodeWant } from './debrid'
import { annotateCache } from './cache-state'
import { resolveOnlineStreams } from './onlinestream'
import { knownBestHashes } from './seadex'
import { fetchExternalSubtitles } from './subtitles'
import type { SubtitleCandidate } from './subtitles/types'
import { normalizeLang } from './sublang'
import { hasConfiguredExtensions, queryExtensions } from '$lib/extensions/manager'
import { cancelExtensionFetches } from '$lib/extensions/fetch-registry'
import { queryTorrentProviders, toProviderMedia } from '$lib/extensions/torrentProvider'
import type { TorrentResult } from '$lib/extensions/types'
import { extToStream } from './ext-stream'
import { markWatched } from '$lib/trackers'
import { savePosition, getPosition, clearPosition, watched, positions, progressKey } from '$lib/player/progress'
import { recordPlay, localHistory } from '$lib/player/history'
import { rememberSourceOrigin, sourceOrigins, type RememberedSource } from '$lib/player/source-origin'
import { connecting, nextEpisodeReady, playing, playerLoadId, nowPlaying, nowPlayingUrl, nowPlayingStream, streamPicker, playerNotice, spriteKey, bingeSource, nowPlayingMedia, nowPlayingPartySource, debridCaching, onlineSubCandidates, subtitleNotice, torrentSubtitleState, playerSleep, playbackRecovery } from '$lib/player/session'
import {
  DIRECT_TORRENT_START_TIMEOUT_MS,
  DIRECT_TORRENT_HARD_START_TIMEOUT_MS,
  DIRECT_TORRENT_NO_PROGRESS_TIMEOUT_MS,
  DIRECT_TORRENT_RECOVERY_TIMEOUT_MS,
  implausiblyShortEpisode,
  prematureEof,
  recoveryWatchDecision,
  recoveryStreamKey,
  resetRecoveryWatch,
} from '$lib/player/recovery-watchdog'
import { markDead } from './dead-sources'
import { shareableSource } from '$lib/watch-together/source'
import {
  preferredAudioLang, preferredSubLang, autoSelectSource, preferredQuality, skipFiller, seadexAnnotations,
  autoplayNext, enableExternalPlayer, externalPlayerPath, debridKey, debridProvider, bingePreload,
  playerCacheMb, playerCacheBytes, torrentPlaybackMode,
  sourcePriority, sourcePriorityMode,
} from '$lib/settings/ui'
import { applyPriorityFilter } from './source-priority'
import { fillerEpisodes } from '$lib/anime/filler'
import { applyContinuationState } from './continuation'
import { title, banner, cover, airedCount, totalEpisodes } from '$lib/anilist/media'
import { isAndroid } from '$lib/platform'
import { offlineMode } from '$lib/stores/offline'
import {
  beginPlaybackOwner,
  cancelPlaybackOwner,
  currentPlaybackIdentity,
  currentPlaybackOwner,
  invalidatePlaybackOwner,
  ownsPlayback,
  recordPlaybackIdentity,
  type PlaybackOwner,
} from '$lib/player/playback-owner'
import { playViaIntent } from '$lib/player/android-playback'
import {
  hasEmbeddedPlayer, mpvLoad, mpvCommand, androidMpvActive, mpvState, startMpvEvents,
  androidStreamInfo, waitForMpvFirstFrame,
} from '$lib/player/android-mpv'
import type { Media } from '$lib/anilist/types'
import {
  activateDirectTorrentPlayback, cancelDirectTorrentStartup, currentDirectTorrentPlaybackId, directTorrentHealth,
  directTorrentPlayerAttached, discardDirectTorrentPlayback, nextDirectTorrentStartupId, reportDirectTorrentBuffer,
  prepareDirectTorrentNext, stopDirectTorrentPlayback, torrentEngineNetworkOptions,
} from '$lib/player/direct-torrent'
import { torrentioResolverInfoHash } from './resolver-url'
import {
  beginResolveTrace,
  currentResolveTrace,
  finishResolveTrace,
  traceResolve,
  traceResolveError,
  type ResolveTrace,
} from '$lib/debug/resolve-trace'

export type PlayState = {
  status: 'idle' | 'resolving' | 'playing' | 'error'
  message?: string
  /** The debrid service refused this release (DMCA/content filter) — the torrent itself may still
   * be fine, so the picker can offer a direct-P2P retry of the same stream. */
  debridBlocked?: boolean
}

export type PlayEpisodeOptions = {
  continuation?: ContinueHint
  forceManual?: boolean
  autoplay?: boolean
}

export type PlayStreamOptions = {
  autoplay?: boolean
  /** Play this torrent through the local P2P engine even when a debrid key is configured — the
   * picker's "Watch this P2P?" retry after the debrid service blocked the release. */
  forceDirect?: boolean
  /** Override history resume when replacing a failed source in-place. */
  startSeconds?: number
  /** Automatic picks get a bounded native metadata/initialization attempt so one dead hash cannot
   * consume the full manual-source allowance before the picker advances to its next candidate. */
  directStartupTimeoutMs?: number
  /** Internal: a watchdog replacement may retain ownership, but can never claim it after a newer
   * episode/source request has taken over. */
  recoveryOwner?: PlaybackOwner
}

function addonTraceName(base: string): string {
  try { return new URL(base).hostname }
  catch { return 'configured-addon' }
}

function streamTraceDetails(stream: Stream, options?: RankOptions) {
  const parsed = describe(stream)
  const ranking = options ? scoreInfo(parsed, options) : undefined
  return {
    provider: stream.__origin?.name ?? stream.__addonName ?? 'unknown',
    kind: stream.__stream ? 'online' : stream.url ? 'resolved-url' : stream.infoHash ? 'torrent' : 'unknown',
    quality: (stream.__quality ?? parsed.quality) || 'unknown',
    cache: parsed.cached,
    cacheSource: parsed.cacheSource,
    audio: stream.__audio ?? (parsed.dualAudio ? 'dual' : undefined),
    seeders: parsed.seeders,
    sizeMiB: parsed.sizeBytes
      ? Math.round(parsed.sizeBytes / 1024 / 1024)
      : undefined,
    rankScore: ranking?.score,
    rankReasons: ranking?.reasons,
  }
}

function batchTraceDetails(streams: Stream[]) {
  const providers = new Map<string, number>()
  let torrents = 0
  let online = 0
  let resolved = 0
  for (const stream of streams) {
    const provider = stream.__origin?.name ?? stream.__addonName ?? 'unknown'
    providers.set(provider, (providers.get(provider) ?? 0) + 1)
    if (stream.__stream) online++
    else if (stream.infoHash) torrents++
    else if (stream.url) resolved++
  }
  return {
    rows: streams.length,
    torrents,
    online,
    resolved,
    providers: Object.fromEntries([...providers.entries()].slice(0, 20)),
  }
}

type DirectTorrentPlayback = {
  url: string
  filename: string
  fileIndex: number
  size: number
  torrentSize: number
  pieceCount: number
  playbackId: number
  subtitles: DirectTorrentSubtitle[]
  engineReadyMs: number
  metadataMs: number
  activeLockWaitMs: number
  initializationMs: number
  totalMs: number
  reusedTorrent: boolean
  metadataPeers: number
  metadataCached: boolean
  metadataCache: string
  trackerCount: number
  incomingPeerPort: number | null
  fastresumePrimed: boolean
}

type DirectTorrentSubtitle = {
  fileIndex: number
  url: string
  lang: string
  title: string
}

/** Attach bundled torrent sidecars after player_embed returns. Fire-and-forget from playStream:
 *  video state reaches "playing" immediately while these tiny files finish in the background. */
async function attachDirectTorrentSubtitles(playbackId: number, subtitles: DirectTorrentSubtitle[]) {
  if (!subtitles.length) return
  torrentSubtitleState.set({
    playbackId,
    status: 'loading',
    loaded: 0,
    total: subtitles.length,
    revision: 0,
  })
  let loaded = 0
  for (const subtitle of subtitles) {
    try {
      await invoke('torrent_playback_add_subtitle', {
        playbackId,
        fileIndex: subtitle.fileIndex,
        lang: subtitle.lang,
        title: subtitle.title,
      })
      loaded++
      torrentSubtitleState.update((state) =>
        state.playbackId === playbackId
          ? { ...state, loaded, revision: state.revision + 1 }
          : state,
      )
    } catch (error) {
      // A playback switch intentionally invalidates the old request in Rust. Do not let that
      // harmless race overwrite the new episode's loading state or interrupt its video.
      if (get(torrentSubtitleState).playbackId !== playbackId) return
      console.warn('direct torrent subtitle failed', error)
    }
  }
  torrentSubtitleState.update((state) =>
    state.playbackId === playbackId
      ? { ...state, status: loaded ? 'ready' : 'error', loaded }
      : state,
  )
}

/** Direct P2P must not wait for online-subtitle discovery before opening its video stream. Apart
 * from adding up to four seconds of startup latency, exact-hash discovery reads the torrent URL
 * while mpv is trying to establish its own initial range. Search without touching the video and
 * attach URL-bearing addon subtitles once mpv has accepted the episode. */
async function attachDirectOnlineSubtitles(
  playbackId: number,
  candidatesP: Promise<SubtitleCandidate[]>,
) {
  const candidates = await candidatesP
  if (currentDirectTorrentPlaybackId() !== playbackId) return

  onlineSubCandidates.set({
    status: 'ready',
    items: candidates.filter((candidate) => candidate.download?.needsFetch),
  })
  for (const candidate of candidates) {
    if (!candidate.url) continue
    if (currentDirectTorrentPlaybackId() !== playbackId) return
    try {
      await invoke('player_attach_subtitle_url', {
        url: candidate.url,
        lang: candidate.lang,
        title: candidate.release,
      })
    } catch (error) {
      if (currentDirectTorrentPlaybackId() !== playbackId) return
      console.warn('direct torrent online subtitle failed', error)
    }
  }
}

// Finite aired-episode count for player bounds (auto-advance / prefetch) + the in-player Next
// button gate. airedCount() consults the airing schedule — many OVAs/ONAs/adult titles have
// episodes=null AND nextAiringEpisode=null on AniList yet a full schedule (e.g. id 178445) —
// and collapses its "unknown" Infinity back to the AniList scalar (0 when absent) so a bound
// like `next <= airedTotal` and `episode < airedTotal` stay sane instead of always-true.
const airedTotalOf = (media: Media): number => {
  const a = airedCount(media)
  return Number.isFinite(a) ? a : (media.episodes ?? 0)
}

/** The ACTIVE provider's cache-check capability, for pickBest. Collapses to 'none' when there is
 *  no key to ask with: a capability we cannot exercise would make pickBest refuse every 'unknown'
 *  row on the grounds that "a confirmed answer was available", when in fact we never asked. */
const activeCacheCheck = (): 'native' | 'library' | 'none' =>
  get(debridKey) ? cacheCheckMode(get(debridProvider)) : 'none'

/** Resolve debrid sidecar subtitles AFTER playback has started and attach each to the live
 *  player. Deliberately not awaited by the caller: each sidecar costs at least one debrid round
 *  trip, and the episode must start immediately. Every failure is swallowed — a missing subtitle
 *  must never disturb playback. */
async function attachDebridSidecars(provider: string, key: string, torrent: string, want?: EpisodeWant) {
  const sidecars = await resolveSidecars(provider, key, torrent, want ? { want } : undefined)
  for (const s of sidecars) {
    try {
      await invoke('player_attach_subtitle_url', { url: s.url, lang: s.lang, title: s.title })
    } catch (error) {
      console.warn('debrid sidecar subtitle failed', error)
    }
  }
}

// Filename of the currently-playing stream, captured for on-demand subtitle re-search.
let lastSubFilename: string | undefined

/** Re-run the external-subtitle search for the currently-playing episode (the in-player "Search
 *  again" button). Writes onlineSubCandidates through a searching → ready|error transition. The
 *  optional `query` is reserved for a future provider-side freetext search; v1 ignores it (the menu
 *  filters the fetched list client-side). */
export async function searchOnlineSubtitles(_query?: string): Promise<void> {
  subtitleNotice.set('')
  const np = get(nowPlayingMedia)
  if (!np) return
  onlineSubCandidates.update((s) => ({ status: 'searching', items: s.items }))
  try {
    const cands = await fetchExternalSubtitles(get(enabledAddonUrls), np.media, np.episode ?? undefined, lastSubFilename)
    onlineSubCandidates.set({ status: 'ready', items: cands.filter((c) => c.download?.needsFetch) })
  } catch {
    onlineSubCandidates.set({ status: 'error', items: [] })
  }
}

// Module-level listener handles from the *previous* play. We unlisten these
// before attaching new ones so repeated plays don't stack listeners (this is a
// plain module, not a component — no runes/lifecycle to lean on).
let stop: Array<() => void> = []

// Monotonic play generation. Bumped on every attach() so a stale event handler that survives
// teardown (Tauri delivers events async — one can already be in flight when we unlisten) can tell
// it's been superseded and skip side effects like auto-advance. See attach().
let playGen = 0

// Drop the current episode's listeners WITHOUT registering a replacement set. `attach()` is the
// only other place teardown happens, so any playback path that doesn't call it used to inherit the
// previous episode's handlers — which still close over that episode's `media`/`episode`. Playing an
// untracked file (debrid Cloud library, raw URL) after watching Anime X ep5 therefore wrote
// `savePosition(X, 5, ...)` from the cloud file's clock every 5s, pushed a bogus `markWatched(X, 5)`
// to AniList/MAL at the ~85% mark, and on EOF auto-advanced into X ep6 on top of the cloud video.
// Deliberately NOT called at the top of `playStream`: that would drop the previous episode's
// `player-finalize` listener before the new file is confirmed loaded, so a failed play would lose
// the old resume point. `attach()` handles that case atomically once the new file is live.
function detach() {
  stop.forEach((f) => f())
  stop = []
  playGen++
  // New episode → the prefetch target changes, so a cooldown recorded for the old one is stale.
  resetPrefetchMiss()
}

// Register a Tauri event listener and store its unlisten SYNCHRONOUSLY. `listen()` is an async
// IPC round-trip; awaiting it before pushing the handle to `stop` (as attach() used to) opened a
// window where a second play's teardown ran before this play's handle existed, so the old
// listeners were never removed — duplicate player-progress/player-ended → double save + double
// auto-advance. Here the remover is in `stop` before any await, and if teardown fires before the
// listen resolves, `cancelled` makes the handle unlisten the moment it arrives.
function pushListen<T>(event: string, handler: EventCallback<T>) {
  let unlisten: (() => void) | null = null
  let cancelled = false
  void listen<T>(event, handler).then((fn) => { if (cancelled) fn(); else unlisten = fn })
  stop.push(() => { cancelled = true; unlisten?.(); unlisten = null })
}

// The in-flight source resolve (playEpisode). A new play or an explicit picker close aborts it
// so a closed resolve settles to idle at once instead of leaving its caller stuck in `resolving`.
// A superseded resolve stays silent because the newer request now owns caller state. The signal
// also cancels the addon stream fetches themselves (only the session-cached manifest lookups run
// to completion); an explicit pick/close additionally cuts the bridged extension fetches — see
// cancelExtensionFetches below. A supersede-by-new-play deliberately does NOT cut those: they
// usually belong to the same title, and their settled answers warm the memo cache the
// replacement resolve is about to read.
let resolveAbort: AbortController | null = null
/** Abort the in-flight source resolve — called when the picker is closed (X / click-off / Esc). */
export function cancelResolve() {
  finishResolveTrace(currentResolveTrace(), 'canceled by user')
  resolveAbort?.abort()
  resolveAbort = null
  // The fetches were "best-effort background" once; on a click they are contention on the very
  // lanes the picked source needs. Cut them loose — reissued fresh next resolve.
  cancelExtensionFetches()
}

// The in-flight DEBRID resolve (playStream's add/select/poll chain). Owned by the newest
// playStream: starting another play aborts the previous chain so a superseded uncached pick
// cannot keep polling in the background. Distinct from `resolveAbort` (the picker's source
// LISTING), which deliberately lets its fetches finish for reuse.
let activeDebridResolve: AbortController | null = null

// Wire the mpv event stream (emitted from Rust) to progress tracking, resume,
// and auto next-episode. Called once per play, after playback has started.
function attach(media: Media, episode: number, onState: (s: PlayState) => void) {
  // Tear down the previous play's listeners, then register the new set ATOMICALLY — this whole
  // body runs with no `await`, so a second play cannot interleave between teardown and
  // registration. `pushListen` stores each unlisten synchronously; `gen` guards the async
  // auto-advance against a stale player-ended still in flight from a superseded play.
  detach()
  const gen = playGen
  let marked = false
  let lastSave = 0
  let warmed = false
  let wrongDurationHandled = false
  pushListen<[number, number]>('player-progress', (e) => {
    const [pos, dur] = e.payload
    if (!wrongDurationHandled && implausiblyShortEpisode(media.duration, dur)) {
      wrongDurationHandled = true
      clearPosition(media.id, episode)
      void recoverPlaybackSource(0, true, 'Wrong short video detected — trying a full episode…')
      return
    }
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
    if ((get(bingePreload) || get(autoplayNext)) && dur > 0) {
      if (pos / dur > 0.85) prefetchNext(media, episode)
      if (!warmed && dur - pos < 20 && prefetched?.mediaId === media.id && prefetched.episode === episode + 1 && prefetched.stream.url) {
        warmed = true
        invoke('player_prefetch', { url: prefetched.stream.url }).catch(() => {})
      }
    }
  })
  // Finalize on close: the position write is throttled to 5s and the watch-mark only fires on a
  // live progress event ≥ threshold — so skimming to the end and immediately backing out could
  // save neither. The player dispatches `player-finalize` with its last pos/dur on close; persist
  // the resume point + mark watched here (idempotent — recordProgress maxes, `marked` guards).
  const onFinalize = (ev: Event) => {
    const { pos, dur } = (ev as CustomEvent<{ pos: number; dur: number }>).detail ?? {}
    if (!dur || dur <= 0) return
    // If EOF already tombstoned this episode (cleared), a near-end finalize must NOT resurrect a
    // ~100% resume point — that would reopen the episode seeked to the very end AND destroy the
    // cross-device completion tombstone. Still mark watched; just don't re-save the position.
    const existing = get(positions)[progressKey(media.id, episode)]
    if (existing?.cleared && watched(pos, dur)) {
      if (!marked) {
        marked = true
        markWatched(media, episode)
      }
      return
    }
    savePosition(media.id, episode, pos, dur)
    if (!marked && watched(pos, dur)) {
      marked = true
      markWatched(media, episode)
    }
  }
  window.addEventListener('player-finalize', onFinalize)
  stop.push(() => window.removeEventListener('player-finalize', onFinalize))
  pushListen('player-ended', async () => {
    // Finished: forget the resume point, then auto-advance if there's a next episode (bounded by
    // the known total). Fires when EITHER "Auto-play next" OR "Binge (preload)" is on — preload
    // warms the next episode near the end precisely so it continues automatically, so having it on
    // implies auto-advance. Advance continues the same release seamlessly, else opens the picker.
    clearPosition(media.id, episode)
    if (get(playerSleep).atEpisodeEnd) {
      playerSleep.set({ deadline: null, atEpisodeEnd: false })
      playerNotice.set('Sleep timer stopped autoplay')
      return
    }
    if (!get(autoplayNext) && !get(bingePreload)) return
    // A picker on screen means the user is mid-choice — most commonly "Change source" for THIS
    // very episode, whose old file can run to EOF while the replacement is still resolving.
    // Auto-advancing here would race the user's pick with the next episode and land the session
    // one episode off. Their choice (or the picker's own continuation) owns what plays next.
    if (get(streamPicker)) return
    const airedTotal = airedTotalOf(media)
    let next = episode + 1
    // Optionally skip past filler episodes (AnimeFillerList).
    if (get(skipFiller)) {
      const filler = await fillerEpisodes(media.id)
      while (next <= airedTotal && filler.includes(next)) next++
    }
    // Bail if a newer play has since taken over (this ended-event belongs to a superseded
    // episode) — otherwise two overlapping plays both advance and skip an episode.
    if (gen !== playGen) return
    if (next <= airedTotal) resolveAndPlayBest(media, next, onState, true)
  })
}

// Android embedded-player tracking: mirrors attach() but driven by the mpv plugin's observed-
// property stream (mpvState) instead of the desktop player-* events. No scrub-prefetch (that's a
// desktop-only command). Re-attaches per episode; the previous episode's subscription is torn down.
let stopAndroid: (() => void) | null = null
function detachAndroid() {
  stopAndroid?.()
  stopAndroid = null
}
function attachAndroid(
  media: Media,
  episode: number,
  onState: (s: PlayState) => void,
  directP2p: boolean,
) {
  detachAndroid()
  resetPrefetchMiss()
  let marked = false
  let lastSave = 0
  let ended = false
  let wrongDurationHandled = false
  let latest = get(mpvState)
  let recoveryWatch = resetRecoveryWatch(Date.now())
  let downloadedBytes = 0
  let selectedSize = 0
  let healthBusy = false
  let recoveryBusy = false
  const onEnded = async () => {
    clearPosition(media.id, episode)
    if (!get(autoplayNext) && !get(bingePreload)) return
    // Same guard as the desktop handler: an open picker means the user is mid-choice (Change
    // source), and the outgoing file reaching EOF must not race their pick with an auto-advance.
    if (get(streamPicker)) return
    const airedTotal = airedTotalOf(media)
    let next = episode + 1
    if (get(skipFiller)) {
      const filler = await fillerEpisodes(media.id)
      while (next <= airedTotal && filler.includes(next)) next++
    }
    if (next <= airedTotal) resolveAndPlayBest(media, next, onState, true)
  }
  // mpvState updates on every observed time-pos/duration/pause/eof — same cadence as the desktop
  // player-progress event, so the throttle + watch-threshold logic transfers directly.
  const unsub = mpvState.subscribe((s) => {
    latest = s
    const { pos, dur, eof, cacheEnd } = s
    reportDirectTorrentBuffer(pos, cacheEnd)
    if (!wrongDurationHandled && implausiblyShortEpisode(media.duration, dur)) {
      wrongDurationHandled = true
      clearPosition(media.id, episode)
      void recoverPlaybackSource(0, !s.paused, 'Wrong short video detected — trying a full episode…')
      return
    }
    if (dur > 0 && Date.now() - lastSave > 5000) {
      savePosition(media.id, episode, pos, dur)
      lastSave = Date.now()
    }
    if (!marked && watched(pos, dur)) {
      marked = true
      markWatched(media, episode)
    }
    // Preload the next episode's stream near the end so auto-advance / Next starts instantly.
    if ((get(bingePreload) || get(autoplayNext)) && dur > 0 && pos / dur > 0.85) prefetchNext(media, episode)
    if (eof && !ended) {
      ended = true
      if (prematureEof(pos, dur)) {
        recoveryBusy = true
        void recoverPlaybackSource(
          pos,
          !s.paused,
          'Source returned no playable video — trying another source…',
        ).catch((error) => {
          console.warn('automatic Android empty-source recovery', error)
          playerNotice.set('Automatic source recovery failed')
        // Always re-arm. This used to latch true on failure, so the FIRST failed recovery
        // permanently disabled the watchdog for the rest of the episode; the watch state machine
        // re-arms with fresh timestamps, so the next attempt is a full timeout window away.
        }).finally(() => { recoveryBusy = false })
      } else {
        onEnded()
      }
    }
  })
  const recoveryTimer = setInterval(() => {
    if (recoveryBusy) return
    if (directP2p && !healthBusy) {
      const playbackId = currentDirectTorrentPlaybackId()
      healthBusy = true
      void directTorrentHealth()
        .then((health) => {
          if (health && currentDirectTorrentPlaybackId() === playbackId) {
            downloadedBytes = health.downloadedBytes
            selectedSize = health.selectedSize
          }
        })
        .finally(() => { healthBusy = false })
    }
    const decision = recoveryWatchDecision(recoveryWatch, {
      now: Date.now(),
      position: latest.pos,
      duration: latest.dur,
      // "Paused" only counts once a frame exists: the watchdog deliberately holds off while
      // paused, but a load that never started can BE paused (a ghost tap on the spinner, or a
      // previous episode's pause carried into the replacement) — and that disarmed the
      // never-started clock entirely. That was the "black screen until pause/play is toggled"
      // report: the manual toggle was what re-armed the watchdog.
      paused: latest.paused && latest.frameReady,
      buffering: latest.buffering || latest.coreIdle,
      seeking: latest.seeking || latest.seekBusy,
      eof: latest.eof,
      firstFrame: latest.frameReady,
      startTimeoutMs: directP2p ? DIRECT_TORRENT_START_TIMEOUT_MS : undefined,
      networkBytes: directP2p ? downloadedBytes : undefined,
      minimumStartupBytesPerSecond: directP2p && media.duration && selectedSize > 0
        ? selectedSize / (media.duration * 60) * 0.5
        : undefined,
    })
    recoveryWatch = decision.state
    if (!decision.recover) return
    recoveryBusy = true
    void recoverPlaybackSource(
      latest.pos,
      !latest.paused,
      directP2p
        ? 'P2P source is too slow — trying a healthier torrent…'
        : 'Source failed to start — trying another source…',
    ).catch((error) => {
      console.warn('automatic Android playback recovery', error)
      playerNotice.set('Automatic source recovery failed')
    // Same re-arm as the premature-EOF path: a failed attempt must not latch the watchdog off.
    }).finally(() => { recoveryBusy = false })
  }, 1_000)
  stopAndroid = () => {
    unsub()
    clearInterval(recoveryTimer)
  }
}

/** Persist the resume point + mark-watched on manual close, then stop tracking. The throttled save
 *  can miss the last few seconds, so the AndroidPlayer calls this with its final pos/dur on close.
 *  Idempotent (savePosition maxes; markWatched has only-increase / complete-on-finish guards). */
export function finalizeAndroidWatch(pos: number, dur: number) {
  const np = get(nowPlaying)
  if (np.id != null && np.episode != null && dur > 0) {
    // Don't let a near-end close resurrect a resume point over an EOF completion tombstone
    // (see onFinalize) — still mark watched, just skip the position write.
    const existing = get(positions)[progressKey(np.id, np.episode)]
    if (existing?.cleared && watched(pos, dur)) {
      if (currentMedia) markWatched(currentMedia, np.episode)
    } else {
      savePosition(np.id, np.episode, pos, dur)
      if (currentMedia && watched(pos, dur)) markWatched(currentMedia, np.episode)
    }
  }
  detachAndroid()
}

// Enforce the season the user is on (hard-drop). Addons return
// cross-season files: Torrentio overflows TVDB seasons (kitsu:X:17 → S04E01), and
// Comet indexes S1 BluRay batches under a later season's kitsu id — so a S4E1
// request gets both correct S04E01 files AND wrong S01 batches, and a season-blind
// ranker can auto-play the wrong one. We DROP confident wrong-season files (parsed
// season/abs present and contradicting the ground truth), then float confident
// matches above unknown parses. Unknown parses are kept (never drop on uncertainty).
function verifySeason(streams: Stream[], want: EpisodeWant): Stream[] {
  const kept = streams.filter((s) => !isWrongSeason(s, want))
  if (!kept.length) return streams // safety net: never empty the list on over-eager parsing
  const good: Stream[] = [], unknown: Stream[] = []
  for (const s of kept) {
    const p = parseSeasonEp(s)
    const matches = (want.season != null && p.season === want.season)
      || (want.episode != null && p.episode === want.episode)
      || (want.abs != null && p.abs === want.abs)
    ;(matches ? good : unknown).push(s)
  }
  return [...good, ...unknown]
}

// Resolve the streams for an episode (kitsu id map → addons, plus any enabled
// source extensions). Returns the ranked list (cached first; uncached shown +
// flagged, dead sunk) plus the cached count, with wrong-season files dropped.
// Throws a user-facing message on failure.

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

async function resolveStreams(media: Media, episode: number | undefined): Promise<{ streams: Stream[]; cachedCount: number; want?: EpisodeWant; kitsu?: number }> {
  const bases = get(enabledAddonUrls)
  if (!bases.length) {
    if (await hasConfiguredExtensions()) return { streams: [], cachedCount: 0 }
    throw new Error('No sources configured — add an addon URL or install an anime package in Settings.')
  }
  const kitsu = await resolveKitsu(media)
  // No Kitsu id ⇒ addons (which index by it) can't be queried. Auto-advance is cached-addon-only,
  // so return nothing and let the caller fall back to the manual picker (its title/id extension
  // search can still find a title that isn't in Kitsu).
  if (!kitsu) return { streams: [], cachedCount: 0 }

  // Fetch streams and the AniZip season map CONCURRENTLY (independent round-trips).
  const seasonP = episode != null ? getEpisodeSeasonMap(media.id) : Promise.resolve({} as Record<number, { season?: number; abs?: number }>)
  const { streams: addonStreams, total, cachedCount } = await getStreams(bases, streamId(kitsu, episode), media.format === 'MOVIE' ? 'movie' : 'series')

  let streams = refineStreams(media, addonStreams).kept

  // Season enforcement: pair the requested episode with its AniZip season/absolute
  // number, then hard-drop returned files that contradict it. `want` is threaded to
  // pickBest so auto-select can't re-promote a wrong-season file either.
  let want: EpisodeWant | undefined
  if (episode != null) {
    const w = (await seasonP)[episode]
    want = { episode, ...(w ?? {}) }
    streams = verifySeason(streams, want)
  }

  // Only hard-fail when there's nothing playable AND no extensions to fall back on;
  // otherwise let the picker fill from extensions asynchronously.
  if (!streams.length && !await hasConfiguredExtensions()) {
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
  signal?: AbortSignal,
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
      episodeCount: totalEpisodes(media) || undefined,
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
      queryExtensions(query, fold, onlyOriginId, signal),
      queryTorrentProviders(query, toProviderMedia(media), fold, onlyOriginId, signal),
    ])
  } catch { /* best-effort: failed sources contributed nothing */ }
}

// Release-continuity across episodes. A stream continues the last-played release when it
// shares the Stremio bingeGroup, the exact pack infoHash, OR the parsed release group
// (fansub author) — the group match is what continues extension/fansub content, which
// carries no bingeGroup. `describe(s).group` is the same parse the picker heading uses.
export interface ContinueHint { bingeGroup?: string; infoHash?: string; group?: string; originId?: string; online?: boolean; audio?: 'sub' | 'dub' }
export function matchesRelease(s: Stream, c: ContinueHint): boolean {
  return !!(
    (c.bingeGroup && s.behaviorHints?.bingeGroup === c.bingeGroup)
    || (c.infoHash && s.infoHash === c.infoHash)
    || (c.group && describe(s).group?.toLowerCase() === c.group.toLowerCase())
    // Direct online sources: the provider IS the release identity. They carry no bingeGroup,
    // no infoHash and no parseable release group, so without this nothing ever matched and the
    // picker reopened for every episode of a binge.
    // Flavour is PART of that identity. A provider serves both sub and dub rows under one origin,
    // so matching the origin alone let the next episode silently revert to the flavour the user
    // had just switched away from mid-episode. Compared only when both sides declare one — a
    // provider that reports no flavour behaves exactly as before.
    // Provider identity is continuity only for DIRECT online streams. Torrent addon rows all share
    // the same origin id (for example every Torrentio release), so applying this clause to them
    // made an unrelated first-ranked torrent look like the same release.
    || (s.__stream && c.originId && s.__origin?.id === c.originId
      && (!c.audio || !s.__audio || s.__audio === c.audio))
  )
}

/** Pick a torrent that can continue the active release. Input order is already the addon's
 * ranking order. The exact pack wins; otherwise a per-episode torrent from the same release group
 * is valid. Kept pure/exported so real provider-shaped rows can regression-test the preloader. */
export function pickDirectPreloadCandidate(
  streams: Stream[],
  hint: ContinueHint | undefined,
  want?: EpisodeWant,
): Stream | undefined {
  if (!hint) return undefined
  const eligible = streams.filter((stream) =>
    !!stream.infoHash && !(want && isWrongSeason(stream, want)))
  return eligible.find((stream) =>
    !!hint.infoHash && stream.infoHash?.toLowerCase() === hint.infoHash.toLowerCase())
    ?? eligible.find((stream) => matchesRelease(stream, hint))
}
// The continuity hint for the NEXT episode of `media`: the release identity of what's
// playing now. undefined when continuity is off, nothing is playing, or it's a different
// title — the caller then just opens the picker normally.
function continueHint(media: Media): ContinueHint | undefined {
  if (!get(bingePreload) && !get(autoplayNext)) return undefined
  const b = get(bingeSource)
  if (!b || b.mediaId !== media.id || !(b.bingeGroup || b.infoHash || b.group || b.originId)) return undefined
  return { bingeGroup: b.bingeGroup, infoHash: b.infoHash, group: b.group, originId: b.originId, online: b.online, audio: b.audio }
}
// A stream mpv can start without a multi-minute debrid cache: a direct online stream, an
// already-resolved url, or a debrid-cached torrent (⚡ — resolves in ~1s).
const playableNow = (s: Stream) => !!(s.__stream || s.url || isCached(s))
// The SAME-release source for this episode, ready-to-play only (never a debrid download or
// a wrong-season file). undefined when continuity is off or nothing matches — the caller
// then opens the picker instead of auto-playing an unrelated best-quality file.
function pickSameRelease(media: Media, streams: Stream[], want?: EpisodeWant): Stream | undefined {
  const c = continueHint(media)
  if (!c) return undefined
  return streams.find((s) => matchesRelease(s, c) && playableNow(s) && !isUncached(s) && !(want && isWrongSeason(s, want)))
}

// Episode-selection context for debrid: tells the provider WHICH file of a (possibly
// batch/season-pack) torrent to play, instead of its legacy largest-file pick. AniZip's
// season/abs pair disambiguates absolute-numbered files and multi-season packs; the
// addon's behaviorHints.filename (batch rows name the exact in-pack file) is an exact
// match hint. Best-effort — an empty want keeps the legacy behavior.
async function episodeWant(media: Media, episode: number | undefined, stream?: Stream): Promise<EpisodeWant | undefined> {
  if (episode == null) return undefined
  const map = await getEpisodeSeasonMap(media.id).catch(() => ({} as Record<number, { season?: number; abs?: number }>))
  const sm = map[episode]
  return { episode, abs: sm?.abs, season: sm?.season, filename: stream?.behaviorHints?.filename }
}

// Next episode resolved ahead of time (near the end of the current one) so Next /
// auto-advance starts instantly — no addon query or debrid round-trip at the cut.
let prefetched: { mediaId: number; episode: number; stream: Stream; at?: number } | null = null
let prefetching = false
// Negative cache for prefetchNext. `prefetched` is only ever assigned on SUCCESS, so a miss (no
// cached same-release, or a throw) left every guard below false — and the progress handler calls
// this at 4Hz for the whole last 15% of an episode. A miss therefore re-ran the complete multi-addon
// fan-out plus refineStreams over every returned row, hundreds of times per episode, on the same
// core that is decoding video. That is guaranteed for anyone without debrid, since pickSameRelease
// only ever matches a debrid-cached release.
// A cooldown rather than a permanent tombstone: an uncached release CAN become cached mid-episode
// (another client, or the debrid service finishing), and a tombstone would silently kill the
// feature for the rest of the episode.
const PREFETCH_MISS_MS = 60_000
let prefetchMiss: { key: string; at: number } | null = null
const prefetchKey = (mediaId: number, episode: number) => `${mediaId}:${episode}`
/** Forget the miss cooldown — the episode changed, so the next target is different. */
function resetPrefetchMiss() { prefetchMiss = null }

/** Resolve a direct-P2P continuation progressively. `getStreams()` deliberately waits for every
 * configured addon; that is useful for a complete picker, but disastrous for background preload:
 * one unrelated addon consuming its 22 s budget used to hide a Torrentio match that arrived in
 * ~200 ms. Race each addon and stop at the first continuity-safe torrent instead. */
async function resolveDirectPreloadStream(
  media: Media,
  episode: number,
  hint: ContinueHint | undefined,
): Promise<{ stream: Stream; want: EpisodeWant; provider: string; rows: number } | undefined> {
  if (!hint) return undefined
  const bases = get(enabledAddonUrls)
  if (!bases.length) return undefined
  const [kitsu, seasonMap] = await Promise.all([
    resolveKitsu(media),
    getEpisodeSeasonMap(media.id).catch(() => ({} as Record<number, { season?: number; abs?: number }>)),
  ])
  if (!kitsu) return undefined
  const mapped = seasonMap[episode]
  const want: EpisodeWant = { episode, ...(mapped ?? {}) }
  const controller = new AbortController()
  const id = streamId(kitsu, episode)
  const kind = media.format === 'MOVIE' ? 'movie' : 'series'
  const waitForHedge = (delayMs: number) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
  const query = async (base: string, delayMs = 0) => {
    if (delayMs) await waitForHedge(delayMs)
    const provider = `${addonTraceName(base)}${delayMs ? ' (hedge)' : ''}`
    const startedAt = performance.now()
    const response = await fetchAddonStreams(base, id, kind, undefined, controller.signal)
    const refined = verifySeason(refineStreams(media, response.streams).kept, want)
    const normalized = refined.map((stream) => {
      const hash = torrentioResolverInfoHash(stream.url, stream.__addonName ?? stream.name)
      return hash ? { ...stream, url: undefined, infoHash: hash } : stream
    })
    const stream = pickDirectPreloadCandidate(normalized, hint, want)
    if (import.meta.env.DEV) console.info(`[binge-preload] ADDON episode ${episode}`, {
      provider,
      durationMs: Math.round(performance.now() - startedAt),
      rawRows: response.total,
      usableRows: normalized.length,
      continuityMatch: !!stream,
    })
    if (!stream) throw new Error(`${provider}: no continuity match`)
    return { stream, want, provider, rows: normalized.length }
  }
  const attempts = bases.flatMap((base) => [
    query(base),
    // The supplied log ended at 22,017 ms — Torrentio's exact budget — despite this episode being
    // present on its endpoint. A delayed duplicate is a standard hedge against a single wedged
    // request. It never runs when the first call is healthy and is aborted with every loser.
    ...(/torrentio/i.test(base) ? [query(base, 1_200)] : []),
  ])
  try {
    return await Promise.any(attempts)
  } catch {
    return undefined
  } finally {
    // The winner is enough. Cancel slower addon stream calls so they do not retain native HTTP
    // pool slots while P2P metadata and tracker work begins.
    controller.abort()
  }
}

/** Resolve the next episode's (cached, same-release-preferred) stream in the
 *  background so the transition is instant. Best-effort; cached-only (never
 *  proactively starts a debrid download). */
async function prefetchNext(media: Media, episode: number) {
  if (!get(bingePreload) && !get(autoplayNext)) return
  const airedTotal = airedTotalOf(media)
  const next = episode + 1
  if (next > airedTotal || prefetching) return
  if (prefetched?.mediaId === media.id && prefetched.episode === next) return
  // Guard BEFORE resolveStreams — the whole point is to skip the fan-out, not just the pick.
  const key = prefetchKey(media.id, next)
  if (prefetchMiss?.key === key && Date.now() - prefetchMiss.at < PREFETCH_MISS_MS) return
  prefetching = true
  let hit = false
  const startedAt = performance.now()
  if (import.meta.env.DEV) console.info(`[binge-preload] START episode ${next}`, {
    mediaId: media.id,
    directP2p: directP2pEnabled(),
  })
  try {
    // Online-extension binge: the addon path below cannot see these sources at all
    // (resolveStreams is addon-only), so the next episode used to start COLD every time — a full
    // picker resolve per transition. Same-origin pre-resolve instead: search + episode list are
    // memo hits from THIS episode, so this is one background video-list call against the provider
    // already playing. Generated at 85%, consumed at the episode cut — comfortably inside the
    // lifetime of these tokenized URLs; takePrefetched enforces a max age regardless.
    const b = get(bingeSource)
    if (b && b.mediaId === media.id && b.online && b.originId) {
      const rows = await resolveOnlineStreams(media, next, b.originId)
      // Same provider AND same flavour first: warming the sub of an episode the user is watching
      // in dub hands auto-advance a stream that undoes their switch.
      const s = rows.find((r) => r.__origin?.id === b.originId && !!r.url && (!b.audio || r.__audio === b.audio))
        ?? rows.find((r) => r.__origin?.id === b.originId && !!r.url)
        ?? rows.find((r) => !!r.url)
      if (s?.url) {
        prefetched = { mediaId: media.id, episode: next, stream: s, at: Date.now() }
        nextEpisodeReady.set({ mediaId: media.id, episode: next })
        hit = true
        if (import.meta.env.DEV) console.info(`[binge-preload] READY episode ${next}`, {
          durationMs: Math.round(performance.now() - startedAt),
          mode: 'online-provider',
        })
      }
      return
    }
    const directP2p = directP2pEnabled()
    const activeRelease = get(bingeSource)
    const directHint: ContinueHint | undefined = activeRelease?.mediaId === media.id
      ? {
          bingeGroup: activeRelease.bingeGroup,
          infoHash: activeRelease.infoHash,
          group: activeRelease.group,
          originId: activeRelease.originId,
          online: activeRelease.online,
          audio: activeRelease.audio,
        }
      : undefined
    const directResult = directP2p
      ? await resolveDirectPreloadStream(media, next, directHint)
      : undefined
    const resolved = directP2p
      ? { streams: directResult ? [directResult.stream] : [], want: directResult?.want }
      : await resolveStreams(media, next)
    const { streams, want } = resolved
    const best = directP2p ? streams[0] : pickSameRelease(media, streams, want)
    if (!best) return // no cached same-release — leave it to the picker rather than force a download
    // Recover the hash from a debrid resolver URL exactly as playStream does. Without this the
    // prefetch stored the resolver URL untouched, playStream then discarded it at play time and
    // ran the whole debrid resolve anyway — so for these rows the preload did nothing at all
    // beyond the addon fan-out, which is most of why "next episode" felt slow.
    const resolverHash = torrentioResolverInfoHash(best.url, best.__addonName ?? best.name)
    let s = resolverHash ? { ...best, url: undefined, infoHash: resolverHash } : best
    if (directP2p) {
      if (!s.infoHash || currentDirectTorrentPlaybackId() == null) return
      const preload = await prepareDirectTorrentNext({
        infoHash: s.infoHash,
        magnet: s.__magnet ?? `magnet:?xt=urn:btih:${s.infoHash}`,
        preferredFilename: s.behaviorHints?.filename,
        seriesTitle: title(media),
        episode: next,
        absoluteEpisode: want?.abs,
        season: want?.season,
      })
      if (!preload) return
      prefetched = { mediaId: media.id, episode: next, stream: s, at: Date.now() }
      nextEpisodeReady.set({ mediaId: media.id, episode: next })
      hit = true
      if (import.meta.env.DEV) console.info(`[binge-preload] READY episode ${next}`, {
        durationMs: Math.round(performance.now() - startedAt),
        mode: preload.sameTorrent ? 'direct-p2p-season-pack' : 'direct-p2p-next-torrent',
        provider: directResult?.provider,
        candidateRows: directResult?.rows,
        releaseGroup: describe(s).group,
        fileIndex: preload.fileIndex,
        fileSizeMiB: Math.round(preload.size / 1024 / 1024),
        alreadyDownloadedMiB: Math.round(preload.downloadedBytes / 1024 / 1024),
      })
      return
    }
    if (!s.url && s.infoHash) {
      s = { ...s, url: await resolveHash(get(debridProvider), get(debridKey), s.__magnet ?? s.infoHash, {
        want: { episode: next, abs: want?.abs, season: want?.season, filename: s.behaviorHints?.filename },
        noAdd: true,
      }) }
    }
    if (s.url) {
      prefetched = { mediaId: media.id, episode: next, stream: s, at: Date.now() }
      nextEpisodeReady.set({ mediaId: media.id, episode: next })
      hit = true
      if (import.meta.env.DEV) console.info(`[binge-preload] READY episode ${next}`, {
        durationMs: Math.round(performance.now() - startedAt),
        mode: 'debrid-cdn',
      })
    }
  }
  catch (error) {
    if (import.meta.env.DEV) console.warn(`[binge-preload] FAILED episode ${next}`, {
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    })
    /* Best-effort: the normal resolve still runs at play time. */
  }
  finally {
    prefetching = false
    prefetchMiss = hit ? null : { key, at: Date.now() }
    if (import.meta.env.DEV && !hit) console.info(`[binge-preload] MISS episode ${next}`, {
      durationMs: Math.round(performance.now() - startedAt),
      retryAfterMs: PREFETCH_MISS_MS,
    })
  }
}

/** Consume a matching prefetched stream, if one is ready for this exact episode. */
function takePrefetched(mediaId: number, episode: number): Stream | null {
  const pf = prefetched
  if (!pf || pf.mediaId !== mediaId || pf.episode !== episode || !(pf.stream.url || pf.stream.infoHash)) return null
  // Tokenized/time-limited URLs (online extensions, debrid CDN links) must not be replayed long
  // after they were minted — a paused-overnight binge would otherwise consume a dead link and
  // look like a broken player instead of just resolving fresh.
  if (pf.at != null && Date.now() - pf.at > 10 * 60_000) {
    prefetched = null
    nextEpisodeReady.set(null)
    return null
  }
  // Consumption-time same-release check, in case the playStream invalidation raced or never ran
  // (e.g. the source change failed after resetting bingeSource): the release actually on screen is
  // bingeSource, and a prefetch that doesn't continue IT would replay the pre-change release. The
  // comparison is the same predicate pickSameRelease used to select the prefetch, so an unchanged
  // release always passes.
  const b = get(bingeSource)
  if (
    b && b.mediaId === mediaId
    && (b.bingeGroup || b.infoHash || b.group || b.originId)
    && !matchesRelease(pf.stream, { bingeGroup: b.bingeGroup, infoHash: b.infoHash, group: b.group, originId: b.originId })
  ) {
    prefetched = null
    nextEpisodeReady.set(null)
    return null
  }
  prefetched = null
  nextEpisodeReady.set(null)
  return pf.stream
}

function retainRecoveryCandidates(media: Media, episode: number | undefined, streams: Stream[]) {
  playbackRecovery.update((current) => {
    const same = current?.media.id === media.id && current.episode === episode
    return {
      media,
      episode,
      streams,
      current: same ? current.current : null,
      attempted: same ? current.attempted : [],
      recovering: same ? current.recovering : false,
    }
  })
}

// User-initiated play: resolve, then show the source picker. The user picks a source and
// `playStream` starts it. `continuation` (set by auto-advance) carries the previous episode's
// release identity: as sources fold in, a same-release one auto-continues without the user
// touching the picker — a ready one instantly, an uncached one after the list settles.
export async function playEpisode(
  media: Media,
  episode: number | undefined,
  onState: (s: PlayState) => void,
  options: PlayEpisodeOptions = {},
) {
  const trace = beginResolveTrace({
    mediaId: media.id,
    episode,
    title: title(media),
    entry: 'episode click',
  })
  traceResolve(trace, 'resolve configuration', {
    forceManual: !!options.forceManual,
    continuation: !!options.continuation,
    autoplay: options.autoplay ?? true,
    preferredQuality: get(preferredQuality),
    autoSelect: get(autoSelectSource),
    torrentMode: get(torrentPlaybackMode),
    debridProvider: get(debridKey) ? providerName(get(debridProvider)) : 'none',
    cacheCheck: activeCacheCheck(),
  })
  // Cancel a watchdog replacement immediately, before this new episode has even resolved a source.
  invalidatePlaybackOwner()
  const cont = options.continuation
  const autoplay = options.autoplay ?? true
  // Supersede any resolve still running from a previous click (its fetches keep going in the
  // background, but this one owns the picker now). `signal` also lets an explicit close abort us.
  // Done FIRST so even an offline/instant play cancels a stale resolve that's still holding a picker.
  resolveAbort?.abort()
  const abort = new AbortController()
  resolveAbort = abort
  const { signal } = abort
  retainRecoveryCandidates(media, episode, [])
  // Offline first: a completed local download plays instantly — no resolve, no
  // picker. libmpv opens an absolute local path exactly like a remote URL.
  const local = episode != null ? downloadOf(media.id, episode) : undefined
  if (local?.status === 'done' && local.path) {
    traceResolve(trace, 'completed download hit; skipping source discovery')
    return await playStream(
      media,
      episode,
      { url: local.path, name: '📥 Downloaded' } as Stream,
      onState,
      { autoplay },
    )
  }
  onState({ status: 'resolving' })
  // Continuing a binge: keep the picker HIDDEN while we look for the same source. It used to open
  // in its skeleton state for the whole lookup and then close itself the moment continuity landed,
  // so every episode flashed a selector the user never needed to see. Revealed only if the
  // continuation actually fails — see the reveal after the post-settle fallback.
  let hideForContinuation = !!cont
  // Open the picker immediately in a skeleton (resolving) state — no "Resolving
  // stream…" text; it fills in with real sources as EACH addon responds.
  streamPicker.set({
    media,
    episode,
    streams: [],
    cachedCount: 0,
    resolving: true,
    hidden: hideForContinuation,
    manualOnly: options.forceManual,
    autoplay,
  })
  // The picker is the UI from here — unless it is hidden (binge continuation), in which case the
  // connecting screen stays up as the only thing holding the user.
  if (!hideForContinuation) connecting.set(null)
  const stillCurrent = () => {
    const current = get(streamPicker)
    // Media + episode are not a unique request identity: a closed picker can be reopened for the
    // same episode while this request's uncancelled network work is still settling. Only the latest
    // controller may mutate the picker, otherwise stale batches/errors leak into the new request.
    return resolveAbort === abort && !signal.aborted
      && !!current && current.media.id === media.id && current.episode === episode
  }
  // Make a picker hidden for a binge continuation visible again: the continuation is off the table,
  // so the user has to choose (or at least see why nothing played).
  const revealPicker = () => {
    hideForContinuation = false
    connecting.set(null)
    if (!stillCurrent()) return
    streamPicker.update((c) => c ? { ...c, hidden: false } : c)
  }
  const showPickerError = (message: string) => {
    if (!stillCurrent()) return
    traceResolve(trace, 'picker error', { message })
    finishResolveTrace(trace, 'picker error')
    cacheSettled = true
    streamPicker.update((current) => current ? {
      ...current,
      resolving: false,
      playbackError: message,
      // An error is always shown, even for a single source that was otherwise hidden — a silent
      // failure would look exactly like nothing happening.
      hidden: false,
    } : current)
    onState({ status: 'error', message })
  }

  // --- debrid cache state ----------------------------------------------------
  // Ask the active provider which of these torrents it can play instantly, and stamp the replies
  // onto the streams so describe() can badge them honestly.
  //
  // Answers accumulate in a MAP rather than being patched into one Stream[] because refresh()
  // rebuilds the row list from `acc` every time a source lands — a one-shot patch would be thrown
  // away by the next fold. Re-applying the map on every refresh also covers a hash that arrives
  // late from a slower addon after we already have its answer.
  //
  // Timing is load-bearing: annotation is applied ONLY while the picker is still resolving, when
  // rows are already appearing and animated-resorting. Once the list settles the user is reading
  // and clicking it, and a late promotion to 'instant' would re-sort a row to the top of its tier
  // out from under their cursor mid-click.
  const cacheAnswers = new Map<string, 'cached' | 'uncached'>()
  const cacheAsked = new Set<string>()
  const cacheChecks: Promise<unknown>[] = []
  const cacheProvider = get(debridProvider)
  const cacheKey = get(debridKey)
  const cacheMode = activeCacheCheck()
  let cacheSettled = false
  /** Ask the provider about every not-yet-asked infoHash in ONE batched call, then hand the new
   *  answers back via `onAnswers`. Deliberately fire-and-forget — a cache badge is a nicety and
   *  must never delay the picker or block playback (checkCached itself never throws). */
  const askCache = (streams: Stream[], onAnswers: () => void) => {
    if (cacheMode === 'none' || cacheSettled) return
    const hashes: string[] = []
    for (const s of streams) {
      // Skip rows the addon already spoke for (its own ⚡/⬇ glyph outranks us in describe() anyway)
      // and rows an earlier wave already asked about.
      if (!s.infoHash || s.__cache || isCached(s) || isUncached(s)) continue
      const h = s.infoHash.toLowerCase()
      if (cacheAsked.has(h)) continue
      cacheAsked.add(h)
      hashes.push(h)
    }
    if (!hashes.length) return
    const cacheStartedAt = performance.now()
    traceResolve(trace, 'debrid cache check start', {
      provider: providerName(cacheProvider), hashes: hashes.length, mode: cacheMode,
    })
    cacheChecks.push(checkCached(cacheProvider, cacheKey, hashes).then((map) => {
      traceResolve(trace, 'debrid cache check finish', {
        durationMs: Math.round(performance.now() - cacheStartedAt),
        answers: map.size,
        cached: [...map.values()].filter((value) => value === 'cached').length,
        uncached: [...map.values()].filter((value) => value === 'uncached').length,
      })
      // Dropped on purpose once the list has settled or the picker moved on: see the timing note.
      if (!map.size || cacheSettled || !stillCurrent()) return
      for (const [h, v] of map) cacheAnswers.set(h, v)
      onAnswers()
    }))
  }
  /** Give checks that are ALREADY in flight a bounded chance to land before the list settles.
   *  Without it a fast single-source resolve finishes before its own check answers and the badges
   *  are discarded by the settle gate — the picker is still visibly resolving here, so this costs
   *  no perceived latency. Hard-capped so a slow provider can never pin the picker open. */
  const CACHE_GRACE_MS = 2000
  const settleCacheChecks = async () => {
    if (!cacheChecks.length) return
    await Promise.race([
      Promise.allSettled(cacheChecks),
      new Promise((resolve) => setTimeout(resolve, CACHE_GRACE_MS)),
    ])
  }
  // Closing the picker aborts and clears the controller, so its caller still needs to leave the
  // resolving state. A newer request replaces the controller; the superseded caller must not emit
  // a late idle/error that can overwrite that newer request's state.
  const settleCancellation = () => {
    if (resolveAbort === null) {
      finishResolveTrace(trace, 'source discovery canceled')
      onState({ status: 'idle' })
    }
  }
  try {
    // Instant path: this episode was prefetched near the end of the previous one
    // (binge continuity) — skip the picker entirely.
    if (!options.forceManual && get(autoSelectSource) && episode != null) {
      const pre = takePrefetched(media.id, episode)
      if (pre) {
        streamPicker.set(null)
        return await playStream(media, episode, pre, onState, { autoplay })
      }
    }

    const bases = get(enabledAddonUrls)
    const extensionCheckStartedAt = performance.now()
    const hasExt = await hasConfiguredExtensions()
    traceResolve(trace, 'source inventory ready', {
      durationMs: Math.round(performance.now() - extensionCheckStartedAt),
      addons: bases.map(addonTraceName),
      extensionsEnabled: hasExt,
    })
    if (!bases.length && !hasExt) throw new Error('No sources configured — add an addon URL or install an anime package in Settings.')
    // One provider is not one source: AllAnime and similar providers can expose several hosts,
    // qualities, subtitle sets, or audio variants. A manual episode click therefore keeps the
    // chooser visible regardless of provider count; the normal Auto preference may choose later.
    const kitsuStartedAt = performance.now()
    traceResolve(trace, 'Kitsu mapping start')
    const kitsu = await resolveKitsu(media)
    traceResolve(trace, 'Kitsu mapping finish', {
      durationMs: Math.round(performance.now() - kitsuStartedAt),
      found: kitsu != null,
      kitsuId: kitsu,
    })
    // Addons index by Kitsu id; extensions search by title/MAL/AniDB. A title with no Kitsu id
    // (e.g. an OVA that isn't in Kitsu) can still be sourced by extensions, so only hard-fail when
    // there's no Kitsu id AND no extension to fall back on. When kitsu is missing we skip the addon
    // queries entirely and let the extension wave do the sourcing.
    if (!kitsu && !hasExt) throw new Error('No addon mapping for this title (not in Kitsu). Add a source extension to find it by title.')

    const type = media.format === 'MOVIE' ? 'movie' : 'series'
    const seasonStartedAt = performance.now()
    const seasonP = episode != null ? getEpisodeSeasonMap(media.id) : Promise.resolve({} as Record<number, { season?: number; abs?: number }>)

    // Fold each addon's streams into the picker AS IT RESPONDS (one
    // origin loads, the rest stream in, the list re-ranks + animated-sorts live)
    // rather than waiting on the slowest. `want` (season) applies as soon as AniZip
    // answers, concurrent with the addon fetches.
    let acc: Stream[] = []
    let want: EpisodeWant | undefined
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
        }, { autoplay })
        return played
      })()
    }
    // Autoplay readiness. Three ways to become ready, earliest wins:
    //   * the pick we would actually commit to is cached, in the user's language and past the
    //     season gate, and has HELD that position for 350ms (so a better row arriving mid-hold
    //     restarts it rather than being pre-empted),
    //   * 1.5s after the first result when something instantly playable is on screen, or when
    //     direct P2P owns uncached rows; 4s only when those rows imply a debrid download,
    //   * every source settled, which is the old behaviour and remains the backstop.
    const READY_HELD_MS = 350
    const READY_INSTANT_MS = 1500
    const READY_COLD_MS = directP2pEnabled() ? READY_INSTANT_MS : 4000
    let autoReady = false
    let resolveSettled = false
    let firstResultAt = 0
    let readyAt = 0
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    let heldKey = ''
    let heldSince = 0
    const clearReadyTimer = () => { if (readyTimer) { clearTimeout(readyTimer); readyTimer = undefined } }
    const scheduleReady = (s: Stream[]) => {
      if (autoReady || !s.length) return
      const now = Date.now()
      if (!firstResultAt) firstResultAt = now
      // Season correctness outranks speed: until AniZip has answered we cannot know that the top
      // row is even the right episode, so the confident path stays shut (the same gate the
      // same-release continuation uses).
      const top = seasonSettled ? pickBest(s, get(preferredQuality), want, rankOpts(media.id)) : undefined
      let deadline: number
      if (top) {
        const key = top.url ?? top.infoHash ?? ''
        if (key !== heldKey) { heldKey = key; heldSince = now }
        deadline = heldSince + READY_HELD_MS
      } else {
        heldKey = ''; heldSince = 0
        const instant = s.some((x) => !!x.url && !isUncached(x))
        deadline = firstResultAt + (instant ? READY_INSTANT_MS : READY_COLD_MS)
      }
      if (readyTimer && deadline === readyAt) return
      clearReadyTimer()
      readyAt = deadline
      readyTimer = setTimeout(() => {
        readyTimer = undefined
        autoReady = true
        traceResolve(trace, 'autoplay became ready', {
          waitFromFirstResultMs: firstResultAt ? Date.now() - firstResultAt : 0,
          seasonSettled,
          heldTopCandidate: !!heldKey,
        })
        if (stillCurrent()) paint(true)
      }, Math.max(0, deadline - now))
    }

    let lastPaintTrace = ''
    const paint = (resolving: boolean) => {
      const refined = refineStreams(media, acc)
      let s = refined.kept
      if (want) s = verifySeason(s, want)
      // `strict` means the user excluded the rest deliberately, so an empty list is the correct
      // answer rather than a reason to quietly play something they ruled out. A no-op in `prefer`
      // mode and whenever no trust order has been stated at all.
      s = applyPriorityFilter(s, get(sourcePriority), get(sourcePriorityMode))
      s = annotateCache(s, cacheAnswers, cacheMode === 'library' ? 'library' : 'native')
      retainRecoveryCandidates(media, episode, s)
      const paintTrace = `${acc.length}|${s.length}|${refined.rejected.length}|${resolving}`
      if (paintTrace !== lastPaintTrace) {
        lastPaintTrace = paintTrace
        traceResolve(trace, resolving ? 'picker update' : 'picker settled', {
          rawRows: acc.length,
          usableRows: s.length,
          rejectedRows: refined.rejected.length,
          cachedRows: s.filter((row) => describe(row).cached === 'instant').length,
          ...batchTraceDetails(s),
        })
      }
      if (resolving) scheduleReady(s)
      else { clearReadyTimer(); autoReady = true; resolveSettled = true; cacheSettled = true }
      streamPicker.set({
        media,
        episode,
        streams: s,
        rejected: refined.rejected,
        cachedCount: s.filter((x) => describe(x).cached === 'instant').length,
        resolving,
        autoReady,
        hidden: hideForContinuation,
        manualOnly: options.forceManual,
        autoplay,
      })
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
      // Kick off the next batched cache lookup for whatever just folded in. Only while resolving:
      // its answer re-sorts the list, which is only safe while the rows are still moving anyway.
      if (resolving) askCache(s, () => refresh(true))
    }

    // Every addon, extension batch and online provider calls refresh as it lands, so a ~20-source
    // resolve fired ~20 full re-derive + re-render passes, several inside the same frame. Leading
    // edge keeps the first source painting instantly; the trailing flush means the last arrival is
    // never the one that gets dropped. The terminal refresh(false) always bypasses.
    const PAINT_MS = 150
    let lastPaint = 0
    let queuedPaint: ReturnType<typeof setTimeout> | undefined
    const refresh = (resolving: boolean) => {
      if (!stillCurrent()) return
      if (queuedPaint) { clearTimeout(queuedPaint); queuedPaint = undefined }
      if (!resolving) { lastPaint = Date.now(); paint(false); return }
      const waited = Date.now() - lastPaint
      if (waited >= PAINT_MS) { lastPaint = Date.now(); paint(true); return }
      queuedPaint = setTimeout(() => {
        queuedPaint = undefined
        lastPaint = Date.now()
        if (stillCurrent()) paint(true)
      }, PAINT_MS - waited)
    }
    // A superseded or closed picker must not keep timers alive behind it.
    signal.addEventListener('abort', () => {
      clearReadyTimer()
      if (queuedPaint) { clearTimeout(queuedPaint); queuedPaint = undefined }
    }, { once: true })

    // Resolve the season target, then unblock + re-run auto-continue. `.finally` so a title with
    // no AniZip season data still flips seasonSettled (nothing to wrong-season against).
    const seasonReady = seasonP.then((m) => {
      if (episode != null) want = { episode, ...(m[episode] ?? {}) }
    }).catch((error) => {
      traceResolveError(trace, 'episode season mapping failed', error)
    }).finally(() => {
      seasonSettled = true
      traceResolve(trace, 'episode season mapping finish', {
        durationMs: Math.round(performance.now() - seasonStartedAt),
        season: want?.season,
        absoluteEpisode: want?.abs,
      })
      refresh(true)
    })

    // Each SOURCE (every addon + the extensions as one wave) folds into the picker as
    // it lands — a genuine multi-source trickle + live re-sort, not a
    // late extension dump. `resolving` only flips false once ALL sources settle (so
    // the autoplay countdown targets the FINAL best pick).
    // Addons only when we have the Kitsu id they need; the extension wave always runs if configured.
    // +1 slot for the aligned-imdb wave below, which has to be waited on even though it fires
    // late: for a title whose addons are all imdb-only, it is the wave that returns everything,
    // and settling without it would show "no sources found" a moment before they arrive.
    let pending = (kitsu != null ? bases.length : 0) + (hasExt ? 2 : 0) + (bases.length ? 1 : 0)
    traceResolve(trace, 'source fan-out start', {
      pendingWaves: pending,
      kitsuAddonRequests: kitsu != null ? bases.length : 0,
      alignedIdWave: bases.length > 0,
      torrentExtensions: hasExt,
      onlineExtensions: hasExt,
    })
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
          const provider = addonTraceName(base)
          const addonStartedAt = performance.now()
          traceResolve(trace, 'add-on request start', { provider, namespace: 'kitsu' })
          // An addon that blows its budget is slow, not wrong: its rows still fold into an open
          // picker whenever they land, instead of being dropped on the floor as they used to be.
          fetchAddonStreams(base, id, type, (late) => {
            if (!stillCurrent()) return
            traceResolve(trace, 'add-on late batch', {
              provider,
              durationMs: Math.round(performance.now() - addonStartedAt),
              rawRows: late.total,
              ...batchTraceDetails(late.streams),
            })
            acc = [...acc, ...late.streams]; totalRaw += late.total
            // A response that outlived the whole resolve must not put a settled picker back into
            // its loading state — the rows just appear.
            refresh(!resolveSettled)
          }, signal)
            .then((r) => {
              traceResolve(trace, 'add-on request finish', {
                provider,
                durationMs: Math.round(performance.now() - addonStartedAt),
                rawRows: r.total,
                ...batchTraceDetails(r.streams),
              })
              acc = [...acc, ...r.streams]; totalRaw += r.total; refresh(true)
            })
            .catch((error) => traceResolveError(trace, 'add-on request failed', error, {
              provider, durationMs: Math.round(performance.now() - addonStartedAt),
            }))
            .finally(done)
        }
      }
      // Second wave, on the id namespace the anime one cannot reach. A stream addon configured
      // for imdb ids returns nothing for `kitsu:` and was previously the entirety of what izumi
      // asked it. This fires only from a mapping that named both the season and the per-season
      // episode number, so the triple is aligned rather than guessed; refineStreams and
      // verifySeason remain the safety net for whatever it brings back.
      if (bases.length) {
        const fold = (r: { streams: Stream[]; total: number }) => {
          if (!stillCurrent() || !r.streams.length) return
          traceResolve(trace, 'aligned-id add-on batch', { rawRows: r.total, ...batchTraceDetails(r.streams) })
          acc = [...acc, ...r.streams]; totalRaw += r.total; refresh(!resolveSettled)
        }
        const alignedStartedAt = performance.now()
        traceResolve(trace, 'aligned IMDb/season mapping start')
        getExtensionIds(media.id, episode)
          .then(async (ids) => {
            const extra = buildStreamIds({ type, imdb: ids.imdbId, season: ids.season, imdbEpisode: ids.episodeNumber, episode })
            traceResolve(trace, 'aligned IMDb/season mapping finish', {
              durationMs: Math.round(performance.now() - alignedStartedAt),
              requestIds: extra.length,
            })
            if (!extra.length || !stillCurrent()) return
            await Promise.all(bases.map(async (base) => {
              const provider = addonTraceName(base)
              const startedAt = performance.now()
              traceResolve(trace, 'add-on request start', { provider, namespace: 'aligned-imdb' })
              try {
                const result = await fetchAddonStreams(base, extra, type, fold, signal)
                traceResolve(trace, 'add-on request finish', {
                  provider,
                  namespace: 'aligned-imdb',
                  durationMs: Math.round(performance.now() - startedAt),
                  rawRows: result.total,
                  ...batchTraceDetails(result.streams),
                })
                fold(result)
              } catch (error) {
                traceResolveError(trace, 'add-on request failed', error, {
                  provider, namespace: 'aligned-imdb', durationMs: Math.round(performance.now() - startedAt),
                })
              }
            }))
          })
          .catch((error) => traceResolveError(trace, 'aligned IMDb/season mapping failed', error))
          .finally(done)
      }
      // Umbrella budget on both extension waves: the per-call caps BOUND each hop, but a provider
      // with many aliases (or several slow providers) still stacks them serially — recovery and
      // downloads already carry exactly this budget, and the picker (the most user-visible wait of
      // the three) was the only resolve without one. Late results still fold in via the callbacks;
      // the budget only stops the WAIT.
      const EXT_WAVE_BUDGET_MS = 30_000
      const budget = async (label: string, work: Promise<unknown>) => {
        const startedAt = performance.now()
        let timedOut = false
        let timeout: ReturnType<typeof setTimeout> | undefined
        traceResolve(trace, `${label} wave start`, { budgetMs: EXT_WAVE_BUDGET_MS })
        await Promise.race([
          work.catch((error) => traceResolveError(trace, `${label} wave failed`, error)),
          new Promise<void>((resolve) => {
            timeout = setTimeout(() => { timedOut = true; resolve() }, EXT_WAVE_BUDGET_MS)
          }),
        ])
        if (timeout) clearTimeout(timeout)
        traceResolve(trace, `${label} wave finish`, {
          durationMs: Math.round(performance.now() - startedAt), timedOut,
        })
      }
      if (hasExt) {
        budget('torrent extension', extToStreams(media, episode, kitsu, (s) => {
          if (s.length) {
            traceResolve(trace, 'torrent extension batch', batchTraceDetails(s))
            acc = [...acc, ...s]; refresh(true)
          }
        }, undefined, signal))
          .finally(done)
      }
      if (hasExt) {
        // Fold each provider in as it settles, exactly like the torrent wave above — otherwise one
        // slow (or wedged, 20s-capped) provider hides every fast one's results until it gives up.
        budget('online extension', resolveOnlineStreams(media, episode, undefined, (s) => {
          if (s.length) {
            traceResolve(trace, 'online extension batch', batchTraceDetails(s))
            acc = [...acc, ...s]; refresh(true)
          }
        }, signal))
          .finally(done)
      }
    })
    traceResolve(trace, 'source fan-out wait complete', {
      rawRows: totalRaw,
      accumulatedRows: acc.length,
      aborted: signal.aborted,
    })
    await seasonReady
    // If the picker was closed, settle its caller to idle now so the next click works. If a newer
    // play superseded this one, stay silent because that request now owns the caller's state.
    if (signal.aborted) return settleCancellation()
    // A ready-to-play same-release source may have been tried while results streamed in. Wait for
    // its real outcome: success closes the picker; failure finishes populating it for manual choice.
    if (continuationAttempt && await continuationAttempt) return
    // Last chance for an in-flight cache answer to reach the rows while they are still animating.
    const cacheGraceStartedAt = performance.now()
    await settleCacheChecks()
    if (cacheChecks.length) traceResolve(trace, 'cache-check grace complete', {
      durationMs: Math.round(performance.now() - cacheGraceStartedAt),
      checks: cacheChecks.length,
      answers: cacheAnswers.size,
    })
    if (signal.aborted) return settleCancellation()
    refresh(false)
    if (continuationError && stillCurrent()) {
      // A failed continuation must be visible, not swallowed behind the hidden picker.
      revealPicker()
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
      let s = refineStreams(media, acc).kept
      if (want) s = verifySeason(s, want)
      const hit = s.find((x) => matchesRelease(x, cont))
      if (hit) {
        tryContinuation(hit)
        if (continuationAttempt && await continuationAttempt) return
        if (continuationError && stillCurrent()) {
          revealPicker()
          streamPicker.update((current) => current ? { ...current, playbackError: continuationError } : current)
        }
      }
    }

    // Every continuation route is exhausted (none matched, or the attempt failed), so the user has
    // to choose after all — reveal the picker. Up to this point it stayed hidden so a successful
    // binge continuation never flashes a selector on its way to the next episode.
    if (hideForContinuation) revealPicker()

    // The user already acted on this picker (picked a source / navigated away) → it's no longer
    // current; settle this resolve neutrally instead of firing a spurious "no streams" error.
    if (!stillCurrent()) return onState({ status: 'idle' })

    // Nothing playable → honest error.
    if (!get(streamPicker)?.streams.length) {
      return showPickerError(totalRaw > 0
        ? `Found ${totalRaw} torrents but none are usable (all dead or notice entries). Try another source.`
        : 'No streams found for this title/episode yet.')
    }
    traceResolve(trace, 'picker ready for source selection', {
      rawRows: totalRaw,
      ...batchTraceDetails(get(streamPicker)?.streams ?? []),
    })
    onState({ status: 'idle' })
  }
  catch (e) {
    if (signal.aborted) return settleCancellation()
    traceResolveError(trace, 'source discovery failed', e)
    finishResolveTrace(trace, 'source discovery error')
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

  streams = refineStreams(media, streams).kept
  const map = await getEpisodeSeasonMap(media.id).catch(() => ({} as Record<number, { season?: number; abs?: number }>))
  const want: EpisodeWant = { episode, ...(map[episode] ?? {}) }
  streams = verifySeason(streams, want)
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
  return pickBest(rankStreams(streams, 'quality', rankOpts(media.id)), get(preferredQuality), want, rankOpts(media.id))
}

/** Resume from Continue Watching / the detail Continue button. Refresh the trimmed home-card Media
 *  snapshot first, then try the remembered origin. A miss or playback error falls through to the
 *  same unrestricted picker used by a direct episode click — without retrying the failed release. */
export async function resumeEpisode(media: Media, episode: number, onState: (s: PlayState) => void) {
  onState({ status: 'resolving' })
  // Nothing is on screen yet: the picker is not open and no source has been chosen, but the media
  // refetch and the remembered-source lookup below are both network round trips. This window used
  // to be covered by a line of text on the detail page; without it the app simply looked frozen.
  connecting.set({
    title: title(media),
    art: banner(media) || cover(media),
    cancel: () => { connecting.set(null); cancelResolve() },
  })
  const current = await fetchMediaById(media.id).catch(() => media)
  // "Continue" is an explicit request for continuity, independent of the general source-picker
  // mode. Always try the last successful provider/release first; countdown/manual preferences only
  // govern the recovery picker when that remembered source is missing or can no longer play.
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
let advanceGeneration = 0
async function resolveAndPlayBest(
  media: Media,
  episode: number | undefined,
  onState: (s: PlayState) => void,
  autoplay = true,
) {
  const generation = ++advanceGeneration
  onState({ status: 'resolving' })
  // Cover the previous file immediately. Resolving the remembered release can take several
  // network round trips; leaving mpv's keep-open frame visible during that work made the old
  // episode/anime look like it was still the thing being loaded.
  connecting.set({
    title: title(media),
    detail: episode != null ? `Episode ${episode}` : undefined,
    art: banner(media) || cover(media),
    cancel: () => {
      if (generation === advanceGeneration) advanceGeneration++
      connecting.set(null)
      cancelResolve()
    },
  })
  // Instant path: use the stream prefetched near the end of the previous episode.
  if (episode != null) {
    const pre = takePrefetched(media.id, episode)
    if (pre) return await playStream(media, episode, pre, onState, { autoplay })
  }
  // Seamless continuity: if the addons already have a CACHED source from the same release
  // we were watching, play it straight away — no picker between back-to-back episodes.
  // Direct P2P deliberately skips this shortcut: preserving a group must not bypass the torrent
  // health/size ranking and commit Next to another multi-gigabyte release.
  if (!directP2pEnabled()) {
    try {
      const { streams, want } = await resolveStreams(media, episode)
      if (generation !== advanceGeneration) return onState({ status: 'idle' })
      const same = pickSameRelease(media, streams, want)
      if (same) return await playStream(media, episode, same, onState, { autoplay })
    }
    catch { /* no addons / nothing yet — the full picker below still queries extensions */ }
  }
  if (generation !== advanceGeneration) return onState({ status: 'idle' })
  // No cached same-release: open the full source picker (addons + extensions) for this
  // episode, carrying the continuity hint so a same-release source auto-continues when it
  // lands (extension/fansub content), and otherwise the user picks. This replaces the old
  // dead-end "no cached source" toast — the next episode always goes somewhere.
  //
  // Direct-P2P blocks TORRENT continuations on purpose (Next must not silently commit to another
  // multi-gigabyte release without the health/size ranking) — but that rationale has nothing to
  // say about ONLINE streaming sources, and blocking those forced extension binges through the
  // full visible picker on every single episode. A hint marked `online` continues in every mode.
  const hint = continueHint(media)
  return await playEpisode(media, episode, onState, {
    continuation: directP2pEnabled() && !hint?.online ? undefined : hint,
    autoplay,
  })
}

// Play a specific chosen stream: embed mpv into the main window + wire progress /
// resume / auto next-episode. Closes the picker.
export async function playStream(
  media: Media,
  episode: number | undefined,
  stream: Stream,
  report: (s: PlayState) => void,
  options: PlayStreamOptions = {},
) {
  const trace = currentResolveTrace(media.id, episode) ?? beginResolveTrace({
    mediaId: media.id,
    episode,
    title: title(media),
    entry: options.recoveryOwner ? 'watchdog source replacement' : 'source selection',
  })
  traceResolve(trace, 'source selected', streamTraceDetails(stream, rankOpts(media.id)))
  const playbackOwner = beginPlaybackOwner(options.recoveryOwner)
  if (!playbackOwner) {
    finishResolveTrace(trace, 'stale source selection')
    return
  }
  const stillOwnsPlayback = () => ownsPlayback(playbackOwner)
  const directStartupId = nextDirectTorrentStartupId()
  const cancelPlaybackStart = () => {
    if (!cancelPlaybackOwner(playbackOwner)) return
    void cancelDirectTorrentStartup(directStartupId)
    activeDebridResolve?.abort()
    activeDebridResolve = null
    debridCaching.set(null)
    connecting.set(null)
    cancelResolve()
    // The owner is deliberately invalid now, so onState would suppress this as stale. Notify the
    // caller directly to re-enable a source picker that was waiting on this exact request.
    report({ status: 'idle' })
  }
  // A newer play supersedes whatever debrid resolve a previous playStream still has in flight.
  // Without this, an abandoned uncached pick kept polling the provider every <=3s for up to 30
  // minutes (its timeout below) — each probe now occupies a pooled-HTTP slot, so zombie resolves
  // were competing with the episode the user actually asked for.
  activeDebridResolve?.abort()
  activeDebridResolve = null
  const autoplay = options.autoplay ?? true
  const recoveryOriginal = stream
  playbackRecovery.update((current) => {
    const same = current?.media.id === media.id && current.episode === episode
    const streams = same ? current.streams : []
    return {
      media,
      episode,
      streams: streams.some((candidate) => recoveryStreamKey(candidate) === recoveryStreamKey(recoveryOriginal))
        ? streams
        : [...streams, recoveryOriginal],
      current: recoveryOriginal,
      attempted: same && current.recovering ? current.attempted : [],
      recovering: same ? current.recovering : false,
    }
  })
  let androidFrameTracePending = false
  // Every exit from this function goes through the state callback, so wrapping it once clears the
  // connecting screen on all of them — including the early returns.
  const onState = (s: PlayState) => {
    if (!stillOwnsPlayback()) return
    if (s.status !== 'resolving') connecting.set(null)
    traceResolve(trace, `playback state: ${s.status}`, s.message ? { message: s.message } : {})
    report(s)
    // For local P2P, player_embed only means mpv accepted the loopback URL. Keep the trace alive
    // until an actual duration/progress event so the headline timing is click-to-first-frame,
    // rather than hiding peer/download/probe delay behind an optimistic "playing" result.
    const awaitsMeasuredFirstFrame = directPlaybackId != null
      && !get(enableExternalPlayer)
      && (!get(isAndroid) || androidFrameTracePending)
    if (s.status === 'playing' && !awaitsMeasuredFirstFrame) {
      finishResolveTrace(trace, 'playing', streamTraceDetails(stream))
    }
    else if (s.status === 'error') finishResolveTrace(trace, 'playback error')
    else if (s.status === 'idle') finishResolveTrace(trace, 'playback canceled')
  }
  connecting.set({
    title: title(media),
    detail: stream.behaviorHints?.filename || stream.title?.split('\n')[0] || '',
    // Carried on the payload rather than read from nowPlayingMedia, which this function sets a few
    // lines later — the overlay would otherwise paint the previous episode's art for a frame.
    art: banner(media) || cover(media),
    cancel: cancelPlaybackStart,
  })
  let directPlaybackId: number | null = null
  const abandonIfStale = async () => {
    if (stillOwnsPlayback()) return false
    if (directPlaybackId != null) {
      await discardDirectTorrentPlayback(directPlaybackId)
      directPlaybackId = null
    }
    return true
  }
  let directTorrentSubtitles: DirectTorrentSubtitle[] = []
  // Set only on the debrid path, so sidecar subtitles can be resolved after playback starts.
  let debridSidecarSource: { provider: string; key: string; torrent: string; want?: EpisodeWant } | null = null
  // Torrentio's debrid `url` contains an account token and can resolve to RD's tiny copyright
  // placeholder while still looking like a valid video to mpv. Recover the public infohash and
  // deliberately discard that private URL: Izumi's resolver has provider-error + filesize guards,
  // and Watch Together may now share the hash without leaking the token embedded in the path.
  const resolverHash = torrentioResolverInfoHash(stream.url, stream.__addonName ?? stream.name)
  if (resolverHash) {
    traceResolve(trace, 'credential-bearing resolver URL converted to local hash resolution')
    stream = { ...stream, url: undefined, infoHash: resolverHash }
  }
  // Remember what's playing so the player's "Change source" can re-open the picker for it.
  nowPlayingMedia.set({ media, episode })
  // Provisional room source, so a guest joining mid-resolve still sees what is starting. It is
  // re-captured from the FINAL stream below, once any debrid resolution has happened.
  nowPlayingPartySource.set(shareableSource(stream))
  lastSubFilename = stream.behaviorHints?.filename
  onlineSubCandidates.set({ status: 'idle', items: [] })
  subtitleNotice.set('')
  torrentSubtitleState.set({ playbackId: null, status: 'idle', loaded: 0, total: 0, revision: 0 })
  // Fetch external subtitles from any subtitle-capable addon (OpenSubtitles etc) CONCURRENTLY with the
  // slow source resolve below, so they're ready by embed time without adding latency. Skipped for the
  // generic external players and Android lite (they own subtitle handling). Best-effort — [] on any failure.
  // Also skipped in offline mode — the external-subtitle addons are network-only, and offline
  // playback is always a local file (any embedded/downloaded subs travel with it).
  const platformStartedAt = performance.now()
  const androidEmbedded = get(isAndroid) ? await hasEmbeddedPlayer() : false
  traceResolve(trace, 'playback platform ready', {
    durationMs: Math.round(performance.now() - platformStartedAt),
    android: get(isAndroid), androidEmbedded, externalPlayer: get(enableExternalPlayer),
  })
  if (!stillOwnsPlayback()) return
  // Note: the picker closes itself on the 'playing' state (so an embed error stays
  // visible in it); auto-next calls this with no picker open.
  // Torrent results carry only an infoHash/magnet. Turn that into a player-openable URL
  // through either the local P2P engine or the user's debrid service.
  if (!stream?.url && stream?.infoHash) {
    const provider = get(debridProvider)
    const key = get(debridKey)
    const torrent = stream.__magnet ?? stream.infoHash
    const wantStartedAt = performance.now()
    const want = await episodeWant(media, episode, stream)
    traceResolve(trace, 'torrent episode mapping ready', {
      durationMs: Math.round(performance.now() - wantStartedAt),
      season: want?.season, episode: want?.episode, absoluteEpisode: want?.abs,
    })
    if (!stillOwnsPlayback()) return
    const direct = options.forceDirect || get(torrentPlaybackMode) === 'direct' || !key
    if (direct) {
      onState({ status: 'resolving' })
      const directStartedAt = performance.now()
      traceResolve(trace, 'direct P2P engine start', {
        forced: !!options.forceDirect,
        hasDebridKey: !!key,
        startupTimeoutMs: options.directStartupTimeoutMs ?? 60_000,
      })
      try {
        const playback = await invoke<DirectTorrentPlayback>('torrent_playback_url', {
          magnet: stream.__magnet ?? `magnet:?xt=urn:btih:${torrent}`,
          preferredFilename: stream.behaviorHints?.filename,
          seriesTitle: title(media),
          episode: want?.episode,
          absoluteEpisode: want?.abs,
          season: want?.season,
          startupTimeoutMs: options.directStartupTimeoutMs,
          startupId: directStartupId,
          ...torrentEngineNetworkOptions(),
        })
        if (!stillOwnsPlayback()) {
          await discardDirectTorrentPlayback(playback.playbackId)
          return
        }
        directPlaybackId = playback.playbackId
        directTorrentSubtitles = playback.subtitles
        activateDirectTorrentPlayback(playback.playbackId)
        stream = {
          ...stream,
          url: playback.url,
          behaviorHints: { ...stream.behaviorHints, filename: playback.filename, videoSize: playback.size },
        }
        traceResolve(trace, 'direct P2P engine ready', {
          durationMs: Math.round(performance.now() - directStartedAt),
          fileSizeMiB: Math.round(playback.size / 1024 / 1024),
          selectedFilename: playback.filename,
          torrentSizeMiB: Math.round(playback.torrentSize / 1024 / 1024),
          pieceCount: playback.pieceCount,
          subtitleFiles: playback.subtitles.length,
          engineReadyMs: playback.engineReadyMs,
          metadataMs: playback.metadataMs,
          activeLockWaitMs: playback.activeLockWaitMs,
          initializationMs: playback.initializationMs,
          nativeTotalMs: playback.totalMs,
          reusedTorrent: playback.reusedTorrent,
          metadataPeers: playback.metadataPeers,
          metadataCached: playback.metadataCached,
          metadataCache: playback.metadataCache,
          trackerCount: playback.trackerCount,
          incomingPeerPort: playback.incomingPeerPort,
          fastresumePrimed: playback.fastresumePrimed,
        })
      } catch (e) {
        if (!stillOwnsPlayback()) return
        traceResolveError(trace, 'direct P2P engine failed', e, {
          durationMs: Math.round(performance.now() - directStartedAt),
        })
        return onState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }
    if (!stream.url) {
      const pname = providerName(provider)
      onState({ status: 'resolving' })
      const debridStartedAt = performance.now()
      traceResolve(trace, 'debrid resolution start', { provider: pname })
      // A CACHED (⚡/[RD+]) source resolves in ~1s (debrid already has it), so it plays off the
      // picker's lightweight spinner with no full-screen "downloading to debrid" screen. That
      // screen is only for a genuine multi-minute cache: shown upfront for a known-uncached pick,
      // and escalated to if a supposedly-cached hash turns out stale and actually starts
      // downloading. The AbortController lets Cancel stop the poll (the torrent keeps caching at
      // the service, so a later retry is instant).
      const controller = new AbortController()
      activeDebridResolve = controller
      let overlayShown = false
      const showCaching = () => {
        if (overlayShown || !stillOwnsPlayback()) return
        overlayShown = true
        debridCaching.set({
          provider: pname, title: title(media), episode, cover: cover(media), info: { stage: 'queued' },
          // Optimistic cancel: close the screen IMMEDIATELY on the first click, then abort the poll in
          // the background. The eventual AbortError just settles playStream to 'idle' (re-enabling the
          // picker); a late onStatus can't resurrect the screen because the store is already null.
          cancel: cancelPlaybackStart,
        })
      }
      // The caching screen appears only when we are genuinely WAITING ON DEBRID, not merely
      // resolving. Both of its old triggers were proxies for that and both were wrong: a
      // known-uncached row showed it upfront even though most of the resolve is our own lookups,
      // and a wall-clock grace fired on any slow resolve regardless of cause. The source-resolve
      // screen covers that whole period already, and it carries the same Cancel.
      //
      // The honest signal is the provider itself saying "not ready": `poll` only calls onStatus
      // for a queued/downloading probe, and never runs at all for a cached hash. Two of them, so a
      // torrent that finishes on the second probe never flashes a downloading screen on its way to
      // playing.
      // See caching-screen.ts for why this is not simply "it has been a while".
      let notReady = 0
      // Time since the PROVIDER first said not-ready, not since this function began. The clock used
      // to start here, which meant it was counting the AniZip lookup, the debrid account scan, the
      // add and the file selection — all our own work, none of it a download. Six seconds of that
      // elapsed routinely, so the very first probe arrived with the threshold already passed.
      let firstNotReadyAt = 0
      // NOTE: there is deliberately no "show it immediately when the picker is hidden" branch here
      // any more. That existed when the connecting screen lived inside the picker and so did not
      // exist without it — but Continue Watching and binge continuation both run with the picker
      // hidden or closed, so the branch fired unconditionally for them and took over before a
      // single probe had been made. The connecting screen is app-wide now and holds every path.
      try {
        const url = await resolveHash(provider, key, torrent, {
          signal: controller.signal,
          timeoutMs: 30 * 60 * 1000,
          priority: true,
          onStatus: (i) => {
            if (!stillOwnsPlayback()) return
            traceResolve(trace, 'debrid status', {
              provider: pname,
              stage: i.stage,
              progress: i.progress,
              probes: notReady + 1,
            })
            if (!firstNotReadyAt) firstNotReadyAt = Date.now()
            if (!overlayShown && shouldShowCachingScreen({
              probes: ++notReady,
              waitedMs: Date.now() - firstNotReadyAt,
              progress: i.progress,
            })) showCaching()
            if (overlayShown) debridCaching.update((c) => (c ? { ...c, info: i } : c))
          },
          want,
        })
        if (!stillOwnsPlayback()) return
        stream = { ...stream, url }
        debridSidecarSource = { provider, key, torrent, want }
        debridCaching.set(null)
        if (activeDebridResolve === controller) activeDebridResolve = null
        traceResolve(trace, 'debrid resolution finish', {
          provider: pname,
          durationMs: Math.round(performance.now() - debridStartedAt),
          notReadyProbes: notReady,
          cachingOverlayShown: overlayShown,
        })
      }
      catch (e) {
        if (stillOwnsPlayback()) debridCaching.set(null)
        if (activeDebridResolve === controller) activeDebridResolve = null
        if (!stillOwnsPlayback()) return
        traceResolveError(trace, 'debrid resolution failed', e, {
          provider: pname,
          durationMs: Math.round(performance.now() - debridStartedAt),
          notReadyProbes: notReady,
        })
        // User-initiated cancel: quietly return to the picker, no error toast.
        if (e instanceof Error && e.name === 'AbortError') return onState({ status: 'idle' })
        return onState({ status: 'error', message: e instanceof Error ? e.message : String(e), debridBlocked: isDebridBlocked(e) })
      }
    }
  }
  if (!stillOwnsPlayback()) return
  if (!stream?.url) return onState({ status: 'error', message: 'That source has no playable link.' })
  // Wait until the final byte-addressable URL is known. Direct P2P is the exception: probing its
  // loopback stream for an exact subtitle hash would compete with mpv's startup reads, so search by
  // episode/filename instead and attach the results after player_embed.
  const subtitlesStartedAt = performance.now()
  const skipExternalSubtitles = (get(isAndroid) ? !androidEmbedded : get(enableExternalPlayer)) || get(offlineMode)
  if (skipExternalSubtitles) traceResolve(trace, 'external subtitle search skipped')
  else traceResolve(trace, 'external subtitle search start', { addOnCount: get(enabledAddonUrls).length })
  const subsP: Promise<SubtitleCandidate[]> = (skipExternalSubtitles
    ? Promise.resolve([])
    : fetchExternalSubtitles(
        get(enabledAddonUrls),
        media,
        episode,
        stream.behaviorHints?.filename,
        directPlaybackId == null
          ? {
              url: stream.url,
              size: stream.behaviorHints?.videoSize,
              hash: typeof stream.behaviorHints?.videoHash === 'string' ? stream.behaviorHints.videoHash : undefined,
              headers: stream.__headers,
            }
          : undefined,
      )).then((rows) => {
        traceResolve(trace, 'external subtitle search finish', {
          durationMs: Math.round(performance.now() - subtitlesStartedAt),
          candidates: rows.length,
          directUrls: rows.filter((row) => !!row.url).length,
          needsFetch: rows.filter((row) => !!row.download?.needsFetch).length,
        })
        return rows
      }).catch((error) => {
        traceResolveError(trace, 'external subtitle search failed', error, {
          durationMs: Math.round(performance.now() - subtitlesStartedAt),
        })
        return []
      })
  // Re-capture the room source from the FINAL stream. For a debrid play this is the resolved,
  // account-bound CDN link, and it is shared as-is: guests play the host's exact URL rather than
  // needing a debrid account each. The host is warned about what that means for their account
  // before the room opens (DebridRoomNotice). Direct-P2P resolves to a loopback address, which
  // shareableSource skips in favour of the infohash, so those rooms are unaffected.
  nowPlayingPartySource.set(shareableSource(stream))
  // A newly resolved direct torrent replaces the old one in the native engine. Any other source
  // ends the previous torrent's watch phase before the new player load begins.
  if (directPlaybackId == null && currentDirectTorrentPlaybackId() != null) {
    const stopTorrentStartedAt = performance.now()
    traceResolve(trace, 'stop previous direct torrent start')
    await stopDirectTorrentPlayback()
    traceResolve(trace, 'stop previous direct torrent finish', {
      durationMs: Math.round(performance.now() - stopTorrentStartedAt),
    })
    if (!stillOwnsPlayback()) return
  }
  const rememberSuccess = () => rememberSourceOrigin(media.id, stream.__origin, {
    infoHash: stream.infoHash,
    bingeGroup: stream.behaviorHints?.bingeGroup,
    group: describe(stream).group,
  })
  try {
    currentMedia = media
    playerLoadId.update((id) => id + 1)
    // Resume from the last saved position for this exact episode, if any.
    const startSeconds = options.startSeconds ?? (episode != null ? getPosition(media.id, episode) : 0)
    const label = episode != null ? `${title(media)} — Episode ${episode}` : title(media)
    // Schedule-aware so the Next button + "Ep X / N" work on airing-schedule-only titles
    // (episodes/nextAiringEpisode both null on AniList). null when genuinely unknown, so the
    // Next gate (`airedTotal != null && episode < airedTotal`) stays hidden rather than wrong.
    const airedTotal = airedTotalOf(media) || null
    const total = totalEpisodes(media) || airedTotal
    nowPlaying.set({
      title: label, animeTitle: title(media), id: media.id, malId: media.idMal ?? null,
      episode: episode ?? null, total, airedTotal,
    })
    nowPlayingUrl.set(stream.url) // for the dev-only Copy URL tool in the track menu
    // Local watch history: record the open now (covers embedded + external playback), so Continue
    // Watching lists this show even with no AniList/MyAnimeList linked. Also remember this source's
    // release identity so Continue Watching can resume the SAME release later. Progress bumps on watch.
    recordPlay(media, episode, { group: describe(stream).group, bingeGroup: stream.behaviorHints?.bingeGroup })

    // Remember this stream's release identity so the next episode can continue from the SAME
    // release without re-picking — by pack infoHash / Stremio bingeGroup, or the parsed release
    // group (fansub author) for extension content that has neither. Set in the COMMON section on
    // purpose: the Android and external-player paths return before the desktop embed, and skipping
    // them left `bingeSource` pointing at whatever release a previous playStream set — so on those
    // paths "Next" continued the pre-change release after a manual source change.
    // `online` marks a DIRECT streaming source (no torrent behind it) — the flag that lets
    // same-origin continuation stay on in Direct-P2P mode, where torrent continuations are
    // deliberately blocked (see resolveAndPlayBest).
    const releaseIdentity = { bingeGroup: stream.behaviorHints?.bingeGroup, infoHash: stream.infoHash, group: describe(stream).group, originId: stream.__origin?.id, online: !!stream.__stream, audio: stream.__audio }
    bingeSource.set({ mediaId: media.id, ...releaseIdentity })
    // A prefetched next episode continues the release that was playing when the prefetch ran.
    // Starting a DIFFERENT release now (manual source change) makes that stored stream — and its
    // lit "next is ready" dot — a trap: Next/auto-advance would silently drag the binge back onto
    // the release from BEFORE the change. Drop it the moment the release identity changes.
    if (prefetched && prefetched.mediaId === media.id && !matchesRelease(prefetched.stream, releaseIdentity)) {
      prefetched = null
      nextEpisodeReady.set(null)
    }

    // Android full: play through embedded mpv. Android lite falls back to an external player. This
    // returns before the desktop embed below, so nothing libmpv-related runs and `playing` stays
    // false (browse UI stays up, no overlay). The episode is marked watched when the user returns.
    if (get(isAndroid)) {
      // "Full" flavor: embedded libmpv player (renders in-app). The plugin only exists when the
      // app was built with the `android-mpv` feature; on the "lite" build hasEmbeddedPlayer() is
      // false and we fall through to the external-player intent below.
      if (androidEmbedded) {
        // Same short gate as the desktop embed (it was 4s here — pure added latency on every
        // Android episode transition whenever a subtitle addon was slow); late results attach to
        // the live player below instead of being dropped.
        const addonSubs = await Promise.race([subsP, new Promise<SubtitleCandidate[]>((r) => setTimeout(() => r([]), 1500))])
        if (await abandonIfStale()) return
        onlineSubCandidates.set({
          status: addonSubs.length ? 'ready' : 'searching',
          items: addonSubs.filter((s) => s.download?.needsFetch),
        })
        const sourceSubs = stream.__stream ? stream.__subtitles ?? [] : []
        const preferred = get(preferredSubLang)
        let selectedPreferred = false
        const subs = [
          ...sourceSubs.map((s) => ({
            url: s.url,
            lang: s.lang,
            title: s.title,
          })),
          ...directTorrentSubtitles.map((s) => ({
            url: s.url,
            lang: s.lang,
            title: s.title,
          })),
          ...addonSubs.filter((s) => !!s.url).map((s) => ({
            url: s.url!,
            lang: normalizeLang(s.lang),
            title: s.release ?? s.lang ?? 'Online subtitles',
          })),
        ].map((subtitle) => {
          const lang = normalizeLang(subtitle.lang) ?? subtitle.lang
          const selected = preferred !== 'none' && !selectedPreferred && lang === preferred
          if (selected) selectedPreferred = true
          return { ...subtitle, lang, selected }
        })
        const sidecarHeaders = Object.assign(
          {},
          ...sourceSubs.map((s) => s.headers ?? {}),
        )
        const headers = {
          ...sidecarHeaders,
          ...(stream.__stream ? stream.__headers ?? {} : {}),
        }
        await startMpvEvents()
        if (await abandonIfStale()) return
        // The reusable Android core emits the outgoing file's teardown while `loadfile` queues the
        // replacement. Stop its episode tracker first so those events cannot recover/advance the
        // previous episode during a manual Next transition.
        detachAndroid()
        await mpvLoad({
          url: stream.url,
          title: label,
          startPos: startSeconds || 0,
          subtitles: subs,
          alang: get(preferredAudioLang),
          slang: preferred,
          headers,
          autoplay,
        })
        if (await abandonIfStale()) return
        // This episode+source is now the one on screen, so the watchdog may recover against it.
        recordPlaybackIdentity({ media, episode, stream: recoveryOriginal })
        // Stash the resolved URL + headers so the scrubber's thumbnail grabber can decode frames.
        androidStreamInfo.set({ url: stream.url, headers })
        androidMpvActive.set(true)
        rememberSuccess()
        androidFrameTracePending = directPlaybackId != null
        onState({ status: 'playing' })
        if (episode != null) attachAndroid(media, episode, onState, directPlaybackId != null)
        if (directPlaybackId != null) {
          const playbackId = directPlaybackId
          traceResolve(trace, 'waiting for Android first video frame')
          void waitForMpvFirstFrame(DIRECT_TORRENT_HARD_START_TIMEOUT_MS).then((ready) => {
            if (!stillOwnsPlayback()) return
            // The native HTTP request normally retired this cursor already. This remains a safe
            // fallback for players/platform events that reached a frame without the notification.
            void directTorrentPlayerAttached(playbackId)
            androidFrameTracePending = false
            finishResolveTrace(
              trace,
              ready ? 'Android first video frame' : 'Android first video frame timeout',
              streamTraceDetails(stream),
            )
          })
        }
        // Late online subtitles (Android mirror of the desktop path): if the short race above lost
        // to a slow subtitle addon, fold results in once they land. `androidStreamInfo.url` pins
        // the results to THIS load — a newer episode replaces it before its own mpvLoad.
        if (!addonSubs.length) {
          const loadUrl = stream.url
          void subsP.then(async (cands) => {
            if (get(androidStreamInfo)?.url !== loadUrl || !get(androidMpvActive)) return
            onlineSubCandidates.set({ status: 'ready', items: cands.filter((s) => s.download?.needsFetch) })
            for (const s of cands) {
              if (!s.url) continue
              if (get(androidStreamInfo)?.url !== loadUrl || !get(androidMpvActive)) return
              const lang = normalizeLang(s.lang) ?? s.lang ?? 'und'
              await mpvCommand(['sub-add', s.url, 'auto', s.release ?? s.lang ?? 'Online subtitles', lang])
                .catch(() => { /* a missing subtitle must never disturb playback */ })
            }
          })
        }
        return
      }
      // A completed download resolves to an absolute on-disk path (not an http URL); flag it so the
      // native side exposes it through a FileProvider content:// URI (a raw file path can't be
      // ACTION_VIEW'd across apps since Android 7).
      const isLocalFile = !/^https?:\/\//i.test(stream.url)
      const ok = await playViaIntent(
        media,
        episode ?? null,
        stream.url,
        isLocalFile,
        directPlaybackId == null ? undefined : () => stopDirectTorrentPlayback(directPlaybackId),
      )
      if (await abandonIfStale()) return
      if (!ok && directPlaybackId != null) void stopDirectTorrentPlayback(directPlaybackId)
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
      // No embedded playback follows, so `attach()` never runs to replace the previous episode's
      // listeners. Drop them here or they keep tracking against the old episode. See detach().
      detach()
      let unlistenExit: (() => void) | undefined
      if (directPlaybackId != null) {
        const id = directPlaybackId
        unlistenExit = await listen('external-player-exited', () => {
          unlistenExit?.()
          void stopDirectTorrentPlayback(id)
        })
        if (await abandonIfStale()) { unlistenExit?.(); return }
      }
      try {
        await invoke('spawn_external_player', {
          path,
          url: stream.url,
          headers: stream.__headers,
        })
        if (await abandonIfStale()) { unlistenExit?.(); return }
      } catch (error) {
        unlistenExit?.()
        throw error
      }
      rememberSuccess()
      onState({ status: 'playing' })
      return
    }

    // Seed the scrub-preview sprite key (infoHash identifies the exact file; fall
    // back to media-episode). The seekbar kicks off generation once mpv reports the
    // duration. Set BEFORE embed so the seekbar sees it as soon as the overlay mounts.
    spriteKey.set(stream.infoHash ?? `${media.id}-${episode ?? 0}`)

    // Embed mpv FIRST — it renders behind the still-opaque webview — THEN reveal the
    // overlay + punch the transparent hole. Otherwise the window is briefly
    // transparent with nothing behind it and the desktop flashes through.
    // Size the demuxer cache for THIS file before loading it: the preset scales up with the file's
    // bitrate (videoSize ÷ runtime), so a 4K Blu-ray buffers as many seconds as the preset holds for
    // 1080p instead of rebuffering on a fixed byte cap. Applied on the next load (this one).
    const durationSec = media.duration ? media.duration * 60 : undefined
    const playerCacheStartedAt = performance.now()
    traceResolve(trace, 'configure player cache start')
    await invoke('set_player_cache', {
      bytes: playerCacheBytes(get(playerCacheMb), stream.behaviorHints?.videoSize, durationSec),
    }).catch(() => {})
    traceResolve(trace, 'configure player cache finish', {
      durationMs: Math.round(performance.now() - playerCacheStartedAt),
    })
    if (await abandonIfStale()) return
    // Await the addon subtitles (bounded — a slow subtitle addon must not hold up playback), and merge
    // them with any the source itself carried (online-stream __subtitles). mpv sub-adds all of them;
    // slang auto-selects the preferred language. The bound used to be 4s, which was the single
    // biggest fixed cost on click-to-video whenever a subtitle addon was having a slow day; late
    // results now attach to the live player below instead of being dropped, so the gate only needs
    // to cover the COMMON fast case (subs land during the debrid resolve and cost nothing here).
    let subtitleGateTimedOut = false
    let subtitleGate: ReturnType<typeof setTimeout> | undefined
    const candidates = directPlaybackId == null
      ? await Promise.race([
          subsP,
          new Promise<SubtitleCandidate[]>((resolve) => {
            subtitleGate = setTimeout(() => { subtitleGateTimedOut = true; resolve([]) }, 1500)
          }),
        ])
      : []
    if (subtitleGate) clearTimeout(subtitleGate)
    traceResolve(trace, 'subtitle startup gate finish', {
      timedOut: subtitleGateTimedOut,
      candidates: candidates.length,
      skippedForDirectP2p: directPlaybackId != null,
    })
    if (await abandonIfStale()) return
    // Partition: url-bearing candidates (addons) merge into mpv at load exactly as before; needsFetch
    // candidates (OpenSubtitles/SubDL) are menu-only — stashed for manual pick, never sent to
    // player_embed. Set fresh each episode so last episode's rows don't linger. An empty result at
    // this point means the search may still be running (we raced it), so stay 'searching' — the
    // late-attach handler below always settles it to 'ready'.
    onlineSubCandidates.set({
      status: directPlaybackId == null && candidates.length ? 'ready' : 'searching',
      items: candidates.filter((s) => s.download?.needsFetch),
    })
    const subtitles = [
      ...(stream.__stream ? stream.__subtitles ?? [] : []),
      ...candidates.filter((s) => !!s.url).map((s) => ({ url: s.url!, lang: s.lang })),
    ]
    const audioTracks = stream.__stream ? stream.__audioTracks ?? [] : []
    // mpv applies `http-header-fields` GLOBALLY — there is no per-URL header option — so a
    // Referer-gated sidecar subtitle can only be fetched by folding its headers into the same set
    // the stream uses. Stream headers win on a key clash: breaking the video to fetch a subtitle
    // would be the wrong trade.
    const sidecarHeaders = Object.assign(
      {},
      ...subtitles.map((s) => ('headers' in s && s.headers) || {}),
      ...audioTracks.map((track) => track.headers ?? {}),
    )
    const mergedHeaders = { ...sidecarHeaders, ...(stream.__headers ?? {}) }
    nowPlayingStream.set({
      url: stream.url,
      headers: mergedHeaders ?? {},
      infoHash: stream.infoHash ?? null,
    })
    // alang/slang drive mpv's preferred-language track auto-selection.
    const embedStartedAt = performance.now()
    traceResolve(trace, 'player embed start', {
      subtitles: subtitles.length,
      audioTracks: audioTracks.length,
      resumeSeconds: Math.round(startSeconds),
    })
    await invoke('player_embed', {
      url: stream.url,
      startSeconds: startSeconds || undefined,
      autoplay,
      alang: get(preferredAudioLang),
      slang: get(preferredSubLang),
      headers: mergedHeaders && Object.keys(mergedHeaders).length ? mergedHeaders : undefined,
      subtitles: subtitles.length ? subtitles : undefined,
      audioTracks: audioTracks.length ? audioTracks : undefined,
    })
    traceResolve(trace, 'player embed accepted', {
      durationMs: Math.round(performance.now() - embedStartedAt),
    })
    if (directPlaybackId != null) void directTorrentPlayerAttached(directPlaybackId)
    if (!stillOwnsPlayback()) {
      const canceledWithoutReplacement = currentPlaybackOwner() === null
      await abandonIfStale()
      // If Back canceled this load and no replacement exists, undo an embed that crossed the
      // cancellation boundary. Never close here when a newer source owns the player.
      if (canceledWithoutReplacement) await invoke('close_player').catch(() => {})
      return
    }
    // This episode+source is now the one on screen, so the watchdog may recover against it.
    recordPlaybackIdentity({ media, episode, stream: recoveryOriginal })
    if (directPlaybackId != null && directTorrentSubtitles.length) {
      void attachDirectTorrentSubtitles(directPlaybackId, directTorrentSubtitles)
    }
    if (directPlaybackId != null) {
      void attachDirectOnlineSubtitles(directPlaybackId, subsP)
    }
    if (debridSidecarSource) {
      const s = debridSidecarSource
      void attachDebridSidecars(s.provider, s.key, s.torrent, s.want)
    }
    rememberSuccess()
    playing.set(true)
    onState({ status: 'playing' })
    // Progress now fires on *actual watch* (~85%), not on play — see attach().
    if (episode != null) attach(media, episode, onState)
    if (directPlaybackId != null) {
      traceResolve(trace, 'waiting for first video frame')
      void waitForDesktopFirstFrame(DIRECT_TORRENT_START_TIMEOUT_MS).then((ready) => {
        if (!stillOwnsPlayback()) return
        finishResolveTrace(
          trace,
          ready ? 'first video frame' : 'first video frame timeout',
          streamTraceDetails(stream),
        )
      })
    }
    // Late online subtitles: when the embed's short race above lost to a slow subtitle addon, fold
    // the results in once they land — menu entries plus URL tracks attached to the live player —
    // instead of dropping them for the whole episode. `playGen` pins the results to THIS play.
    if (directPlaybackId == null && !candidates.length) {
      const subGen = playGen
      void subsP.then(async (cands) => {
        if (subGen !== playGen) return
        onlineSubCandidates.set({ status: 'ready', items: cands.filter((s) => s.download?.needsFetch) })
        for (const s of cands) {
          if (!s.url) continue
          if (subGen !== playGen) return
          try { await invoke('player_attach_subtitle_url', { url: s.url, lang: s.lang, title: s.release ?? s.lang ?? 'Online subtitles' }) }
          catch { /* a missing subtitle must never disturb playback */ }
        }
      })
    }
  }
  catch (e) {
    if (!stillOwnsPlayback()) {
      await abandonIfStale()
      return
    }
    traceResolveError(trace, 'player handoff failed', e)
    if (directPlaybackId != null) void stopDirectTorrentPlayback(directPlaybackId)
    onState({ status: 'error', message: String(e) })
  }
}

/** `player_embed` resolving means mpv accepted the URL, not that the replacement produced video.
 * Direct torrents can sit there downloading indefinitely, so recovery must wait for a real
 * duration/progress event before declaring a candidate healthy. */
async function waitForDesktopFirstFrame(timeoutMs: number): Promise<boolean> {
  if (get(isAndroid) || get(enableExternalPlayer)) return true
  return await new Promise<boolean>(async (resolve) => {
    let settled = false
    let unlisten: (() => void) | null = null
    let lastDownloadedBytes = 0
    let lastAdvancedAt = Date.now()
    const startedAt = Date.now()
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      clearInterval(timer)
      unlisten?.()
      resolve(ready)
    }
    const timer = setInterval(() => {
      void directTorrentHealth().then((health) => {
        if (settled) return
        const now = Date.now()
        if (health && health.downloadedBytes > lastDownloadedBytes) {
          lastDownloadedBytes = health.downloadedBytes
          lastAdvancedAt = now
        }
        if (now - startedAt >= DIRECT_TORRENT_HARD_START_TIMEOUT_MS
          || (now - startedAt >= timeoutMs
            && now - lastAdvancedAt >= DIRECT_TORRENT_NO_PROGRESS_TIMEOUT_MS)) {
          finish(false)
        }
      })
    }, 1_000)
    try {
      const off = await listen<[number, number]>('player-progress', (event) => {
        if (event.payload[1] > 0) finish(true)
      })
      if (settled) return off()
      unlisten = off
    } catch {
      finish(false)
    }
  })
}

/** Replace a source that successfully opened but later stopped producing video. This is separate
 * from the picker's startup-error chain: the watchdog calls it minutes into an active session.
 * The current playhead and play/pause intent are explicit inputs so a replacement is genuinely
 * in-place. Returns true once a replacement has been handed to mpv. */
export async function recoverPlaybackSource(
  position: number,
  autoplay: boolean,
  notice = 'Playback stalled — trying another source…',
): Promise<boolean> {
  const owner = currentPlaybackOwner()
  if (!owner) return false
  const stillOwnsPlayback = () => ownsPlayback(owner)
  let context = get(playbackRecovery)
  if (!context || context.recovering) return false
  // The retained pool follows whatever the PICKER last resolved, which is not necessarily what is
  // on screen: opening the picker for another episode and backing out of it leaves the pool
  // pointing at that episode while the old one keeps playing. Recovering into it would swap the
  // file under the user and start saving progress against the wrong episode, so fall back to the
  // file actually loaded and let the re-resolve below rebuild a pool for the right one.
  const loaded = currentPlaybackIdentity()
  if (!loaded) return false
  if (loaded.media.id !== context.media.id || loaded.episode !== context.episode) {
    context = {
      media: loaded.media,
      episode: loaded.episode,
      streams: [],
      current: loaded.stream,
      attempted: [],
      recovering: false,
    }
  }

  const failed = context.current
  const attempted = new Set(context.attempted)
  if (failed && stillOwnsPlayback()) {
    attempted.add(recoveryStreamKey(failed))
    markDead(failed)
  }
  if (!stillOwnsPlayback()) return false
  playbackRecovery.set({ ...context, attempted: [...attempted], recovering: true })
  playerNotice.set(notice)

  // The progressive picker normally leaves us its complete ranked pool. Prefetched/remembered
  // sources bypass that picker, so rebuild the pool only when there is no alternative retained.
  let streams = context.streams
  if (!streams.some((stream) => !attempted.has(recoveryStreamKey(stream)))) {
    try {
      const base = await resolveStreams(context.media, context.episode)
      streams = [...base.streams]
      const fold = (batch: Stream[]) => { streams = [...streams, ...batch] }
      // Bounded: this runs while a broken source is ON SCREEN, and a wedged extension provider
      // used to pin `recovering: true` forever (the resets below never ran), permanently
      // disabling recovery. Whatever folded in before the budget is what the retry works with.
      await Promise.race([
        Promise.all([
          extToStreams(context.media, context.episode, base.kitsu, fold),
          resolveOnlineStreams(context.media, context.episode, undefined, fold).then(fold),
        ]),
        new Promise<void>((resolve) => setTimeout(resolve, 25_000)),
      ])
      if (!stillOwnsPlayback()) return false
      const refined = refineStreams(context.media, streams).kept
      streams = base.want ? verifySeason(refined, base.want) : refined
      retainRecoveryCandidates(context.media, context.episode, streams)
      context = get(playbackRecovery) ?? context
      playbackRecovery.set({ ...context, attempted: [...attempted], recovering: true })
    } catch {
      // The retained candidates, even if empty, still lead to the manual recovery picker below.
    }
  }

  const directP2p = directP2pEnabled()
  const candidates = pickCandidates(
    streams,
    get(preferredQuality),
    undefined,
    (stream) => attempted.has(recoveryStreamKey(stream)),
    { ...rankOpts(context.media.id), allowUncached: true },
  )
    .filter((stream) => !attempted.has(recoveryStreamKey(stream)))
    .slice(0, directP2p ? 2 : 3)

  const subDelay = await invoke<string>('player_get_property', { name: 'sub-delay' }).catch(() => '')
  let lastError = ''
  for (const candidate of candidates) {
    if (!stillOwnsPlayback()) return false
    const key = recoveryStreamKey(candidate)
    attempted.add(key)
    playbackRecovery.update((current) => current ? {
      ...current,
      attempted: [...attempted],
      recovering: true,
    } : current)
    let played = false
    await playStream(context.media, context.episode, candidate, (state) => {
      if (state.status === 'playing') played = true
      if (state.status === 'error') lastError = state.message ?? 'The replacement source failed.'
    }, { autoplay, startSeconds: Math.max(0, position), recoveryOwner: owner })
    if (!stillOwnsPlayback()) return false
    const directCandidate = directP2p && !!candidate.infoHash && !candidate.url
    if (played && directCandidate) {
      played = await waitForDesktopFirstFrame(DIRECT_TORRENT_RECOVERY_TIMEOUT_MS)
      if (!stillOwnsPlayback()) return false
      if (!played) {
        lastError = 'Replacement torrent also failed to produce video.'
        await stopDirectTorrentPlayback()
      }
    }
    if (played) {
      if (subDelay) {
        await invoke('player_command', { name: 'set', args: ['sub-delay', subDelay] }).catch(() => {})
      }
      playbackRecovery.update((current) => current ? { ...current, recovering: false } : current)
      playerNotice.set('Switched to a working source')
      return true
    }
    markDead(candidate)
  }

  if (!stillOwnsPlayback()) return false
  playbackRecovery.update((current) => current ? { ...current, recovering: false } : current)
  if (directP2p) await stopDirectTorrentPlayback()
  playerNotice.set(lastError || 'Automatic recovery ran out of sources — choose another source')
  void playEpisode(context.media, context.episode, (state) => {
    if (state.status === 'error') playerNotice.set(state.message ?? 'No replacement source was found.')
  }, { forceManual: true, autoplay })
  return false
}

// The Media currently playing, so the in-player Prev/Next buttons can resolve the
// adjacent episode without the caller threading it back in.
let currentMedia: Media | null = null

// Surface auto-advance / prev-next progress + errors as a transient overlay toast.
const noticeState = (s: PlayState) => {
  // No "Loading episode…" toast: the connecting screen covers the whole resolve now, app-wide, and
  // a small hoverable saying the same thing underneath it was both redundant and the clunkier of
  // the two. Failures still get a toast — those happen once playback has already started, where
  // there is no connecting screen to carry the message.
  if (s.status === 'error') playerNotice.set(s.message ?? 'Playback failed.')
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
      detach()
      await invoke('spawn_external_player', { path, url })
      return onState({ status: 'playing' })
    }
    // These items carry no Media, so Prev/Next must not act on a stale one — and neither must the
    // previous episode's progress/auto-advance listeners, which `attach()` is never called to
    // replace on this path. See detach().
    detach()
    currentMedia = null
    playerLoadId.update((id) => id + 1)
    nowPlayingMedia.set(null)
    nowPlayingPartySource.set({ source: null, error: 'Cloud-library links are private to this device.' })
    nowPlaying.set({ title: label, animeTitle: label, id: null, malId: null, episode: null, total: null, airedTotal: null })
    nowPlayingUrl.set(url) // for the dev-only Copy URL tool in the track menu
    nowPlayingStream.set({ url, headers: {}, infoHash: null })
    spriteKey.set(null)   // no per-file scrub sprites for cloud items
    bingeSource.set(null) // no release-continuity chain
    await invoke('player_embed', { url, alang: get(preferredAudioLang), slang: get(preferredSubLang) })
    // No episode identity at all — and the watchdog is live from here, so the previous episode's
    // identity has to go with it or a stall would recover onto that episode's sources.
    recordPlaybackIdentity(null)
    playing.set(true)
    onState({ status: 'playing' })
  }
  catch (e) { onState({ status: 'error', message: String(e) }) }
}

/** Play the previous episode (in-player button). No-op past episode 1. */
export function playPrev(onState: (s: PlayState) => void = noticeState, autoplay = true) {
  const ep = get(nowPlaying).episode
  if (!currentMedia || ep == null || ep <= 1) return
  resolveAndPlayBest(currentMedia, ep - 1, onState, autoplay)
}
/** Play the next episode (in-player button + keyboard `n`). No-op past the aired total, mirroring
 *  the on-screen Next button's bounds gate — otherwise the keyboard path resolved a non-existent
 *  episode and popped an empty "No streams found" picker. */
export function playNext(onState: (s: PlayState) => void = noticeState, autoplay = true) {
  const ep = get(nowPlaying).episode
  if (!currentMedia || ep == null) return
  const airedTotal = airedTotalOf(currentMedia)
  // At the newest aired episode there is genuinely nowhere to go — but returning silently is
  // indistinguishable from the button being broken, so say so.
  if (airedTotal > 0 && ep >= airedTotal) {
    return onState({ status: 'error', message: 'No later episode has aired yet.' })
  }
  resolveAndPlayBest(currentMedia, ep + 1, onState, autoplay)
}

interface ResolvedDownloadBase { filename: string; quality?: string; provider?: string; infoHash?: string }
/** A byte-addressable link (a plain addon url, or a debrid resolve) streamed to disk over HTTP.
 *  `headers` carries an extension source's gate (Referer/Origin) — absent for debrid links. */
export interface ResolvedHttpDownload extends ResolvedDownloadBase { kind: 'http'; url: string; headers?: Record<string, string> }
/** A torrent fetched from peers by the local P2P engine. Carries the episode identity so the
 *  native side can pick the right file out of a season pack, exactly as playback does. */
export interface ResolvedTorrentDownload extends ResolvedDownloadBase {
  kind: 'torrent'
  magnet: string
  preferredFilename?: string
  episode?: number
  absoluteEpisode?: number
  season?: number
}
export type ResolvedDownload = ResolvedHttpDownload | ResolvedTorrentDownload

// Resolve a single episode to something downloadable — no player, no mpv. Reuses the same
// resolveStreams+pickBest path as playback, and honours the SAME torrent-source preference:
// a torrent-only pick goes to the local P2P engine under Direct P2P (or with no debrid
// credential at all), and through debrid otherwise. Fetches the Media by id so it works even
// for a persisted download resumed after an app restart.
export async function resolveDownloadUrl(mediaId: number, episode: number, preferences?: DownloadPreferences): Promise<ResolvedDownload> {
  const media = await fetchMediaById(mediaId)
  const { streams, want, kitsu } = await resolveStreams(media, episode)
  let all = streams
  // Extensions are a first-class playback source but were never consulted here, so an
  // extension-only setup played episodes fine and then reported "no source found" the moment a
  // download was queued. Fold both extension flavours in exactly like playback does, then put the
  // merged list through the same refine + season gates.
  if (await hasConfiguredExtensions()) {
    let extra: Stream[] = []
    // Bounded: a download is a queued background job and must survive one wedged provider —
    // whatever folded in before the budget expires is what gets considered.
    const EXT_BUDGET_MS = 25_000
    await Promise.race([
      Promise.all([
        extToStreams(media, episode, kitsu, (batch) => { extra = [...extra, ...batch] }),
        resolveOnlineStreams(media, episode).then((s) => { extra = [...extra, ...s] }),
      ]),
      new Promise<void>((resolve) => setTimeout(resolve, EXT_BUDGET_MS)),
    ])
    if (extra.length) {
      let merged = refineStreams(media, [...all, ...extra]).kept
      if (want) merged = verifySeason(merged, want)
      all = merged
    }
  }
  // HLS manifests are playable but not saveable — the byte-stream downloader would write the
  // playlist text, not the video. Torrent rows (no url) pass through untouched.
  let eligible = all.filter((s) => !/\.m3u8(?:$|\?)/i.test(s.url ?? ''))
  if (!eligible.length) eligible = all
  if (preferences?.cachedOnly) eligible = eligible.filter((stream) => !isUncached(stream))
  const raw = (stream: Stream) => `${stream.name ?? ''} ${stream.title ?? ''} ${stream.behaviorHints?.filename ?? ''}`.toLowerCase()
  if (preferences?.audio && preferences.audio !== 'any') {
    const preferred = eligible.filter((stream) => preferences.audio === 'dub'
      ? /\b(?:dub|dual[ ._-]?audio|english[ ._-]?audio)\b/i.test(raw(stream))
      : !/\b(?:dub|english[ ._-]?audio)\b/i.test(raw(stream)))
    if (preferred.length) eligible = preferred
  }
  if (preferences?.codec && preferences.codec !== 'any') {
    const patterns = {
      h264: /\b(?:h\.?264|x264|avc)\b/i,
      h265: /\b(?:h\.?265|x265|hevc)\b/i,
      av1: /\bav1\b/i,
    }
    const preferred = eligible.filter((stream) => patterns[preferences.codec as 'h264' | 'h265' | 'av1'].test(raw(stream)))
    if (preferred.length) eligible = preferred
  }
  const best = pickBest(eligible, preferences?.quality ?? get(preferredQuality), want, rankOpts(media.id)) ?? eligible[0]
  if (!best) throw new Error('No source found to download.')
  const info = describe(best)
  // The saved name follows the release when it has one; otherwise the title/episode. The extension
  // is only ever guessed for an HTTP link — a torrent's real one is known natively and applied there.
  const named = (url?: string) => {
    const ext = url?.split('?')[0].match(/\.(mkv|mp4|avi|mov|webm)$/i)?.[1]?.toLowerCase() ?? 'mkv'
    const base = best.behaviorHints?.filename || `${title(media)} - E${episode}`
    return /\.(?:mkv|mp4|avi|mov|webm)$/i.test(base) ? base : `${base}.${ext}`
  }
  const common = { quality: info.quality ? `${info.quality}p` : undefined, infoHash: best.infoHash }

  if (best.url) {
    return { kind: 'http', url: best.url, headers: best.__headers, filename: named(best.url), provider: info.provider, ...common }
  }
  if (best.infoHash) {
    // Same rule as playback (directP2pEnabled): Direct P2P, or no credential to resolve with.
    if (directP2pEnabled()) {
      return {
        kind: 'torrent',
        magnet: best.__magnet ?? `magnet:?xt=urn:btih:${best.infoHash}`,
        filename: named(),
        preferredFilename: best.behaviorHints?.filename,
        episode,
        absoluteEpisode: want?.abs,
        season: want?.season,
        provider: info.provider,
        ...common,
      }
    }
    const p = get(debridProvider)
    const url = await resolveHash(p, get(debridKey), best.__magnet ?? best.infoHash, {
      want: { episode, abs: want?.abs, season: want?.season, filename: best.behaviorHints?.filename },
    })
    if (!url) throw new Error(`${providerName(p)} returned no link for that source.`)
    return { kind: 'http', url, filename: named(url), provider: providerName(p), ...common }
  }
  throw new Error('That source has no downloadable link.')
}
