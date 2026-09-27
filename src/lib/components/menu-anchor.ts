// Where a dropdown portalled to <body> sits: fixed at its trigger, under it or over it when below
// has less room (menu-placement.ts). A fixed element renders in LOCAL px while rects and the window
// size are SCREEN px, so everything is divided by the UI-scale zoom, as in preview-pos.ts. Shared by
// the episode toolbar's menus and the season list (EpisodeToolbar.svelte, SeasonPicker.svelte).
import { rootZoom } from '$lib/components/cards/preview-pos'
import { menuPlacement } from '$lib/components/menu-placement'

/** Room between the trigger and the menu, and between the menu and the window edge (local px). */
const GAP = 4
const EDGE = 8

/** A popover's inline style: `end` lines up the right edges, `start` the left ones; `cap` limits
 *  the height in local px. Call it once on open and again once the panel has its real size. */
export function anchoredMenuStyle(button: HTMLElement | undefined, panel: HTMLElement | undefined, align: 'start' | 'end', cap = Infinity): string {
  if (!button) return ''
  const zoom = rootZoom()
  const box = button.getBoundingClientRect()
  const width = window.innerWidth / zoom
  const fit = menuPlacement({
    top: box.top,
    bottom: box.bottom,
    viewport: window.innerHeight,
    zoom,
    content: panel ? Math.min(panel.scrollHeight, cap) : undefined,
    desired: Math.min(260, cap),
  })
  const x = align === 'end'
    ? `right:${Math.max(EDGE, width - box.right / zoom)}px`
    : `left:${Math.max(EDGE, Math.min(box.left / zoom, width - (panel?.offsetWidth ?? 0) - EDGE))}px`
  const y = fit.side === 'down' ? `top:${box.bottom / zoom + GAP}px` : `bottom:${window.innerHeight / zoom - box.top / zoom + GAP}px`
  return `${x};${y};max-height:${Math.min(fit.maxHeight, cap)}px`
}
