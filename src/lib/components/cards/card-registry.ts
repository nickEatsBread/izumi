import type { Media } from '$lib/anilist/types'

/** Card root → its media. SmallCard and ContinueCard fill it while mounted; Carousel reads it to bind a
 *  row's caption template (API 6 `captionTemplate`) to the focused card. */
export const cardMedia = new WeakMap<Element, Media>()
