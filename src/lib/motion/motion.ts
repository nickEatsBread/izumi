import { get } from 'svelte/store'
import { cubicOut } from 'svelte/easing'
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

/** A Svelte transition for menus, panels and the featured banner: a plain CSS animation of the
 *  given channels. Svelte runs transitions through the Web Animations API, which the stylesheet's
 *  reduced-motion rule cannot reach, so reduced motion is honoured here. */
export function motion(_node: HTMLElement, p: MotionParams) {
  if (reducedMotion()) return { duration: 0 }
  const { duration = 200, delay = 0, easing = cubicOut } = p
  return { duration, delay, easing, css: (t: number) => motionCss(motionFrame(p, t)) }
}
