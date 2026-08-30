<script lang="ts" generics="T">
  import { onMount, tick, type Snippet } from 'svelte'
  import { resolvedGridColumns, virtualGridRange, type VirtualGridRange } from './virtual-grid'

  let {
    items,
    getKey,
    children,
    className = '',
    itemClassName = 'min-w-0',
    overscanViewports = 1,
    endThresholdPx = 900,
    onEndReached,
  }: {
    items: T[]
    getKey: (item: T) => string | number
    children: Snippet<[T, number]>
    className?: string
    itemClassName?: string
    overscanViewports?: number
    endThresholdPx?: number
    onEndReached?: () => void
  } = $props()

  const EMPTY_RANGE: VirtualGridRange = {
    startIndex: 0,
    endIndex: 0,
    startRow: 0,
    endRow: 0,
    totalRows: 0,
    topSpacerPx: 0,
    bottomSpacerPx: 0,
    totalHeightPx: 0,
  }
  const INITIAL_ROWS = 6

  let root = $state<HTMLElement>()
  let columns = $state(1)
  let rowHeight = $state(0)
  let rowGap = $state(0)
  let range = $state<VirtualGridRange>(EMPTY_RANGE)
  let frame = 0
  let lastObservedWidth = -1
  let refreshGeneration = 0

  const initialEnd = $derived(Math.min(items.length, Math.max(12, columns * INITIAL_ROWS)))
  const startIndex = $derived(rowHeight > 0 ? range.startIndex : 0)
  const endIndex = $derived(rowHeight > 0 ? range.endIndex : initialEnd)
  const visibleItems = $derived(items.slice(startIndex, endIndex))

  function visualScale(rect: DOMRect): number {
    const layoutWidth = root?.offsetWidth ?? 0
    const scale = layoutWidth > 0 ? rect.width / layoutWidth : 1
    return Number.isFinite(scale) && scale > 0 ? scale : 1
  }

  function measureRows(): boolean {
    if (!root) return false
    const style = getComputedStyle(root)
    const nextColumns = resolvedGridColumns(style.gridTemplateColumns)
    const nextGap = Number.parseFloat(style.rowGap) || 0
    const rendered = Array.from(root.querySelectorAll<HTMLElement>(':scope > [data-virtual-grid-item]'))
    const measuredHeight = rendered.reduce((height, item) => Math.max(height, item.offsetHeight), 0)
    let changed = false

    if (nextColumns !== columns) {
      columns = nextColumns
      rowHeight = measuredHeight
      changed = true
    } else if (measuredHeight > rowHeight + 0.5) {
      // Grid rows stretch their cells. Retaining the largest measured row keeps spacers stable when
      // a later title wraps to two lines instead of letting the document jump while scrolling back.
      rowHeight = measuredHeight
      changed = true
    }
    if (Math.abs(nextGap - rowGap) > 0.5) {
      rowGap = nextGap
      changed = true
    }
    return changed
  }

  function updateRange(): boolean {
    if (!root || rowHeight <= 0) return false
    const rect = root.getBoundingClientRect()
    const scale = visualScale(rect)
    const next = virtualGridRange({
      itemCount: items.length,
      columns,
      rowHeight,
      rowGap,
      containerTop: rect.top,
      viewportHeight: window.innerHeight,
      scale,
      overscanViewports,
    })
    const changed = next.startIndex !== range.startIndex
      || next.endIndex !== range.endIndex
      || next.topSpacerPx !== range.topSpacerPx
      || next.bottomSpacerPx !== range.bottomSpacerPx
    range = next
    if (rect.bottom <= window.innerHeight + endThresholdPx * scale) onEndReached?.()
    return changed
  }

  async function refresh(resetMeasurement = false) {
    const generation = ++refreshGeneration
    await tick()
    if (generation !== refreshGeneration || !root) return
    if (resetMeasurement) rowHeight = 0
    measureRows()
    // Calculate the first real range while the initial measuring rows still occupy the grid. If we
    // let rowHeight flush first, the empty initial range would briefly remove every item and make
    // the grid look short enough to request an unnecessary extra page.
    const windowChanged = updateRange()
    if (windowChanged || resetMeasurement) {
      await tick()
      if (generation !== refreshGeneration || !root) return
      if (measureRows()) {
        await tick()
        if (generation === refreshGeneration) updateRange()
      }
    }
  }

  function schedule() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (updateRange()) void refresh()
    })
  }

  // Appending a page changes the virtual height. Recalculate immediately so a short first page can
  // request another page until it fills the viewport, matching the old infinite-scroll behavior.
  $effect(() => {
    void items.length
    if (root) void refresh()
  })

  onMount(() => {
    void refresh(true)
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      if (Math.abs(width - lastObservedWidth) < 0.5) return
      lastObservedWidth = width
      void refresh(true)
    })
    if (root) resize?.observe(root)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      resize?.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(frame)
      refreshGeneration++
    }
  })
</script>

<div bind:this={root} class={className} data-virtual-grid data-virtual-total={items.length}>
  {#if rowHeight > 0 && range.topSpacerPx > 0}
    <div aria-hidden="true" data-virtual-grid-spacer style={`grid-column:1/-1;height:${range.topSpacerPx}px`}></div>
  {/if}
  {#each visibleItems as item, localIndex (getKey(item))}
    <div class={itemClassName} data-virtual-grid-item data-virtual-index={startIndex + localIndex}>
      {@render children(item, startIndex + localIndex)}
    </div>
  {/each}
  {#if rowHeight > 0 && range.bottomSpacerPx > 0}
    <div aria-hidden="true" data-virtual-grid-spacer style={`grid-column:1/-1;height:${range.bottomSpacerPx}px`}></div>
  {/if}
</div>
