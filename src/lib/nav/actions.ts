import { get } from 'svelte/store'
import { gameMode, playing } from '$lib/player/session'

export function dragScroll(node: HTMLElement) {
  let down = false, moved = false, startX = 0, startLeft = 0
  // Desktop mouse-drag-to-scroll. In Game mode the app-wide `initTouchScroll` owns ALL
  // scrolling, so this bails there. Listeners live on the NODE — NOT on window — so a page with
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

// App-wide drag-to-scroll for Game mode (Steam Deck). The embedded WebKit webview delivers
// the touchscreen as MOUSE/pointer events with no native kinetic scrolling — so nothing
// scrolls on a finger drag (and, without user-select:none, it selects text). This makes a
// finger drag scroll the page like a normal webpage: it locks to an axis, scrolls the nearest
// scrollable ancestor on that axis (a carousel row horizontally, else the page vertically),
// glides with momentum on release, and swallows the trailing click so a swipe never opens a
// card. No-ops outside Game mode (Desktop uses the wheel + `dragScroll`) and while the player
// is open (that owns its own touch). Call once at app start.
export function initTouchScroll() {
  let downX = 0, downY = 0, lastX = 0, lastY = 0, lastT = 0
  let axis: 'x' | 'y' | null = null
  let target: HTMLElement | null = null
  let vx = 0, vy = 0
  let active = false, dragged = false
  let raf = 0        // momentum glide
  let dragRaf = 0    // batched drag apply
  let accDx = 0, accDy = 0 // pending delta to apply on the next frame

  const doc = () => document.scrollingElement as HTMLElement
  // Apply the deltas accumulated since the last frame in ONE scroll write. A touch digitizer
  // fires several pointermove events per frame; scrolling on each repaints the whole page
  // several times per frame (cheap for a small row, but drops frames on the full home page —
  // the "slow / twitchy" vertical scroll). Coalescing to one write per frame fixes that.
  const flush = () => {
    dragRaf = 0
    if (target) {
      if (axis === 'x') target.scrollLeft -= accDx
      else target.scrollTop -= accDy
    }
    accDx = 0; accDy = 0
  }
  // Nearest ancestor that actually scrolls on `ax`. Vertical falls back to the document
  // scroller (the page). Horizontal does NOT fall back to the document: the page is
  // `overflow-x: clip`, so a horizontal drag with no scrollable carousel under the finger must
  // be a no-op — otherwise it drags the whole document sideways into overflow and the client
  // looks like it shrinks (dragging from the right edge). null = don't scroll on this axis.
  function scrollableOn(from: Element | null, ax: 'x' | 'y'): HTMLElement | null {
    for (let n = from as HTMLElement | null; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (ax === 'x' && n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(s.overflowX)) return n
      if (ax === 'y' && n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(s.overflowY)) return n
    }
    return ax === 'y' ? doc() : null
  }
  const glide = () => {
    const damp = 0.94, min = 0.02
    if (!target) return
    if (axis === 'x') { if (Math.abs(vx) < min) return; target.scrollLeft -= vx * 16; vx *= damp }
    else { if (Math.abs(vy) < min) return; target.scrollTop -= vy * 16; vy *= damp }
    raf = requestAnimationFrame(glide)
  }
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !get(gameMode) || get(playing)) return
    cancelAnimationFrame(raf); cancelAnimationFrame(dragRaf); dragRaf = 0
    active = true; dragged = false; axis = null; target = null; vx = vy = 0; accDx = 0; accDy = 0
    downX = lastX = e.clientX; downY = lastY = e.clientY; lastT = performance.now()
  }
  const onMove = (e: PointerEvent) => {
    if (!active) return
    const x = e.clientX, y = e.clientY
    if (!axis) {
      const adx = Math.abs(x - downX), ady = Math.abs(y - downY)
      if (adx < 8 && ady < 8) return
      axis = adx > ady ? 'x' : 'y'
      target = scrollableOn(e.target as Element, axis)
      dragged = true
    }
    const now = performance.now(), dt = Math.max(1, now - lastT)
    const dx = x - lastX, dy = y - lastY
    // Accumulate the delta + track velocity; the actual scroll write happens once per frame
    // in `flush` (see above) instead of on every event.
    if (axis === 'x') { accDx += dx; vx = dx / dt } else { accDy += dy; vy = dy / dt }
    lastX = x; lastY = y; lastT = now
    if (!dragRaf) dragRaf = requestAnimationFrame(flush)
    e.preventDefault()
  }
  const onUp = () => {
    if (!active) return
    active = false
    if (dragRaf) { cancelAnimationFrame(dragRaf); flush() } // apply the last accumulated batch
    if (dragged && target) raf = requestAnimationFrame(glide)
  }
  const onClickCapture = (e: MouseEvent) => { if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false } }

  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onUp, true)
  window.addEventListener('click', onClickCapture, true)
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
