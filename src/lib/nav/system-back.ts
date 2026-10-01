import { handleLayeredBack } from './back'

/** The global MainActivity's OnBackPressedCallback evaluates: `window.__izumiBack?.()===true`. */
export type SystemBackWindow = Window & { __izumiBack?: () => boolean }

/**
 * Phone system Back bridge (spec §5.3). MainActivity (src-tauri/android/MainActivity.kt) calls
 * `window.__izumiBack()` on every phone or tablet Back press, including the back gesture.
 * - true: the layered Back pipeline consumed the press (a layer, dialog, sheet, the keyboard or a
 *   settings level closed).
 * - false: the press goes to stock Back (WebView history, or leaving the app). A shell that has not
 *   mounted yet, or a script error, also reads as "not true" there.
 * Android TV never calls it: its remote Back stays an Escape key event. The single owner of the
 * global. Returns the teardown, which removes only this install's bridge, so a late teardown of an
 * older mount cannot delete a newer one.
 */
export function installSystemBack(target: SystemBackWindow = window as SystemBackWindow): () => void {
  const bridge = () => handleLayeredBack('system')
  target.__izumiBack = bridge
  return () => {
    if (target.__izumiBack === bridge) delete target.__izumiBack
  }
}
