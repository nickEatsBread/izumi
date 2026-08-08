/** A press ripple, approximating Android's touch feedback in a WebView. Only `transform` and
 *  `opacity` animate, and the node removes itself when the animation ends, so no compositing layer
 *  accumulates on a low-end phone. */

export interface RippleRect { left: number; top: number; width: number; height: number }
export interface RippleGeometry { x: number; y: number; size: number }

/** Where to draw the ripple and how big it must be to reach the furthest corner. Coordinates are
 *  relative to the element; a missing pointer position (keyboard activation) centres it. */
export function rippleGeometry(rect: RippleRect, clientX?: number, clientY?: number): RippleGeometry {
  const x = clientX == null ? rect.width / 2 : clientX - rect.left
  const y = clientY == null ? rect.height / 2 : clientY - rect.top
  const furthestX = Math.max(x, rect.width - x)
  const furthestY = Math.max(y, rect.height - y)
  return { x, y, size: Math.ceil(Math.hypot(furthestX, furthestY) * 2) }
}

export function ripple(node: HTMLElement) {
  const spawn = (event: PointerEvent) => {
    const rect = node.getBoundingClientRect()
    const { x, y, size } = rippleGeometry(rect, event.clientX, event.clientY)
    const span = document.createElement('span')
    span.className = 'ripple-ink'
    span.style.width = span.style.height = `${size}px`
    span.style.left = `${x - size / 2}px`
    span.style.top = `${y - size / 2}px`
    span.addEventListener('animationend', () => span.remove(), { once: true })
    node.appendChild(span)
  }
  node.addEventListener('pointerdown', spawn)
  return { destroy: () => node.removeEventListener('pointerdown', spawn) }
}
