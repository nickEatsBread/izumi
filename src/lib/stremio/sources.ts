import { persisted } from 'svelte-persisted-store'
export const addonUrls = persisted<string[]>('stremio-addon-urls', [])
// Force https: the Tauri webview blocks mixed-content http, and Torrentio 301s http->https anyway.
export const normalizeBase = (u: string) =>
  u.trim().replace(/^http:\/\//i, 'https://').replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '')
