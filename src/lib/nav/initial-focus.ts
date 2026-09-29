/** Focus `node` (or its first `[data-focusable]`) two frames after it mounts, but only while nothing
 *  else holds focus, so a focus restore (Back returning to the card you left) always wins. */
export function focusWhenIdle(node: HTMLElement, enabled: boolean | (() => boolean)) {
  let frame = 0
  let count = 0
  const tick = () => {
    if (++count < 2) { frame = requestAnimationFrame(tick); return }
    const active = document.activeElement
    const on = typeof enabled === 'function' ? enabled() : enabled
    if (!on || (active && active !== document.body) || !node.isConnected) return
    const target = node.matches('[data-focusable]') ? node : node.querySelector<HTMLElement>('[data-focusable]')
    target?.focus({ preventScroll: true })
  }
  frame = requestAnimationFrame(tick)
  return { destroy: () => cancelAnimationFrame(frame) }
}
