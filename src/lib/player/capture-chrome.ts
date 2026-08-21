/** Temporary document class while a compositor screenshot is taken.
 *  CSS hides `.izumi-hud` for that paint only so the shot is video + subs, not OSD. */
export const PLAYER_CAPTURE_CLASS = 'izumi-capturing'

function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

type CaptureRoot = { classList: { add(token: string): void; remove(token: string): void } }

/** Hide in-webview player chrome for one compositor frame, run `fn`, then restore.
 *  Always restores, even if capture throws. */
export async function withPlayerChromeHidden<T>(
  fn: () => Promise<T>,
  root?: CaptureRoot | null,
): Promise<T> {
  const el = root !== undefined
    ? root
    : (typeof document === 'undefined' ? null : document.documentElement)
  el?.classList.add(PLAYER_CAPTURE_CLASS)
  try {
    await nextPaint()
    return await fn()
  } finally {
    el?.classList.remove(PLAYER_CAPTURE_CLASS)
  }
}
