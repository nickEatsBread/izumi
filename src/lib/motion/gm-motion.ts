import { get } from 'svelte/store'
import { cubicOut } from 'svelte/easing'
import { gameMode } from '$lib/player/session'
import { motionPreference } from '$lib/settings/ui'

type Range = readonly [number, number]

export interface MotionParams {
  duration?: number
  delay?: number
  easing?: (t: number) => number
  /** [hidden, shown] for every channel: an intro runs hidden → shown, an outro shown → hidden. */
  opacity?: Range
  x?: Range
  y?: Range
  /** Horizontal offset as a percentage of the element's own width. */
  xPercent?: Range
  scale?: Range
  /** Run in Game mode only (elsewhere the element keeps its own CSS motion). */
  gameModeOnly?: boolean
}

export interface MotionFrame {
  opacity?: number
  translate?: string
  scale?: number
}

export function reducedMotion(): boolean {
  const preference = get(motionPreference)
  if (preference === 'reduce') return true
  if (preference === 'full') return false
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

const lerp = (range: Range | undefined, t: number) => range ? range[0] + (range[1] - range[0]) * t : undefined

/** The style values of a motion at progress `t` (0 = hidden, 1 = shown). */
export function motionFrame(p: MotionParams, t: number): MotionFrame {
  const opacity = lerp(p.opacity, t)
  const x = lerp(p.x, t)
  const y = lerp(p.y, t)
  const xPercent = lerp(p.xPercent, t)
  const scale = lerp(p.scale, t)
  const moves = x != null || y != null || xPercent != null
  const round = (v: number) => Math.round(v * 1000) / 1000
  return {
    ...(opacity != null ? { opacity: round(opacity) } : {}),
    ...(moves ? { translate: `${xPercent != null ? `${round(xPercent)}%` : `${round(x ?? 0)}px`} ${round(y ?? 0)}px` } : {}),
    ...(scale != null ? { scale: round(scale) } : {}),
  }
}

export function motionCss(frame: MotionFrame): string {
  return [
    frame.opacity != null ? `opacity: ${frame.opacity}` : '',
    frame.translate ? `translate: ${frame.translate}` : '',
    frame.scale != null ? `scale: ${frame.scale}` : '',
  ].filter(Boolean).join('; ')
}

/** A Svelte transition for menus, panels and the featured banner.
 *
 *  Everywhere but Game mode it is an ordinary CSS transition. In Game mode (WebKitGTK 2.52 under
 *  gamescope) a CSS or Web Animations animation drops its element's compositor layer when it ends,
 *  and the next frame can be presented before the page tiles hold that element's pixels: the
 *  featured banner and the side menu's pickers blinked once at the end of every animation. There
 *  the same motion runs as per-frame style writes on an element pinned to its own layer for its
 *  whole life (a static translateZ(0)), so nothing changes layers when the motion ends. */
export function motion(node: HTMLElement, p: MotionParams, options?: { direction?: 'in' | 'out' | 'both' }) {
  const gm = get(gameMode)
  if ((p.gameModeOnly && !gm) || reducedMotion()) return { duration: 0 }
  const { duration = 200, delay = 0, easing = cubicOut } = p
  if (!gm) return { duration, delay, easing, css: (t: number) => motionCss(motionFrame(p, t)) }
  const apply = (t: number) => {
    const frame = motionFrame(p, t)
    if (frame.opacity != null) node.style.opacity = String(frame.opacity)
    if (frame.translate) node.style.translate = frame.translate
    if (frame.scale != null) node.style.scale = String(frame.scale)
  }
  node.style.transform = 'translateZ(0)'
  // The first painted frame of an intro is already its hidden state, not one frame of the end state.
  if (options?.direction === 'in') apply(0)
  return { duration, delay, easing, tick: apply }
}
