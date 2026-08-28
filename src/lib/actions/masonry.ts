/** Number of CSS grid rows an item needs, including the gap after it. */
export function masonryRowSpan(height: number, rowHeight: number, rowGap: number) {
  if (height <= 0 || rowHeight <= 0) return 1
  return Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)))
}

/**
 * Packs variable-height source cards without making the card in the other column inherit their
 * row height. The parent remains a normal single-column grid below its wide-screen breakpoint.
 */
export function masonryItem(node: HTMLElement) {
  const update = () => {
    const grid = node.closest<HTMLElement>('[data-source-masonry]')
    if (!grid) return

    const style = getComputedStyle(grid)
    const columns = style.gridTemplateColumns.trim().split(/\s+/).filter(Boolean)
    if (columns.length < 2) {
      node.style.removeProperty('grid-row-end')
      return
    }

    const rowHeight = Number.parseFloat(style.gridAutoRows)
    const parsedGap = Number.parseFloat(style.rowGap)
    const rowGap = Number.isFinite(parsedGap) ? parsedGap : 0
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) return

    node.style.gridRowEnd = `span ${masonryRowSpan(
      node.getBoundingClientRect().height,
      rowHeight,
      rowGap,
    )}`
  }

  const observer = new ResizeObserver(update)
  observer.observe(node)
  window.addEventListener('resize', update)
  update()

  return {
    destroy() {
      observer.disconnect()
      window.removeEventListener('resize', update)
      node.style.removeProperty('grid-row-end')
    },
  }
}
