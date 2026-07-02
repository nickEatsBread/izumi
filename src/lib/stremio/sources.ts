import { persisted } from 'svelte-persisted-store'
export const addonUrls = persisted<string[]>('stremio-addon-urls', [])
// Force https (webview blocks mixed-content http; Torrentio 301s anyway) and decode
// %7C -> | : Torrentio does NOT decode %7C in its config path, so an encoded pipe makes
// it treat the whole "language=..|..|realdebrid=KEY" as one opaque string and ignore the
// debrid key entirely (=> no debrid .url streams).
export const normalizeBase = (u: string) =>
  u.trim().replace(/^http:\/\//i, 'https://').replace(/%7[Cc]/g, '|').replace(/\/manifest\.json\/?$/i, '').replace(/\/$/, '')
