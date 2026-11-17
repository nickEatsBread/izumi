import { get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window'
import { torrentEngineNetworkOptions } from '$lib/player/direct-torrent'
import { downloadDir, downloadConcurrency, downloadChooseSource } from '$lib/settings/ui'
import { downloads, speeds, keyFor, setItem, removeItem, setSpeed, setDownloadedMedia, type DownloadItem, type DownloadPreferences } from './state'
import { releaseOf, savedSource } from './source'
import type { Stream } from '$lib/stremio/parse'
import { getEpisodeMeta } from '$lib/anizip'
import { hasTauriRuntime, isAndroid } from '$lib/platform'
import { downloadTaskbarProgress } from './taskbar'
import { formatBytes, formatSpeed } from '$lib/util/format'
import type { Media } from '$lib/anilist/types'
import { abortShakaOffline, removeShakaOffline, storeShakaOffline } from './shaka-offline'
import { NOT_INSTALLED, PROTECTED_SAVE_SETUP, usesNativeDrm } from '$lib/player/native-drm'
import { invokeNativeHttp } from '$lib/net/http'
import type { ResolvedDrmDownload, ResolvedShakaDownload } from '$lib/stremio/play'

// Download queue + actions + event wiring. Reads data from ./state (which play.ts
// also imports, cycle-free). Files stream to disk via the Rust `download_*` commands.

export { downloads, speeds, downloadOf, hasDownload, keyFor, type DownloadItem } from './state'

async function ensureDir(): Promise<string> {
  let dir = get(downloadDir)
  if (!dir) { dir = await invoke<string>('download_dir_default'); downloadDir.set(dir) }
  return dir
}
export type DiskSpace = { free: number, total: number }
/** Space left on the drive holding the downloads folder; null where it can't be read (a web preview,
 *  macOS, Android). Reads the default folder without saving it as the user's choice. */
export async function diskSpace(): Promise<DiskSpace | null> {
  try {
    return await invoke<DiskSpace | null>('download_disk_space', { dir: get(downloadDir) || await invoke<string>('download_dir_default') })
  } catch {
    return null
  }
}
const posterOf = (m: Media) => m.coverImage?.extraLarge ?? m.coverImage?.medium
const filenameOf = (it?: DownloadItem) => it?.filename ?? `${it?.title ?? 'download'}.mkv`

/** Queue one episode for download (no-op if already queued/downloading/done). `source` is the
 *  stream to save (picked by the user, or playing); without one the download rules pick it. */
export function enqueue(media: Media, episode: number, preferences?: DownloadPreferences, ruleId?: string, source?: Stream) {
  // A search box release has no title to resolve a download by (its toolbar hides Download).
  if (media.release) return
  const id = keyFor(media.id, episode)
  const cur = get(downloads)[id]
  if (cur && cur.status !== 'error') return
  // A protected stream keeps the protected route as it is, narrowed to the source it came from.
  const protectedOrigin = source?.__drm ? source.__origin?.id : undefined
  downloads.update((d) => ({ ...d, [id]: {
    id, mediaId: media.id, episode,
    title: `${media.title.userPreferred ?? media.title.romaji ?? 'Anime'} — E${episode}`,
    poster: posterOf(media), bytes: 0, downloaded: 0, status: 'queued', addedAt: Date.now(),
    preferences: protectedOrigin ? { ...preferences, sourceOriginId: protectedOrigin } : preferences,
    ruleId,
    source: source && !source.__drm ? savedSource(source) : undefined,
  } }))
  // Cache the series info for OFFLINE use: a media snapshot (persisted) + the AniZip
  // episode metadata (idb-cached) so the downloads page + offline playback show titles
  // and thumbnails without a network fetch.
  setDownloadedMedia(media)
  getEpisodeMeta(media.id).catch(() => {})
  startPump()
}
export function enqueueMany(media: Media, episodes: number[], preferences?: DownloadPreferences) {
  for (const ep of episodes) enqueue(media, ep, preferences)
}

/** Downloads the user asked for: queued at once, or, with Settings → Downloads → "Choose the source"
 *  on, once they pick the first episode's source in the source picker (the rules' pick suggested).
 *  The other episodes then follow that release. Automatic downloads go straight to `enqueue`. */
export async function startDownload(media: Media, episodes: number | number[], preferences?: DownloadPreferences) {
  const wanted = [episodes].flat().filter((ep) => {
    const cur = get(downloads)[keyFor(media.id, ep)]
    return !cur || cur.status === 'error'
  })
  if (!wanted.length) return
  if (!get(downloadChooseSource) || media.release) return enqueueMany(media, wanted, preferences)
  const [first, ...rest] = wanted
  const { playEpisode, pickDownloadStream } = await import('$lib/stremio/play')
  await playEpisode(media, first, () => {}, {
    // Nothing starts on its own, and whatever is playing keeps playing.
    forceManual: true,
    remoteOnly: true,
    download: {
      choose: (stream) => {
        enqueue(media, first, preferences, undefined, stream)
        enqueueMany(media, rest, { ...preferences, release: releaseOf(stream) })
      },
      suggest: (streams) => pickDownloadStream(streams, media, undefined, preferences),
    },
  })
}

// Ids with a live download_start this session. Used so the startup requeue never
// re-launches an already-running stream (which would double-write the .part and
// make the progress bar yank).
const running = new Set<string>()
// HTTP jobs just (re)started: their engine first reports where it really starts, which is lower
// than the bar when the server made it start over. That one report may move the bar back.
const restarting = new Set<string>()

// Android 13+ hides ordinary foreground-service notifications from the notification drawer until
// POST_NOTIFICATIONS is granted. Ask at the moment the user starts/resumes a download, then keep
// the result for this app session so a multi-episode batch produces one system prompt.
let notificationPermission: Promise<boolean> | null = null
function ensureAndroidDownloadNotifications(): Promise<boolean> {
  if (!get(isAndroid)) return Promise.resolve(true)
  if (!notificationPermission) {
    notificationPermission = invoke<{ granted?: boolean }>('plugin:extplayer|download_notifications')
      .then((result) => result?.granted === true)
      .catch(() => false)
  }
  return notificationPermission
}

function startPump() {
  if (!get(isAndroid)) return pump()
  // The transfer still starts if permission is declined; Android will keep the required foreground
  // service visible in its active-apps task manager, even though the drawer notification is hidden.
  void ensureAndroidDownloadNotifications().finally(pump)
}

// Concurrency-limited pump. Resolves each url lazily at job time (so a bulk enqueue
// doesn't fan out debrid calls up front).
let active = 0
function pump() {
  const limit = Math.max(1, get(downloadConcurrency))
  while (active < limit) {
    const next = Object.values(get(downloads)).find((x) => x.status === 'queued' && !running.has(x.id))
    if (!next) return
    active++
    setItem(next.id, { status: 'downloading', error: undefined })
    runJob(next).finally(() => { active--; pump() })
  }
}

// A decrypting DRM job whose device blob the licence server refuses (403) surfaces this prefix from
// the native engine; the job then falls back to the Shaka offline path with the same source.
const LICENSE_FORBIDDEN = 'licence-forbidden:'

/** Save a protected episode through izumi's own Widevine module: it decrypts every fragment as it
 *  arrives, so the saved folder is a clear fMP4 pair that plays with no module, licence or network.
 *  The source's licence request (drm) is what obtains the content keys for the decrypt. */
async function saveWithModule(item: DownloadItem, r: ResolvedShakaDownload | ResolvedDrmDownload, dir: string) {
  const path = await invoke<string>('widevine_save_folder', { dir, name: r.filename })
  setItem(item.id, { path })
  const saved = await invoke<{ path: string; bytes: number; height: number }>('widevine_save', {
    id: item.id, manifestUrl: r.url, dir, name: r.filename, maxHeight: r.preferredHeight ?? null, drm: r.drm,
  })
  setItem(item.id, {
    status: 'done',
    path: saved.path,
    requiresOnlineLicense: false,
    sourceOriginId: r.sourceOriginId,
    preferences: { ...item.preferences, ...(r.sourceOriginId ? { sourceOriginId: r.sourceOriginId } : {}) },
    quality: `${saved.height}p`,
    downloaded: saved.bytes,
    bytes: saved.bytes,
    completedAt: Date.now(),
  })
  setSpeed(item.id, undefined)
}

/** Decrypting download with the bundled device: the native engine fetches the plan, gets the content
 *  keys, decrypts each fragment and writes ONE clear local file. No offlineUri and no drmKeySystem are
 *  stored on success, so offline playback can never be tempted to re-acquire a licence. Progress and
 *  completion arrive via the shared download-* events (done sets status/path via event). A refused
 *  device falls back to the Shaka offline path with the same source. */
async function downloadWithDevice(item: DownloadItem, r: ResolvedDrmDownload, dir: string) {
  try {
    await invoke('drm_download_start', {
      id: item.id, planUrl: r.planUrl, licenseUrl: r.licenseUrl, releaseUrl: r.releaseUrl,
      dir, filename: r.filename,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!message.includes(LICENSE_FORBIDDEN)) throw e
    // The shipped device blob was refused — re-resolve the SAME source forcing the Shaka path
    // so the download still succeeds (as encrypted segments plus a licence) instead of failing.
    const { resolveDownloadUrl } = await import('$lib/stremio/play')
    const shaka = await resolveDownloadUrl(item.mediaId, item.episode, item.preferences, true)
    if (shaka.kind !== 'shaka') throw e
    setItem(item.id, { kind: 'shaka', filename: shaka.filename })
    await storeShaka(item, shaka)
  }
}
/** Store a Shaka offline item and finalize its DB entry (encrypted segments + optional licence). */
async function storeShaka(item: DownloadItem, r: ResolvedShakaDownload) {
  const stored = await storeShakaOffline(item.id, r, ({ downloaded, bytes, speed }) => {
    const current = get(downloads)[item.id]?.downloaded ?? 0
    if (downloaded < current) return
    setItem(item.id, { downloaded, ...(bytes ? { bytes } : {}) })
    setSpeed(item.id, speed)
  })
  setItem(item.id, {
    status: 'done',
    offlineUri: stored.offlineUri,
    drmKeySystem: stored.drmKeySystem,
    requiresOnlineLicense: !stored.persistentLicense,
    sourceOriginId: r.sourceOriginId,
    preferences: {
      ...item.preferences,
      ...(r.sourceOriginId ? { sourceOriginId: r.sourceOriginId } : {}),
    },
    downloaded: stored.bytes,
    bytes: stored.bytes,
    completedAt: Date.now(),
  })
  setSpeed(item.id, undefined)
}

async function runJob(item: DownloadItem) {
  running.add(item.id)
  try {
    const dir = await ensureDir()
    // Playback resolution is substantial and downloads are the only boot-mounted consumer. Load
    // it when a queued job actually runs, not whenever the app shell attaches download listeners.
    const { resolveDownloadUrl } = await import('$lib/stremio/play')
    const r = await resolveDownloadUrl(item.mediaId, item.episode, item.preferences, false, item.source)
    // Paused or cancelled while the source resolved: start nothing.
    if (get(downloads)[item.id]?.status !== 'downloading') return
    // izumi's own Widevine module saves protected episodes as clear files where it is built (Linux
    // and Windows) and installed. Without it, a source with a decrypt plan falls back to the bundled
    // device (one clear file); otherwise the Shaka offline store.
    const native = (r.kind === 'shaka' || r.kind === 'drm') && usesNativeDrm(r.drm)
    setItem(item.id, {
      kind: native ? 'drm-local' : r.kind, url: r.kind === 'http' ? r.url : undefined,
      filename: r.filename, infoHash: r.infoHash, provider: r.provider, quality: r.quality,
      source: r.source ?? item.source,
      sourceOriginId: r.kind === 'shaka' || r.kind === 'drm' ? r.sourceOriginId : item.sourceOriginId,
    })
    // Both resolve when the file is fully written OR paused; progress/done come via events.
    // A torrent pick goes to the local P2P engine — the same one playback uses under Direct P2P —
    // so downloading works with no debrid credential at all.
    if (r.kind === 'torrent') {
      await invoke('torrent_download_start', {
        id: item.id, magnet: r.magnet, dir, filename: r.filename,
        preferredFilename: r.preferredFilename,
        episode: r.episode, absoluteEpisode: r.absoluteEpisode, season: r.season,
        ...torrentEngineNetworkOptions(),
      })
    } else if ((r.kind === 'shaka' || r.kind === 'drm') && native) {
      try {
        await saveWithModule(item, r, dir)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (!message.includes(NOT_INSTALLED)) throw e
        // The module has not been set up here (checked before any network or disk work, so nothing is
        // left behind). Only a `drm` source has another route, a Widevine device the user supplied
        // themselves, and that route falls back again if there is none. Otherwise say where to fix it.
        if (r.kind !== 'drm') throw new Error(PROTECTED_SAVE_SETUP)
        setItem(item.id, { kind: 'drm', path: undefined })
        await downloadWithDevice(item, r, dir)
      } finally {
        // The source opened a playback session for the download; it is not needed any more.
        if (r.drm?.releaseUrl) void invokeNativeHttp('ext_fetch', { url: r.drm.releaseUrl, method: 'DELETE', headers: {} }, { timeoutMs: 10_000 }).catch(() => {})
      }
    } else if (r.kind === 'drm') {
      await downloadWithDevice(item, r, dir)    } else if (r.kind === 'shaka') {
      await storeShaka(item, r)
    } else {
      restarting.add(item.id)
      await invoke('download_start', {
        id: item.id, url: r.url, dir, filename: r.filename, headers: r.headers,
        hls: r.hls, preferredHeight: r.preferredHeight,
      })
    }
  } catch (e) {
    if (get(downloads)[item.id]?.status === 'paused') return // benign — user paused it
    setItem(item.id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
  } finally {
    running.delete(item.id)
    restarting.delete(item.id)
  }
}

/** Stop an in-flight job through the engine that owns it. `discard` throws the partial data away
 *  (cancel); otherwise it is kept so a later resume continues from it (pause). */
async function stopJob(id: string, it: DownloadItem | undefined, discard: boolean) {
  if (it?.kind === 'drm-local') {
    await invoke('widevine_save_cancel', { id }).catch(() => {})
    if (discard && it.path) await invoke('download_delete', { path: it.path }).catch(() => {})
    return
  }
  if (it?.kind === 'shaka') {
    await abortShakaOffline(id)
    if (discard && it.offlineUri) await removeShakaOffline(it.offlineUri).catch(() => {})
    return
  }
  if (it?.kind === 'torrent') {
    await invoke('torrent_download_cancel', { id, deleteFiles: discard, dir: get(downloadDir) })
    return
  }
  if (it?.kind === 'drm') {
    await invoke('drm_download_cancel', { id, deletePart: discard, dir: get(downloadDir), filename: filenameOf(it) })
    return
  }
  await invoke('download_cancel', { id, deletePart: discard, dir: get(downloadDir), filename: filenameOf(it) })
}

export async function pauseDownload(id: string) {
  const it = get(downloads)[id]; if (!it) return
  await stopJob(id, it, false)
  setItem(id, { status: 'paused' }); setSpeed(id, undefined)
}
/** Queue a paused (or failed) download again, with the same source. HTTP, HLS, torrent and
 *  decrypting downloads continue from what is on disk; see `canPause` for the ones that cannot. */
export function resumeDownload(id: string) {
  setItem(id, { status: 'queued' })
  startPump()
}
export async function cancelDownload(id: string) {
  await stopJob(id, get(downloads)[id], true)
  removeItem(id); setSpeed(id, undefined)
}
/** Clear finished: take saved episodes off the Downloads list, leaving their files on this device. */
export function clearFromList(ids: string[]) {
  for (const id of ids) setItem(id, { cleared: true })
}
export async function deleteDownload(id: string) {
  const it = get(downloads)[id]
  if (it?.offlineUri) await removeShakaOffline(it.offlineUri).catch(() => {})
  if (it?.path) { try { await invoke('download_delete', { path: it.path }) } catch { /* already gone */ } }
  removeItem(id); setSpeed(id, undefined)
}
export async function revealDownload(id: string) {
  const it = get(downloads)[id]
  if (it?.offlineUri) return
  if (it?.path) { try { await invoke('reveal_in_folder', { path: it.path }) } catch { /* ignore */ } }
}

// --- Android background downloads -------------------------------------------------------------
// A dataSync foreground service (extplayer plugin) keeps the process alive and unfrozen while
// anything is downloading, so backgrounding the app no longer suspends the queue: the Rust
// engine keeps streaming and the JS pump keeps advancing. Synced from the `downloads` store —
// every progress write lands here — throttled to 1/s, started only while the app can legally
// start it (we're in the foreground whenever a download begins), stopped when the queue drains.
let fgOn = false
let fgLastSent = 0
let fgTrailing: ReturnType<typeof setTimeout> | undefined
function syncDownloadForeground() {
  if (!get(isAndroid)) return
  const all = Object.values(get(downloads))
  const activeItems = all.filter((x) => x.status === 'downloading')
  const queued = all.filter((x) => x.status === 'queued').length
  if (!activeItems.length) {
    clearTimeout(fgTrailing)
    if (fgOn) {
      fgOn = false
      // A failed stop re-arms the flag so the next store change retries, instead of leaving a
      // zombie notification with no download behind it.
      void invoke('plugin:extplayer|download_foreground', { payload: { active: false } }).catch(() => { fgOn = true })
    }
    return
  }
  const now = Date.now()
  if (now - fgLastSent < 1000) {
    // Trailing update so the final state (e.g. 99% → done) is never dropped by the throttle.
    clearTimeout(fgTrailing)
    fgTrailing = setTimeout(syncDownloadForeground, 1000 - (now - fgLastSent))
    return
  }
  fgLastSent = now
  const known = activeItems.filter((x) => x.bytes > 0)
  const total = known.reduce((sum, x) => sum + x.bytes, 0)
  const received = known.reduce((sum, x) => sum + x.downloaded, 0)
  const totalSpeed = activeItems.reduce((sum, x) => sum + (get(speeds)[x.id] ?? 0), 0)
  const detail = [
    total > 0 ? `${formatBytes(received)} / ${formatBytes(total)}` : null,
    totalSpeed > 0 ? formatSpeed(totalSpeed) : null,
    activeItems.length + queued > 1 ? `${activeItems.length + queued} episodes` : null,
  ].filter(Boolean).join(' · ')
  fgOn = true
  void invoke('plugin:extplayer|download_foreground', { payload: {
    active: true,
    title: activeItems.length === 1 ? activeItems[0].title : 'Downloading episodes',
    detail: detail || null,
    progress: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
    count: activeItems.length + queued,
  } }).catch(() => {})
}

// Desktop shells expose a native app/taskbar progress indicator (Windows taskbar, macOS Dock,
// and supported Linux launchers). Only send when the visible integer state changes, so the native
// bridge does not receive one IPC call per torrent/HTTP progress event when several jobs run.
let taskbarSignature = ''
function syncDownloadTaskbar(snapshot: Record<string, DownloadItem>) {
  if (get(isAndroid)) return
  const state = downloadTaskbarProgress(Object.values(snapshot))
  const signature = `${state.status}:${state.status === 'normal' ? state.progress : ''}`
  if (signature === taskbarSignature) return
  taskbarSignature = signature
  const status = state.status === 'normal'
    ? ProgressBarStatus.Normal
    : state.status === 'indeterminate'
      ? ProgressBarStatus.Indeterminate
      : ProgressBarStatus.None
  void getCurrentWindow().setProgressBar({
    status,
    ...(state.status === 'normal' ? { progress: state.progress } : {}),
  }).catch(() => {})
}

// Attached once at app start (from the app layout). Wires progress/done/paused
// events and resumes any download interrupted by an app kill.
let attached = false
export function attachDownloadEvents() {
  // A browser has no native download events or taskbar. Calling getCurrentWindow during its
  // initial subscription throws synchronously and prevents the app shell from mounting cleanly.
  if (attached || !hasTauriRuntime()) return
  attached = true
  downloads.subscribe((snapshot) => {
    syncDownloadForeground()
    syncDownloadTaskbar(snapshot)
  })
  // Speed is a separate ephemeral store, so it needs its own notification refresh trigger.
  speeds.subscribe(() => syncDownloadForeground())
  listen<[string, number, number, number]>('download-progress', (e) => {
    const [id, received, total, speed] = e.payload
    // Monotonic: ignore any backward value (a stray/duplicate stream) so the bar
    // only ever advances — except the starting point a restarted HTTP job reports.
    const cur = get(downloads)[id]?.downloaded ?? 0
    if (received < cur && !restarting.has(id)) return
    restarting.delete(id)
    setItem(id, { downloaded: received, ...(total ? { bytes: total } : {}) })
    setSpeed(id, speed)
  })
  listen<[string, string, number]>('download-done', (e) => {
    const [id, path, bytes] = e.payload
    setItem(id, { status: 'done', path, downloaded: bytes, bytes, completedAt: Date.now() })
    setSpeed(id, undefined)
    // Scrub thumbnails for a downloaded episode render on demand from the LOCAL file via
    // the headless libmpv decoder at playback time (instant seeks on local) — no pre-gen.
  })
  listen<[string, number]>('download-paused', (e) => setSpeed(e.payload[0], undefined))
  // The decrypting DRM engine reports a hard failure (missing key, decrypt failure, bad plan) via
  // its own event so the queue surfaces the error; the clear output was already removed natively.
  listen<[string, string]>('download-error', (e) => {
    const [id, message] = e.payload
    if (get(downloads)[id]?.status === 'paused') return // a pause is not a failure
    setItem(id, { status: 'error', error: message })
    setSpeed(id, undefined)
  })
  // Resume-safe: requeue anything stuck 'downloading' from a PREVIOUS session (app
  // killed mid-download). Skip ids with a live stream this session so we never
  // launch a second concurrent download for the same file.
  downloads.update((d) => {
    const n = { ...d }
    for (const k of Object.keys(n)) if (n[k].status === 'downloading' && !running.has(k)) n[k] = { ...n[k], status: 'queued' }
    return n
  })
  startPump()
}
