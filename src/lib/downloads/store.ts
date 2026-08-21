import { get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window'
import { resolveDownloadUrl } from '$lib/stremio/play'
import { torrentEngineNetworkOptions } from '$lib/player/direct-torrent'
import { downloadDir, downloadConcurrency } from '$lib/settings/ui'
import { downloads, keyFor, setItem, removeItem, setSpeed, setDownloadedMedia, type DownloadItem, type DownloadPreferences } from './state'
import { getEpisodeMeta } from '$lib/anizip'
import { isAndroid } from '$lib/platform'
import { downloadTaskbarProgress } from './taskbar'
import type { Media } from '$lib/anilist/types'
import { abortShakaOffline, removeShakaOffline, storeShakaOffline } from './shaka-offline'

// Download queue + actions + event wiring. Reads data from ./state (which play.ts
// also imports, cycle-free). Files stream to disk via the Rust `download_*` commands.

export { downloads, speeds, downloadOf, hasDownload, keyFor, type DownloadItem } from './state'

async function ensureDir(): Promise<string> {
  let dir = get(downloadDir)
  if (!dir) { dir = await invoke<string>('download_dir_default'); downloadDir.set(dir) }
  return dir
}
const posterOf = (m: Media) => m.coverImage?.extraLarge ?? m.coverImage?.medium
const filenameOf = (it?: DownloadItem) => it?.filename ?? `${it?.title ?? 'download'}.mkv`

/** Queue one episode for download (no-op if already queued/downloading/done). */
export function enqueue(media: Media, episode: number, preferences?: DownloadPreferences, ruleId?: string) {
  const id = keyFor(media.id, episode)
  const cur = get(downloads)[id]
  if (cur && cur.status !== 'error') return
  downloads.update((d) => ({ ...d, [id]: {
    id, mediaId: media.id, episode,
    title: `${media.title.userPreferred ?? media.title.romaji ?? 'Anime'} — E${episode}`,
    poster: posterOf(media), bytes: 0, downloaded: 0, status: 'queued', addedAt: Date.now(),
    preferences, ruleId,
  } }))
  // Cache the series info for OFFLINE use: a media snapshot (persisted) + the AniZip
  // episode metadata (idb-cached) so the downloads page + offline playback show titles
  // and thumbnails without a network fetch.
  setDownloadedMedia(media)
  getEpisodeMeta(media.id).catch(() => {})
  pump()
}
export function enqueueMany(media: Media, episodes: number[], preferences?: DownloadPreferences) {
  for (const ep of episodes) enqueue(media, ep, preferences)
}

// Ids with a live download_start this session. Used so the startup requeue never
// re-launches an already-running stream (which would double-write the .part and
// make the progress bar yank).
const running = new Set<string>()

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

async function runJob(item: DownloadItem) {
  running.add(item.id)
  try {
    const dir = await ensureDir()
    const r = await resolveDownloadUrl(item.mediaId, item.episode, item.preferences)
    setItem(item.id, {
      kind: r.kind, url: r.kind === 'http' ? r.url : undefined,
      filename: r.filename, infoHash: r.infoHash, provider: r.provider, quality: r.quality,
      sourceOriginId: r.kind === 'shaka' ? r.sourceOriginId : item.sourceOriginId,
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
    } else if (r.kind === 'shaka') {
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
    } else {
      await invoke('download_start', { id: item.id, url: r.url, dir, filename: r.filename, headers: r.headers })
    }
  } catch (e) {
    if (get(downloads)[item.id]?.status === 'paused') return // benign — user paused it
    setItem(item.id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
  } finally {
    running.delete(item.id)
  }
}

/** Stop an in-flight job through the engine that owns it. `discard` throws the partial data away
 *  (cancel); otherwise it is kept so a later resume continues from it (pause). */
async function stopJob(id: string, it: DownloadItem | undefined, discard: boolean) {
  if (it?.kind === 'shaka') {
    await abortShakaOffline(id)
    if (discard && it.offlineUri) await removeShakaOffline(it.offlineUri).catch(() => {})
    return
  }
  if (it?.kind === 'torrent') {
    await invoke('torrent_download_cancel', { id, deleteFiles: discard, dir: get(downloadDir) })
    return
  }
  await invoke('download_cancel', { id, deletePart: discard, dir: get(downloadDir), filename: filenameOf(it) })
}

export async function pauseDownload(id: string) {
  const it = get(downloads)[id]; if (!it) return
  await stopJob(id, it, false)
  setItem(id, { status: 'paused' }); setSpeed(id, undefined)
}
export function resumeDownload(id: string) { setItem(id, { status: 'queued' }); pump() }
export async function cancelDownload(id: string) {
  await stopJob(id, get(downloads)[id], true)
  removeItem(id); setSpeed(id, undefined)
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
  fgOn = true
  void invoke('plugin:extplayer|download_foreground', { payload: {
    active: true,
    title: activeItems.length === 1 ? activeItems[0].title : 'Downloading episodes',
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
  if (attached) return
  attached = true
  downloads.subscribe((snapshot) => {
    syncDownloadForeground()
    syncDownloadTaskbar(snapshot)
  })
  listen<[string, number, number, number]>('download-progress', (e) => {
    const [id, received, total, speed] = e.payload
    // Monotonic: ignore any backward value (a stray/duplicate stream) so the bar
    // only ever advances.
    const cur = get(downloads)[id]?.downloaded ?? 0
    if (received < cur) return
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
  // Resume-safe: requeue anything stuck 'downloading' from a PREVIOUS session (app
  // killed mid-download). Skip ids with a live stream this session so we never
  // launch a second concurrent download for the same file.
  downloads.update((d) => {
    const n = { ...d }
    for (const k of Object.keys(n)) if (n[k].status === 'downloading' && !running.has(k)) n[k] = { ...n[k], status: 'queued' }
    return n
  })
  pump()
}
