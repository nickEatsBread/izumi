/** Deck browse chrome is deliberately enlarged, but the player is already touch-sized and must
 * stay in unscaled CSS pixels so its HTML controls continue to match the native video surface. */
export function deckWebviewZoom(uiScale: number, playing: boolean): number {
  return playing ? 1 : uiScale * 1.25
}

/** Hide the document while native page zoom jumps 1 ↔ 1.25 so leaving the player does not
 * visibly scale the browse UI. Pair with {@link releaseDeckBrowseZoom} after zoom is applied. */
export const DECK_ZOOM_HOLD_CLASS = 'deck-zoom-hold'

export function holdDeckBrowseZoom(): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.add(DECK_ZOOM_HOLD_CLASS)
}

export function releaseDeckBrowseZoom(): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.remove(DECK_ZOOM_HOLD_CLASS)
}
