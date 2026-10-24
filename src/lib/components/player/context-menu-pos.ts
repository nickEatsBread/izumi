// Where the player's right-click menu opens. Everything is in the player root's own (local) CSS px:
// the caller converts the pointer with the root's local/screen ratio, which also covers the uiScale
// CSS zoom (rects are screen px, absolute left/top are local px).

const EDGE = 8

/** Top-left for a `w`×`h` menu opened at (`x`, `y`) inside a `boundsW`×`boundsH` box. The menu
 *  opens down and to the right of the pointer, flips to the other side when it would cross the far
 *  edge, and is clamped inside the box as a last resort. */
export function placeContextMenu(x: number, y: number, w: number, h: number, boundsW: number, boundsH: number) {
  const axis = (at: number, size: number, bound: number) => {
    const start = at + size > bound - EDGE ? at - size : at
    return Math.max(EDGE, Math.min(start, bound - size - EDGE))
  }
  return { left: axis(x, w, boundsW), top: axis(y, h, boundsH) }
}
