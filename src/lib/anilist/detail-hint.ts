import { writable } from 'svelte/store'
import type { Media } from './types'

/** Media already visible on the card the user selected. Detail queries can use this to keep the
 * title/art on screen while the richer record is fetched, instead of replacing known content with
 * anonymous grey blocks. This is intentionally session-only. */
export const detailHints = writable<Record<number, Media>>({})

export function rememberDetail(media: Media) {
  detailHints.update((hints) => hints[media.id] === media ? hints : { ...hints, [media.id]: media })
}
