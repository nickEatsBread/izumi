import { readable } from 'svelte/store'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** The desktop window is minimised. WebView2 keeps reporting the page as visible then (native occlusion
 *  tracking is off), so anything that should stop on minimise reads this as well as `document.hidden`. */
export const windowMinimized = readable(false, (set) => {
  let win: ReturnType<typeof getCurrentWindow>
  try { win = getCurrentWindow() } catch { return }
  const sync = () => { win.isMinimized().then(set, () => {}) }
  let stop: (() => void) | undefined
  let gone = false
  sync()
  // Minimising and restoring both resize the window.
  win.onResized(sync).then((unlisten) => { if (gone) unlisten(); else stop = unlisten }).catch(() => {})
  return () => { gone = true; stop?.() }
})
