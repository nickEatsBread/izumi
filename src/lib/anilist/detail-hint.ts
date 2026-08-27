import { writable } from 'svelte/store'
import type { Media } from './types'

/** Media already visible on the card the user selected. Detail queries can use this to keep the
 * title/art on screen while the richer record is fetched, instead of replacing known content with
 * anonymous grey blocks. This is intentionally session-only. */
export const detailHints = writable<Record<number, Media>>({})

export function rememberDetail(media: Media, displayedTitle?: string) {
  // Continue Watching may be rendering a provider-normalized title from an older trimmed snapshot.
  // Carry that exact visible label as userPreferred so the destination skeleton never becomes
  // anonymous while the richer detail query is in flight.
  const hint = displayedTitle && media.title.userPreferred !== displayedTitle
    ? { ...media, title: { ...media.title, userPreferred: displayedTitle } }
    : media
  detailHints.update((hints) => hints[media.id] === hint ? hints : { ...hints, [media.id]: hint })
}
