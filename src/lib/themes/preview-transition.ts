import { goto } from '$app/navigation'
import { cubicOut } from 'svelte/easing'
import { reducedMotion } from '$lib/motion/gm-motion'

// Script-driven on purpose: WebKitGTK 2.52 (Deck) blinks at the end of CSS and Web Animations
// motion, so the clone moves by per-frame style writes on elements pinned to their own layer.
const GROW_MS = 480
const FADE_MS = 280

interface Box { left: number; top: number; width: number; height: number }
const viewport = (): Box => ({ left: 0, top: 0, width: innerWidth, height: innerHeight })
const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height } }
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const frames = (count: number) => new Promise<void>((done) => {
  let left = count
  const step = () => (--left <= 0 ? done() : requestAnimationFrame(step))
  requestAnimationFrame(step)
})

function tween(duration: number, frame: (t: number) => void): Promise<void> {
  return new Promise((done) => {
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      frame(cubicOut(t))
      if (t < 1) requestAnimationFrame(step)
      else done()
    }
    requestAnimationFrame(step)
  })
}

/** A protected overlay: a black scrim and the screenshot, above everything (including the bar). */
function stage(src: string) {
  const root = document.createElement('div')
  root.setAttribute('data-theme-protected', '')
  root.setAttribute('aria-hidden', 'true')
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;transform:translateZ(0)'
  const scrim = document.createElement('div')
  scrim.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;transform:translateZ(0)'
  const image = document.createElement('img')
  image.alt = ''
  image.referrerPolicy = 'no-referrer'
  image.src = src
  image.style.cssText = 'position:absolute;object-fit:cover;transform:translateZ(0)'
  root.append(scrim, image)
  document.body.append(root)
  const place = (from: Box, to: Box, t: number, radius: number) => {
    image.style.left = `${mix(from.left, to.left, t)}px`
    image.style.top = `${mix(from.top, to.top, t)}px`
    image.style.width = `${mix(from.width, to.width, t)}px`
    image.style.height = `${mix(from.height, to.height, t)}px`
    image.style.borderRadius = `${radius}px`
  }
  return { root, scrim, image, place }
}

async function waitFor(target: () => Element | null, timeout: number): Promise<Element | null> {
  const until = performance.now() + timeout
  while (performance.now() < until) {
    const found = target()
    if (found && found.getBoundingClientRect().width > 0) return found
    await frames(1)
  }
  return null
}

/** Grow the screenshot to fill the window, start the preview and open its screen underneath,
 *  then dissolve into the live themed app. */
export async function stepIntoPreview(from: HTMLImageElement | null, start: () => void, route: string): Promise<void> {
  if (!from || reducedMotion()) { start(); await goto(route); return }
  const box = boxOf(from)
  const { root, scrim, place } = stage(from.currentSrc || from.src)
  place(box, box, 0, 12)
  try {
    await tween(GROW_MS, (t) => { place(box, viewport(), t, 12 * (1 - t)); scrim.style.opacity = String(t) })
    start()
    await goto(route)
    await frames(6)
    await tween(FADE_MS, (t) => { root.style.opacity = String(1 - t) })
  } finally { root.remove() }
}

/** Dim the live screen, end the preview and return to the theme page underneath, then fade this
 *  screen's screenshot in as it shrinks into the page's viewer (a plain fade if it never appears).
 *  The live screen never crossfades with the screenshot: their content differs. */
export async function stepOutOfPreview(src: string | null, end: () => void, route: string, target: () => Element | null): Promise<void> {
  if (!src || reducedMotion()) { end(); await goto(route); return }
  const { root, scrim, image, place } = stage(src)
  place(viewport(), viewport(), 0, 0)
  image.style.opacity = '0'
  try {
    await tween(FADE_MS, (t) => { scrim.style.opacity = String(t) })
    end()
    await goto(route)
    const found = await waitFor(target, 1500)
    if (found) {
      const box = boxOf(found)
      await tween(GROW_MS, (t) => { place(viewport(), box, t, 12 * t); image.style.opacity = String(Math.min(1, t * 3)); scrim.style.opacity = String(1 - t) })
    } else {
      await tween(FADE_MS, (t) => { scrim.style.opacity = String(1 - t) })
    }
  } finally { root.remove() }
}
