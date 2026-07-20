import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { fetchMediaById } from '$lib/anilist/fetch-media'
import type { Media } from '$lib/anilist/types'
import { downloads, keyFor, type DownloadPreferences } from './state'
import { enqueue } from './store'
import {
  autoDownloadDelayMinutes, downloadAudio, downloadCachedOnly, downloadCodec, downloadQuality,
} from '$lib/settings/ui'

export interface AutoDownloadRule {
  id: string
  mediaId: number
  title: string
  poster?: string
  enabled: boolean
  nextEpisode: number
  createdAt: number
  lastRunAt?: number
  lastError?: string
}

export const autoDownloadRules = persisted<AutoDownloadRule[]>('auto-download-subscriptions-v2', [])
export const autoDownloadRunning = writable(false)

const mediaTitle = (media: Media) => media.title.userPreferred || media.title.english || media.title.romaji || 'Anime'

/** Subscribe to episodes that air after the user enables this from Download. */
export function subscribeAutoDownloads(media: Media, nextEpisode: number): AutoDownloadRule {
  const rule: AutoDownloadRule = {
    id: `${media.id}-${Date.now().toString(36)}`,
    mediaId: media.id,
    title: mediaTitle(media),
    poster: media.coverImage?.extraLarge ?? media.coverImage?.medium ?? undefined,
    enabled: true,
    nextEpisode: Math.max(1, Math.floor(nextEpisode)),
    createdAt: Date.now(),
  }
  autoDownloadRules.update((rules) => [...rules.filter((item) => item.mediaId !== media.id), rule])
  return rule
}

export function autoDownloadRuleFor(mediaId: number): AutoDownloadRule | undefined {
  return get(autoDownloadRules).find((rule) => rule.mediaId === mediaId)
}

export function removeAutoDownloadForMedia(mediaId: number) {
  autoDownloadRules.update((rules) => rules.filter((rule) => rule.mediaId !== mediaId))
}

export function updateAutoDownloadRule(id: string, patch: Partial<AutoDownloadRule>) {
  autoDownloadRules.update((rules) => rules.map((rule) => rule.id === id ? { ...rule, ...patch, id: rule.id, mediaId: rule.mediaId } : rule))
}

export function removeAutoDownloadRule(id: string) {
  autoDownloadRules.update((rules) => rules.filter((rule) => rule.id !== id))
}

export function currentDownloadPreferences(): DownloadPreferences {
  return {
    quality: get(downloadQuality),
    cachedOnly: get(downloadCachedOnly),
    audio: get(downloadAudio),
    codec: get(downloadCodec),
  }
}

export function airedEpisodes(media: Media, nowSeconds: number): number[] {
  const scheduled = (media.airingSchedule?.nodes ?? [])
    .filter((item) => item.airingAt <= nowSeconds)
    .map((item) => item.episode)
  if (scheduled.length) return [...new Set(scheduled)].sort((a, b) => a - b)
  if (media.status === 'FINISHED' && media.episodes) return Array.from({ length: media.episodes }, (_, i) => i + 1)
  const next = media.nextAiringEpisode?.episode
  return next && next > 1 ? Array.from({ length: next - 1 }, (_, i) => i + 1) : []
}

export function dueAutoDownloadEpisodes(
  media: Media,
  nextEpisode: number,
  nowMs: number,
  delayMinutes: number,
): number[] {
  const releaseCutoff = nowMs - Math.max(0, delayMinutes) * 60_000
  return airedEpisodes(media, Math.floor(releaseCutoff / 1000))
    .filter((episode) => episode >= Math.max(1, nextEpisode))
}

export async function runAutoDownloadRules(now = Date.now()): Promise<number> {
  if (get(autoDownloadRunning)) return 0
  autoDownloadRunning.set(true)
  let queued = 0
  try {
    for (const rule of get(autoDownloadRules).filter((item) => item.enabled)) {
      try {
        // Airing schedules change over time, so scheduler checks must bypass the
        // playback-oriented session cache and read current AniList state.
        const media = await fetchMediaById(rule.mediaId, true)
        const due = dueAutoDownloadEpisodes(media, rule.nextEpisode, now, get(autoDownloadDelayMinutes))
        let nextEpisode = rule.nextEpisode
        for (const episode of due) {
          const existing = get(downloads)[keyFor(media.id, episode)]
          // Once an episode has entered the queue successfully, move the subscription past it.
          // Errors stay eligible so a source that appears late is retried on the next check.
          if (existing && existing.status !== 'error') {
            nextEpisode = Math.max(nextEpisode, episode + 1)
            continue
          }
          enqueue(media, episode, currentDownloadPreferences(), rule.id)
          queued++
        }
        updateAutoDownloadRule(rule.id, { nextEpisode, lastRunAt: now, lastError: undefined })
      } catch (error) {
        updateAutoDownloadRule(rule.id, { lastRunAt: now, lastError: error instanceof Error ? error.message : String(error) })
      }
    }
  } finally {
    autoDownloadRunning.set(false)
  }
  return queued
}

let initialized = false
export function initAutoDownloads() {
  if (initialized) return () => {}
  initialized = true
  const run = () => { if (navigator.onLine) void runAutoDownloadRules() }
  const timer = setInterval(run, 15 * 60_000)
  window.addEventListener('online', run)
  setTimeout(run, 8_000)
  return () => { clearInterval(timer); window.removeEventListener('online', run); initialized = false }
}
