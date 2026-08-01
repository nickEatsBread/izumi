import { get } from 'svelte/store'
import { cancel, isPermissionGranted, requestPermission, Schedule, sendNotification } from '@tauri-apps/plugin-notification'
import { localHistory, type HistoryEntry } from '$lib/player/history'
import { title } from '$lib/anilist/media'
import {
  airingNotifications,
  airingNotificationLeadMinutes,
  scheduledAiringNotificationIds,
} from '$lib/settings/ui'

export interface AiringNotification {
  id: number
  at: number
  mediaId: number
  episode: number
  title: string
}

/** Stable positive i32 identifier used to replace/cancel the same episode across launches. */
export function airingNotificationId(mediaId: number, episode: number): number {
  let hash = 0x811c9dc5
  for (const byte of `${mediaId}:${episode}`) {
    hash ^= byte.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash & 0x7fffffff
}

export function notificationPlan(
  history: Record<number, HistoryEntry>,
  now = Date.now(),
  leadMinutes = 0,
): AiringNotification[] {
  const earliest = now + 5_000
  const latest = now + 60 * 24 * 60 * 60 * 1000
  const seen = new Set<number>()
  const plan: AiringNotification[] = []
  for (const entry of Object.values(history)) {
    for (const airing of entry.media.airingSchedule?.nodes ?? []) {
      const at = airing.airingAt * 1000 - Math.max(0, leadMinutes) * 60_000
      const id = airingNotificationId(entry.media.id, airing.episode)
      if (at < earliest || at > latest || seen.has(id)) continue
      seen.add(id)
      plan.push({ id, at, mediaId: entry.media.id, episode: airing.episode, title: title(entry.media) })
    }
  }
  return plan.sort((a, b) => a.at - b.at)
}

export async function setAiringNotificationsEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled) { airingNotifications.set(false); return true }
  let granted = await isPermissionGranted().catch(() => false)
  if (!granted) granted = await requestPermission().then((permission) => permission === 'granted').catch(() => false)
  airingNotifications.set(granted)
  return granted
}

let started = false
export function initAiringNotifications(): () => void {
  if (started) return () => {}
  started = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0

  const sync = async () => {
    const mine = ++generation
    const previous = get(scheduledAiringNotificationIds)
    if (previous.length) await cancel(previous).catch(() => {})
    if (mine !== generation) return
    if (!get(airingNotifications) || !(await isPermissionGranted().catch(() => false))) {
      scheduledAiringNotificationIds.set([])
      return
    }
    const plan = notificationPlan(get(localHistory), Date.now(), get(airingNotificationLeadMinutes))
    for (const item of plan) {
      sendNotification({
        id: item.id,
        title: `${item.title} · Episode ${item.episode}`,
        body: get(airingNotificationLeadMinutes) ? 'Airs soon' : 'Just aired',
        schedule: Schedule.at(new Date(item.at)),
        group: 'airing',
        extra: { mediaId: item.mediaId, episode: item.episode },
      })
    }
    if (mine === generation) scheduledAiringNotificationIds.set(plan.map((item) => item.id))
  }
  const queue = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void sync(), 250) }
  const unsubscribers = [
    airingNotifications.subscribe(queue),
    airingNotificationLeadMinutes.subscribe(queue),
    localHistory.subscribe(queue),
  ]
  return () => {
    started = false
    generation++
    if (timer) clearTimeout(timer)
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}
