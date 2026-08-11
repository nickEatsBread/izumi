/** Deck browse chrome is deliberately enlarged, but the player is already touch-sized and must
 * stay in unscaled CSS pixels so its HTML controls continue to match the native video surface. */
export function deckWebviewZoom(uiScale: number, playing: boolean): number {
  return playing ? 1 : uiScale * 1.25
}
