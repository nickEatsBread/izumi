import { writable, get } from 'svelte/store'
import { updateProgress } from '$lib/trackers'
import { recordProgress, localHistory } from '$lib/player/history'
import { title } from '$lib/anilist/media'
import type { Media } from '$lib/anilist/types'

// Return-based tracking for the Android external-player flow: we can't observe playback in another
// app, so returning to izumi is the "I watched it" signal. Armed on a successful launch, fired on
// the first app resume after it.

let pending: { media: Media; episode: number } | null = null

/** Arm tracking for {media, episode} — called after a SUCCESSFUL external launch. */
export function armPendingWatch(media: Media, episode: number) {
  pending = { media, episode }
}

/** Transient "marked watched — undo" toast (the in-player overlay isn't mounted on Android, so we
 *  render this in the app shell). null = hidden. */
export const watchToast = writable<{ text: string; undo: () => void } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined

/** Wire the resume listeners. Idempotent-safe to call once at boot on Android. */
export function initReturnTracking() {
  const onResume = () => {
    const p = pending
    if (!p) return
    pending = null
    const prev = get(localHistory)[p.media.id]?.progress ?? 0
    recordProgress(p.media, p.episode)
    updateProgress(p.media, p.episode, 'CURRENT').catch(() => {})
    const undo = () => {
      // Revert the local-history bump (the tracker push is best-effort / left as-is).
      localHistory.update((h) => {
        const e = h[p.media.id]
        return e ? { ...h, [p.media.id]: { ...e, progress: prev } } : h
      })
      watchToast.set(null)
    }
    watchToast.set({ text: `Marked ${title(p.media)} · Ep ${p.episode} watched`, undo })
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => watchToast.set(null), 6000)
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onResume()
  })
  window.addEventListener('focus', onResume)
}
