import { get, writable } from 'svelte/store'
import { goto } from '$app/navigation'
import { mediaHref } from './media'
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
  // Every entry point projects a different slice of the same record (a schedule row has a title and
  // a cover, a season chip adds the banner, the series page itself leaves the full record). Keep
  // what an earlier, richer hint already knew instead of trading it for a slimmer card's fields, one
  // level down too, so a schedule row's two-size cover does not drop the cover colour a card brought.
  // A record from another catalog under the same id (the stand-in the series page shows while
  // AniList is unavailable) is not a slice of the same record: it replaces the hint.
  const stored = get(detailHints)[media.id]
  const previous = stored && catalogOf(stored) === catalogOf(hint) ? stored : undefined
  // A store emits on every object write, and a link records on press and again on click: skip a
  // hint that adds nothing.
  if (previous && (Object.keys(hint) as (keyof Media)[]).every((key) => hint[key] === undefined || previous[key] === hint[key])) return
  detailHints.update((hints) => ({ ...hints, [media.id]: previous ? mergeHint(previous, hint) : hint }))
}

const catalogOf = (media: Media) => media.catalog?.provider ?? 'anilist'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** `next` over `previous`; an object field (title, coverImage) keeps the keys only `previous` has.
 *  An undefined field is one the slice does not know, like an absent one; null still means none. */
function mergeHint(previous: Media, next: Media): Media {
  const merged: Record<string, unknown> = { ...previous }
  const assign = (target: Record<string, unknown>, source: Record<string, unknown>, deep: boolean) => {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue
      const before = target[key]
      target[key] = deep && isRecord(value) && isRecord(before) ? assign({ ...before }, value, false) : value
    }
    return target
  }
  return assign(merged, next as unknown as Record<string, unknown>, true) as unknown as Media
}

/** Open `media`'s series page with its hint recorded, for code that navigates instead of a link. */
export function openDetail(media: Media, displayedTitle?: string): Promise<void> {
  rememberDetail(media, displayedTitle)
  return goto(mediaHref(media))
}

/** `use:detailLink={media}` on a link to `media`'s series page. Records the hint when the press
 * starts, the earliest moment, so the page can draw the title and art the viewer just pressed while
 * the full record loads; click and Enter cover controllers, keyboards and synthesized clicks. It
 * only records: nothing is fetched, so a touch that becomes a scroll costs no request. */
export function detailLink(node: HTMLElement, media: Media | null | undefined) {
  let current = media
  const remember = () => { if (current) rememberDetail(current) }
  const key = (event: KeyboardEvent) => { if (event.key === 'Enter') remember() }
  node.addEventListener('pointerdown', remember)
  node.addEventListener('click', remember)
  node.addEventListener('keydown', key)
  return {
    update(next: Media | null | undefined) { current = next },
    destroy() {
      node.removeEventListener('pointerdown', remember)
      node.removeEventListener('click', remember)
      node.removeEventListener('keydown', key)
    },
  }
}
