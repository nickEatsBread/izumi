// Where the native video surface sits inside the window while the browse chrome is up.
//
// The webview is transparent over mpv, so the HTML player root IS the video's frame: whatever
// area the root covers must be exactly what the native surface renders into. The root reports its
// edges as fractions of the viewport (`measureStage`), and `playerInsets` turns them into the
// physical-pixel insets the native side expects (`player_set_inset`). Before the overlay has
// measured itself, the chrome's own extent is used so the first frame lands in the right place.
import type { ThemeNavPlacement } from '$lib/themes/presentation'

/** Edges of the video stage as fractions of the viewport: `right`/`bottom` measure from those
 *  edges, so a full-viewport stage is all zeros. Fractions are zoom-agnostic: both rects come from
 *  the same `getBoundingClientRect` semantics, whatever the engine does with a root `zoom`. */
export interface StageFractions { left: number; top: number; right: number; bottom: number }
export interface PlayerInsets { left: number; top: number; right: number; bottom: number }
export interface InsetContext {
  /** Browse chrome is visible around the video (windowed playback). Fullscreen, Game mode and
   *  picture-in-picture render edge to edge, so every inset is 0. */
  chrome: boolean
  nav: ThemeNavPlacement
  /** The player root's measured edges, or null before it has mounted. */
  stage: StageFractions | null
  viewport: { width: number; height: number }
  dpr: number
  uiScale: number
  /** The bottom bar's height in CSS px (a theme can change it), used before measurement. */
  bottomNav?: number
}

export const SIDEBAR_WIDTH = 56
export const TOP_BAR_HEIGHT = 76
export const BOTTOM_NAV_HEIGHT = 64

const clamp01 = (value: number) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

/** The stage's edges relative to a probe that spans the whole viewport. */
export function measureStage(stage: DOMRectReadOnly, viewport: DOMRectReadOnly): StageFractions | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null
  return {
    left: clamp01((stage.left - viewport.left) / viewport.width),
    top: clamp01((stage.top - viewport.top) / viewport.height),
    right: clamp01((viewport.right - stage.right) / viewport.width),
    bottom: clamp01((viewport.bottom - stage.bottom) / viewport.height),
  }
}

export function playerInsets(context: InsetContext): PlayerInsets {
  if (!context.chrome) return { left: 0, top: 0, right: 0, bottom: 0 }
  const dpr = context.dpr > 0 ? context.dpr : 1
  const px = (value: number) => Math.max(0, Math.round(value * dpr))
  const { stage, viewport } = context
  if (stage) {
    return {
      left: px(stage.left * viewport.width),
      top: px(stage.top * viewport.height),
      right: px(stage.right * viewport.width),
      bottom: px(stage.bottom * viewport.height),
    }
  }
  // Not measured yet: the chrome's own extent, scaled like the page (CSS zoom on the root).
  const scale = context.uiScale > 0 ? context.uiScale : 1
  if (context.nav === 'top') return { left: 0, top: px(TOP_BAR_HEIGHT * scale), right: 0, bottom: 0 }
  if (context.nav === 'bottom') return { left: 0, top: 0, right: 0, bottom: px((context.bottomNav ?? BOTTOM_NAV_HEIGHT) * scale) }
  return { left: px(SIDEBAR_WIDTH * scale), top: 0, right: 0, bottom: 0 }
}

export const sameInsets = (a: PlayerInsets | null, b: PlayerInsets) =>
  !!a && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom
