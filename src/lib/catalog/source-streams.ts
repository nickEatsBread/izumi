/** Playing a source catalog's own titles: the source's stream endpoint answers for the episode, and
 *  the playhead goes back to the source so its Continue Watching follows the viewer across devices. */
import { sourceSkipSegments } from '$lib/stremio/skip-segments'
import type { Media } from '$lib/anilist/types'
import { title } from '$lib/anilist/media'
import { invokeNativeHttp, phttp } from '$lib/net/http'
import { listenSafe } from '$lib/util/listen'
import type { Stream } from '$lib/stremio/parse'
import { videoSourceToStream, type SnVideoSource } from '$lib/stremio/onlinestream'
import { isSourceOrigin, sourceAddonForOrigin } from './source-catalogs'

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** A URL the source names for its own requests: only on the source's own address. */
function sameOrigin(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.origin === new URL(base).origin ? url.href : undefined
  } catch {
    return undefined
  }
}

/** One stream from a source's answer. `izumi.onlinestream` marks a direct video source (the same
 *  shape an online source returns for an episode); anything else is a plain Stremio stream. Either
 *  way it is the source's own stream for its own title, so it carries that title (`showTitle`): the
 *  episode's name ("Asta and Yuno") is not a different show. */
export function sourceStream(raw: unknown, base: string, provider: string, packageId: string, index: number, epTitle?: string, showTitle?: string): Stream | undefined {
  const value = record(raw)
  if (!value || typeof value.url !== 'string') return undefined
  const extras = record(value.izumi)
  const progressUrl = sameOrigin(extras?.progressUrl, base)
  // The source's own intro, recap and credits markers, checked before the player sees them.
  const skip = sourceSkipSegments(extras?.skip)
  if (extras?.onlinestream === true) {
    const headers = Object.fromEntries(Object.entries(record(extras.headers) ?? {}).filter(([, header]) => typeof header === 'string')) as Record<string, string>
    return {
      ...videoSourceToStream(value as unknown as SnVideoSource, 'default', headers, provider, epTitle, undefined, packageId, undefined, false, undefined, showTitle, index),
      ...(progressUrl ? { __progressUrl: progressUrl } : {}),
      ...(skip.length ? { __skip: skip } : {}),
    }
  }
  const { izumi: _izumi, ...stream } = value
  return {
    ...(stream as Stream),
    __addonName: provider,
    __accuracy: 'high',
    ...(showTitle ? { __sourceTitle: showTitle } : {}),
    ...(progressUrl ? { __progressUrl: progressUrl } : {}),
    ...(skip.length ? { __skip: skip } : {}),
  }
}

/** The streams a source offers for one of its own titles' videos; null for any other title. */
export async function sourceStreams(media: Media, videoId: string, epTitle?: string, signal?: AbortSignal): Promise<Stream[] | null> {
  const originId = media.catalog?.addonId
  if (!originId || !isSourceOrigin(originId)) return null
  const addon = await sourceAddonForOrigin(originId)
  if (!addon) throw new Error('The source that supplied this title is not available.')
  const type = media.catalog?.resourceType || 'series'
  const response = await phttp(`${addon.base}/stream/${encodeURIComponent(type)}/${encodeURIComponent(videoId)}.json`, {
    timeoutMs: 45_000, maxBytes: 4 * 1024 * 1024, signal,
  })
  if (!response.ok) throw new Error(`The source answered HTTP ${response.status}.`)
  const body = record(await response.json())
  const list = Array.isArray(body?.streams) ? body.streams : []
  const showTitle = title(media)
  return list.flatMap((raw, index) => sourceStream(raw, addon.base, addon.manifest.name, addon.packageId, index, epTitle, showTitle) ?? [])
}

/** The protected player's pause/resume event (DrmSurface.svelte); its detail carries `paused`, `pos`, `dur`. */
export const DRM_PAUSE_EVENT = 'izumi-drm-pause'
/** A pause shorter than this (a scrub, a quick pause/resume) sends nothing. */
const PAUSE_SETTLE_MS = 2_000
/** A pause report never follows another report sooner than this. */
const PAUSE_GAP_MS = 5_000

/** Sends the playhead to `stream.__progressUrl`: every 30 s while playing, once a pause has held, and
 *  once more when playback ends. Nothing for a stream that did not ask. Failures are dropped: the
 *  next report carries on. Pauses come from mpv's `player-paused` and the protected player's
 *  `DRM_PAUSE_EVENT`; `flush` is the last report and stops listening for them. */
export function sourceProgressReporter(stream: Stream, intervalMs = 30_000): { progress(pos: number, dur?: number): void; flush(pos?: number): void } | undefined {
  const url = stream.__progressUrl
  if (!url) return undefined
  let position = 0
  let duration = 0
  let sentAt = 0
  let sent = -1
  let pauseTimer: ReturnType<typeof setTimeout> | undefined
  const send = () => {
    const seconds = Math.floor(position)
    if (seconds <= 0 || (duration > 0 && seconds > duration) || seconds === sent) return
    sent = seconds
    void invokeNativeHttp('ext_fetch', {
      url, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ position: seconds }),
    }, { timeoutMs: 10_000, maxBytes: 64 * 1024 }).catch(() => {})
  }
  const take = (pos: number, dur?: number) => {
    if (Number.isFinite(pos)) position = pos
    if (dur !== undefined && Number.isFinite(dur) && dur > 0) duration = dur
  }
  const pauseChanged = (paused: boolean) => {
    clearTimeout(pauseTimer)
    pauseTimer = undefined
    if (!paused) return
    pauseTimer = setTimeout(() => {
      pauseTimer = undefined
      sentAt = Date.now()
      send()
    }, Math.max(PAUSE_SETTLE_MS, sentAt + PAUSE_GAP_MS - Date.now()))
  }
  const onDrmPause = (event: Event) => {
    const detail = record((event as CustomEvent).detail)
    take(Number(detail?.pos), Number(detail?.dur))
    pauseChanged(detail?.paused === true)
  }
  const stopMpv = listenSafe<boolean>('player-paused', ({ payload }) => pauseChanged(payload === true))
  if (typeof window !== 'undefined') window.addEventListener(DRM_PAUSE_EVENT, onDrmPause)
  return {
    progress(pos, dur) {
      take(pos, dur)
      if (Date.now() - sentAt < intervalMs) return
      sentAt = Date.now()
      send()
    },
    flush(pos) {
      clearTimeout(pauseTimer)
      pauseTimer = undefined
      stopMpv()
      if (typeof window !== 'undefined') window.removeEventListener(DRM_PAUSE_EVENT, onDrmPause)
      if (pos !== undefined) take(pos)
      send()
    },
  }
}

/** Adds or removes a title from the source's own watchlist (`sourceFacts.watchlistUrl`). */
export async function setSourceWatchlist(url: string, on: boolean): Promise<boolean> {
  const reply = await invokeNativeHttp<{ status: number; body: string }>('ext_fetch', {
    url, method: on ? 'POST' : 'DELETE', headers: {},
  }, { timeoutMs: 20_000, maxBytes: 64 * 1024 })
  if (reply.status < 200 || reply.status >= 300) throw new Error(`The source answered HTTP ${reply.status}.`)
  try {
    const value = record(JSON.parse(reply.body))
    return typeof value?.watchlist === 'boolean' ? value.watchlist : on
  } catch {
    return on
  }
}
