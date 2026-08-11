export const CONTINUE_DISMISS_HOLD_MS = 550
const MOVE_TOLERANCE_PX = 12

export interface LongPressOptions {
  onLongPress: () => void
}

/** Touch-only long press for Continue Watching cards. It stays passive until the hold completes,
 * and movement cancels it so horizontal carousel scrolling keeps its native behaviour. */
export function longPressDismiss(node: HTMLElement, initial: LongPressOptions) {
  let options = initial
  let timer: ReturnType<typeof setTimeout> | undefined
  let startX = 0
  let startY = 0
  let suppressClick = false

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  const interactiveTarget = (target: EventTarget | null) => {
    const closest = (target as { closest?: (selector: string) => unknown } | null)?.closest
    return typeof closest === 'function'
      && !!closest.call(target, 'button, a, input, textarea, select, [contenteditable="true"]')
  }

  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || event.button !== 0 || interactiveTarget(event.target)) return
    clear()
    suppressClick = false
    startX = event.clientX
    startY = event.clientY
    timer = setTimeout(() => {
      timer = undefined
      suppressClick = true
      options.onLongPress()
    }, CONTINUE_DISMISS_HOLD_MS)
  }
  const move = (event: PointerEvent) => {
    if (!timer) return
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE_PX) clear()
  }
  const end = () => clear()
  const click = (event: MouseEvent) => {
    if (!suppressClick) return
    suppressClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const contextMenu = (event: MouseEvent) => {
    if (timer || suppressClick) event.preventDefault()
  }

  node.addEventListener('pointerdown', down)
  node.addEventListener('pointermove', move)
  node.addEventListener('pointerup', end)
  node.addEventListener('pointercancel', end)
  node.addEventListener('lostpointercapture', end)
  node.addEventListener('click', click, true)
  node.addEventListener('contextmenu', contextMenu)

  return {
    update(next: LongPressOptions) { options = next },
    destroy() {
      clear()
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', end)
      node.removeEventListener('pointercancel', end)
      node.removeEventListener('lostpointercapture', end)
      node.removeEventListener('click', click, true)
      node.removeEventListener('contextmenu', contextMenu)
    },
  }
}
