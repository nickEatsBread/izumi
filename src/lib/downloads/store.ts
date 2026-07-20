import { get } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { resolveDownloadUrl } from '$lib/stremio/play'
import { downloadDir, downloadConcurrency } from '$lib/settings/ui'
import { downloads, keyFor, setItem, removeItem, setSpeed, setDownloadedMedia, type DownloadItem, type DownloadPreferences } from './state'
import { getEpisodeMeta } from '$lib/anizip'
import type { Media } from '$lib/anilist/types'

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
    setItem(item.id, { url: r.url, filename: r.filename, infoHash: r.infoHash, provider: r.provider, quality: r.quality })
    // Resolves when the file is fully written OR paused; progress/done come via events.
    await invoke('download_start', { id: item.id, url: r.url, dir, filename: r.filename })
  } catch (e) {
    if (get(downloads)[item.id]?.status === 'paused') return // benign — user paused it
    setItem(item.id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
  } finally {
    running.delete(item.id)
  }
}

export async function pauseDownload(id: string) {
  const it = get(downloads)[id]; if (!it) return
  await invoke('download_cancel', { id, deletePart: false, dir: get(downloadDir), filename: filenameOf(it) })
  setItem(id, { status: 'paused' }); setSpeed(id, undefined)
}
export function resumeDownload(id: string) { setItem(id, { status: 'queued' }); pump() }
export async function cancelDownload(id: string) {
  const it = get(downloads)[id]
  await invoke('download_cancel', { id, deletePart: true, dir: get(downloadDir), filename: filenameOf(it) })
  removeItem(id); setSpeed(id, undefined)
}
export async function deleteDownload(id: string) {
  const it = get(downloads)[id]
  if (it?.path) { try { await invoke('download_delete', { path: it.path }) } catch { /* already gone */ } }
  removeItem(id); setSpeed(id, undefined)
}
export async function revealDownload(id: string) {
  const it = get(downloads)[id]
  if (it?.path) { try { await invoke('reveal_in_folder', { path: it.path }) } catch { /* ignore */ } }
}

// Attached once at app start (from the app layout). Wires progress/done/paused
// events and resumes any download interrupted by an app kill.
let attached = false
export function attachDownloadEvents() {
  if (attached) return
  attached = true
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
