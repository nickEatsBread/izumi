import { get, writable } from 'svelte/store'
import { persisted } from 'svelte-persisted-store'
import { fetchMediaById } from '$lib/anilist/fetch-media'
import type { Media } from '$lib/anilist/types'
import type { LibraryMedia } from '$lib/library/types'
import { hasLibraryEpisode } from '$lib/library/store'
import { downloads, keyFor, type DownloadPreferences } from './state'
import { enqueue } from './store'

export interface AutoDownloadRule extends DownloadPreferences {
  id: string
  mediaId: number
  title: string
  poster?: string
  enabled: boolean
  nextEpisode: number
  delayMinutes: number
  createdAt: number
  lastRunAt?: number
  lastError?: string
}

export const autoDownloadRules = persisted<AutoDownloadRule[]>('auto-download-rules-v1', [])
export const autoDownloadRunning = writable(false)

const mediaTitle = (media: LibraryMedia | Media) => media.title.userPreferred || media.title.english || media.title.romaji || 'Anime'

export function createAutoDownloadRule(media: LibraryMedia | Media, nextEpisode = 1): AutoDownloadRule {
  const rule: AutoDownloadRule = {
    id: `${media.id}-${Date.now().toString(36)}`,
    mediaId: media.id,
    title: mediaTitle(media),
    poster: media.coverImage?.extraLarge ?? media.coverImage?.medium ?? undefined,
    enabled: true,
    nextEpisode: Math.max(1, Math.floor(nextEpisode)),
    delayMinutes: 10,
    quality: '1080', cachedOnly: true, audio: 'sub', codec: 'any', createdAt: Date.now(),
  }
  autoDownloadRules.update((rules) => [...rules.filter((item) => item.mediaId !== media.id), rule])
  return rule
}

export function updateAutoDownloadRule(id: string, patch: Partial<AutoDownloadRule>) {
  autoDownloadRules.update((rules) => rules.map((rule) => rule.id === id ? { ...rule, ...patch, id: rule.id, mediaId: rule.mediaId } : rule))
}

export function removeAutoDownloadRule(id: string) {
  autoDownloadRules.update((rules) => rules.filter((rule) => rule.id !== id))
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

export async function runAutoDownloadRules(now = Date.now()): Promise<number> {
  if (get(autoDownloadRunning)) return 0
  autoDownloadRunning.set(true)
  let queued = 0
  try {
    for (const rule of get(autoDownloadRules).filter((item) => item.enabled)) {
      try {
        const media = await fetchMediaById(rule.mediaId)
        const dueAt = now - Math.max(0, rule.delayMinutes) * 60_000
        const due = airedEpisodes(media, Math.floor(dueAt / 1000)).filter((episode) => episode >= rule.nextEpisode)
        for (const episode of due) {
          const existing = get(downloads)[keyFor(media.id, episode)]
          if ((existing && existing.status !== 'error') || hasLibraryEpisode(media.id, episode)) continue
          enqueue(media, episode, {
            quality: rule.quality, cachedOnly: rule.cachedOnly, audio: rule.audio, codec: rule.codec,
          }, rule.id)
          queued++
        }
        updateAutoDownloadRule(rule.id, { lastRunAt: now, lastError: undefined })
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
