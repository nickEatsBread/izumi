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

/** Drop a remembered position, so the next restore of `url` starts at the top. */
export function forgetScroll(url: URL) {
  try { sessionStorage.removeItem(key(url)) } catch { /* unavailable */ }
}

export function restoreScroll(url: URL) {
  cleanupPendingRestore?.()
  cleanupPendingRestore = null
  const generation = ++restoreGeneration
  // A `#id` on the page (a settings search hit's block) was scrolled into view by SvelteKit just
  // before afterNavigate; resetting or restoring here would undo it.
  if (url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1)))) return
  let value: string | null = null
  try { value = sessionStorage.getItem(key(url)) } catch { /* unavailable */ }
  if (value == null) {
    // Route restoration is state, not navigation animation. `auto` inherits the app's global
    // smooth-scroll CSS and can keep pulling toward 0 after a Deck finger has started panning.
    window.scrollTo({ top: 0, behavior: 'instant' })
    return
  }
  const top = Number.isFinite(Number(value)) ? Number(value) : 0
  // A page already long enough (a cached list, Back to a page that kept its rows) is restored in the
  // navigation's own frame, so its first painted frame is already in place. Waiting two frames here
  // painted it at the top first and then jumped: a second flash on every route change.
  const room = typeof document === 'undefined' ? -1 : document.documentElement.scrollHeight - window.innerHeight
  if (top <= room) {
    window.scrollTo({ top, behavior: 'instant' })
    return
  }
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
    window.scrollTo({ top, behavior: 'instant' })
  }))
}

let instantHolds = 0

/** A route change is state, not motion. app.css smooth-scrolls every programmatic window scroll, so
 *  SvelteKit's own reset (to the top, or to a Back's saved spot) slid from the old page's offset: the
 *  new page painted mid-slide, then jumped when restoreScroll landed. Window scrolls stay instant until
 *  `done` (the navigation) settles; overlapping navigations share the hold. */
export function instantScrollUntil(done: Promise<unknown>): void {
  const root = document.documentElement
  instantHolds++
  root.style.scrollBehavior = 'auto'
  void done.catch(() => {}).finally(() => {
    if (--instantHolds === 0) root.style.removeProperty('scroll-behavior')
  })
}
