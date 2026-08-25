import { invoke } from '@tauri-apps/api/core'

// Game-mode (gamescope) touch survival. Two jobs, both driven by capture-phase window listeners:
//
// 1. HOLD: report finger-down/up edges to Rust (`native_touch_hold`) so the STEAM_TOUCH_CLICK_MODE
//    keepalive never writes mid-gesture — gamescope reroutes a gesture's remaining motion through
//    whatever mode is current per event, so a write landing mid-drag freezes or warps it.
//
// 2. WATCHDOG: recover from a stranded pointer. gamescope can drop a touch-up outright
//    (wlserver_touchup skips the whole release when its mouse_focus_surface is NULL at up-time —
//    e.g. the Steam overlay/OSK appearing under a held finger), and WebKitGTK 2.48-2.50 compiles
//    pointercancel OUT for the GTK port — a lost release therefore strands the (synthesized-mouse)
//    pointer as held FOREVER with no event of any kind. Timeout heuristics are the only possible
//    detector. Recovery releases any stranded pointer capture and replays a synthetic
//    `pointercancel` through the window so store-level cleanup (PlayerOverlay's endStuckScrub)
//    runs; WebKit's internal pointer state is out of JS reach, so every recovered incident is
//    also logged through `gm_log` — the field signal that tells us which failure mode users hit.
const STUCK_MS = 6_000
const CHECK_MS = 2_000
const FOCUS_RECOVERY_MS = 600

type Tracked = { downAt: number; lastAt: number; captured: Element | null }

/** Clear any gesture WebKit lost while a player/comments surface was being hidden, then reassert
 * Gamescope passthrough after the replacement surface has painted. Cross-origin iframes can own
 * the release event, so the parent watchdog cannot rely on seeing pointerup in this transition. */
/** One delayed restore after a screen change. The native side also coalesces writes, so a second
 *  rAF/timeout pair was just extra XWayland round-trips. */
export const GM_TOUCH_RESTORE_DELAY_MS = 120

export function restoreGmTouchAfterTransition(): void {
  window.dispatchEvent(new Event('gm-touch-reset'))
  void invoke('native_touch_hold', { held: false }).catch(() => {})
  window.setTimeout(() => void invoke('restore_native_touch').catch(() => {}), GM_TOUCH_RESTORE_DELAY_MS)
}

/** Start the watchdog; returns the teardown. Call only in Game mode. */
export function initGmTouchWatchdog(): () => void {
  const active = new Map<number, Tracked>()
  let held = false
  let focusRecoveryTimer: number | undefined
  const setHold = (h: boolean) => {
    if (h === held) return
    held = h
    void invoke('native_touch_hold', { held: h }).catch(() => {})
  }
  const down = (e: PointerEvent) => {
    // Controller focus reveal is deliberately smooth, but SteamOS's WebKit can retain its old
    // target when touch interrupts that animation. An instant no-distance scroll aborts the old
    // programmatic animation before native panning owns the same scrolling boxes.
    window.scrollTo({ left: window.scrollX, top: window.scrollY, behavior: 'instant' })
    for (const target of e.composedPath()) {
      if (!(target instanceof HTMLElement)) continue
      if (target.scrollHeight <= target.clientHeight && target.scrollWidth <= target.clientWidth) continue
      target.scrollTo({ left: target.scrollLeft, top: target.scrollTop, behavior: 'instant' })
    }
    // Track EVERY pointer type. WebKitGTK 2.48-2.50 (the shipped Deck runtime) compiles touch
    // pointer events out entirely — every finger arrives as a synthesized MOUSE pointer (id 1) —
    // so the old `pointerType === 'touch'` filter made the watchdog and the keepalive hold inert
    // on the exact platform they were built for. The cost the filter guarded against (a mouse
    // click whose control unmounts losing its release) is covered anyway: the capture-phase
    // window listener still sees the retargeted pointerup, and the 6s watchdog recovers the rest.
    active.set(e.pointerId, { downAt: Date.now(), lastAt: Date.now(), captured: null })
    setHold(true)
  }
  const move = (e: PointerEvent) => {
    const p = active.get(e.pointerId)
    if (p) p.lastAt = Date.now()
  }
  const clear = (e: PointerEvent) => {
    active.delete(e.pointerId)
    // Receiving pointerup/cancel proves Gamescope and WebKit already ended this sequence. The old
    // path still fired XTest + warped the cursor to (0,0) here; that extra pointer transition could
    // interrupt kinetic scrolling and pull the document back toward its previous smooth target.
    // Reserve the native unstick for a release that is actually missing (recover(), below).
    if (!active.size) setHold(false)
  }
  const got = (e: Event) => {
    const pe = e as PointerEvent
    const p = active.get(pe.pointerId)
    if (p) p.captured = e.target as Element
  }
  const lost = (e: Event) => {
    const pe = e as PointerEvent
    const p = active.get(pe.pointerId)
    if (p) p.captured = null
  }
  const recover = (id: number, p: Tracked, why: string) => {
    active.delete(id)
    if (!active.size) setHold(false)
    const hadCapture = !!p.captured
    // NotFoundError on an already-inactive id is expected (and the norm on WebKitGTK >= 2.52
    // where real touch pointerIds die with their sequence).
    try { p.captured?.releasePointerCapture(id) } catch { /* already released */ }
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, bubbles: true }))
    // DOM cleanup alone cannot reach WebKit's internal pointer state — if the compositor swallowed
    // the release, WebKit still believes a button is held and every later tap continues the
    // phantom drag. The X-level fake ButtonRelease is what actually ends the stuck sequence.
    void invoke('gm_touch_unstick').catch(() => {})
    void invoke('gm_log', {
      message: `touch-watchdog: recovered stuck pointer ${id} (${why}, held ${Date.now() - p.downAt}ms, capture=${hadCapture})`,
    }).catch(() => {})
  }
  // A finger legitimately resting still for 6s produces no moves either — accept the false
  // positive: recovery only releases captures and cancels scrub state, which a resting finger
  // isn't using. (Real drags emit moves continuously; taps end in <300ms.)
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [id, p] of [...active]) {
      if (now - p.lastAt > STUCK_MS) recover(id, p, 'stale')
    }
  }, CHECK_MS)
  const reset = () => {
    for (const [id, p] of [...active]) recover(id, p, 'focus-reset')
    active.clear()
    setHold(false)
  }
  const suspendFocusRecovery = () => {
    if (focusRecoveryTimer !== undefined) window.clearTimeout(focusRecoveryTimer)
    focusRecoveryTimer = undefined
  }
  // A brief Gamescope focus wobble can happen *during* a valid swipe (field logs showed one eight
  // milliseconds after pointerdown). Immediate reset used to fake-release and warp that live
  // gesture. On return, recover only pointers which existed at the edge and produced no later
  // move/up for a quiet window. Continued gestures and brand-new touches are left alone.
  const returned = () => {
    suspendFocusRecovery()
    const returnedAt = Date.now()
    const candidates = [...active]
    focusRecoveryTimer = window.setTimeout(() => {
      focusRecoveryTimer = undefined
      for (const [id, pointer] of candidates) {
        if (active.get(id) === pointer && pointer.lastAt <= returnedAt) {
          recover(id, pointer, 'focus-return')
        }
      }
    }, FOCUS_RECOVERY_MS)
    window.setTimeout(() => void invoke('restore_native_touch').catch(() => {}), GM_TOUCH_RESTORE_DELAY_MS)
  }
  const onVisibility = () => (document.visibilityState === 'visible' ? returned() : suspendFocusRecovery())
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', clear, true)
  window.addEventListener('pointercancel', clear, true)
  window.addEventListener('gotpointercapture', got, true)
  window.addEventListener('lostpointercapture', lost, true)
  window.addEventListener('blur', suspendFocusRecovery)
  window.addEventListener('focus', returned)
  window.addEventListener('gm-touch-reset', reset)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    clearInterval(timer)
    suspendFocusRecovery()
    setHold(false)
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', clear, true)
    window.removeEventListener('pointercancel', clear, true)
    window.removeEventListener('gotpointercapture', got, true)
    window.removeEventListener('lostpointercapture', lost, true)
    window.removeEventListener('blur', suspendFocusRecovery)
    window.removeEventListener('focus', returned)
    window.removeEventListener('gm-touch-reset', reset)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
