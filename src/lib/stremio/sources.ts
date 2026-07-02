import { persisted } from 'svelte-persisted-store'
export const addonUrls = persisted<string[]>('stremio-addon-urls', [])
// Force https only (the webview blocks mixed-content http). Pass the config path
// verbatim — Torrentio parses its own pipe-separated config either encoded or raw.
export const normalizeBase = (u: string) =>
  u.trim().replace(/^http:\/\//i, 'https://').replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '')
