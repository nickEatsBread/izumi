// One spare YouTube player for the muted trailers (hover previews, hero and series backdrops). Creating a
// player stalls the page for about half a second (measured in WebView2, the same for a bare embed), while
// loading another video into a live one does not. So a trailer that goes away parks its player here, and
// the next one moves it into place with `moveBefore`, which keeps an iframe running, and swaps the video.
// Without `moveBefore` (WebKit) every trailer creates its own player, as before.

interface Parked { frame: HTMLIFrameElement; key: string; drop: ReturnType<typeof setTimeout> }
type Mover = Element & { moveBefore(node: Node, child: Node | null): void }

/** How long an unused player is kept before it is closed (it holds a renderer process). */
export const PARK_MS = 60_000
let parked: Parked | null = null

export const canPool = (): boolean => typeof Element !== 'undefined' && 'moveBefore' in Element.prototype

function lot(): Mover {
  let el = document.getElementById('izumi-youtube-lot')
  if (!el) {
    el = document.createElement('div')
    el.id = 'izumi-youtube-lot'
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:360px;overflow:hidden;visibility:hidden;pointer-events:none'
    document.body.append(el)
  }
  return el as unknown as Mover
}

/** Moves the parked player made with the same embed setup (`key`) to the end of `host`, if there is one. */
export function takePlayer(key: string, host: Element): HTMLIFrameElement | undefined {
  if (!parked || parked.key !== key || !canPool() || !host.isConnected || !parked.frame.isConnected) return undefined
  const { frame, drop } = parked
  clearTimeout(drop)
  parked = null
  ;(host as Mover).moveBefore(frame, null)
  return frame
}

/** Parks a live player for the next trailer: one spare at most, closed after `PARK_MS` unused. False when
 *  it cannot be kept (no `moveBefore`, or the frame already left the page): the caller removes it. */
export function parkPlayer(frame: HTMLIFrameElement, key: string): boolean {
  if (!canPool() || !frame.isConnected) return false
  if (parked && parked.frame !== frame) {
    clearTimeout(parked.drop)
    parked.frame.remove()
  }
  lot().moveBefore(frame, null)
  const drop = setTimeout(() => {
    if (parked?.frame === frame) parked = null
    frame.remove()
  }, PARK_MS)
  parked = { frame, key, drop }
  return true
}

/** Test hook. */
export function clearParkedPlayer(): void {
  if (parked) { clearTimeout(parked.drop); parked.frame.remove() }
  parked = null
}
