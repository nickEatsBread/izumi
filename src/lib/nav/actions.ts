import { get } from 'svelte/store'
import { gameMode, playing } from '$lib/player/session'

export function dragScroll(node: HTMLElement) {
  let down = false, moved = false, startX = 0, startLeft = 0
  // Desktop mouse-drag-to-scroll. Game mode uses WebKitGTK's native touchscreen scrolling, so
  // this bails there. Listeners live on the NODE — NOT on window — so a page with
  // many carousels doesn't pile up global pointermove handlers, which made scrolling lag more
  // and more the further you'd navigated (the accumulating-lag bug).
  const onDown = (e: PointerEvent) => {
    if (get(gameMode) || get(playing) || e.button !== 0) return
    down = true; moved = false; startX = e.clientX; startLeft = node.scrollLeft
  }
  const onMove = (e: PointerEvent) => {
    if (!down) return
    const dx = e.clientX - startX
    // Capture the pointer ONLY once a real drag begins (>5px), so the drag can continue off the
    // node. Do NOT capture on pointerdown: while a pointer is captured the browser dispatches
    // the `click` to the CAPTURE target (this carousel) instead of the card's <a>/button, which
    // silently swallows card navigation — you couldn't open a title or reach the player.
    if (!moved && Math.abs(dx) > 5) {
      moved = true
      try { node.setPointerCapture(e.pointerId) } catch { /* capture unsupported — fine while over the node */ }
    }
    if (moved) node.scrollLeft = startLeft - dx
  }
  const onUp = (e: PointerEvent) => { down = false; try { node.releasePointerCapture(e.pointerId) } catch { /* wasn't captured */ } }
  // If the pointer actually dragged, swallow the click so it doesn't open a card.
  // Capture phase so it runs before the card's own click handler.
  const onClick = (e: MouseEvent) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false } }
  node.addEventListener('pointerdown', onDown)
  node.addEventListener('pointermove', onMove)
  node.addEventListener('pointerup', onUp)
  node.addEventListener('pointercancel', onUp)
  node.addEventListener('click', onClick, true)
  return {
    destroy() {
      node.removeEventListener('pointerdown', onDown)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerup', onUp)
      node.removeEventListener('pointercancel', onUp)
      node.removeEventListener('click', onClick, true)
    }
  }
}

// Game mode: kill the native `title` hover tooltips (the little accessibility popups). With a
// controller the emulated pointer hovers everything and pops them up over the UI. We strip the
// title on pointer-enter (stashing it in data-title so nothing is lost) so the tooltip's delay
// timer finds no title to show. Idempotent; call once. No-op outside Game mode.
let tooltipsSuppressed = false
export function suppressNativeTooltips() {
  if (tooltipsSuppressed || !get(gameMode)) return
  tooltipsSuppressed = true
  window.addEventListener('pointerover', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('[title]') as HTMLElement | null
    if (el?.title) { el.dataset.title = el.title; el.removeAttribute('title') }
  }, true)
}

// Focus this element on mount when in Game mode (controller/d-pad), so a series page lands on
// Play and modals land on their primary action. rAF so layout has settled. No-op for mouse/desktop.
export function focusOnMount(node: HTMLElement) {
  if (get(gameMode)) requestAnimationFrame(() => node.focus({ preventScroll: true }))
}

export function hover(node: HTMLElement, handlers: { enter: () => void; leave: () => void }) {
  const onEnter = () => handlers.enter()
  const onLeave = () => handlers.leave()
  node.addEventListener('pointerenter', onEnter)
  node.addEventListener('pointerleave', onLeave)
  return {
    destroy() {
      node.removeEventListener('pointerenter', onEnter)
      node.removeEventListener('pointerleave', onLeave)
    }
  }
}
