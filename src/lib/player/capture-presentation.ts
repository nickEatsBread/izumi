import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'

export const CAPTURE_CONTROLS_WINDOW = 'capture-controls'
export const CAPTURE_OUTPUT_CLASS = 'izumi-capture-output'

const READY_EVENT = 'player-capture-controls-ready'
const PROBE_EVENT = 'player-capture-controls-probe'
const FRAME_EVENT = 'player-capture-controls-frame'
const PAINTED_EVENT = 'player-capture-controls-painted'
const MIRROR_INTERVAL_MS = 125
const SYNC_INTERVAL_MS = 500
const READY_TIMEOUT_MS = 4_000
const PAINT_TIMEOUT_MS = 1_000

type CaptureControlsFrame = {
  revision: number
  html: string
  documentClass: string
  documentStyle: string
  bodyClass: string
}

export type CapturePresentation = {
  end(): Promise<void>
}

type EventLatch<T> = {
  result: Promise<T>
  cancel(): void
}

let readyTask: Promise<void> | null = null
let ready = false
let revision = 0
let users = 0
let mirrorTimer: ReturnType<typeof setInterval> | undefined
let syncTimer: ReturnType<typeof setInterval> | undefined
let lastHtml = ''
let activeCleanup: (() => Promise<void>) | null = null

async function armEvent<T>(
  name: string,
  accept: (payload: T) => boolean,
  timeoutMs: number,
): Promise<EventLatch<T>> {
  let settle: ((payload: T) => void) | undefined
  let fail: ((error: Error) => void) | undefined
  let unlisten: UnlistenFn | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  unlisten = await listen<T>(name, (event) => {
    if (!accept(event.payload)) return
    if (timer) clearTimeout(timer)
    unlisten?.()
    settle?.(event.payload)
  })
  timer = setTimeout(() => {
    unlisten?.()
    fail?.(new Error(`${name} timed out`))
  }, timeoutMs)
  return {
    result,
    cancel() {
      if (timer) clearTimeout(timer)
      unlisten?.()
    },
  }
}

async function ensureOverlayReady(): Promise<void> {
  if (ready) return
  if (readyTask) return readyTask
  readyTask = (async () => {
    if (platform() !== 'windows') throw new Error('capture controls overlay is unavailable')
    const latch = await armEvent<null>(READY_EVENT, () => true, READY_TIMEOUT_MS)
    let probeTimer: ReturnType<typeof setInterval> | undefined
    try {
      // The window is constructed during native setup, where WebView2 can initialize safely.
      // Verify it exists, then probe repeatedly so an early route-ready event cannot be missed.
      await invoke('capture_controls_overlay_prepare')
      const probe = () => { void emitTo(CAPTURE_CONTROLS_WINDOW, PROBE_EVENT, null).catch(() => {}) }
      probe()
      probeTimer = setInterval(probe, 100)
      await latch.result
      await invoke('capture_controls_overlay_sync')
      ready = true
    } finally {
      if (probeTimer) clearInterval(probeTimer)
      latch.cancel()
    }
  })()
  try {
    await readyTask
  } catch (error) {
    readyTask = null
    throw error
  }
}

function markMirrorState(original: HTMLElement, clone: HTMLElement): void {
  const originalNodes = [original, ...Array.from(original.querySelectorAll<HTMLElement>('*'))]
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))]
  const mark = (element: Element | null, attribute: string) => {
    if (!(element instanceof HTMLElement)) return
    const index = originalNodes.indexOf(element)
    if (index >= 0) cloneNodes[index]?.setAttribute(attribute, '')
  }
  mark(document.activeElement, 'data-capture-focus')
  const hovered = Array.from(document.querySelectorAll<HTMLElement>(':hover')).findLast((node) => original.contains(node))
  mark(hovered ?? null, 'data-capture-hover')
}

function cloneSurface(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement
  markMirrorState(element, clone)
  // The player root receives keyboard focus for shortcuts. Mirroring that focus as an outlined
  // rounded rectangle leaves one antialiased accent pixel at its clipped top-left/sidebar seam.
  // Child controls still retain their focus marker and remain visually identifiable.
  if (clone.classList.contains('izumi-player-root')) clone.removeAttribute('data-capture-focus')
  clone.querySelector('.izumi-capture-root')?.remove()
  // Small chrome that is already represented inside the player can create clipped paint remnants
  // when copied across fixed surfaces. Keep it in the real window, but never serialize it twice.
  clone.querySelectorAll('[data-capture-exclude]').forEach((node) => node.remove())
  // Some expensive panels deliberately remain mounted while closed. Their hidden state can live
  // in component-scoped CSS that is not loaded by the lightweight mirror route, so never copy an
  // explicitly marked inert cache into the visible controls window.
  clone.querySelectorAll('[data-capture-exclude-when-inert][inert]').forEach((node) => node.remove())
  clone.querySelectorAll('video, audio, iframe, script').forEach((node) => node.remove())
  clone.removeAttribute('tabindex')
  clone.classList.add('izumi-capture-copy')
  return clone.outerHTML
}

/** Serialize only app/player chrome. The protected video element deliberately never crosses into
 * the click-through mirror, so the capture window cannot duplicate playback or consume a licence. */
export function captureControlsFrame(nextRevision = ++revision): CaptureControlsFrame {
  const surfaces = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-tauri-drag-region], [data-nav-sidebar], .izumi-player-root',
  ))
  // The titlebar's descendants also carry data-tauri-drag-region in some WebView versions.
  // Do not serialize the same fixed surface twice.
  const roots = surfaces.filter((surface) => !surfaces.some((candidate) => candidate !== surface && candidate.contains(surface)))
  return {
    revision: nextRevision,
    html: roots.map(cloneSurface).join(''),
    documentClass: document.documentElement.className,
    documentStyle: document.documentElement.style.cssText,
    bodyClass: document.body.className,
  }
}

async function publishFrame(waitForPaint: boolean): Promise<void> {
  const frame = captureControlsFrame()
  if (!waitForPaint && frame.html === lastHtml) return
  lastHtml = frame.html
  if (!waitForPaint) {
    await emitTo(CAPTURE_CONTROLS_WINDOW, FRAME_EVENT, frame)
    return
  }
  const latch = await armEvent<number>(PAINTED_EVENT, (payload) => payload === frame.revision, PAINT_TIMEOUT_MS)
  try {
    await emitTo(CAPTURE_CONTROLS_WINDOW, FRAME_EVENT, frame)
    await latch.result
  } finally {
    latch.cancel()
  }
}

function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function beginFallback(): CapturePresentation {
  document.documentElement.classList.add(CAPTURE_OUTPUT_CLASS)
  return {
    async end() {
      document.documentElement.classList.remove(CAPTURE_OUTPUT_CLASS)
    },
  }
}

function captureLease(): CapturePresentation {
  let ended = false
  return {
    async end() {
      if (ended) return
      ended = true
      users = Math.max(0, users - 1)
      if (users > 0) return
      const cleanup = activeCleanup
      activeCleanup = null
      await cleanup?.()
    },
  }
}

/** Warm the reusable controls-only WebView after protected playback reaches its first frame.
 * It stays hidden and does no periodic work until a screenshot/GIF actually starts. */
export async function warmCapturePresentation(): Promise<void> {
  try {
    await ensureOverlayReady()
  } catch {
    // Non-Windows webviews and browser previews use the paint-scoped CSS fallback.
  }
}

/** Keep player chrome visible and interactive on the monitor while removing it from the main
 * WebView's capture surface. The owned mirror is input-transparent; the original opacity-zero
 * controls underneath it continue to receive mouse, keyboard, touch and gamepad input. */
export async function beginCapturePresentation(live: boolean): Promise<CapturePresentation> {
  if (users > 0) {
    users += 1
    return captureLease()
  }

  try {
    await ensureOverlayReady()
    await publishFrame(true)
    await invoke('capture_controls_overlay_present')
  } catch {
    const fallback = beginFallback()
    users = 1
    activeCleanup = fallback.end
    await nextPaint()
    return captureLease()
  }

  document.documentElement.classList.add(CAPTURE_OUTPUT_CLASS)
  await nextPaint()
  users = 1
  if (live) {
    mirrorTimer = setInterval(() => { void publishFrame(false).catch(() => {}) }, MIRROR_INTERVAL_MS)
    syncTimer = setInterval(() => { void invoke('capture_controls_overlay_sync').catch(() => {}) }, SYNC_INTERVAL_MS)
  }
  activeCleanup = async () => {
    if (mirrorTimer) clearInterval(mirrorTimer)
    if (syncTimer) clearInterval(syncTimer)
    mirrorTimer = undefined
    syncTimer = undefined
    lastHtml = ''
    // Restore the real UI before retracting its visually identical mirror; there is no blank
    // frame and input focus remains in the main WebView throughout.
    document.documentElement.classList.remove(CAPTURE_OUTPUT_CLASS)
    await invoke('capture_controls_overlay_hide').catch(() => {})
  }
  return captureLease()
}

export const captureControlsEvents = {
  ready: READY_EVENT,
  probe: PROBE_EVENT,
  frame: FRAME_EVENT,
  painted: PAINTED_EVENT,
}
