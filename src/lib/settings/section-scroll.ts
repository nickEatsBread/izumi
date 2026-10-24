import { get } from 'svelte/store'
import { rootZoom } from '$lib/components/cards/preview-pos'
import { reducedMotion } from '$lib/motion/gm-motion'
import { focusRestoreAllowed } from '$lib/nav/focus-memory'
import { gameMode } from '$lib/player/session'
import { firstSafeControl } from './search-target'
import { SUBCATEGORY_OPEN_EVENT } from './sections'
import { activeSubcategory, SCROLL_SPY_GAP } from './scroll-spy'

// Desktop section pages (SettingsSection): which subcategories a page renders, which one is being
// read, whether the page header has scrolled away, the chip jump, and the section-switch fade.

export interface SectionScrollState {
  /** Rendered subcategory ids in page order. A platform-hidden subcategory never renders, so it
   *  gets no chip. */
  ids: string[]
  /** The subcategory being read: the lit chip and the sticky bar's last crumb. */
  active: string | null
  /** The page header has scrolled out of view, so the compact bar shows. */
  stuck: boolean
}

export interface SectionScrollTracker {
  /** A chip press: unfold the subcategory if folded, scroll to it, and keep it lit until the user
   *  scrolls. On a pad or TV focus moves to its first safe control. */
  jump(id: string): void
  destroy(): void
}

// Input that starts a scroll of the user's own ends a chip jump's hold on the lit chip.
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

/** Follows one section page through the window scroll. Rect maths on scroll, never
 *  IntersectionObserver: CSS zoom on the document makes it misreport in the WebViews we ship
 *  (util/near-viewport.ts). */
export function trackSectionScroll(
  root: HTMLElement,
  header: HTMLElement,
  onChange: (state: SectionScrollState) => void,
): SectionScrollTracker {
  let frame = 0
  let jumpFrame = 0
  let held: string | null = null
  let last = ''
  const subcategories = () => [...root.querySelectorAll<HTMLElement>('[data-settings-subcategory]')]
  const measure = () => {
    frame = 0
    const els = subcategories()
    const tops = els.map((el) => ({ id: el.id, top: el.getBoundingClientRect().top }))
    const ids = tops.map(({ id }) => id)
    const atEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 1
    // Rect tops are screen px under the UI-scale zoom on <html>; computed lengths are local px.
    const zoom = rootZoom()
    // A jump lands a heading at its scroll margin, which grows with the titlebar/top-bar band
    // (--theme-shell-top). The reading line sits just below it.
    const margin = els.length ? parseFloat(getComputedStyle(els[0]).scrollMarginTop) || 0 : 0
    const line = (margin + SCROLL_SPY_GAP) * zoom
    const active = held !== null && ids.includes(held) ? held : activeSubcategory(tops, line, atEnd)
    // The header is gone once it slides under the fixed titlebar/top-bar band, which the bar's top
    // padding spans. Waiting for the viewport edge left the section named nowhere under a top bar.
    const bar = root.querySelector<HTMLElement>('[data-settings-sticky]')
    const band = bar ? (parseFloat(getComputedStyle(bar).paddingTop) || 0) * zoom : 0
    const state: SectionScrollState = { ids, active, stuck: header.getBoundingClientRect().bottom <= band }
    const key = JSON.stringify(state)
    if (key === last) return
    last = key
    onChange(state)
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure)
  }
  const release = () => {
    if (held === null) return
    held = null
    schedule()
  }
  // Content that grows or shrinks (a subcategory unfolding, rows loading) moves headings without a scroll.
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  resize?.observe(root)
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, release, { capture: true, passive: true })
  measure()
  return {
    jump(id) {
      const target = subcategories().find((el) => el.id === id)
      if (!target) return
      held = id
      const go = () => {
        jumpFrame = 0
        target.scrollIntoView({ behavior: reducedMotion() ? 'instant' : 'smooth', block: 'start' })
        // On a pad or TV focus follows the jump: left on the chip, the next press would start from
        // there and scroll straight back up. A foldable block's heading is its fold toggle, where the
        // next A would fold the block straight back up, so look in the body first.
        if (!focusRestoreAllowed()) return
        const body = target.querySelector<HTMLElement>('[data-settings-subcategory-body]')
        const control = (body && firstSafeControl(body)) ?? firstSafeControl(target)
        control?.focus({ preventScroll: true })
      }
      cancelAnimationFrame(jumpFrame)
      // A folded body unhides on Svelte's next flush; scrolling before it would stop at the old page end.
      if (target.hasAttribute('data-collapsed')) {
        target.dispatchEvent(new CustomEvent(SUBCATEGORY_OPEN_EVENT))
        jumpFrame = requestAnimationFrame(go)
      } else go()
      schedule()
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame)
      if (jumpFrame) cancelAnimationFrame(jumpFrame)
      resize?.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, release, { capture: true })
    },
  }
}

/** `in:fly` params for a desktop section switch (settings +layout.svelte): a 160 ms fade with a
 *  6 px rise. Instant under reduced motion (izumi's setting or the OS) and in Game mode, where the
 *  end of a CSS animation blinks (motion/gm-motion.ts). */
export function sectionFade() {
  return { y: 6, opacity: 0, duration: reducedMotion() || get(gameMode) ? 0 : 160 }
}
