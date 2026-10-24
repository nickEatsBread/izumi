import { pivotScrollDelta, revealAxisDelta } from '$lib/nav'

/** The option a select menu opens on: the current value's row, or the first enabled row when the
 *  current one is disabled (Appearance's "Custom" theme) or missing. Null for an empty list. */
export function openingOption(list: ParentNode, value: string): HTMLElement | null {
  const rows = [...list.querySelectorAll<HTMLElement>('[data-select-value]:not(:disabled)')]
  return rows.find((row) => row.dataset.selectValue === value) ?? rows[0] ?? null
}

/** Scroll `row` inside the picker's own capped list, centred or just into view. Never
 *  scrollIntoView: it moves every scrollable ancestor, and from this fixed overlay a window scroll
 *  only shifts the page behind the backdrop (nav's revealFocused avoids it for the same reason). */
function scrollInList(row: HTMLElement, centre: boolean): void {
  const list = row.closest<HTMLElement>('[data-nav-scroll-container]:not([data-select-picker])')
  if (!list) return
  const item = row.getBoundingClientRect()
  const port = list.getBoundingClientRect()
  const edges = { itemStart: item.top, itemEnd: item.bottom, portStart: port.top, portEnd: port.bottom }
  list.scrollTop += centre
    ? pivotScrollDelta({ ...edges, pivot: 0.5, minShift: 0 })
    : revealAxisDelta({ ...edges, startMargin: 0, endMargin: 0 })
}

/** Centre the opening option in the controller picker's list (spec §3.5: it opens scrolled to the
 *  current value, not just focused on it). The same row SelectMenu focuses, so focus never opens
 *  off-screen. Returns the row, or null when the list has none. */
export function centrePickerValue(list: ParentNode, value: string): HTMLElement | null {
  const row = openingOption(list, value)
  if (row) scrollInList(row, true)
  return row
}

/** Move focus one enabled option down (1) or up (-1) an open select menu, wrapping at both ends;
 *  from outside the options (the search box) Down takes the first and Up the last. `panel` is the
 *  open menu, since the controller picker is portalled to <body>, outside the trigger's root.
 *  `reveal` scrolls the option into the capped list: the menu stops the arrow, so the nav engine's
 *  own reveal never runs for a TV remote's key events. */
export function stepMenuOption(panel: ParentNode, step: 1 | -1, reveal: boolean): HTMLElement | undefined {
  const items = [...panel.querySelectorAll<HTMLElement>('[data-select-value]:not(:disabled)')]
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = items[at < 0 && step < 0 ? items.length - 1 : (at + step + items.length) % items.length]
  next?.focus({ preventScroll: true })
  if (reveal && next) scrollInList(next, false)
  return next
}
