export interface VirtualGridRangeInput {
  itemCount: number
  columns: number
  rowHeight: number
  rowGap: number
  /** Visual-pixel distance from the viewport top to the grid top. */
  containerTop: number
  viewportHeight: number
  /** Visual pixels per layout/CSS pixel (captures document zoom). */
  scale?: number
  overscanViewports?: number
}

export interface VirtualGridRange {
  startIndex: number
  endIndex: number
  startRow: number
  endRow: number
  totalRows: number
  topSpacerPx: number
  bottomSpacerPx: number
  totalHeightPx: number
}

const finitePositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback

/**
 * Calculate a row-aligned virtual window. Viewport/container coordinates are visual pixels while
 * spacer heights are layout pixels, so document zoom never shifts the selected rows.
 */
export function virtualGridRange({
  itemCount,
  columns,
  rowHeight,
  rowGap,
  containerTop,
  viewportHeight,
  scale = 1,
  overscanViewports = 1,
}: VirtualGridRangeInput): VirtualGridRange {
  const count = Math.max(0, Math.floor(itemCount))
  const cols = Math.max(1, Math.floor(columns))
  const height = finitePositive(rowHeight, 1)
  const gap = Math.max(0, Number.isFinite(rowGap) ? rowGap : 0)
  const visualScale = finitePositive(scale, 1)
  const viewport = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0)
  const overscan = viewport * Math.max(0, Number.isFinite(overscanViewports) ? overscanViewports : 1)
  const totalRows = Math.ceil(count / cols)
  const stride = height + gap
  const visualStride = stride * visualScale
  const viewportStart = -containerTop
  const startRow = Math.min(totalRows, Math.max(0, Math.floor((viewportStart - overscan) / visualStride)))
  const endRow = Math.min(
    totalRows,
    Math.max(startRow, Math.ceil((viewportStart + viewport + overscan) / visualStride)),
  )
  const rowsAfter = Math.max(0, totalRows - endRow)
  const spacerHeight = (rows: number) => rows > 0 ? Math.max(0, rows * stride - gap) : 0

  return {
    startIndex: Math.min(count, startRow * cols),
    endIndex: Math.min(count, endRow * cols),
    startRow,
    endRow,
    totalRows,
    topSpacerPx: spacerHeight(startRow),
    bottomSpacerPx: spacerHeight(rowsAfter),
    totalHeightPx: spacerHeight(totalRows),
  }
}

/** Count resolved CSS grid tracks without splitting spaces inside minmax()/calc(). */
export function resolvedGridColumns(template: string): number {
  const value = template.trim()
  if (!value || value === 'none') return 1
  let depth = 0
  let tracks = 0
  let token = false
  for (const char of value) {
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    if (/\s/.test(char) && depth === 0) {
      if (token) tracks++
      token = false
    } else {
      token = true
    }
  }
  return Math.max(1, tracks + Number(token))
}
