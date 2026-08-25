const PREFIX = 'izumi-scroll:'
const RESTORE_CANCEL_EVENTS = ['pointerdown', 'touchstart', 'wheel', 'keydown'] as const
let restoreGeneration = 0
let cleanupPendingRestore: (() => void) | null = null

function key(url: URL) {
  return `${PREFIX}${url.pathname}${url.search}`
}

export function rememberScroll(url: URL) {
  try { sessionStorage.setItem(key(url), String(window.scrollY)) } catch { /* unavailable */ }
}

export function restoreScroll(url: URL) {
  cleanupPendingRestore?.()
  cleanupPendingRestore = null
  const generation = ++restoreGeneration
  let value: string | null = null
  try { value = sessionStorage.getItem(key(url)) } catch { /* unavailable */ }
  if (value == null) {
    // Route restoration is state, not navigation animation. `auto` inherits the app's global
    // smooth-scroll CSS and can keep pulling toward 0 after a Deck finger has started panning.
    window.scrollTo({ top: 0, behavior: 'instant' })
    return
  }
  const top = Number(value)
  let cancelled = false
  const cleanup = () => {
    for (const event of RESTORE_CANCEL_EVENTS) window.removeEventListener(event, cancel, true)
    if (cleanupPendingRestore === cleanup) cleanupPendingRestore = null
  }
  const cancel = () => {
    cancelled = true
    cleanup()
  }
  cleanupPendingRestore = cleanup
  for (const event of RESTORE_CANCEL_EVENTS) window.addEventListener(event, cancel, true)
  requestAnimationFrame(() => requestAnimationFrame(() => {
    cleanup()
    if (cancelled || generation !== restoreGeneration) return
    window.scrollTo({ top: Number.isFinite(top) ? top : 0, behavior: 'instant' })
  }))
}
