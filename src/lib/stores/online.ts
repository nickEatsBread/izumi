import { readable } from 'svelte/store'

// Online/offline state, driven by the browser's connectivity events. In a Tauri
// webview these fire the same as in a browser (navigator.onLine + online/offline).
export const online = readable(typeof navigator !== 'undefined' ? navigator.onLine : true, (set) => {
  if (typeof window === 'undefined') return
  const up = () => set(true)
  const down = () => set(false)
  window.addEventListener('online', up)
  window.addEventListener('offline', down)
  return () => {
    window.removeEventListener('online', up)
    window.removeEventListener('offline', down)
  }
})
