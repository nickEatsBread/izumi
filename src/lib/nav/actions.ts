import { get } from 'svelte/store'
import { gameMode, playing } from '$lib/player/session'
import { dragCarousels } from '$lib/settings/ui'

export function dragScroll(node: HTMLElement) {
  let down = false, moved = false, startX = 0, startLeft = 0
  // Desktop mouse-drag-to-scroll. Game mode uses WebKitGTK's native touchscreen scrolling, so
  // this bails there. Listeners live on the NODE — NOT on window — so a page with
  // many carousels doesn't pile up global pointermove handlers, which made scrolling lag more
  // and more the further you'd navigated (the accumulating-lag bug).
  const onDown = (e: PointerEvent) => {
    if (!get(dragCarousels) || get(gameMode) || get(playing) || e.button !== 0) return
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
      // Close and latch any portalled hover trailer before the row starts moving. It must stay
      // closed while cards slide beneath a stationary pointer and only rearm on a later real move.
      window.dispatchEvent(new Event('carousel-nav'))
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

/** Steam Deck carousel arbitration. WebKitGTK otherwise lets an overflow-x row (or one of its
 * draggable poster links) claim an ambiguous finger gesture before the document can begin its
 * vertical pan. Advertise native pan-y up front, then own only a clearly-horizontal drag here.
 * Gamescope exposes Deck touch as a synthesized mouse pointer on the shipped GTK port, so this is
 * intentionally pointer-type agnostic while remaining strictly Game-mode gated. */
export function gameModeCarouselTouch(node: HTMLElement) {
  const previousTouchAction = node.style.touchAction
  const stopMode = gameMode.subscribe((enabled) => {
    node.style.touchAction = enabled ? 'pan-y' : previousTouchAction
  })
  let pointer = -1
  let axis: 'pending' | 'horizontal' | 'vertical' = 'pending'
  let startX = 0, startY = 0, startLeft = 0, lastX = 0, lastAt = 0, velocity = 0
  let momentumFrame = 0
  let suppressClickUntil = 0

  const stopMomentum = () => {
    if (momentumFrame) cancelAnimationFrame(momentumFrame)
    momentumFrame = 0
  }
  const coast = () => {
    if (Math.abs(velocity) < 0.05) return
    let previous = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(32, Math.max(1, now - previous))
      previous = now
      velocity *= Math.pow(0.91, dt / 16.67)
      if (Math.abs(velocity) < 0.05) { momentumFrame = 0; return }
      const before = node.scrollLeft
      node.scrollLeft += velocity * dt
      if (Math.abs(node.scrollLeft - before) < 0.1) { momentumFrame = 0; return }
      momentumFrame = requestAnimationFrame(frame)
    }
    momentumFrame = requestAnimationFrame(frame)
  }
  const onDown = (event: PointerEvent) => {
    if (!get(gameMode) || get(playing) || event.button !== 0) return
    stopMomentum()
    pointer = event.pointerId
    axis = 'pending'
    startX = lastX = event.clientX
    startY = event.clientY
    startLeft = node.scrollLeft
    lastAt = performance.now()
    velocity = 0
  }
  const onMove = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (axis === 'pending') {
      if (Math.hypot(dx, dy) < 8) return
      // Bias a diagonal gesture toward the document. A row starts moving only when horizontal
      // intent is unambiguous; vertical movement never calls preventDefault.
      axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical'
      if (axis === 'horizontal') {
        suppressClickUntil = performance.now() + 450
        window.dispatchEvent(new Event('carousel-nav'))
        try { node.setPointerCapture(event.pointerId) } catch { /* capture is optional */ }
      }
    }
    if (axis !== 'horizontal') return
    event.preventDefault()
    const now = performance.now()
    const dt = Math.max(1, now - lastAt)
    const sample = Math.max(-3, Math.min(3, (lastX - event.clientX) / dt))
    velocity = velocity * 0.55 + sample * 0.45
    lastX = event.clientX
    lastAt = now
    node.scrollLeft = startLeft - dx
  }
  const onEnd = (event: PointerEvent) => {
    if (pointer !== event.pointerId) return
    const horizontal = axis === 'horizontal'
    pointer = -1
    axis = 'pending'
    try { node.releasePointerCapture(event.pointerId) } catch { /* wasn't captured */ }
    if (horizontal) coast()
  }
  const onClick = (event: MouseEvent) => {
    if (performance.now() >= suppressClickUntil) return
    event.preventDefault()
    event.stopPropagation()
  }
  const onDragStart = (event: DragEvent) => {
    if (get(gameMode)) event.preventDefault()
  }

  node.addEventListener('pointerdown', onDown)
  node.addEventListener('pointermove', onMove)
  node.addEventListener('pointerup', onEnd)
  node.addEventListener('pointercancel', onEnd)
  node.addEventListener('click', onClick, true)
  node.addEventListener('dragstart', onDragStart)
  return {
    destroy() {
      stopMomentum()
      stopMode()
      node.style.touchAction = previousTouchAction
      node.removeEventListener('pointerdown', onDown)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerup', onEnd)
      node.removeEventListener('pointercancel', onEnd)
      node.removeEventListener('click', onClick, true)
      node.removeEventListener('dragstart', onDragStart)
    },
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
  const stripTitle = (el: Element | null) => {
    const title = el?.getAttribute('title')
    if (!el || !title) return
    el.setAttribute('data-title', title)
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', title)
    el.removeAttribute('title')
  }
  const stripTree = (root: ParentNode) => {
    if (root instanceof Element) stripTitle(root)
    root.querySelectorAll?.('[title]').forEach(stripTitle)
  }
  // Remove titles which already exist before the emulated Gamescope pointer is moved. Waiting for
  // pointerover can be one native hit-test too late and briefly paints WebKit's top-left tooltip.
  stripTree(document)
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') stripTitle(mutation.target as Element)
      else mutation.addedNodes.forEach((node) => { if (node instanceof Element) stripTree(node) })
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] })
  window.addEventListener('pointerover', (e) => {
    stripTitle((e.target as Element | null)?.closest?.('[title]') ?? null)
  }, true)
}

// Game mode: a held touchscreen/controller-mouse press can make WebKitGTK open its desktop
// context menu ("Open Link", "Open Link in New Window", ...). That native menu sits outside
// the DOM and steals the d-pad until dismissed. Cancel only the browser default; do not stop
// propagation, so app-owned contextmenu gestures can still handle the event themselves.
let contextMenusSuppressed = false
export function suppressNativeContextMenus() {
  if (contextMenusSuppressed || !get(gameMode)) return
  contextMenusSuppressed = true
  window.addEventListener('contextmenu', (e) => e.preventDefault(), true)
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
