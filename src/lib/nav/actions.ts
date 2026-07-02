export function dragScroll(node: HTMLElement) {
  let down = false, startX = 0, startLeft = 0
  const onDown = (e: PointerEvent) => { if (e.button !== 0) return; down = true; startX = e.clientX; startLeft = node.scrollLeft }
  const onMove = (e: PointerEvent) => { if (!down) return; node.scrollLeft = startLeft - (e.clientX - startX) }
  const onUp = () => { down = false }
  node.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  return {
    destroy() {
      node.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }
}
