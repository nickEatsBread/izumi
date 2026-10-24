import { reducedMotion } from '$lib/motion/gm-motion'

/** Svelte action on the desktop Settings rail (SettingsNav): keeps its one selection indicator
 *  (`data-part="settings.rail.indicator"`) over the link of the current section (`data-section`).
 *  The first placement jumps, so opening Settings never shows a slide; later moves slide through
 *  the CSS transition `data-animate` enables, except under reduced motion (izumi's setting or the
 *  OS), which always jumps. Offsets are measured from the rail, which is the indicator's
 *  positioned container. */
export function railIndicator(nav: HTMLElement, current: string | null) {
  const indicator = nav.querySelector<HTMLElement>('[data-part="settings.rail.indicator"]')
  let placed = false
  let frame = 0
  const place = () => {
    frame = 0
    if (!indicator) return
    const item = current ? nav.querySelector<HTMLElement>(`a[data-section="${current}"]`) : null
    indicator.hidden = !item
    if (!item) {
      placed = false
      return
    }
    indicator.toggleAttribute('data-animate', placed && !reducedMotion())
    indicator.style.height = `${item.offsetHeight}px`
    indicator.style.transform = `translateY(${item.offsetTop}px)`
    placed = true
  }
  // Rail items move when the window, or izumi's UI scale, changes size.
  const onResize = () => {
    if (!frame) frame = requestAnimationFrame(place)
  }
  place()
  window.addEventListener('resize', onResize)
  return {
    update(next: string | null) {
      current = next
      place()
    },
    destroy() {
      window.removeEventListener('resize', onResize)
      if (frame) cancelAnimationFrame(frame)
    },
  }
}
