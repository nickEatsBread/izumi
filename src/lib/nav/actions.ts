export function dragScroll(node: HTMLElement) {
  let down = false, moved = false, startX = 0, startLeft = 0
  const onDown = (e: PointerEvent) => { if (e.button !== 0) return; down = true; moved = false; startX = e.clientX; startLeft = node.scrollLeft }
  const onMove = (e: PointerEvent) => {
    if (!down) return
    const dx = e.clientX - startX
    if (Math.abs(dx) > 5) moved = true
    node.scrollLeft = startLeft - dx
  }
  const onUp = () => { down = false }
  // If the pointer actually dragged, swallow the click so it doesn't open a card.
  // Capture phase so it runs before the card's own click handler.
  const onClick = (e: MouseEvent) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false } }
  node.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  node.addEventListener('click', onClick, true)
  return {
    destroy() {
      node.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      node.removeEventListener('click', onClick, true)
    }
  }
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
