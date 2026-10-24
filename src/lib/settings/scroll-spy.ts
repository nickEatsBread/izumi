/** A rendered subcategory and its top edge in CSS px from the viewport top. */
export interface SubcategoryTop { id: string; top: number }

/** How far below a jumped-to heading's landing spot (SettingsSubcategory's scroll margin) the
 *  reading line sits, so a chip jump lights its own chip. */
export const SCROLL_SPY_GAP = 16

/** The subcategory being read, for the chips and the sticky bar: the last one in page order whose
 *  top has reached `line` (section-scroll.ts measures it from the live scroll margin), else the
 *  first. `atEnd` (the page is scrolled to its end) picks the last one, which may be too short ever
 *  to reach the line. null when the page has none. */
export function activeSubcategory(tops: readonly SubcategoryTop[], line: number, atEnd = false): string | null {
  if (!tops.length) return null
  if (atEnd) return tops[tops.length - 1].id
  let active = tops[0].id
  for (const { id, top } of tops) {
    if (top > line) break
    active = id
  }
  return active
}
