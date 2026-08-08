/** Pixels of overlap around the switch point in which the bar keeps whatever state it already had.
 *  Without it, a scroll position resting exactly on the threshold flickers between transparent and
 *  blurred as the browser's sub-pixel scroll offset jitters. */
export const HERO_BAR_HYSTERESIS_PX = 8

export interface HeroBarState {
  /** Blurred, bordered background instead of a transparent overlay. */
  solid: boolean
  /** The bar carries the series title (the big one has scrolled away). */
  showTitle: boolean
}

/**
 * Which state the series page's floating bar should be in.
 *
 * @param scrollY    current page scroll offset
 * @param artHeight  measured height of the artwork band (0 before it is measured)
 * @param barHeight  measured height of the bar, including its safe-area padding
 * @param wasSolid   the bar's current state, used to resolve the hysteresis band
 */
export function heroBarState(
  scrollY: number,
  artHeight: number,
  barHeight: number,
  wasSolid = false,
): HeroBarState {
  if (artHeight <= 0) return { solid: false, showTitle: false }
  const threshold = artHeight - barHeight
  const solid = wasSolid
    ? scrollY > threshold - HERO_BAR_HYSTERESIS_PX
    : scrollY > threshold + HERO_BAR_HYSTERESIS_PX
  return { solid, showTitle: solid }
}
