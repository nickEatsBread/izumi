/** Per-frame tweens for state changes that are not an element entering or leaving: a card taking focus,
 *  an image that finished loading. They run as style writes from script everywhere, so Game mode
 *  (WebKitGTK 2.52, which blinks when a CSS transition's compositor layer drops at its end) animates
 *  them too instead of snapping. No layer is ever promoted for them, so none is dropped. */
import { cubicOut } from 'svelte/easing'
import { reducedMotion } from './gm-motion'

const frames = new WeakMap<HTMLElement, Map<string, number>>()

/** Tweens `read()` → `to` over `duration` ms, writing each value with `write`. A new tween of the same
 *  `key` on `node` replaces the one running, starting from where it got to. */
export function tween(node: HTMLElement, key: string, read: () => number, write: (value: number) => void, to: number, duration: number, done?: () => void): void {
  const running = frames.get(node) ?? new Map<string, number>()
  frames.set(node, running)
  const frame = running.get(key)
  if (frame !== undefined) cancelAnimationFrame(frame)
  running.delete(key)
  const from = read()
  if (reducedMotion() || duration <= 0 || from === to) {
    write(to)
    done?.()
    return
  }
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    write(from + (to - from) * cubicOut(t))
    if (t < 1) running.set(key, requestAnimationFrame(step))
    else {
      running.delete(key)
      done?.()
    }
  }
  running.set(key, requestAnimationFrame(step))
}

/** Stops every tween running on `node`, leaving its styles where they got to. */
export function stopTweens(node: HTMLElement): void {
  for (const frame of frames.get(node)?.values() ?? []) cancelAnimationFrame(frame)
  frames.delete(node)
}

/** The custom property a focused element carries, rising 0 → 1 as it takes focus and falling back as it
 *  loses it. Themes tween their focus look from it (scale, overlay opacity, ring colour). */
export const FOCUS_PROPERTY = '--izumi-focus'
export const FOCUS_MS = 150

const focusValue = (node: HTMLElement) => Number.parseFloat(node.style.getPropertyValue(FOCUS_PROPERTY)) || 0
const setFocus = (node: HTMLElement, to: number) =>
  tween(node, FOCUS_PROPERTY, () => focusValue(node), (value) => node.style.setProperty(FOCUS_PROPERTY, value.toFixed(3)), to, FOCUS_MS)

/** Keeps `--izumi-focus` on whatever focusable element takes or loses focus. Returns the unsubscribe. */
export function trackFocusProgress(root: Document = document): () => void {
  const target = (event: Event) => event.target instanceof HTMLElement && event.target.hasAttribute('data-focusable') ? event.target : null
  const onIn = (event: FocusEvent) => { const node = target(event); if (node) setFocus(node, 1) }
  const onOut = (event: FocusEvent) => { const node = target(event); if (node) setFocus(node, 0) }
  root.addEventListener('focusin', onIn)
  root.addEventListener('focusout', onOut)
  return () => {
    root.removeEventListener('focusin', onIn)
    root.removeEventListener('focusout', onOut)
  }
}

export const IMAGE_FADE_MS = 220

/** Fades an image in once it has loaded; one already decoded when it mounts shows at once. The opacity
 *  is the image's own while it fades and given back to the stylesheet once it is in. */
export function fadeOnLoad(node: HTMLImageElement): { destroy(): void } {
  if (reducedMotion() || (node.complete && node.naturalWidth > 0)) return { destroy() {} }
  node.style.opacity = '0'
  const show = () => tween(node, 'opacity', () => Number.parseFloat(node.style.opacity) || 0, (value) => (node.style.opacity = value.toFixed(3)), 1, IMAGE_FADE_MS, () => node.style.removeProperty('opacity'))
  const fail = () => node.style.removeProperty('opacity')
  node.addEventListener('load', show, { once: true })
  node.addEventListener('error', fail, { once: true })
  return {
    destroy() {
      node.removeEventListener('load', show)
      node.removeEventListener('error', fail)
      stopTweens(node)
    },
  }
}
