import { get, writable } from 'svelte/store'
import { invoke } from '@tauri-apps/api/core'
import { cubicOut } from 'svelte/easing'
import { gameMode } from '$lib/player/session'
import { motionFrame, reducedMotion, type MotionParams } from '$lib/motion/gm-motion'

/** Game-mode menu stage.
 *
 *  Under gamescope nothing in the webview can be drawn over the live video window, and shrinking
 *  the video to a corner tile beside the menus read as a broken picture-in-picture. TV players
 *  pause behind their menus instead, and so does this:
 *
 *    live → freezing   the video pauses and mpv writes that exact frame, subtitles included;
 *    freezing → frozen the webview paints the frame full-size under the menus, then the video
 *                      window unmaps, so the swap is invisible and every menu is ordinary live HTML
 *                      (it scrolls, takes touch and moves focus at the display rate);
 *    frozen → thawing  the menus slide out, the video window maps back over the identical paused
 *                      frame (a source picked from the menu first shows its own first frame), and
 *                      playback resumes if the menu paused it;
 *    thawing → live.
 */
export type GmStage = 'live' | 'freezing' | 'frozen' | 'thawing'

export const gmStage = writable<GmStage>('live')
/** Object URL of the frozen frame; '' while a stage has no frame to show (nothing played yet). */
export const gmFrozenFrame = writable<string | null>(null)

export const GM_PANEL_IN_MS = 220
export const GM_PANEL_OUT_MS = 160
/** A thaw waits for the menus' outros before the video window covers them again. */
export const GM_THAW_DELAY_MS = GM_PANEL_OUT_MS + 30

/** The paused frame as an object URL, or '' when mpv has none to give. */
export async function captureFrozenFrame(): Promise<string> {
  try {
    const data = await invoke<ArrayBuffer | number[]>('player_frame_snapshot')
    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : Array.isArray(data) ? Uint8Array.from(data) : null
    if (!bytes?.length) return ''
    return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
  } catch {
    return ''
  }
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** Resolve once `img` is decoded and a couple of frames have been presented with it, so the video
 *  window can unmap (or map back) without one frame of whatever was under it. */
export async function framePainted(img?: HTMLImageElement | null): Promise<void> {
  if (img?.src) {
    try { await img.decode() } catch { /* a broken frame still leaves the black stage */ }
  }
  await nextFrame()
  await nextFrame()
}

export type GmPanelFrom = 'right' | 'bottom' | 'fade'

const PANEL_MOTION: Record<GmPanelFrom, MotionParams> = {
  right: { opacity: [0, 1], x: [56, 0] },
  bottom: { opacity: [0, 1], y: [28, 0] },
  fade: { opacity: [0, 1] },
}

/** The outro that mirrors {@link gmPanel}, for `out:motion`. Game mode only. */
export function gmPanelOut(from: GmPanelFrom = 'right'): MotionParams {
  return { ...PANEL_MOTION[from], duration: GM_PANEL_OUT_MS, gameModeOnly: true }
}

/** Svelte action for a Game-mode menu surface. While the stage is still freezing the surface is
 *  behind the video window, so it holds its hidden state and slides in once the frozen frame is up;
 *  anywhere else it slides in straight away. The motion is per-frame style writes on an element
 *  pinned to its own layer, like gm-motion, so WebKitGTK never drops a layer as it settles. */
export function gmPanel(node: HTMLElement, from: GmPanelFrom = 'right') {
  if (!get(gameMode)) return {}
  const params = PANEL_MOTION[from]
  let raf = 0
  let revealed = false
  let unsubscribe = () => {}
  const apply = (t: number) => {
    const frame = motionFrame(params, t)
    if (frame.opacity != null) node.style.opacity = String(frame.opacity)
    if (frame.translate) node.style.translate = frame.translate
  }
  const reveal = () => {
    if (revealed) return
    revealed = true
    if (reducedMotion()) { apply(1); return }
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / GM_PANEL_IN_MS)
      apply(cubicOut(t))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
  }
  node.style.transform = 'translateZ(0)'
  apply(0)
  // Decide one frame after mounting: the menu store and the stage flip in the same update.
  raf = requestAnimationFrame(() => {
    unsubscribe = gmStage.subscribe((stage) => { if (stage !== 'freezing') reveal() })
  })
  return {
    destroy() {
      cancelAnimationFrame(raf)
      unsubscribe()
    },
  }
}
