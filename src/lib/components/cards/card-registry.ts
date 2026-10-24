import type { Media } from '$lib/anilist/types'
import type { DisplayModel } from '$lib/themes/presentation'

/** A card's media, plus the model its own template binds when the media alone says less (a Continue
 *  card's row loads few series fields, and its resume episode is the card's own). */
export interface CardEntry { media: Media; model?: DisplayModel }

/** Card root → its entry. SmallCard and ContinueCard fill it while mounted; Carousel reads it to bind a
 *  row's caption template (API 6 `captionTemplate`) to the focused card. */
export const cardMedia = new WeakMap<Element, CardEntry>()
